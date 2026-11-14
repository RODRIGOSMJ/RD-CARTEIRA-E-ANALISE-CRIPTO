import type {
  AIAnalysisResult,
  AppSettings,
  AppStatePayload,
  ChartPoint,
  MarketSnapshot,
  PortfolioHistoryPoint,
  PortfolioHolding,
  PortfolioSummary,
  PortfolioTransaction,
  SignalAction,
  SignalAlert,
  StudyCycleSummary,
  TransactionType,
  WatchlistAsset,
} from '../types/crypto.ts';
import {
  calculateBollingerArray,
  calculateEMAArray,
  calculateRSIArray,
  computeTechnicalIndicators,
} from '../utils/indicators.ts';

export class BackendUnavailableError extends Error {
  constructor(message = 'Servidor de API indisponível neste ambiente') {
    super(message);
    this.name = 'BackendUnavailableError';
  }
}

export type ClientBackendMode = 'server' | 'local';

let currentMode: ClientBackendMode = 'server';

export function getBackendMode(): ClientBackendMode {
  return currentMode;
}

async function safeFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new BackendUnavailableError('Falha de rede ao acessar a API');
  }

  const text = await res.text();
  const trimmed = text.trim();

  if (!trimmed) {
    if (res.status === 404 || res.status >= 502) {
      throw new BackendUnavailableError(`HTTP ${res.status}`);
    }
    throw new Error('Resposta vazia do servidor.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // HTML / plain text errors such as "The page could not be found"
    throw new BackendUnavailableError('Resposta não-JSON do servidor');
  }

  if (!res.ok) {
    if (res.status === 404 && trimmed.includes('Endpoint de API não encontrado')) {
      throw new BackendUnavailableError('Rota ausente');
    }
    throw new Error(parsed?.error || `Erro HTTP ${res.status}`);
  }

  return parsed as T;
}

// ============================================================================
// Client-side Local Live Engine (used automatically if static publish has no /api)
// ============================================================================

const LOCAL_STORAGE_KEY = 'sinalcripto_local_store_v1';

interface LocalStore {
  watchlist: WatchlistAsset[];
  analyses: Record<string, AIAnalysisResult>;
  alerts: SignalAlert[];
  studyHistory: StudyCycleSummary[];
  settings: AppSettings;
  portfolioName: string;
  transactions: PortfolioTransaction[];
}

const DEFAULT_LOCAL_SETTINGS: AppSettings = {
  autoStudyEnabled: true,
  intervalMinutes: 5,
  currency: 'BRL',
  minConfidenceForAlert: 65,
  webhookUrl: '',
};

function loadLocalStore(): LocalStore {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalStore>;
      return {
        watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
        analyses: parsed.analyses ?? {},
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
        studyHistory: Array.isArray(parsed.studyHistory) ? parsed.studyHistory : [],
        settings: { ...DEFAULT_LOCAL_SETTINGS, ...(parsed.settings ?? {}) },
        portfolioName: parsed.portfolioName || 'MINHA CARTEIRA',
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      };
    }
  } catch {
    // ignore corrupted local storage
  }
  return {
    watchlist: [],
    analyses: {},
    alerts: [],
    studyHistory: [],
    settings: { ...DEFAULT_LOCAL_SETTINGS },
    portfolioName: 'MINHA CARTEIRA',
    transactions: [],
  };
}

function saveLocalStore(store: LocalStore): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage quota errors
  }
}

interface CachedSeries {
  timestamps: number[];
  closes: number[];
  volumes: number[];
  fetchedAt: number;
}

const localSeriesCache = new Map<string, CachedSeries>();
const localSnapshotCache = new Map<string, { data: MarketSnapshot; fetchedAt: number }>();
let localUsdBrl = { rate: 5.75, fetchedAt: 0 };

async function fetchLocalUsdBrl(): Promise<number> {
  if (Date.now() - localUsdBrl.fetchedAt < 5 * 60_000) {
    return localUsdBrl.rate;
  }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const json = (await res.json()) as { rates?: { BRL?: number } };
      const p = Number(json?.rates?.BRL);
      if (Number.isFinite(p) && p > 1) {
        localUsdBrl = { rate: p, fetchedAt: Date.now() };
        return p;
      }
    }
  } catch {
    // fallback
  }

  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const json = (await res.json()) as { USDBRL?: { bid?: string } };
      const p = Number(json?.USDBRL?.bid);
      if (Number.isFinite(p) && p > 1) {
        localUsdBrl = { rate: p, fetchedAt: Date.now() };
        return p;
      }
    }
  } catch {
    // keep cached
  }

  return localUsdBrl.rate;
}

async function fetchLocalBinance24hr(symbols: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const valid = Array.from(new Set(symbols.filter(Boolean)));
  if (valid.length === 0) return map;

  try {
    const url = `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(
      JSON.stringify(valid)
    )}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5500) });
    if (res.ok) {
      const data = (await res.json()) as any[];
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item?.symbol) map.set(item.symbol, item);
        }
        return map;
      }
    }
  } catch {
    // fallback per symbol
  }

  await Promise.all(
    valid.map(async (sym) => {
      try {
        const res = await fetch(
          `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${encodeURIComponent(sym)}`,
          { signal: AbortSignal.timeout(4500) }
        );
        if (!res.ok) return;
        const item = (await res.json()) as any;
        if (item?.symbol) map.set(item.symbol, item);
      } catch {
        // ignore
      }
    })
  );

  return map;
}

async function fetchLocalKlines(
  binanceSymbol: string,
  interval = '1h',
  limit = 168
): Promise<CachedSeries | null> {
  try {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(
      binanceSymbol
    )}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!Array.isArray(rows) || rows.length < 10) return null;

    const timestamps: number[] = [];
    const closes: number[] = [];
    const volumes: number[] = [];
    for (const row of rows) {
      timestamps.push(Number(row[0]));
      closes.push(Number(row[4]));
      volumes.push(Number(row[5]));
    }
    return { timestamps, closes, volumes, fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

async function fetchLocalSeriesForAsset(
  asset: WatchlistAsset,
  range: '24h' | '7d' | '30d' | '90d' | 'all' = '7d'
): Promise<CachedSeries | null> {
  const key = `${asset.id}:${range}`;
  const cached = localSeriesCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < 60_000) {
    return cached;
  }

  const pair = asset.binanceSymbol || `${asset.symbol.toUpperCase()}USDT`;
  let series: CachedSeries | null = null;
  if (range === '24h') series = await fetchLocalKlines(pair, '15m', 96);
  else if (range === '7d') series = await fetchLocalKlines(pair, '1h', 168);
  else if (range === '30d') series = await fetchLocalKlines(pair, '4h', 180);
  else if (range === '90d') series = await fetchLocalKlines(pair, '12h', 180);
  else series = await fetchLocalKlines(pair, '1d', 365);

  if (!series) {
    try {
      const days =
        range === '24h' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365;
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
          asset.id
        )}/market_chart?vs_currency=usd&days=${days}`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (res.ok) {
        const json = (await res.json()) as {
          prices?: [number, number][];
          total_volumes?: [number, number][];
        };
        if (Array.isArray(json.prices) && json.prices.length >= 10) {
          series = {
            timestamps: json.prices.map((p) => p[0]),
            closes: json.prices.map((p) => p[1]),
            volumes: Array.isArray(json.total_volumes)
              ? json.total_volumes.map((v) => v[1])
              : json.prices.map(() => 1),
            fetchedAt: Date.now(),
          };
        }
      }
    } catch {
      // ignore
    }
  }

  if (series) {
    localSeriesCache.set(key, series);
    return series;
  }
  return cached ?? null;
}

async function fetchLocalCoinbaseSpot(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.coinbase.com/v2/prices/${encodeURIComponent(symbol.toUpperCase())}-USD/spot`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: { amount?: string } };
      const p = Number(json?.data?.amount);
      if (Number.isFinite(p) && p > 0) return p;
    }
  } catch {
    // ignore
  }
  return null;
}

function getLocalTrackedAssets(store: LocalStore): WatchlistAsset[] {
  const map = new Map<string, WatchlistAsset>();
  for (const w of store.watchlist) map.set(w.id, w);
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
  return Array.from(map.values());
}

async function fetchLocalMarketSnapshots(
  assets: WatchlistAsset[],
  forceRefresh = false
): Promise<Record<string, MarketSnapshot>> {
  const now = Date.now();
  const result: Record<string, MarketSnapshot> = {};
  if (assets.length === 0) return result;

  if (!forceRefresh) {
    let allFresh = true;
    for (const a of assets) {
      const c = localSnapshotCache.get(a.id);
      if (c && now - c.fetchedAt < 10_000) {
        result[a.id] = c.data;
      } else {
        allFresh = false;
      }
    }
    if (allFresh && Object.keys(result).length === assets.length) {
      return result;
    }
  }

  const pairs = assets.map((a) => a.binanceSymbol || `${a.symbol.toUpperCase()}USDT`);
  const binanceMap = await fetchLocalBinance24hr(pairs);

  await Promise.all(
    assets.map(async (asset) => {
      const pair = asset.binanceSymbol || `${asset.symbol.toUpperCase()}USDT`;
      const bData = binanceMap.get(pair);
      const series = await fetchLocalSeriesForAsset(asset, '7d');

      let priceUsd = bData ? Number(bData.lastPrice) : 0;
      if (!priceUsd || !Number.isFinite(priceUsd)) {
        const cb = await fetchLocalCoinbaseSpot(asset.symbol);
        if (cb) priceUsd = cb;
      }
      if ((!priceUsd || !Number.isFinite(priceUsd)) && series?.closes.length) {
        priceUsd = series.closes[series.closes.length - 1];
      }

      const prevCached = localSnapshotCache.get(asset.id)?.data;
      if (!priceUsd && prevCached) {
        result[asset.id] = prevCached;
        return;
      }

      const closes = series ? [...series.closes] : priceUsd ? [priceUsd] : [];
      if (priceUsd > 0 && closes.length > 0) closes[closes.length - 1] = priceUsd;

      const indicators = computeTechnicalIndicators(closes, series?.volumes);
      const first7d = closes[0] ?? priceUsd;
      const computed7dPct =
        first7d > 0 && priceUsd > 0 ? ((priceUsd - first7d) / first7d) * 100 : 0;
      const prev1hPrice = closes.length >= 2 ? closes[closes.length - 2] : priceUsd;
      const computed1hPct =
        prev1hPrice > 0 && priceUsd > 0 ? ((priceUsd - prev1hPrice) / prev1hPrice) * 100 : 0;

      const change24hPct = bData ? Number(bData.priceChangePercent) : 0;
      const snap: MarketSnapshot = {
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        priceUsd: priceUsd || 0,
        change1hPct: Number(computed1hPct.toFixed(2)),
        change24hPct: Number(change24hPct.toFixed(2)),
        change7dPct: Number(computed7dPct.toFixed(2)),
        high24hUsd: bData ? Number(bData.highPrice) : priceUsd * 1.02,
        low24hUsd: bData ? Number(bData.lowPrice) : priceUsd * 0.98,
        volume24hUsd: bData ? Number(bData.quoteVolume) : 0,
        marketCapUsd: 0,
        sparkline7d: closes.slice(-42),
        indicators,
        updatedAt: new Date().toISOString(),
        dataSource: bData ? 'Binance Spot' : 'Coinbase Spot',
      };

      localSnapshotCache.set(asset.id, { data: snap, fetchedAt: now });
      result[asset.id] = snap;
    })
  );

  return result;
}

function computeLocalPortfolioSummary(
  store: LocalStore,
  snapshots: Record<string, MarketSnapshot>
): PortfolioSummary {
  const chronological = [...store.transactions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const byCoin = new Map<
    string,
    {
      coinId: string;
      symbol: string;
      name: string;
      quantity: number;
      remainingCostBasisUsd: number;
      realizedPnlUsd: number;
      totalInvestedUsd: number;
      totalBoughtQty: number;
      totalSoldQty: number;
      totalGainedQty: number;
    }
  >();

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
        totalBoughtQty: 0,
        totalSoldQty: 0,
        totalGainedQty: 0,
      };
      byCoin.set(tx.coinId, acc);
    }

    const qty = Math.max(0, Number(tx.quantity) || 0);
    const price = Math.max(0, Number(tx.pricePerCoinUsd) || 0);
    const fee = Math.max(0, Number(tx.feeUsd) || 0);

    if (tx.type === 'compra') {
      const cost = qty * price + fee;
      acc.quantity += qty;
      acc.remainingCostBasisUsd += cost;
      acc.totalInvestedUsd += cost;
      acc.totalBoughtQty += qty;
    } else if (tx.type === 'ganho') {
      acc.quantity += qty;
      acc.totalGainedQty += qty;
    } else if (tx.type === 'venda') {
      const soldQty = Math.min(qty, acc.quantity > 0 ? acc.quantity : qty);
      const avgCost = acc.quantity > 0 ? acc.remainingCostBasisUsd / acc.quantity : 0;
      const costRemoved = avgCost * soldQty;
      const proceeds = soldQty * price - fee;
      acc.realizedPnlUsd += proceeds - costRemoved;
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
    const currentPriceUsd = snap?.priceUsd ?? 0;
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
    prev24hPortfolioValueUsd > 0 ? (change24hUsd / prev24hPortfolioValueUsd) * 100 : 0;

  return {
    name: store.portfolioName,
    totalValueUsd: Number(totalValueUsd.toFixed(2)),
    totalCostBasisUsd: Number(totalCostBasisUsd.toFixed(2)),
    allTimeProfitUsd: Number(allTimeProfitUsd.toFixed(2)),
    allTimeProfitPct: Number(allTimeProfitPct.toFixed(2)),
    change24hUsd: Number(change24hUsd.toFixed(2)),
    change24hPct: Number(change24hPct.toFixed(2)),
    holdings,
    transactions: [...store.transactions].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ),
    bestPerformer,
    worstPerformer,
  };
}

function evaluateLocalAlerts(store: LocalStore, snapshots: Record<string, MarketSnapshot>) {
  const nowIso = new Date().toISOString();
  let updated = false;
  for (const alert of store.alerts) {
    const snap = snapshots[alert.coinId];
    if (!snap || snap.priceUsd <= 0 || alert.priceAtSignalUsd <= 0) continue;
    const rawReturnPct =
      ((snap.priceUsd - alert.priceAtSignalUsd) / alert.priceAtSignalUsd) * 100;
    alert.evaluatedReturnPct = Number(rawReturnPct.toFixed(2));
    alert.evaluatedAt = nowIso;

    if (alert.action === 'COMPRAR') {
      if (rawReturnPct >= 1.2 || snap.priceUsd >= alert.targetPriceUsd) alert.outcome = 'acerto';
      else if (rawReturnPct <= -2.0 || snap.priceUsd <= alert.stopLossUsd) alert.outcome = 'erro';
      else alert.outcome = (Date.now() - new Date(alert.createdAt).getTime()) / 3600_000 > 12 ? 'neutro' : 'em_aberto';
      updated = true;
    } else if (alert.action === 'VENDER') {
      if (rawReturnPct <= -1.2 || snap.priceUsd <= alert.targetPriceUsd) alert.outcome = 'acerto';
      else if (rawReturnPct >= 2.0 || snap.priceUsd >= alert.stopLossUsd) alert.outcome = 'erro';
      else alert.outcome = (Date.now() - new Date(alert.createdAt).getTime()) / 3600_000 > 12 ? 'neutro' : 'em_aberto';
      updated = true;
    } else {
      const ageHours = (Date.now() - new Date(alert.createdAt).getTime()) / 3600_000;
      alert.outcome =
        ageHours >= 2 ? (Math.abs(rawReturnPct) <= 2.2 ? 'acerto' : 'neutro') : 'em_aberto';
      updated = true;
    }
  }
  if (updated) saveLocalStore(store);
}

function getLocalAccuracyStats(store: LocalStore) {
  const evaluated = store.alerts.filter((a) => a.outcome !== 'em_aberto');
  const hits = evaluated.filter((a) => a.outcome === 'acerto').length;
  const neutrals = evaluated.filter((a) => a.outcome === 'neutro').length;
  const misses = evaluated.filter((a) => a.outcome === 'erro').length;
  const decisive = hits + misses;
  return {
    totalEvaluated: evaluated.length,
    hits,
    neutrals,
    misses,
    accuracyPct: decisive > 0 ? Math.round((hits / decisive) * 100) : null,
  };
}

function analyzeAssetLocally(
  asset: WatchlistAsset,
  snap: MarketSnapshot,
  cycleId: string,
  holding?: PortfolioHolding
): AIAnalysisResult {
  const ind = snap.indicators;
  const price = snap.priceUsd || 1;
  let score = 0;

  if (ind.rsi14 <= 32) score += 2;
  else if (ind.rsi14 <= 44) score += 1;
  else if (ind.rsi14 >= 68) score -= 2;
  else if (ind.rsi14 >= 60) score -= 1;

  if (ind.emaTrend === 'alta') score += 1.5;
  else if (ind.emaTrend === 'baixa') score -= 1.5;

  if (ind.macdTrend === 'bullish') score += 1;
  else if (ind.macdTrend === 'bearish') score -= 1;

  if (ind.bollingerPercentB <= 22) score += 1;
  else if (ind.bollingerPercentB >= 82) score -= 1;

  let action: SignalAction = 'ESPERAR';
  if (score >= 1.5) action = 'COMPRAR';
  else if (score <= -1.5) action = 'VENDER';

  const confidence = Math.min(92, Math.max(54, Math.round(58 + Math.abs(score) * 7.5)));
  const entryLow = Math.min(price * 0.992, Math.max(ind.supportLevel, price * 0.96));
  const entryHigh = Math.max(entryLow, price * 1.005);
  const targetPriceUsd =
    action === 'VENDER'
      ? Math.min(price * 0.95, Math.max(ind.supportLevel, price * 0.91))
      : Math.max(price * 1.045, ind.resistanceLevel);
  const stopLossUsd =
    action === 'VENDER' ? price * 1.035 : Math.min(price * 0.955, ind.supportLevel * 0.985);

  let portfolioAdvice =
    'Você ainda não possui posição aberta neste ativo. Considere aguardar confirmação na zona de entrada.';
  if (holding && holding.quantity > 0) {
    if (holding.unrealizedPnlPct >= 8 && action === 'VENDER') {
      portfolioAdvice = `Sua posição tem lucro de ${holding.unrealizedPnlPct.toFixed(
        1
      )}% sobre o preço médio. Momento favorável para realizar lucro parcial e proteger ganhos.`;
    } else if (holding.unrealizedPnlPct < -5 && action === 'COMPRAR') {
      portfolioAdvice = `Ativo abaixo do seu preço médio (${holding.unrealizedPnlPct.toFixed(
        1
      )}%) com RSI em ${ind.rsi14.toFixed(1)}. Possível região técnica para redução de preço médio com controle de risco.`;
    } else {
      portfolioAdvice = `Você detém ${holding.quantity.toLocaleString('pt-BR', {
        maximumFractionDigits: 6,
      })} ${holding.symbol} (${holding.unrealizedPnlPct >= 0 ? '+' : ''}${holding.unrealizedPnlPct.toFixed(
        1
      )}%). ${action === 'ESPERAR' ? 'Mantenha a posição e acompanhe suporte/resistência.' : 'Ajuste alvos conforme sua gestão de risco.'}`;
    }
  }

  return {
    coinId: asset.id,
    symbol: asset.symbol,
    action,
    confidence,
    horizon: 'curto_prazo',
    riskLevel: ind.volatilityPct > 3.5 ? 'elevado' : ind.volatilityPct < 1.5 ? 'baixo' : 'moderado',
    headline:
      action === 'COMPRAR'
        ? `${asset.symbol} mostra força compradora perto de suporte técnico`
        : action === 'VENDER'
        ? `${asset.symbol} sinaliza sobrecompra ou perda de tendência`
        : `${asset.symbol} em consolidação — aguardar definição de direção`,
    thesis: `Leitura quantitativa ao vivo indica RSI(14) em ${ind.rsi14.toFixed(
      1
    )}, tendência EMA de ${ind.emaTrend} e MACD ${
      ind.macdTrend === 'bullish'
        ? 'positivo'
        : ind.macdTrend === 'bearish'
        ? 'negativo'
        : 'neutro'
    }, com banda de Bollinger em ${ind.bollingerPercentB.toFixed(0)}%.`,
    entryZoneLowUsd: entryLow,
    entryZoneHighUsd: entryHigh,
    targetPriceUsd,
    stopLossUsd,
    technicalFactors: [
      `RSI (14) medido em ${ind.rsi14.toFixed(1)}`,
      `Tendência EMA9/EMA21 classificada como ${ind.emaTrend}`,
      `Bollinger %B em ${ind.bollingerPercentB.toFixed(1)}% com volatilidade de ${ind.volatilityPct.toFixed(2)}%`,
    ],
    riskFactors: [
      `Perda do suporte em US$ ${ind.supportLevel.toFixed(4)} invalida cenário altista`,
      `Mudanças bruscas de liquidez no Bitcoin podem impactar ${asset.symbol}`,
    ],
    selfLearningNote:
      'Análise quantitativa contínua executada com métricas técnicas em tempo real.',
    portfolioAdvice,
    analyzedAt: new Date().toISOString(),
    priceAtAnalysisUsd: price,
    cycleId,
  };
}

let localNextStudyAt: string | null = null;

function ensureLocalNextStudyAt(settings: AppSettings, reset = false): string | null {
  if (!settings.autoStudyEnabled) {
    localNextStudyAt = null;
    return null;
  }
  if (reset || !localNextStudyAt || new Date(localNextStudyAt).getTime() <= Date.now()) {
    localNextStudyAt = new Date(
      Date.now() + Math.max(1, settings.intervalMinutes) * 60_000
    ).toISOString();
  }
  return localNextStudyAt;
}

async function buildLocalStatePayload(forceRefresh = false): Promise<AppStatePayload> {
  const store = loadLocalStore();
  const tracked = getLocalTrackedAssets(store);
  const [snapshots, usdBrlRate] = await Promise.all([
    fetchLocalMarketSnapshots(tracked, forceRefresh),
    fetchLocalUsdBrl(),
  ]);
  evaluateLocalAlerts(store, snapshots);

  return {
    watchlist: store.watchlist,
    snapshots,
    analyses: store.analyses,
    alerts: store.alerts,
    studyHistory: store.studyHistory,
    settings: store.settings,
    portfolio: computeLocalPortfolioSummary(store, snapshots),
    usdBrlRate,
    isStudying: false,
    nextStudyAt: ensureLocalNextStudyAt(store.settings, false),
    accuracyStats: getLocalAccuracyStats(store),
  };
}

function runLocalStudy(
  assets?: WatchlistAsset[],
  trigger: 'automatico' | 'manual' | 'novo_ativo' = 'manual',
  snapshots?: Record<string, MarketSnapshot>
): { cycle: StudyCycleSummary; newAlerts: SignalAlert[]; store: LocalStore } {
  const store = loadLocalStore();
  const targetAssets = assets && assets.length > 0 ? assets : store.watchlist;
  const activeSnaps = snapshots ?? {};
  const portfolio = computeLocalPortfolioSummary(store, activeSnaps);
  const newAlerts: SignalAlert[] = [];

  const cycleId = `cyc_${Date.now()}`;
  let buySignals = 0;
  let sellSignals = 0;
  let holdSignals = 0;

  for (const asset of targetAssets) {
    const snap = activeSnaps[asset.id];
    if (!snap) continue;
    const holding = portfolio.holdings.find((h) => h.coinId === asset.id);
    const analysis = analyzeAssetLocally(asset, snap, cycleId, holding);
    const prev = store.analyses[asset.id];
    store.analyses[asset.id] = analysis;

    if (analysis.action === 'COMPRAR') buySignals++;
    else if (analysis.action === 'VENDER') sellSignals++;
    else holdSignals++;

    const actionChanged = !prev || prev.action !== analysis.action;
    if (
      analysis.action !== 'ESPERAR' &&
      analysis.confidence >= store.settings.minConfidenceForAlert &&
      (actionChanged || trigger === 'manual' || trigger === 'novo_ativo')
    ) {
      const alert: SignalAlert = {
        id: `al_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        coinId: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        action: analysis.action,
        confidence: analysis.confidence,
        priceAtSignalUsd: snap.priceUsd,
        targetPriceUsd: analysis.targetPriceUsd,
        stopLossUsd: analysis.stopLossUsd,
        headline: analysis.headline,
        reason: analysis.thesis,
        createdAt: new Date().toISOString(),
        read: false,
        outcome: 'em_aberto',
      };
      store.alerts.unshift(alert);
      newAlerts.push(alert);
    }
  }

  store.alerts = store.alerts.slice(0, 80);
  const stats = getLocalAccuracyStats(store);
  const cycle: StudyCycleSummary = {
    id: cycleId,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    trigger,
    assetsStudied: targetAssets.length,
    buySignals,
    sellSignals,
    holdSignals,
    alertsEmitted: newAlerts.length,
    marketSummary: `Ciclo concluído para ${targetAssets.length} ativo(s): ${buySignals} compra, ${sellSignals} venda e ${holdSignals} espera.`,
    evaluatedAccuracyPct: stats.accuracyPct,
  };
  store.studyHistory.unshift(cycle);
  store.studyHistory = store.studyHistory.slice(0, 30);
  saveLocalStore(store);
  ensureLocalNextStudyAt(store.settings, true);
  return { cycle, newAlerts, store };
}

// ============================================================================
// Unified API Functions (Auto-fallback to Client Live Mode when needed)
// ============================================================================

async function withFallback<T>(
  serverCall: () => Promise<T>,
  localCall: () => Promise<T>
): Promise<T> {
  if (currentMode === 'local') {
    return localCall();
  }
  try {
    return await serverCall();
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      currentMode = 'local';
      return localCall();
    }
    throw err;
  }
}

export async function apiGetState(forceRefresh = false): Promise<AppStatePayload> {
  return withFallback(
    () => safeFetchJson<AppStatePayload>(`/api/state${forceRefresh ? '?refresh=1' : ''}`),
    () => buildLocalStatePayload(forceRefresh)
  );
}

export async function apiGetAssetChart(
  coinId: string,
  range: '24h' | '7d' | '30d',
  symbol?: string
): Promise<{ points: ChartPoint[] }> {
  return withFallback(
    () =>
      safeFetchJson<{ points: ChartPoint[] }>(
        `/api/chart/${encodeURIComponent(coinId)}?range=${range}`
      ),
    async () => {
      const store = loadLocalStore();
      const asset = store.watchlist.find((w) => w.id === coinId) ?? {
        id: coinId,
        symbol: (symbol || coinId).toUpperCase(),
        name: coinId,
        binanceSymbol: `${(symbol || coinId).toUpperCase()}USDT`,
        addedAt: '',
      };
      const series = await fetchLocalSeriesForAsset(asset, range);
      if (!series || series.closes.length === 0) return { points: [] };

      const ema9 = calculateEMAArray(series.closes, 9);
      const ema21 = calculateEMAArray(series.closes, 21);
      const bb = calculateBollingerArray(series.closes, 20, 2);
      const rsi = calculateRSIArray(series.closes, 14);
      return {
        points: series.closes.map((price, idx) => ({
          timestamp: series.timestamps[idx],
          price,
          ema9: ema9[idx],
          ema21: ema21[idx],
          bollingerUpper: bb.upper[idx],
          bollingerLower: bb.lower[idx],
          rsi: rsi[idx],
        })),
      };
    }
  );
}

export async function apiGetPortfolioHistory(
  range: '24h' | '7d' | '30d' | '90d' | 'all'
): Promise<{ points: PortfolioHistoryPoint[] }> {
  return withFallback(
    () =>
      safeFetchJson<{ points: PortfolioHistoryPoint[] }>(
        `/api/portfolio/history?range=${range}`
      ),
    async () => {
      const store = loadLocalStore();
      const tracked = getLocalTrackedAssets(store);
      const snapshots = await fetchLocalMarketSnapshots(tracked, false);
      const portfolio = computeLocalPortfolioSummary(store, snapshots);
      const activeHoldings = portfolio.holdings.filter((h) => h.quantity > 0);
      if (activeHoldings.length === 0) return { points: [] };

      const btcSeries = await fetchLocalSeriesForAsset(
        {
          id: 'bitcoin',
          symbol: 'BTC',
          name: 'Bitcoin',
          binanceSymbol: 'BTCUSDT',
          addedAt: '',
        },
        range
      );
      if (!btcSeries || btcSeries.timestamps.length < 2) return { points: [] };

      const coinSeriesMap = new Map<string, CachedSeries>();
      await Promise.all(
        activeHoldings.map(async (h) => {
          if (h.coinId === 'bitcoin') {
            coinSeriesMap.set(h.coinId, btcSeries);
            return;
          }
          const s = await fetchLocalSeriesForAsset(
            {
              id: h.coinId,
              symbol: h.symbol,
              name: h.name,
              binanceSymbol: `${h.symbol.toUpperCase()}USDT`,
              addedAt: '',
            },
            range
          );
          if (s && s.closes.length > 0) coinSeriesMap.set(h.coinId, s);
        })
      );

      const btcFirst = btcSeries.closes[0] || 1;
      const findPriceAt = (series: CachedSeries, targetTs: number) => {
        let bestIdx = 0;
        let minDiff = Math.abs(series.timestamps[0] - targetTs);
        for (let i = 1; i < series.timestamps.length; i++) {
          const diff = Math.abs(series.timestamps[i] - targetTs);
          if (diff <= minDiff) {
            minDiff = diff;
            bestIdx = i;
          } else break;
        }
        return series.closes[bestIdx] ?? 0;
      };

      const points: PortfolioHistoryPoint[] = btcSeries.timestamps.map((ts, i) => {
        const btcTrendPct = ((btcSeries.closes[i] - btcFirst) / btcFirst) * 100;
        let totalValueUsd = 0;
        for (const h of activeHoldings) {
          const s = coinSeriesMap.get(h.coinId);
          if (s) totalValueUsd += h.quantity * findPriceAt(s, ts);
        }
        const profitPct =
          portfolio.totalCostBasisUsd > 0
            ? ((totalValueUsd - portfolio.totalCostBasisUsd) /
                portfolio.totalCostBasisUsd) *
              100
            : 0;
        return {
          timestamp: ts,
          totalValueUsd: Number(totalValueUsd.toFixed(2)),
          costBasisUsd: Number(portfolio.totalCostBasisUsd.toFixed(2)),
          profitPct: Number(profitPct.toFixed(2)),
          btcTrendPct: Number(btcTrendPct.toFixed(2)),
        };
      });

      return { points };
    }
  );
}

export async function apiSearchCryptos(
  query: string
): Promise<Array<{ id: string; symbol: string; name: string; marketCapRank: number | null }>> {
  const q = query.trim();
  if (q.length < 2) return [];

  return withFallback(
    async () => {
      const json = await safeFetchJson<{
        results?: Array<{ id: string; symbol: string; name: string; marketCapRank: number | null }>;
      }>(`/api/search?q=${encodeURIComponent(q)}`);
      return json.results ?? [];
    },
    async () => {
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const json = (await res.json()) as {
            coins?: Array<{
              id: string;
              symbol: string;
              name: string;
              market_cap_rank: number | null;
            }>;
          };
          const list = (json.coins ?? []).slice(0, 10).map((c) => ({
            id: c.id,
            symbol: c.symbol.toUpperCase(),
            name: c.name,
            marketCapRank: c.market_cap_rank,
          }));
          if (list.length > 0) return list;
        }
      } catch {
        // fallback to CoinPaprika
      }

      try {
        const res = await fetch(
          `https://api.coinpaprika.com/v1/search?q=${encodeURIComponent(q)}&c=currencies&limit=10`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const json = (await res.json()) as {
            currencies?: Array<{ id: string; symbol: string; name: string; rank: number | null }>;
          };
          return (json.currencies ?? []).slice(0, 10).map((c) => ({
            id: c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            symbol: c.symbol.toUpperCase(),
            name: c.name,
            marketCapRank: c.rank && c.rank > 0 ? c.rank : null,
          }));
        }
      } catch {
        // ignore
      }
      return [];
    }
  );
}

export async function apiGetCoinPrice(
  coinId: string,
  symbol: string
): Promise<number | null> {
  return withFallback(
    async () => {
      const json = await safeFetchJson<{ priceUsd?: number | null }>(
        `/api/price?coinId=${encodeURIComponent(coinId)}&symbol=${encodeURIComponent(symbol)}`
      );
      return json.priceUsd ?? null;
    },
    async () => {
      try {
        const res = await fetch(
          `https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(
            `${symbol.toUpperCase()}USDT`
          )}`,
          { signal: AbortSignal.timeout(4000) }
        );
        if (res.ok) {
          const json = (await res.json()) as { price?: string };
          const p = Number(json.price);
          if (Number.isFinite(p) && p > 0) return p;
        }
      } catch {
        // fallback
      }
      return fetchLocalCoinbaseSpot(symbol);
    }
  );
}

export async function apiRunStudy(
  coinId?: string
): Promise<{ state: AppStatePayload; newAlerts: SignalAlert[] }> {
  return withFallback(
    () =>
      safeFetchJson<{ state: AppStatePayload; newAlerts: SignalAlert[] }>('/api/study/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coinId ? { coinId } : {}),
      }),
    async () => {
      const store = loadLocalStore();
      const targets = coinId
        ? store.watchlist.filter((w) => w.id === coinId)
        : store.watchlist;
      if (targets.length === 0) throw new Error('Nenhum ativo cadastrado para estudar.');
      const tracked = getLocalTrackedAssets(store);
      const snapshots = await fetchLocalMarketSnapshots(tracked, true);
      const { newAlerts } = runLocalStudy(targets, 'manual', snapshots);
      const state = await buildLocalStatePayload(false);
      return { state, newAlerts };
    }
  );
}

export async function apiAddWatchlist(coin: {
  id: string;
  symbol: string;
  name: string;
}): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coin),
      });
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      if (store.watchlist.some((w) => w.id === coin.id)) {
        throw new Error(`${coin.symbol} já está na lista de monitoramento.`);
      }
      const newAsset: WatchlistAsset = {
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        binanceSymbol: `${coin.symbol.toUpperCase()}USDT`,
        addedAt: new Date().toISOString(),
      };
      store.watchlist.push(newAsset);
      saveLocalStore(store);

      const snapshots = await fetchLocalMarketSnapshots(getLocalTrackedAssets(store), true);
      runLocalStudy([newAsset], 'novo_ativo', snapshots);
      return buildLocalStatePayload(false);
    }
  );
}

export async function apiRemoveWatchlist(coinId: string): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>(
        `/api/watchlist/${encodeURIComponent(coinId)}`,
        { method: 'DELETE' }
      );
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      store.watchlist = store.watchlist.filter((a) => a.id !== coinId);
      delete store.analyses[coinId];
      saveLocalStore(store);
      return buildLocalStatePayload(false);
    }
  );
}

export async function apiUpdateSettings(
  patch: Partial<AppSettings>
): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      store.settings = { ...store.settings, ...patch };
      saveLocalStore(store);
      ensureLocalNextStudyAt(store.settings, true);
      return buildLocalStatePayload(false);
    }
  );
}

export async function apiTestWebhook(webhookUrl: string): Promise<void> {
  return withFallback(
    async () => {
      await safeFetchJson<{ ok: boolean }>('/api/settings/test-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl }),
      });
    },
    async () => {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '**SinalCripto IA** — Teste de integração de alertas automáticos.',
        }),
      });
      if (!res.ok) {
        throw new Error('O servidor de destino rejeitou ou bloqueou o webhook.');
      }
    }
  );
}

export async function apiMarkAlertsRead(): Promise<void> {
  return withFallback(
    async () => {
      await safeFetchJson('/api/alerts/mark-read', { method: 'POST' });
    },
    async () => {
      const store = loadLocalStore();
      for (const a of store.alerts) a.read = true;
      saveLocalStore(store);
    }
  );
}

export async function apiDeleteAlert(alertId: string): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>(
        `/api/alerts/${encodeURIComponent(alertId)}`,
        { method: 'DELETE' }
      );
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      store.alerts = store.alerts.filter((a) => a.id !== alertId);
      saveLocalStore(store);
      return buildLocalStatePayload(false);
    }
  );
}

export async function apiClearAlerts(): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>('/api/alerts', {
        method: 'DELETE',
      });
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      store.alerts = [];
      saveLocalStore(store);
      return buildLocalStatePayload(false);
    }
  );
}

export async function apiDeleteStudyCycle(cycleId: string): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>(
        `/api/study-history/${encodeURIComponent(cycleId)}`,
        { method: 'DELETE' }
      );
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      store.studyHistory = store.studyHistory.filter((c) => c.id !== cycleId);
      saveLocalStore(store);
      return buildLocalStatePayload(false);
    }
  );
}

export async function apiClearStudyHistory(): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>('/api/study-history', {
        method: 'DELETE',
      });
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      store.studyHistory = [];
      saveLocalStore(store);
      return buildLocalStatePayload(false);
    }
  );
}

export async function apiRenamePortfolio(name: string): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>('/api/portfolio/meta', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      store.portfolioName = name.slice(0, 40);
      saveLocalStore(store);
      return buildLocalStatePayload(false);
    }
  );
}

export async function apiAddTransaction(payload: {
  coinId: string;
  symbol: string;
  name: string;
  type: TransactionType;
  quantity: number;
  pricePerCoinUsd: number;
  feeUsd: number;
  timestamp: string;
  note?: string;
}): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>(
        '/api/portfolio/transactions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      const upperSym = payload.symbol.toUpperCase();
      let addedNewAsset: WatchlistAsset | null = null;
      if (!store.watchlist.some((w) => w.id === payload.coinId)) {
        addedNewAsset = {
          id: payload.coinId,
          symbol: upperSym,
          name: payload.name,
          binanceSymbol: `${upperSym}USDT`,
          addedAt: new Date().toISOString(),
        };
        store.watchlist.push(addedNewAsset);
      }

      const tx: PortfolioTransaction = {
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        coinId: payload.coinId,
        symbol: upperSym,
        name: payload.name,
        type: payload.type,
        quantity: payload.quantity,
        pricePerCoinUsd: payload.pricePerCoinUsd,
        feeUsd: payload.feeUsd,
        timestamp: payload.timestamp,
        note: payload.note,
      };
      store.transactions.push(tx);
      saveLocalStore(store);

      const snapshots = await fetchLocalMarketSnapshots(getLocalTrackedAssets(store), true);
      if (addedNewAsset) {
        runLocalStudy([addedNewAsset], 'novo_ativo', snapshots);
      }
      return buildLocalStatePayload(false);
    }
  );
}

export async function apiDeleteTransaction(txId: string): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>(
        `/api/portfolio/transactions/${encodeURIComponent(txId)}`,
        { method: 'DELETE' }
      );
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      store.transactions = store.transactions.filter((t) => t.id !== txId);
      saveLocalStore(store);
      return buildLocalStatePayload(false);
    }
  );
}

export async function apiClearTransactions(): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>(
        '/api/portfolio/transactions',
        { method: 'DELETE' }
      );
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      store.transactions = [];
      saveLocalStore(store);
      return buildLocalStatePayload(false);
    }
  );
}

export async function apiDeletePortfolioAsset(coinId: string): Promise<AppStatePayload> {
  return withFallback(
    async () => {
      const res = await safeFetchJson<{ state: AppStatePayload }>(
        `/api/portfolio/assets/${encodeURIComponent(coinId)}`,
        { method: 'DELETE' }
      );
      return res.state;
    },
    async () => {
      const store = loadLocalStore();
      store.transactions = store.transactions.filter((t) => t.coinId !== coinId);
      saveLocalStore(store);
      return buildLocalStatePayload(false);
    }
  );
}
