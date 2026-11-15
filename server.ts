import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import type {
  AIAnalysisResult,
  AppSettings,
  AppStatePayload,
  PortfolioHolding,
  PortfolioSummary,
  PriceTrigger,
  SignalAlert,
  TriggerActionHint,
  TriggerConditionType,
  TriggerRepeatMode,
  WatchlistAsset,
  WhatsAppSettings,
} from './src/types/crypto.ts';
import {
  dispatchWebhookNotification,
  runAutonomousStudyCycle,
} from './server/aiEngine.ts';
import {
  fetchMarketSnapshots,
  fetchSingleCoinPriceUsd,
  getAssetChartSeries,
  getPortfolioHistorySeries,
  getUsdBrlRate,
  searchCryptos,
} from './server/marketData.ts';
import {
  computePortfolioSummary,
  DEFAULT_WHATSAPP_SETTINGS,
  evaluatePastAlerts,
  getAccuracyStats,
  getStore,
  loadStore,
  saveStore,
} from './server/store.ts';
import { evaluatePriceTriggers, sendWhatsAppMessage } from './server/whatsapp.ts';

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  loadStore();

  const app = express();
  app.use(express.json());

  // SSE connected clients
  const sseClients = new Set<express.Response>();
  let isStudying = false;
  let nextStudyAt: string | null = null;
  let studyTimer: ReturnType<typeof setInterval> | null = null;
  let marketTimer: ReturnType<typeof setInterval> | null = null;
  let clientCloudActiveUntil = 0;

  function broadcastSSE(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  function getTrackedMarketAssets(): WatchlistAsset[] {
    const store = getStore();
    const map = new Map<string, WatchlistAsset>();
    for (const w of store.watchlist) {
      map.set(w.id, w);
    }
    for (const tx of store.transactions) {
      if (!map.has(tx.coinId)) {
        map.set(tx.coinId, {
          id: tx.coinId,
          symbol: tx.symbol.toUpperCase(),
          name: tx.name,
          binanceSymbol: `${tx.symbol.toUpperCase()}USDT`,
          addedAt: tx.timestamp,
        });
      }
    }
    for (const trig of store.priceTriggers) {
      if (!map.has(trig.coinId)) {
        map.set(trig.coinId, {
          id: trig.coinId,
          symbol: trig.symbol.toUpperCase(),
          name: trig.name,
          binanceSymbol: `${trig.symbol.toUpperCase()}USDT`,
          addedAt: trig.createdAt,
        });
      }
    }
    return Array.from(map.values());
  }

  async function buildStatePayload(forceMarketRefresh = false): Promise<AppStatePayload> {
    const store = getStore();
    const trackedAssets = getTrackedMarketAssets();
    const [snapshots, usdBrlRate] = await Promise.all([
      fetchMarketSnapshots(trackedAssets, forceMarketRefresh),
      getUsdBrlRate(),
    ]);
    evaluatePastAlerts(snapshots);
    if (forceMarketRefresh) {
      await evaluatePriceTriggers(snapshots, usdBrlRate);
    }

    return {
      watchlist: store.watchlist,
      snapshots,
      analyses: store.analyses,
      alerts: store.alerts,
      triggers: store.priceTriggers,
      studyHistory: store.studyHistory,
      settings: store.settings,
      portfolio: computePortfolioSummary(snapshots),
      usdBrlRate,
      isStudying,
      nextStudyAt,
      accuracyStats: getAccuracyStats(),
    };
  }

  async function executeStudy(
    assets?: WatchlistAsset[],
    trigger: 'automatico' | 'manual' | 'novo_ativo' = 'automatico'
  ) {
    if (isStudying) {
      throw new Error('Um ciclo de estudo autônomo já está em andamento.');
    }
    const store = getStore();
    const targetAssets = assets && assets.length > 0 ? assets : store.watchlist;
    if (targetAssets.length === 0) {
      throw new Error('Nenhum ativo cadastrado para estudar.');
    }
    isStudying = true;
    broadcastSSE('study_status', { isStudying: true, trigger });

    try {
      const snapshots = await fetchMarketSnapshots(store.watchlist, true);
      const result = await runAutonomousStudyCycle(
        targetAssets,
        snapshots,
        trigger,
        (prog) => broadcastSSE('study_progress', prog)
      );

      scheduleNextStudyTimer();
      const fullState = await buildStatePayload(false);
      broadcastSSE('study_completed', {
        cycle: result.cycle,
        newAlerts: result.newAlerts,
        state: fullState,
      });

      return result;
    } finally {
      isStudying = false;
      broadcastSSE('study_status', { isStudying: false });
    }
  }

  function scheduleNextStudyTimer() {
    if (studyTimer) {
      clearInterval(studyTimer);
      studyTimer = null;
    }
    const store = getStore();
    if (!store.settings.autoStudyEnabled) {
      nextStudyAt = null;
      return;
    }

    const intervalMs = Math.max(1, store.settings.intervalMinutes) * 60_000;
    nextStudyAt = new Date(Date.now() + intervalMs).toISOString();

    studyTimer = setInterval(async () => {
      const currentStore = getStore();
      if (
        isStudying ||
        !currentStore.settings.autoStudyEnabled ||
        currentStore.watchlist.length === 0
      ) {
        return;
      }
      try {
        await executeStudy(undefined, 'automatico');
      } catch (err) {
        console.error('Erro no ciclo automático de estudo:', err);
      }
    }, intervalMs);
  }

  // Periodic live price refresh every 5 seconds pushed via SSE and running 24/7 for active triggers
  marketTimer = setInterval(async () => {
    const store = getStore();
    const hasActiveTriggers = store.priceTriggers.some((t) => t.enabled);
    if (sseClients.size === 0 && !hasActiveTriggers) return;
    try {
      const trackedAssets = getTrackedMarketAssets();
      if (trackedAssets.length === 0) return;
      const [snapshots, usdBrlRate] = await Promise.all([
        fetchMarketSnapshots(trackedAssets, true),
        getUsdBrlRate(),
      ]);
      evaluatePastAlerts(snapshots);
      const isCloudClientActive = Date.now() < clientCloudActiveUntil;
      const { triggeredAlerts } = isCloudClientActive
        ? { triggeredAlerts: [] }
        : await evaluatePriceTriggers(snapshots, usdBrlRate);

      if (sseClients.size > 0) {
        broadcastSSE('market_tick', {
          snapshots,
          usdBrlRate,
          accuracyStats: getAccuracyStats(),
          alerts: store.alerts,
          triggers: store.priceTriggers,
          portfolio: computePortfolioSummary(snapshots),
        });
        if (triggeredAlerts.length > 0) {
          broadcastSSE('trigger_fired', {
            alerts: triggeredAlerts,
            triggers: store.priceTriggers,
          });
        }
      }
    } catch {
      // silent retry on next tick
    }
  }, 5_000);

  // API Routes
  app.get('/api/state', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === '1';
      const payload = await buildStatePayload(forceRefresh);
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao carregar estado do mercado.' });
    }
  });

  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, isStudying, nextStudyAt })}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
    }, 25_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  app.get('/api/chart/:coinId', async (req, res) => {
    try {
      const { coinId } = req.params;
      const rangeParam = req.query.range;
      const symbolParam = String(req.query.symbol ?? '').trim();
      const range: '24h' | '7d' | '30d' =
        rangeParam === '24h' || rangeParam === '30d' ? rangeParam : '7d';

      const asset: WatchlistAsset | undefined =
        getStore().watchlist.find((a) => a.id === coinId) ??
        (symbolParam
          ? {
              id: coinId,
              symbol: symbolParam.toUpperCase(),
              name: coinId,
              binanceSymbol: `${symbolParam.toUpperCase()}USDT`,
              addedAt: new Date().toISOString(),
            }
          : undefined);
      if (!asset) {
        return res.status(404).json({ error: 'Criptoativo não encontrado na lista.' });
      }

      const points = await getAssetChartSeries(asset, range);
      res.json({ coinId, range, points });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao carregar gráfico.' });
    }
  });

  app.get('/api/search', async (req, res) => {
    try {
      const q = String(req.query.q ?? '');
      const results = await searchCryptos(q);
      res.json({ results });
    } catch {
      res.json({ results: [] });
    }
  });

  app.get('/api/price', async (req, res) => {
    try {
      const coinId = String(req.query.coinId ?? '').trim();
      const symbol = String(req.query.symbol ?? '').trim();
      if (!coinId || !symbol) {
        return res.status(400).json({ error: 'coinId e symbol são obrigatórios.' });
      }
      const priceUsd = await fetchSingleCoinPriceUsd(coinId, symbol);
      res.json({ priceUsd });
    } catch {
      res.json({ priceUsd: null });
    }
  });

  app.post('/api/watchlist', async (req, res) => {
    try {
      const { id, symbol, name } = req.body as {
        id?: string;
        symbol?: string;
        name?: string;
      };
      if (!id || !symbol || !name) {
        return res.status(400).json({ error: 'Campos id, symbol e name são obrigatórios.' });
      }

      const store = getStore();
      const exists = store.watchlist.find((a) => a.id === id);
      if (exists) {
        return res.status(409).json({ error: `${symbol} já está na lista de monitoramento.` });
      }

      const newAsset: WatchlistAsset = {
        id,
        symbol: symbol.toUpperCase(),
        name,
        binanceSymbol: `${symbol.toUpperCase()}USDT`,
        addedAt: new Date().toISOString(),
      };

      store.watchlist.push(newAsset);
      saveStore();

      const snapshots = await fetchMarketSnapshots(store.watchlist, true);
      const fullState = await buildStatePayload(false);
      res.json({ asset: newAsset, state: fullState, snapshots });

      if (!isStudying && process.env.GEMINI_API_KEY) {
        void executeStudy([newAsset], 'novo_ativo').catch((aiErr) => {
          console.warn('Estudo imediato do novo ativo falhou:', aiErr);
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao adicionar criptoativo.' });
    }
  });

  app.delete('/api/watchlist/:coinId', async (req, res) => {
    try {
      const { coinId } = req.params;
      const store = getStore();
      store.watchlist = store.watchlist.filter((a) => a.id !== coinId);
      delete store.analyses[coinId];
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao remover ativo.' });
    }
  });

  app.post('/api/study/run', async (req, res) => {
    try {
      const coinId = req.body?.coinId as string | undefined;
      const store = getStore();
      const assets = coinId
        ? store.watchlist.filter((a) => a.id === coinId)
        : store.watchlist;

      if (assets.length === 0) {
        return res.status(404).json({ error: 'Nenhum ativo encontrado para estudar.' });
      }

      const result = await executeStudy(assets, 'manual');
      const fullState = await buildStatePayload(false);
      res.json({
        cycle: result.cycle,
        newAlerts: result.newAlerts,
        state: fullState,
      });
    } catch (err: any) {
      const message = err?.message || 'Falha ao executar estudo de IA.';
      const status = message.includes('andamento') ? 409 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.patch('/api/settings', async (req, res) => {
    try {
      const store = getStore();
      const patch = req.body as Partial<typeof store.settings>;
      const waPatch = patch.whatsapp as Partial<WhatsAppSettings> | undefined;
      store.settings = {
        ...store.settings,
        ...(typeof patch.autoStudyEnabled === 'boolean'
          ? { autoStudyEnabled: patch.autoStudyEnabled }
          : {}),
        ...(typeof patch.intervalMinutes === 'number'
          ? { intervalMinutes: Math.max(1, Math.min(120, patch.intervalMinutes)) }
          : {}),
        ...(patch.currency === 'USD' || patch.currency === 'BRL'
          ? { currency: patch.currency }
          : {}),
        ...(typeof patch.minConfidenceForAlert === 'number'
          ? { minConfidenceForAlert: Math.max(40, Math.min(95, patch.minConfidenceForAlert)) }
          : {}),
        ...(typeof patch.webhookUrl === 'string'
          ? { webhookUrl: patch.webhookUrl.trim() }
          : {}),
        whatsapp: waPatch
          ? {
              ...DEFAULT_WHATSAPP_SETTINGS,
              ...(store.settings.whatsapp ?? {}),
              ...(typeof waPatch.enabled === 'boolean' ? { enabled: waPatch.enabled } : {}),
              ...(waPatch.provider === 'callmebot' ||
              waPatch.provider === 'webhook_rest' ||
              waPatch.provider === 'meta_cloud'
                ? { provider: waPatch.provider }
                : {}),
              ...(typeof waPatch.phoneNumber === 'string'
                ? { phoneNumber: waPatch.phoneNumber.trim() }
                : {}),
              ...(typeof waPatch.callMeBotApiKey === 'string'
                ? { callMeBotApiKey: waPatch.callMeBotApiKey.trim() }
                : {}),
              ...(typeof waPatch.customWebhookUrl === 'string'
                ? { customWebhookUrl: waPatch.customWebhookUrl.trim() }
                : {}),
              ...(typeof waPatch.customWebhookToken === 'string'
                ? { customWebhookToken: waPatch.customWebhookToken.trim() }
                : {}),
              ...(typeof waPatch.metaPhoneNumberId === 'string'
                ? { metaPhoneNumberId: waPatch.metaPhoneNumberId.trim() }
                : {}),
              ...(typeof waPatch.metaAccessToken === 'string'
                ? { metaAccessToken: waPatch.metaAccessToken.trim() }
                : {}),
              ...(typeof waPatch.forwardAiSignals === 'boolean'
                ? { forwardAiSignals: waPatch.forwardAiSignals }
                : {}),
            }
          : store.settings.whatsapp,
      };
      saveStore();
      scheduleNextStudyTimer();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao atualizar configurações.' });
    }
  });

  app.post('/api/whatsapp/test', async (req, res) => {
    try {
      const store = getStore();
      const bodyWa = (req.body?.whatsapp ?? req.body ?? {}) as Partial<WhatsAppSettings>;
      const merged: WhatsAppSettings = {
        ...DEFAULT_WHATSAPP_SETTINGS,
        ...(store.settings.whatsapp ?? {}),
        ...bodyWa,
      };
      const testText =
        '*SinalCripto IA — Teste de Conexão 24h*\n\nSeu WhatsApp está conectado e pronto para receber automaticamente seus gatilhos de queda, alta e sinais da IA 24 horas por dia.';
      const result = await sendWhatsAppMessage(merged, testText, { type: 'whatsapp_test' });
      if (!result.ok) {
        return res.status(400).json({ error: result.error || 'Falha ao enviar mensagem de teste.' });
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao testar WhatsApp.' });
    }
  });

  app.post('/api/settings/test-webhook', async (req, res) => {
    try {
      const webhookUrl = String(req.body?.webhookUrl || getStore().settings.webhookUrl || '').trim();
      if (!webhookUrl) {
        return res.status(400).json({ error: 'Informe uma URL de webhook válida.' });
      }
      const ok = await dispatchWebhookNotification(webhookUrl, [
        {
          id: 'test_webhook',
          coinId: 'bitcoin',
          symbol: 'BTC',
          name: 'Bitcoin',
          action: 'COMPRAR',
          confidence: 82,
          priceAtSignalUsd: 90000,
          targetPriceUsd: 95000,
          stopLossUsd: 87000,
          headline: 'Teste de integração de alertas automáticos do SinalCripto IA',
          reason: 'Mensagem de verificação enviada pelo painel de configurações.',
          createdAt: new Date().toISOString(),
          read: true,
          outcome: 'em_aberto',
        },
      ]);
      if (!ok) {
        return res.status(502).json({ error: 'O servidor de destino rejeitou ou não respondeu ao webhook.' });
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao testar webhook.' });
    }
  });

  app.post('/api/alerts/mark-read', (_req, res) => {
    const store = getStore();
    for (const alert of store.alerts) {
      alert.read = true;
    }
    saveStore();
    res.json({ ok: true, alerts: store.alerts });
  });

  // Portfolio endpoints
  app.get('/api/portfolio/history', async (req, res) => {
    try {
      const rangeParam = String(req.query.range || '7d');
      const range: '24h' | '7d' | '30d' | '90d' | 'all' =
        rangeParam === '24h' ||
        rangeParam === '30d' ||
        rangeParam === '90d' ||
        rangeParam === 'all'
          ? rangeParam
          : '7d';

      const store = getStore();
      const snapshots = await fetchMarketSnapshots(store.watchlist, false);
      const portfolio = computePortfolioSummary(snapshots);
      const activeHoldings = portfolio.holdings.filter((h) => h.quantity > 0);
      const points = await getPortfolioHistorySeries(
        activeHoldings,
        portfolio.totalCostBasisUsd,
        range
      );

      res.json({ range, points });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao calcular histórico da carteira.' });
    }
  });

  app.patch('/api/portfolio/meta', async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim();
      if (!name) {
        return res.status(400).json({ error: 'Informe um nome válido para a carteira.' });
      }
      const store = getStore();
      store.portfolioName = name.slice(0, 40);
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao renomear carteira.' });
    }
  });

  app.post('/api/portfolio/transactions', async (req, res) => {
    try {
      const { coinId, symbol, name, type, quantity, pricePerCoinUsd, feeUsd, timestamp, note } =
        req.body as {
          coinId?: string;
          symbol?: string;
          name?: string;
          type?: 'compra' | 'venda' | 'ganho';
          quantity?: number;
          pricePerCoinUsd?: number;
          feeUsd?: number;
          timestamp?: string;
          note?: string;
        };

      if (!coinId || !symbol || !name) {
        return res.status(400).json({ error: 'Selecione um criptoativo válido.' });
      }
      if (type !== 'compra' && type !== 'venda' && type !== 'ganho') {
        return res.status(400).json({ error: 'Tipo deve ser compra, venda ou ganho.' });
      }
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Informe uma quantidade maior que zero.' });
      }

      const unitPrice = type === 'ganho' ? Math.max(0, Number(pricePerCoinUsd) || 0) : Number(pricePerCoinUsd);
      if (type !== 'ganho' && (!Number.isFinite(unitPrice) || unitPrice <= 0)) {
        return res.status(400).json({ error: 'Informe um preço unitário válido.' });
      }

      const store = getStore();
      const upperSym = symbol.toUpperCase();

      // Auto-sync asset into AI watchlist so the robot monitors and computes signals for it
      const existingAsset = store.watchlist.find((a) => a.id === coinId);
      let addedNewAsset: WatchlistAsset | null = null;
      if (!existingAsset) {
        addedNewAsset = {
          id: coinId,
          symbol: upperSym,
          name,
          binanceSymbol: `${upperSym}USDT`,
          addedAt: new Date().toISOString(),
        };
        store.watchlist.push(addedNewAsset);
      }

      const tx = {
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        coinId,
        symbol: upperSym,
        name,
        type,
        quantity: qty,
        pricePerCoinUsd: Number.isFinite(unitPrice) ? unitPrice : 0,
        feeUsd: Math.max(0, Number(feeUsd) || 0),
        timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
        note: note ? String(note).slice(0, 140) : undefined,
      };

      store.transactions.push(tx);
      saveStore();

      // Fetch snapshot immediately for the added asset and return saved state right away
      await fetchMarketSnapshots(store.watchlist, true);
      const fullState = await buildStatePayload(false);
      res.json({ transaction: tx, state: fullState });

      // Run AI study on new asset in background and broadcast via SSE
      if (addedNewAsset && !isStudying && process.env.GEMINI_API_KEY) {
        void executeStudy([addedNewAsset], 'novo_ativo').catch((aiErr) => {
          console.warn('Estudo imediato do ativo da carteira falhou:', aiErr);
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao registrar transação.' });
    }
  });

  app.delete('/api/portfolio/transactions/:txId', async (req, res) => {
    try {
      const { txId } = req.params;
      const store = getStore();
      const before = store.transactions.length;
      store.transactions = store.transactions.filter((t) => t.id !== txId);
      if (store.transactions.length === before) {
        return res.status(404).json({ error: 'Transação não encontrada.' });
      }
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao remover transação.' });
    }
  });

  app.delete('/api/portfolio/transactions', async (_req, res) => {
    try {
      const store = getStore();
      store.transactions = [];
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao limpar histórico de transações.' });
    }
  });

  app.delete('/api/portfolio/assets/:coinId', async (req, res) => {
    try {
      const { coinId } = req.params;
      const store = getStore();
      store.transactions = store.transactions.filter((t) => t.coinId !== coinId);
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao excluir histórico do ativo na carteira.' });
    }
  });

  app.delete('/api/alerts/:alertId', async (req, res) => {
    try {
      const { alertId } = req.params;
      const store = getStore();
      store.alerts = store.alerts.filter((a) => a.id !== alertId);
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao excluir alerta.' });
    }
  });

  app.delete('/api/alerts', async (_req, res) => {
    try {
      const store = getStore();
      store.alerts = [];
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao limpar alertas.' });
    }
  });

  app.delete('/api/study-history/:cycleId', async (req, res) => {
    try {
      const { cycleId } = req.params;
      const store = getStore();
      store.studyHistory = store.studyHistory.filter((c) => c.id !== cycleId);
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao excluir registro de estudo.' });
    }
  });

  app.delete('/api/study-history', async (_req, res) => {
    try {
      const store = getStore();
      store.studyHistory = [];
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao limpar histórico de estudos.' });
    }
  });

  // 24/7 Price Triggers & WhatsApp Alerts endpoints
  app.post('/api/triggers', async (req, res) => {
    try {
      const {
        coinId,
        symbol,
        name,
        conditionType,
        targetValue,
        referencePriceUsd,
        actionHint,
        repeatMode,
        cooldownMinutes,
        sendWhatsApp,
        note,
      } = req.body as {
        coinId?: string;
        symbol?: string;
        name?: string;
        conditionType?: TriggerConditionType;
        targetValue?: number;
        referencePriceUsd?: number;
        actionHint?: TriggerActionHint;
        repeatMode?: TriggerRepeatMode;
        cooldownMinutes?: number;
        sendWhatsApp?: boolean;
        note?: string;
      };

      if (!coinId || !symbol || !name) {
        return res.status(400).json({ error: 'Selecione um criptoativo válido.' });
      }
      if (
        conditionType !== 'queda_pct' &&
        conditionType !== 'alta_pct' &&
        conditionType !== 'abaixo_preco' &&
        conditionType !== 'acima_preco'
      ) {
        return res.status(400).json({ error: 'Tipo de condição inválido.' });
      }
      const parsedTarget = Number(targetValue);
      if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
        return res.status(400).json({ error: 'Informe um valor alvo maior que zero.' });
      }
      if (
        (conditionType === 'queda_pct' || conditionType === 'alta_pct') &&
        parsedTarget > 99.9 &&
        conditionType === 'queda_pct'
      ) {
        return res.status(400).json({ error: 'Percentual de queda deve ser menor que 100%.' });
      }

      const store = getStore();
      const upperSym = symbol.toUpperCase();

      let refUsd = Number(referencePriceUsd) || 0;
      if (refUsd <= 0) {
        const fetched = await fetchSingleCoinPriceUsd(coinId, upperSym);
        if (fetched && fetched > 0) refUsd = fetched;
      }

      const newTrigger: PriceTrigger = {
        id: `trig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        coinId,
        symbol: upperSym,
        name,
        conditionType,
        targetValue: parsedTarget,
        referencePriceUsd: refUsd,
        actionHint:
          actionHint === 'COMPRAR' || actionHint === 'VENDER' || actionHint === 'AVALIAR'
            ? actionHint
            : 'COMPRAR',
        repeatMode: repeatMode === 'continuo' ? 'continuo' : 'uma_vez',
        cooldownMinutes: Math.max(1, Math.min(1440, Number(cooldownMinutes) || 60)),
        enabled: true,
        sendWhatsApp: typeof sendWhatsApp === 'boolean' ? sendWhatsApp : true,
        note: note ? String(note).trim().slice(0, 140) : undefined,
        createdAt: new Date().toISOString(),
        triggerCount: 0,
      };

      store.priceTriggers.unshift(newTrigger);
      saveStore();

      const fullState = await buildStatePayload(true);
      res.json({ trigger: newTrigger, state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao salvar gatilho.' });
    }
  });

  app.patch('/api/triggers/:triggerId', async (req, res) => {
    try {
      const { triggerId } = req.params;
      const store = getStore();
      const trig = store.priceTriggers.find((t) => t.id === triggerId);
      if (!trig) {
        return res.status(404).json({ error: 'Gatilho não encontrado.' });
      }
      const patch = req.body as Partial<PriceTrigger> & { resetReference?: boolean };
      if (typeof patch.enabled === 'boolean') trig.enabled = patch.enabled;
      if (typeof patch.sendWhatsApp === 'boolean') trig.sendWhatsApp = patch.sendWhatsApp;
      if (typeof patch.targetValue === 'number' && Number.isFinite(patch.targetValue) && patch.targetValue > 0) {
        trig.targetValue = patch.targetValue;
      }
      if (patch.actionHint === 'COMPRAR' || patch.actionHint === 'VENDER' || patch.actionHint === 'AVALIAR') {
        trig.actionHint = patch.actionHint;
      }
      if (patch.repeatMode === 'uma_vez' || patch.repeatMode === 'continuo') {
        trig.repeatMode = patch.repeatMode;
      }
      if (patch.resetReference) {
        const live = await fetchSingleCoinPriceUsd(trig.coinId, trig.symbol);
        if (live && live > 0) {
          trig.referencePriceUsd = live;
        }
      }
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ trigger: trig, state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao atualizar gatilho.' });
    }
  });

  app.delete('/api/triggers/:triggerId', async (req, res) => {
    try {
      const { triggerId } = req.params;
      const store = getStore();
      store.priceTriggers = store.priceTriggers.filter((t) => t.id !== triggerId);
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao excluir gatilho.' });
    }
  });

  app.delete('/api/triggers', async (_req, res) => {
    try {
      const store = getStore();
      store.priceTriggers = [];
      saveStore();
      const fullState = await buildStatePayload(false);
      res.json({ state: fullState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao limpar gatilhos.' });
    }
  });

  // Multi-device Cloud Sync helper routes (stateless market, history, AI study & WhatsApp relay)
  app.post('/api/market/snapshots', async (req, res) => {
    try {
      const assets = Array.isArray(req.body?.assets) ? (req.body.assets as WatchlistAsset[]) : [];
      const forceRefresh = Boolean(req.body?.forceRefresh);
      const [snapshots, usdBrlRate] = await Promise.all([
        fetchMarketSnapshots(assets, forceRefresh),
        getUsdBrlRate(),
      ]);
      res.json({ snapshots, usdBrlRate });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao buscar cotações ao vivo.' });
    }
  });

  app.post('/api/portfolio/history', async (req, res) => {
    try {
      const rangeParam = String(req.body?.range || '7d');
      const range: '24h' | '7d' | '30d' | '90d' | 'all' =
        rangeParam === '24h' ||
        rangeParam === '30d' ||
        rangeParam === '90d' ||
        rangeParam === 'all'
          ? rangeParam
          : '7d';
      const holdings = Array.isArray(req.body?.holdings)
        ? (req.body.holdings as PortfolioHolding[]).filter((h) => h.quantity > 0)
        : [];
      const totalCostBasisUsd = Number(req.body?.totalCostBasisUsd) || 0;
      const points = await getPortfolioHistorySeries(holdings, totalCostBasisUsd, range);
      res.json({ range, points });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao calcular histórico da carteira.' });
    }
  });

  app.post('/api/study/cloud-run', async (req, res) => {
    try {
      const {
        assetsToStudy,
        allTrackedAssets,
        previousAnalyses,
        recentAlerts,
        portfolioSummary,
        settings,
        accuracyStats,
        trigger,
      } = req.body as {
        assetsToStudy?: WatchlistAsset[];
        allTrackedAssets?: WatchlistAsset[];
        previousAnalyses?: Record<string, AIAnalysisResult>;
        recentAlerts?: SignalAlert[];
        portfolioSummary?: PortfolioSummary;
        settings?: AppSettings;
        accuracyStats?: {
          totalEvaluated: number;
          hits: number;
          neutrals: number;
          misses: number;
          accuracyPct: number | null;
        };
        trigger?: 'automatico' | 'manual' | 'novo_ativo';
      };

      const targets = Array.isArray(assetsToStudy) ? assetsToStudy : [];
      if (targets.length === 0) {
        return res.status(400).json({ error: 'Nenhum ativo informado para estudo.' });
      }
      const snapshots = await fetchMarketSnapshots(
        Array.isArray(allTrackedAssets) && allTrackedAssets.length > 0
          ? allTrackedAssets
          : targets,
        true
      );
      const result = await runAutonomousStudyCycle(
        targets,
        snapshots,
        trigger ?? 'manual',
        (prog) => broadcastSSE('study_progress', prog),
        {
          previousAnalyses: previousAnalyses ?? {},
          recentAlerts: recentAlerts ?? [],
          portfolioSummary: portfolioSummary ?? {
            name: 'MINHA CARTEIRA',
            totalValueUsd: 0,
            totalCostBasisUsd: 0,
            allTimeProfitUsd: 0,
            allTimeProfitPct: 0,
            change24hUsd: 0,
            change24hPct: 0,
            holdings: [],
            transactions: [],
            bestPerformer: null,
            worstPerformer: null,
          },
          settings: settings ?? getStore().settings,
          accuracyStats: accuracyStats ?? {
            totalEvaluated: 0,
            hits: 0,
            neutrals: 0,
            misses: 0,
            accuracyPct: null,
          },
        }
      );

      res.json({
        cycle: result.cycle,
        newAlerts: result.newAlerts,
        returnedAnalysesList: result.returnedAnalysesList,
        snapshots,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Falha ao executar estudo de IA.' });
    }
  });

  app.post('/api/whatsapp/send', async (req, res) => {
    try {
      const store = getStore();
      const bodyWa = (req.body?.whatsapp ?? {}) as Partial<WhatsAppSettings>;
      const merged: WhatsAppSettings = {
        ...DEFAULT_WHATSAPP_SETTINGS,
        ...(store.settings.whatsapp ?? {}),
        ...bodyWa,
      };
      const text = String(req.body?.text ?? '').trim();
      if (!text) {
        return res.status(400).json({ error: 'Texto da mensagem é obrigatório.' });
      }
      const result = await sendWhatsAppMessage(merged, text, req.body?.metadata);
      if (!result.ok) {
        return res.status(400).json({ error: result.error || 'Falha ao enviar WhatsApp.' });
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Erro ao enviar WhatsApp.' });
    }
  });

  app.post('/api/sync', (req, res) => {
    try {
      const store = getStore();
      const body = req.body as Partial<{
        watchlist: WatchlistAsset[];
        priceTriggers: PriceTrigger[];
        settings: AppSettings;
        clientActiveMs: number;
      }>;
      if (Array.isArray(body.watchlist)) store.watchlist = body.watchlist;
      if (Array.isArray(body.priceTriggers)) store.priceTriggers = body.priceTriggers;
      if (body.settings) {
        store.settings = {
          ...store.settings,
          ...body.settings,
          whatsapp: {
            ...DEFAULT_WHATSAPP_SETTINGS,
            ...(body.settings.whatsapp ?? {}),
          },
        };
      }
      if (typeof body.clientActiveMs === 'number' && body.clientActiveMs > 0) {
        clientCloudActiveUntil = Date.now() + body.clientActiveMs;
      }
      saveStore();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Falha ao sincronizar fundo 24h.' });
    }
  });

  // Guarantee /api/* never returns HTML/text 404 from SPA wildcard
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint de API não encontrado.' });
  });

  // Vite dev middleware or production static build
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SinalCripto IA rodando em http://0.0.0.0:${PORT}`);
    scheduleNextStudyTimer();

    const store = getStore();
    const hasAnalyses = Object.keys(store.analyses).length >= store.watchlist.length;
    if (store.watchlist.length > 0 && !hasAnalyses && process.env.GEMINI_API_KEY) {
      setTimeout(() => {
        if (!isStudying && getStore().watchlist.length > 0) {
          executeStudy(undefined, 'automatico').catch((err) => {
            console.warn('Estudo inicial automático falhou:', err?.message ?? err);
          });
        }
      }, 1500);
    }
  });

  process.on('SIGTERM', () => {
    if (studyTimer) clearInterval(studyTimer);
    if (marketTimer) clearInterval(marketTimer);
    process.exit(0);
  });
}

startServer();
