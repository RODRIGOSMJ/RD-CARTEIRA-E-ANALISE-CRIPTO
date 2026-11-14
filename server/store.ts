import fs from 'node:fs';
import path from 'node:path';
import type {
  AIAnalysisResult,
  AppSettings,
  MarketSnapshot,
  PortfolioHolding,
  PortfolioSummary,
  PortfolioTransaction,
  PriceTrigger,
  SignalAlert,
  StudyCycleSummary,
  WatchlistAsset,
  WhatsAppSettings,
} from '../src/types/crypto.ts';

export const DEFAULT_WATCHLIST: WatchlistAsset[] = [];

export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppSettings = {
  enabled: false,
  provider: 'callmebot',
  phoneNumber: '',
  callMeBotApiKey: '',
  customWebhookUrl: '',
  customWebhookToken: '',
  metaPhoneNumberId: '',
  metaAccessToken: '',
  forwardAiSignals: true,
};

export const DEFAULT_SETTINGS: AppSettings = {
  autoStudyEnabled: true,
  intervalMinutes: 5,
  currency: 'BRL',
  minConfidenceForAlert: 65,
  webhookUrl: '',
  whatsapp: DEFAULT_WHATSAPP_SETTINGS,
};

export interface PersistedStore {
  watchlist: WatchlistAsset[];
  analyses: Record<string, AIAnalysisResult>;
  alerts: SignalAlert[];
  priceTriggers: PriceTrigger[];
  studyHistory: StudyCycleSummary[];
  settings: AppSettings;
  portfolioName: string;
  transactions: PortfolioTransaction[];
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'sinalcripto-state.json');

let state: PersistedStore = {
  watchlist: DEFAULT_WATCHLIST,
  analyses: {},
  alerts: [],
  priceTriggers: [],
  studyHistory: [],
  settings: DEFAULT_SETTINGS,
  portfolioName: 'MINHA CARTEIRA',
  transactions: [],
};

export function loadStore(): PersistedStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedStore>;
      state = {
        watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
        analyses: parsed.analyses ?? {},
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
        priceTriggers: Array.isArray(parsed.priceTriggers) ? parsed.priceTriggers : [],
        studyHistory: Array.isArray(parsed.studyHistory) ? parsed.studyHistory : [],
        settings: {
          ...DEFAULT_SETTINGS,
          ...(parsed.settings ?? {}),
          whatsapp: {
            ...DEFAULT_WHATSAPP_SETTINGS,
            ...(parsed.settings?.whatsapp ?? {}),
          },
        },
        portfolioName: parsed.portfolioName || 'MINHA CARTEIRA',
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      };
    }
  } catch (err) {
    console.warn('Falha ao carregar estado persistido, iniciando estado padrão:', err);
  }
  return state;
}

export function saveStore(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Falha ao salvar estado:', err);
  }
}

export function getStore(): PersistedStore {
  return state;
}

export function computePortfolioSummary(
  snapshots: Record<string, MarketSnapshot>
): PortfolioSummary {
  // Sort transactions chronologically oldest -> newest to accurately track average cost basis & realized P&L
  const chronological = [...state.transactions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  interface Acc {
    coinId: string;
    symbol: string;
    name: string;
    quantity: number;
    remainingCostBasisUsd: number;
    realizedPnlUsd: number;
    totalInvestedUsd: number;
    totalProceedsUsd: number;
    totalBoughtQty: number;
    totalSoldQty: number;
    totalGainedQty: number;
    lastTxPriceUsd: number;
  }

  const byCoin = new Map<string, Acc>();

  for (const tx of chronological) {
    let acc = byCoin.get(tx.coinId);
    if (!acc) {
      acc = {
        coinId: tx.coinId,
        symbol: tx.symbol,
        name: tx.name,
        quantity: 0,
        remainingCostBasisUsd: 0,
        realizedPnlUsd: 0,
        totalInvestedUsd: 0,
        totalProceedsUsd: 0,
        totalBoughtQty: 0,
        totalSoldQty: 0,
        totalGainedQty: 0,
        lastTxPriceUsd: 0,
      };
      byCoin.set(tx.coinId, acc);
    }

    const qty = Math.max(0, Number(tx.quantity) || 0);
    const price = Math.max(0, Number(tx.pricePerCoinUsd) || 0);
    const fee = Math.max(0, Number(tx.feeUsd) || 0);

    if (tx.type !== 'ganho' && price > 0) {
      acc.lastTxPriceUsd = price;
    }

    if (tx.type === 'compra') {
      const cost = qty * price + fee;
      acc.quantity += qty;
      acc.remainingCostBasisUsd += cost;
      acc.totalInvestedUsd += cost;
      acc.totalBoughtQty += qty;
    } else if (tx.type === 'ganho') {
      // Rewards / staking / airdrops increase quantity at zero cost basis (pure gain)
      acc.quantity += qty;
      acc.totalGainedQty += qty;
    } else if (tx.type === 'venda') {
      const soldQty = Math.min(qty, acc.quantity > 0 ? acc.quantity : qty);
      const avgCostBeforeSale =
        acc.quantity > 0 ? acc.remainingCostBasisUsd / acc.quantity : 0;
      const costRemoved = avgCostBeforeSale * soldQty;
      const proceeds = soldQty * price - fee;
      acc.realizedPnlUsd += proceeds - costRemoved;
      acc.totalProceedsUsd += proceeds;
      acc.quantity = Math.max(0, acc.quantity - soldQty);
      acc.remainingCostBasisUsd = Math.max(0, acc.remainingCostBasisUsd - costRemoved);
      acc.totalSoldQty += soldQty;
    }
  }

  let totalValueUsd = 0;
  let totalCostBasisUsd = 0;
  let totalRealizedPnlUsd = 0;
  let prev24hPortfolioValueUsd = 0;

  const rawHoldings: PortfolioHolding[] = [];

  for (const acc of byCoin.values()) {
    const snap = snapshots[acc.coinId];
    const currentPriceUsd =
      snap?.priceUsd && snap.priceUsd > 0 ? snap.priceUsd : acc.lastTxPriceUsd;
    const currentValueUsd = acc.quantity * currentPriceUsd;

    const avgBuyPriceUsd =
      acc.quantity > 0 ? acc.remainingCostBasisUsd / acc.quantity : 0;
    const unrealizedPnlUsd = currentValueUsd - acc.remainingCostBasisUsd;
    const unrealizedPnlPct =
      acc.remainingCostBasisUsd > 0
        ? (unrealizedPnlUsd / acc.remainingCostBasisUsd) * 100
        : currentValueUsd > 0
        ? 100
        : 0;

    const totalPnlUsd = unrealizedPnlUsd + acc.realizedPnlUsd;
    const baseForTotalPct =
      acc.totalInvestedUsd > 0 ? acc.totalInvestedUsd : acc.remainingCostBasisUsd;
    const totalPnlPct =
      baseForTotalPct > 0
        ? (totalPnlUsd / baseForTotalPct) * 100
        : currentValueUsd > 0
        ? 100
        : 0;

    if (acc.quantity > 0) {
      totalValueUsd += currentValueUsd;
      totalCostBasisUsd += acc.remainingCostBasisUsd;

      const change24hRatio = (snap?.change24hPct ?? 0) / 100;
      const price24hAgo =
        change24hRatio > -0.99 ? currentPriceUsd / (1 + change24hRatio) : currentPriceUsd;
      prev24hPortfolioValueUsd += acc.quantity * price24hAgo;
    }
    totalRealizedPnlUsd += acc.realizedPnlUsd;

    if (acc.quantity > 0 || acc.totalSoldQty > 0) {
      rawHoldings.push({
        coinId: acc.coinId,
        symbol: acc.symbol,
        name: acc.name,
        quantity: acc.quantity,
        avgBuyPriceUsd,
        costBasisUsd: acc.remainingCostBasisUsd,
        currentPriceUsd,
        currentValueUsd,
        unrealizedPnlUsd,
        unrealizedPnlPct: Number(unrealizedPnlPct.toFixed(2)),
        realizedPnlUsd: acc.realizedPnlUsd,
        totalPnlUsd,
        totalPnlPct: Number(totalPnlPct.toFixed(2)),
        allocationPct: 0,
        totalBoughtQty: acc.totalBoughtQty,
        totalSoldQty: acc.totalSoldQty,
        totalGainedQty: acc.totalGainedQty,
      });
    }
  }

  const holdings = rawHoldings
    .map((h) => ({
      ...h,
      allocationPct:
        totalValueUsd > 0
          ? Number(((h.currentValueUsd / totalValueUsd) * 100).toFixed(2))
          : 0,
    }))
    .sort((a, b) => b.currentValueUsd - a.currentValueUsd);

  const activeHoldings = holdings.filter((h) => h.quantity > 0 || h.totalSoldQty > 0);
  const sortedByPnl = [...activeHoldings].sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);
  const bestPerformer = sortedByPnl[0] ?? null;
  const worstPerformer =
    sortedByPnl.length > 1
      ? sortedByPnl[sortedByPnl.length - 1]
      : sortedByPnl[0] && sortedByPnl[0].totalPnlUsd < 0
      ? sortedByPnl[0]
      : null;

  const allTimeProfitUsd = totalValueUsd - totalCostBasisUsd + totalRealizedPnlUsd;
  const totalCapitalEverInvested = chronological
    .filter((t) => t.type === 'compra')
    .reduce((acc, t) => acc + t.quantity * t.pricePerCoinUsd + (t.feeUsd || 0), 0);

  const allTimeProfitPct =
    totalCapitalEverInvested > 0
      ? (allTimeProfitUsd / totalCapitalEverInvested) * 100
      : totalValueUsd > 0
      ? 100
      : 0;

  const change24hUsd = totalValueUsd - prev24hPortfolioValueUsd;
  const change24hPct =
    prev24hPortfolioValueUsd > 0
      ? (change24hUsd / prev24hPortfolioValueUsd) * 100
      : 0;

  const newestFirstTx = [...state.transactions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return {
    name: state.portfolioName,
    totalValueUsd: Number(totalValueUsd.toFixed(2)),
    totalCostBasisUsd: Number(totalCostBasisUsd.toFixed(2)),
    allTimeProfitUsd: Number(allTimeProfitUsd.toFixed(2)),
    allTimeProfitPct: Number(allTimeProfitPct.toFixed(2)),
    change24hUsd: Number(change24hUsd.toFixed(2)),
    change24hPct: Number(change24hPct.toFixed(2)),
    holdings,
    transactions: newestFirstTx,
    bestPerformer,
    worstPerformer,
  };
}

export function evaluatePastAlerts(snapshots: Record<string, MarketSnapshot>): void {
  const nowIso = new Date().toISOString();
  let updated = false;

  for (const alert of state.alerts) {
    const snap = snapshots[alert.coinId];
    if (!snap || snap.priceUsd <= 0 || alert.priceAtSignalUsd <= 0) continue;

    const rawReturnPct =
      ((snap.priceUsd - alert.priceAtSignalUsd) / alert.priceAtSignalUsd) * 100;
    alert.evaluatedReturnPct = Number(rawReturnPct.toFixed(2));
    alert.evaluatedAt = nowIso;

    if (alert.action === 'COMPRAR') {
      if (rawReturnPct >= 1.2 || snap.priceUsd >= alert.targetPriceUsd) {
        alert.outcome = 'acerto';
      } else if (rawReturnPct <= -2.0 || snap.priceUsd <= alert.stopLossUsd) {
        alert.outcome = 'erro';
      } else {
        const ageHours = (Date.now() - new Date(alert.createdAt).getTime()) / 3600_000;
        alert.outcome = ageHours > 12 ? 'neutro' : 'em_aberto';
      }
      updated = true;
    } else if (alert.action === 'VENDER') {
      if (rawReturnPct <= -1.2 || snap.priceUsd <= alert.targetPriceUsd) {
        alert.outcome = 'acerto';
      } else if (rawReturnPct >= 2.0 || snap.priceUsd >= alert.stopLossUsd) {
        alert.outcome = 'erro';
      } else {
        const ageHours = (Date.now() - new Date(alert.createdAt).getTime()) / 3600_000;
        alert.outcome = ageHours > 12 ? 'neutro' : 'em_aberto';
      }
      updated = true;
    } else {
      const ageHours = (Date.now() - new Date(alert.createdAt).getTime()) / 3600_000;
      if (ageHours >= 2) {
        alert.outcome = Math.abs(rawReturnPct) <= 2.2 ? 'acerto' : 'neutro';
      } else {
        alert.outcome = 'em_aberto';
      }
      updated = true;
    }
  }

  if (updated) {
    saveStore();
  }
}

export function getAccuracyStats() {
  const evaluated = state.alerts.filter((a) => a.outcome !== 'em_aberto');
  const hits = evaluated.filter((a) => a.outcome === 'acerto').length;
  const neutrals = evaluated.filter((a) => a.outcome === 'neutro').length;
  const misses = evaluated.filter((a) => a.outcome === 'erro').length;
  const decisive = hits + misses;
  const accuracyPct = decisive > 0 ? Math.round((hits / decisive) * 100) : null;

  return {
    totalEvaluated: evaluated.length,
    hits,
    neutrals,
    misses,
    accuracyPct,
  };
}
