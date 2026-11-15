import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AIAnalysisResult,
  AppSettings,
  MarketSnapshot,
  PortfolioHolding,
  PortfolioSummary,
  SignalAction,
  SignalAlert,
  StudyCycleSummary,
  WatchlistAsset,
} from '../src/types/crypto.ts';
import {
  computePortfolioSummary,
  evaluatePastAlerts,
  getAccuracyStats,
  getStore,
  saveStore,
} from './store.ts';
import { getUsdBrlRate } from './marketData.ts';
import {
  formatAiAlertsWhatsAppText,
  isWhatsAppConfigured,
  sendWhatsAppMessage,
} from './whatsapp.ts';
import {
  formatAiAlertsTelegramHtml,
  isTelegramConfigured,
  sendTelegramMessage,
} from './telegram.ts';
import { applyPortfolioProtectionPolicy } from '../src/utils/verdictPolicy.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada no ambiente do servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.code;
      // Do not retry auth or invalid model errors
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        throw err;
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 900 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export async function dispatchWebhookNotification(
  webhookUrl: string,
  alerts: SignalAlert[]
): Promise<boolean> {
  if (!webhookUrl || alerts.length === 0) return false;
  try {
    const lines = alerts.map(
      (a) =>
        `• **${a.symbol} (${a.name})**: **${a.action}** (Confiança ${a.confidence}%) @ US$ ${a.priceAtSignalUsd.toLocaleString('en-US', { maximumFractionDigits: 6 })} — ${a.headline}`
    );
    const content = `**SinalCripto IA — Novas Sugestões Automáticas**\n${lines.join('\n')}`;

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        text: content,
        source: 'SinalCripto IA',
        alerts,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface StatelessStudyContext {
  previousAnalyses: Record<string, AIAnalysisResult>;
  recentAlerts: SignalAlert[];
  portfolioSummary: PortfolioSummary;
  settings: AppSettings;
  accuracyStats: {
    totalEvaluated: number;
    hits: number;
    neutrals: number;
    misses: number;
    accuracyPct: number | null;
  };
}

export async function runAutonomousStudyCycle(
  assetsToStudy: WatchlistAsset[],
  snapshots: Record<string, MarketSnapshot>,
  trigger: 'automatico' | 'manual' | 'novo_ativo' = 'automatico',
  onProgress?: (event: { type: string; message: string }) => void,
  statelessContext?: StatelessStudyContext
): Promise<{
  cycle: StudyCycleSummary;
  newAlerts: SignalAlert[];
  analyses: Record<string, AIAnalysisResult>;
  returnedAnalysesList: AIAnalysisResult[];
}> {
  const store = getStore();
  const startedAt = new Date().toISOString();
  const cycleId = `cycle_${Date.now()}`;

  // 1. Self-evaluation: measure how previous signals performed before studying again
  if (!statelessContext) {
    evaluatePastAlerts(snapshots);
  }
  const accuracyStats = statelessContext ? statelessContext.accuracyStats : getAccuracyStats();
  const portfolioSummary = statelessContext
    ? statelessContext.portfolioSummary
    : computePortfolioSummary(snapshots);
  const activeAnalyses = statelessContext ? statelessContext.previousAnalyses : store.analyses;
  const activeAlerts = statelessContext ? statelessContext.recentAlerts : store.alerts;
  const activeSettings = statelessContext ? statelessContext.settings : store.settings;

  const holdingsByCoin = new Map<string, PortfolioHolding>(
    portfolioSummary.holdings.map((h) => [h.coinId, h])
  );

  onProgress?.({
    type: 'study_progress',
    message: `Avaliando histórico de acertos, sua carteira e indicadores de ${assetsToStudy.length} criptoativos...`,
  });

  const ai = getGeminiClient();

  // Process in batches of up to 8 assets per Gemini call for speed and cross-market context
  const batchSize = 8;
  const allReturnedAnalyses: AIAnalysisResult[] = [];
  let overallMarketSummary = '';

  for (let i = 0; i < assetsToStudy.length; i += batchSize) {
    const batch = assetsToStudy.slice(i, i + batchSize);
    const contextPayload = batch
      .map((asset) => {
        const snap = snapshots[asset.id];
        if (!snap || snap.priceUsd <= 0) return null;

        const prevAnalysis = activeAnalyses[asset.id];
        const holding = holdingsByCoin.get(asset.id);
        const recentAlerts = activeAlerts
          .filter((a) => a.coinId === asset.id)
          .slice(0, 3)
          .map((a) => ({
            action: a.action,
            priceAtSignalUsd: a.priceAtSignalUsd,
            outcome: a.outcome,
            returnPct: a.evaluatedReturnPct ?? null,
            date: a.createdAt,
          }));

        return {
          coinId: asset.id,
          symbol: asset.symbol,
          name: asset.name,
          priceUsd: snap.priceUsd,
          change1hPct: snap.change1hPct ?? 0,
          change24hPct: snap.change24hPct,
          change7dPct: snap.change7dPct,
          high24hUsd: snap.high24hUsd,
          low24hUsd: snap.low24hUsd,
          volume24hUsd: Math.round(snap.volume24hUsd),
          userPortfolioPosition: holding && holding.quantity > 0
            ? {
                quantityHeld: holding.quantity,
                avgBuyPriceUsd: Number(holding.avgBuyPriceUsd.toFixed(6)),
                costBasisUsd: Number(holding.costBasisUsd.toFixed(2)),
                currentValueUsd: Number(holding.currentValueUsd.toFixed(2)),
                unrealizedPnlUsd: Number(holding.unrealizedPnlUsd.toFixed(2)),
                unrealizedPnlPct: holding.unrealizedPnlPct,
                allocationPct: holding.allocationPct,
                realizedPnlUsd: Number(holding.realizedPnlUsd.toFixed(2)),
              }
            : null,
          indicators: {
            rsi14: snap.indicators.rsi14,
            ema9: snap.indicators.ema9,
            ema21: snap.indicators.ema21,
            ema50: snap.indicators.ema50,
            emaTrend: snap.indicators.emaTrend,
            macdLine: Number(snap.indicators.macdLine.toFixed(6)),
            macdSignal: Number(snap.indicators.macdSignal.toFixed(6)),
            macdHistogram: Number(snap.indicators.macdHistogram.toFixed(6)),
            macdTrend: snap.indicators.macdTrend,
            bollingerUpper: snap.indicators.bollingerUpper,
            bollingerMiddle: snap.indicators.bollingerMiddle,
            bollingerLower: snap.indicators.bollingerLower,
            bollingerPercentB: snap.indicators.bollingerPercentB,
            volatilityPct: snap.indicators.volatilityPct,
            supportLevel: snap.indicators.supportLevel,
            resistanceLevel: snap.indicators.resistanceLevel,
            volumeMomentumPct: snap.indicators.volumeMomentumPct,
          },
          previousPrediction: prevAnalysis
            ? {
                action: prevAnalysis.action,
                confidence: prevAnalysis.confidence,
                priceAtAnalysisUsd: prevAnalysis.priceAtAnalysisUsd,
                priceDeltaSinceLastStudyPct: Number(
                  (
                    ((snap.priceUsd - prevAnalysis.priceAtAnalysisUsd) /
                      prevAnalysis.priceAtAnalysisUsd) *
                    100
                  ).toFixed(2)
                ),
                analyzedAt: prevAnalysis.analyzedAt,
              }
            : null,
          recentTrackRecord: recentAlerts,
        };
      })
      .filter(Boolean);

    if (contextPayload.length === 0) continue;

    const portfolioOverviewText =
      portfolioSummary.holdings.length > 0
        ? `Carteira real do usuário ("${portfolioSummary.name}"):
- Valor total atual: US$ ${portfolioSummary.totalValueUsd.toFixed(2)} (Custo base: US$ ${portfolioSummary.totalCostBasisUsd.toFixed(2)})
- Lucro/Prejuízo acumulado: US$ ${portfolioSummary.allTimeProfitUsd.toFixed(2)} (${portfolioSummary.allTimeProfitPct.toFixed(2)}%)
- Ativos em posse: ${portfolioSummary.holdings
            .filter((h) => h.quantity > 0)
            .map(
              (h) =>
                `${h.symbol} (${h.quantity} un., PM US$ ${h.avgBuyPriceUsd.toFixed(4)}, P&L ${h.unrealizedPnlPct.toFixed(1)}%, peso ${h.allocationPct.toFixed(1)}%)`
            )
            .join('; ')}`
        : 'Carteira do usuário ainda sem transações registradas.';

    const prompt = `
Você é um analista quantitativo autônomo de criptomoedas com capacidade de autoaprendizado contínuo e leitura direta da carteira do usuário.
Analise os dados reais de mercado, indicadores técnicos e a posição real do usuário em carteira (se houver) para decidir para cada criptoativo se é hora de COMPRAR, VENDER ou ESPERAR.

Contexto de autoavaliação global da IA até agora:
- Sinais avaliados: ${accuracyStats.totalEvaluated} (Acertos: ${accuracyStats.hits}, Erros: ${accuracyStats.misses}, Neutros: ${accuracyStats.neutrals})
- Taxa de acerto histórica: ${accuracyStats.accuracyPct !== null ? `${accuracyStats.accuracyPct}%` : 'Ciclo inicial'}

${portfolioOverviewText}

Regras analíticas rigorosas de PROTEÇÃO AO PATRIMÔNIO (HODL e Carteira):
1. NUNCA recomende "VENDER" durante quedas fortes, mercado sangrando, variação de 7 dias fortemente negativa ou quando o RSI indicar sobrevenda/pânico — isso faria o usuário vender no prejuízo!
2. Em cenários de queda generalizada (change7dPct negativa ou queda forte 24h):
   - Se o RSI(14) estiver abaixo de 40/45, recomende "COMPRAR" explicando no headline e no portfolioAdvice que é oportunidade de "COMPRAR (Preço Médio)" / "ACUMULAR" para baratear o preço médio.
   - Se o mercado estiver apenas consolidando ou sem direção clara (RSI entre 45 e 70), recomende "ESPERAR" explicando no headline "ESPERAR / MANTER (HODL)".
3. O veredito "VENDER" (ou Venda Parcial para realizar lucros) SÓ deve ser acionado estritamente quando o ativo estiver em forte tendência de alta prolongada (change7dPct positiva e EMA em alta) COM RSI(14) acima de 70 (sobrecomprado), garantindo realização de lucro (nunca venda no prejuízo se userPortfolioPosition tiver unrealizedPnlPct <= 0).
4. Baseie cada decisão na confluência técnica real dos números fornecidos (RSI 14, cruzamento EMA 9/21/50, MACD, Bandas de Bollinger %B, suporte/resistência e variação 1h/24h/7d).
5. Integração com a Carteira ("userPortfolioPosition"):
   - Considere o Preço Médio (avgBuyPriceUsd), Lucro/Prejuízo atual (unrealizedPnlPct) e peso na carteira (allocationPct).
   - Preencha "portfolioAdvice" com recomendação prática em PT-BR (HODL, Preço Médio ou Venda Parcial apenas com lucro e RSI > 70).
6. Em "selfLearningNote", compare o sinal anterior com o movimento real desde o último estudo.
7. Escreva tudo em Português do Brasil (PT-BR) claro e objetivo e garanta entryZoneLowUsd <= entryZoneHighUsd.

Dados de mercado e posição na carteira:
${JSON.stringify(contextPayload, null, 2)}
`;

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'Você é o motor analítico autônomo do SinalCripto IA. Responda exclusivamente em JSON válido seguindo o schema, em Português (PT-BR). Nunca invente preços fora da escala do ativo analisado.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              marketSummary: {
                type: Type.STRING,
                description: 'Resumo macro curto do mercado cripto e da carteira neste ciclo em PT-BR (máx 2 frases).',
              },
              assets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    coinId: { type: Type.STRING },
                    symbol: { type: Type.STRING },
                    action: {
                      type: Type.STRING,
                      description: 'Exatamente COMPRAR, VENDER ou ESPERAR',
                    },
                    confidence: {
                      type: Type.INTEGER,
                      description: 'Confiança de 0 a 100',
                    },
                    horizon: {
                      type: Type.STRING,
                      description: 'curto_prazo, medio_prazo ou swing',
                    },
                    entryZoneLowUsd: { type: Type.NUMBER },
                    entryZoneHighUsd: { type: Type.NUMBER },
                    targetPriceUsd: { type: Type.NUMBER },
                    stopLossUsd: { type: Type.NUMBER },
                    riskLevel: {
                      type: Type.STRING,
                      description: 'baixo, moderado ou elevado',
                    },
                    headline: {
                      type: Type.STRING,
                      description: 'Título curto da recomendação (até 75 caracteres)',
                    },
                    thesis: {
                      type: Type.STRING,
                      description: 'Explicação clara da tese técnica e recomendação em 2-3 frases.',
                    },
                    portfolioAdvice: {
                      type: Type.STRING,
                      description: 'Recomendação específica considerando a posição atual do usuário na carteira (preço médio, lucro/prejuízo e momento de vender ou segurar).',
                    },
                    technicalFactors: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: '3 pontos objetivos dos indicadores que embasam a decisão.',
                    },
                    riskFactors: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: '2 riscos ou condições que invalidam o cenário.',
                    },
                    selfLearningNote: {
                      type: Type.STRING,
                      description: 'Reflexão de autoaprendizado comparando o sinal anterior.',
                    },
                  },
                  required: [
                    'coinId',
                    'symbol',
                    'action',
                    'confidence',
                    'horizon',
                    'entryZoneLowUsd',
                    'entryZoneHighUsd',
                    'targetPriceUsd',
                    'stopLossUsd',
                    'riskLevel',
                    'headline',
                    'thesis',
                    'portfolioAdvice',
                    'technicalFactors',
                    'riskFactors',
                    'selfLearningNote',
                  ],
                },
              },
            },
            required: ['marketSummary', 'assets'],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      marketSummary?: string;
      assets?: any[];
    };

    if (parsed.marketSummary && !overallMarketSummary) {
      overallMarketSummary = parsed.marketSummary;
    }

    const nowIso = new Date().toISOString();
    for (const item of parsed.assets ?? []) {
      const snap = snapshots[item.coinId];
      if (!snap) continue;

      const rawAction: SignalAction =
        item.action === 'COMPRAR' || item.action === 'VENDER' || item.action === 'ESPERAR'
          ? item.action
          : 'ESPERAR';

      const holding = holdingsByCoin.get(item.coinId);
      const protectedVerdict = applyPortfolioProtectionPolicy({
        rawAction,
        snap,
        holding,
        headline: String(item.headline || ''),
        thesis: String(item.thesis || ''),
        portfolioAdvice: String(item.portfolioAdvice || ''),
      });
      const normalizedAction = protectedVerdict.action;

      const normalizedHorizon =
        item.horizon === 'curto_prazo' || item.horizon === 'medio_prazo' || item.horizon === 'swing'
          ? item.horizon
          : 'swing';

      const normalizedRisk =
        item.riskLevel === 'baixo' || item.riskLevel === 'moderado' || item.riskLevel === 'elevado'
          ? item.riskLevel
          : 'moderado';

      const analysis: AIAnalysisResult = {
        coinId: item.coinId,
        symbol: snap.symbol,
        action: normalizedAction,
        confidence: Math.max(15, Math.min(98, Math.round(Number(item.confidence) || 60))),
        horizon: normalizedHorizon,
        entryZoneLowUsd: Number(item.entryZoneLowUsd) || snap.priceUsd * 0.98,
        entryZoneHighUsd: Number(item.entryZoneHighUsd) || snap.priceUsd * 1.01,
        targetPriceUsd: Number(item.targetPriceUsd) || snap.priceUsd * 1.05,
        stopLossUsd: Number(item.stopLossUsd) || snap.priceUsd * 0.96,
        riskLevel: normalizedRisk,
        headline: protectedVerdict.headline || `${snap.symbol}: ${normalizedAction}`,
        thesis: protectedVerdict.thesis,
        portfolioAdvice: protectedVerdict.portfolioAdvice,
        technicalFactors: Array.isArray(item.technicalFactors)
          ? item.technicalFactors.slice(0, 4).map(String)
          : [],
        riskFactors: Array.isArray(item.riskFactors)
          ? item.riskFactors.slice(0, 3).map(String)
          : [],
        selfLearningNote: String(item.selfLearningNote || ''),
        priceAtAnalysisUsd: snap.priceUsd,
        analyzedAt: nowIso,
        cycleId,
      };

      allReturnedAnalyses.push(analysis);
    }
  }

  // 2. Compare with previous analyses & emit automatic suggestions/alerts
  const newAlerts: SignalAlert[] = [];
  let buySignals = 0;
  let sellSignals = 0;
  let holdSignals = 0;

  const nextAnalysesMap: Record<string, AIAnalysisResult> = { ...activeAnalyses };

  for (const analysis of allReturnedAnalyses) {
    if (analysis.action === 'COMPRAR') buySignals++;
    else if (analysis.action === 'VENDER') sellSignals++;
    else holdSignals++;

    const prev = activeAnalyses[analysis.coinId];
    const actionChanged = !prev || prev.action !== analysis.action;
    const isActionableHighConviction =
      (analysis.action === 'COMPRAR' || analysis.action === 'VENDER') &&
      analysis.confidence >= activeSettings.minConfidenceForAlert;

    const latestAlertForCoin = activeAlerts.find((a) => a.coinId === analysis.coinId);
    const hoursSinceLastAlert = latestAlertForCoin
      ? (Date.now() - new Date(latestAlertForCoin.createdAt).getTime()) / 3600_000
      : 999;

    const shouldEmitAlert =
      actionChanged || (isActionableHighConviction && hoursSinceLastAlert >= 1.5);

    if (shouldEmitAlert) {
      const snap = snapshots[analysis.coinId];
      const alert: SignalAlert = {
        id: `alert_${analysis.coinId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        coinId: analysis.coinId,
        symbol: analysis.symbol,
        name: snap?.name ?? analysis.symbol,
        action: analysis.action,
        previousAction: prev?.action,
        confidence: analysis.confidence,
        priceAtSignalUsd: analysis.priceAtAnalysisUsd,
        targetPriceUsd: analysis.targetPriceUsd,
        stopLossUsd: analysis.stopLossUsd,
        headline: analysis.headline,
        reason: analysis.thesis,
        createdAt: analysis.analyzedAt,
        read: false,
        outcome: 'em_aberto',
      };
      newAlerts.push(alert);
    }

    nextAnalysesMap[analysis.coinId] = analysis;
    if (!statelessContext) {
      store.analyses[analysis.coinId] = analysis;
    }
  }

  if (!statelessContext && newAlerts.length > 0) {
    store.alerts = [...newAlerts, ...store.alerts].slice(0, 120);
  }

  const cycle: StudyCycleSummary = {
    id: cycleId,
    startedAt,
    completedAt: new Date().toISOString(),
    assetsStudied: allReturnedAnalyses.length,
    buySignals,
    sellSignals,
    holdSignals,
    alertsEmitted: newAlerts.length,
    evaluatedAccuracyPct: accuracyStats.accuracyPct,
    trigger,
    marketSummary:
      overallMarketSummary ||
      `Ciclo concluído em ${allReturnedAnalyses.length} criptoativos (${buySignals} compras, ${sellSignals} vendas, ${holdSignals} aguardando).`,
  };

  if (!statelessContext) {
    store.studyHistory = [cycle, ...store.studyHistory].slice(0, 40);
    saveStore();
  }

  if (activeSettings.webhookUrl && newAlerts.length > 0) {
    void dispatchWebhookNotification(activeSettings.webhookUrl, newAlerts);
  }

  if (
    activeSettings.whatsapp?.forwardAiSignals &&
    isWhatsAppConfigured(activeSettings.whatsapp) &&
    newAlerts.length > 0
  ) {
    const actionable = newAlerts.filter(
      (a) => a.action === 'COMPRAR' || a.action === 'VENDER'
    );
    if (actionable.length > 0) {
      void getUsdBrlRate().then((rate) => {
        const text = formatAiAlertsWhatsAppText(actionable, rate);
        return sendWhatsAppMessage(activeSettings.whatsapp, text, {
          type: 'ai_signals',
          alerts: actionable,
        });
      });
    }
  }

  if (
    activeSettings.telegram?.forwardAiSignals &&
    isTelegramConfigured(activeSettings.telegram) &&
    newAlerts.length > 0
  ) {
    const actionable = newAlerts.filter(
      (a) => a.action === 'COMPRAR' || a.action === 'VENDER'
    );
    if (actionable.length > 0) {
      void getUsdBrlRate().then((rate) => {
        const html = formatAiAlertsTelegramHtml(actionable, rate);
        return sendTelegramMessage(activeSettings.telegram!, html, {
          isPreformattedHtml: true,
        });
      });
    }
  }

  return {
    cycle,
    newAlerts,
    analyses: statelessContext ? nextAnalysesMap : store.analyses,
    returnedAnalysesList: allReturnedAnalyses,
  };
}
