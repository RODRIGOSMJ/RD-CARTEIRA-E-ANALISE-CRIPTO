import type { ChartPoint, MarketSnapshot, WatchlistAsset } from '../src/types/crypto.ts';
import {
  calculateBollingerArray,
  calculateEMAArray,
  calculateRSIArray,
  computeTechnicalIndicators,
} from './indicators.ts';

interface CachedSeries {
  timestamps: number[];
  closes: number[];
  volumes: number[];
  fetchedAt: number;
}

const seriesCache = new Map<string, CachedSeries>();
const snapshotCache = new Map<string, { data: MarketSnapshot; fetchedAt: number }>();
let cachedUsdBrl = { rate: 5.75, fetchedAt: 0 };

const SNAPSHOT_TTL_MS = 10_000;
const SERIES_TTL_MS = 60_000;

export async function getUsdBrlRate(): Promise<number> {
  if (Date.now() - cachedUsdBrl.fetchedAt < 10 * 60_000) {
    return cachedUsdBrl.rate;
  }

  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const json = (await res.json()) as { USDBRL?: { bid?: string } };
      const parsed = Number(json?.USDBRL?.bid);
      if (Number.isFinite(parsed) && parsed > 1) {
        cachedUsdBrl = { rate: parsed, fetchedAt: Date.now() };
        return parsed;
      }
    }
  } catch {
    // Fallback to CoinGecko tether/brl
  }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const json = (await res.json()) as { rates?: { BRL?: number } };
      const parsed = Number(json?.rates?.BRL);
      if (Number.isFinite(parsed) && parsed > 1) {
        cachedUsdBrl = { rate: parsed, fetchedAt: Date.now() };
        return parsed;
      }
    }
  } catch {
    // Fallback to CoinGecko tether/brl
  }

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=brl',
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const json = (await res.json()) as { tether?: { brl?: number } };
      const parsed = Number(json?.tether?.brl);
      if (Number.isFinite(parsed) && parsed > 1) {
        cachedUsdBrl = { rate: parsed, fetchedAt: Date.now() };
        return parsed;
      }
    }
  } catch {
    // keep cached
  }

  return cachedUsdBrl.rate;
}

async function fetchBinance24hr(symbols: string[]): Promise<Map<string, any>> {
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
    // fallback to individual requests below
  }

  // If one symbol is invalid on Binance Spot (causing batch 400), query individually
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
        // ignore missing symbol
      }
    })
  );

  return map;
}

async function fetchBinanceKlines(
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

async function fetchCoinGeckoMarkets(ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (ids.length === 0) return map;
  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(
      ids.join(',')
    )}&sparkline=true&price_change_percentage=24h,7d`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return map;
    const data = (await res.json()) as any[];
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item?.id) map.set(item.id, item);
      }
    }
  } catch {
    // ignore
  }
  return map;
}

async function fetchCoinGeckoSeries(
  coinId: string,
  days = 7
): Promise<CachedSeries | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
      coinId
    )}/market_chart?vs_currency=usd&days=${days}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      prices?: [number, number][];
      total_volumes?: [number, number][];
    };
    if (!Array.isArray(json.prices) || json.prices.length < 10) return null;

    const timestamps = json.prices.map((p) => p[0]);
    const closes = json.prices.map((p) => p[1]);
    const volumes = Array.isArray(json.total_volumes)
      ? json.total_volumes.map((v) => v[1])
      : closes.map(() => 1);
    return { timestamps, closes, volumes, fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

async function fetchCryptoComparePrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.coinbase.com/v2/prices/${encodeURIComponent(
        symbol.toUpperCase()
      )}-USD/spot`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: { amount?: string } };
      const parsed = Number(json?.data?.amount);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

async function fetchCryptoCompareSeries(
  symbol: string,
  limit = 168
): Promise<CachedSeries | null> {
  try {
    const res = await fetch(
      `https://min-api.cryptocompare.com/data/v2/histohour?fsym=${encodeURIComponent(
        symbol.toUpperCase()
      )}&tsym=USD&limit=${limit}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      Data?: { Data?: Array<{ time: number; close: number; volumeto: number }> };
    };
    const rows = json?.Data?.Data;
    if (!Array.isArray(rows) || rows.length < 10) return null;
    return {
      timestamps: rows.map((r) => r.time * 1000),
      closes: rows.map((r) => r.close),
      volumes: rows.map((r) => r.volumeto),
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export async function getSeriesForAsset(
  asset: WatchlistAsset,
  range: '24h' | '7d' | '30d' | '90d' | 'all' = '7d'
): Promise<CachedSeries | null> {
  const cacheKey = `${asset.id}:${range}`;
  const cached = seriesCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < SERIES_TTL_MS) {
    return cached;
  }

  let series: CachedSeries | null = null;
  const binancePair = asset.binanceSymbol || `${asset.symbol.toUpperCase()}USDT`;

  if (range === '24h') {
    series = await fetchBinanceKlines(binancePair, '15m', 96);
  } else if (range === '7d') {
    series = await fetchBinanceKlines(binancePair, '1h', 168);
  } else if (range === '30d') {
    series = await fetchBinanceKlines(binancePair, '4h', 180);
  } else if (range === '90d') {
    series = await fetchBinanceKlines(binancePair, '12h', 180);
  } else {
    series = await fetchBinanceKlines(binancePair, '1d', 365);
  }

  if (!series) {
    const days =
      range === '24h' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365;
    series = await fetchCoinGeckoSeries(asset.id, days);
  }

  if (!series) {
    const limit = range === '24h' ? 24 : range === '7d' ? 168 : 300;
    series = await fetchCryptoCompareSeries(asset.symbol, limit);
  }

  if (series) {
    seriesCache.set(cacheKey, series);
    return series;
  }

  return cached ?? null;
}

export async function fetchMarketSnapshots(
  assets: WatchlistAsset[],
  forceRefresh = false
): Promise<Record<string, MarketSnapshot>> {
  const now = Date.now();
  const result: Record<string, MarketSnapshot> = {};

  if (!forceRefresh) {
    let allFresh = true;
    for (const asset of assets) {
      const cached = snapshotCache.get(asset.id);
      if (cached && now - cached.fetchedAt < SNAPSHOT_TTL_MS) {
        result[asset.id] = cached.data;
      } else {
        allFresh = false;
      }
    }
    if (allFresh && Object.keys(result).length === assets.length) {
      return result;
    }
  }

  const binancePairs = assets.map((a) => a.binanceSymbol || `${a.symbol.toUpperCase()}USDT`);
  const [binanceMap, cgMap] = await Promise.all([
    fetchBinance24hr(binancePairs),
    fetchCoinGeckoMarkets(assets.map((a) => a.id)),
  ]);

  await Promise.all(
    assets.map(async (asset) => {
      const pair = asset.binanceSymbol || `${asset.symbol.toUpperCase()}USDT`;
      const bData = binanceMap.get(pair);
      const cgData = cgMap.get(asset.id);

      let series = await getSeriesForAsset(asset, '7d');
      if (!series && cgData?.sparkline_in_7d?.price?.length > 10) {
        const prices = cgData.sparkline_in_7d.price as number[];
        const step = (7 * 24 * 3600 * 1000) / prices.length;
        const start = now - 7 * 24 * 3600 * 1000;
        series = {
          timestamps: prices.map((_, idx) => Math.round(start + idx * step)),
          closes: prices,
          volumes: prices.map(() => 1),
          fetchedAt: now,
        };
      }

      let priceUsd = bData ? Number(bData.lastPrice) : cgData ? Number(cgData.current_price) : 0;
      if (!priceUsd || !Number.isFinite(priceUsd)) {
        const ccPrice = await fetchCryptoComparePrice(asset.symbol);
        if (ccPrice) priceUsd = ccPrice;
      }

      const prevCached = snapshotCache.get(asset.id)?.data;
      if (!priceUsd && prevCached) {
        result[asset.id] = prevCached;
        return;
      }

      const closes = series?.closes ?? (priceUsd ? [priceUsd] : []);
      const volumes = series?.volumes;

      if (priceUsd > 0 && closes.length > 0) {
        closes[closes.length - 1] = priceUsd;
      }

      const indicators = computeTechnicalIndicators(closes, volumes);
      const first7d = closes[0] ?? priceUsd;
      const computed7dPct =
        first7d > 0 && priceUsd > 0 ? ((priceUsd - first7d) / first7d) * 100 : 0;

      // Compute 1h change from the previous hourly candle
      const prev1hPrice = closes.length >= 2 ? closes[closes.length - 2] : priceUsd;
      const computed1hPct =
        prev1hPrice > 0 && priceUsd > 0 ? ((priceUsd - prev1hPrice) / prev1hPrice) * 100 : 0;

      const change24hPct = bData
        ? Number(bData.priceChangePercent)
        : cgData?.price_change_percentage_24h ?? 0;

      const change7dPct =
        typeof cgData?.price_change_percentage_7d_in_currency === 'number'
          ? cgData.price_change_percentage_7d_in_currency
          : computed7dPct;

      const high24hUsd = bData
        ? Number(bData.highPrice)
        : cgData?.high_24h ?? priceUsd * 1.02;
      const low24hUsd = bData
        ? Number(bData.lowPrice)
        : cgData?.low_24h ?? priceUsd * 0.98;
      const volume24hUsd = bData
        ? Number(bData.quoteVolume)
        : cgData?.total_volume ?? 0;
      const marketCapUsd = cgData?.market_cap ?? 0;

      const sparklineRaw = closes.slice(-42);
      const sourceLabel = bData
        ? 'Binance Spot'
        : cgData
        ? 'CoinGecko'
        : 'CryptoCompare';

      const snapshot: MarketSnapshot = {
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        priceUsd: priceUsd || closes[closes.length - 1] || 0,
        change1hPct: Number(computed1hPct.toFixed(2)),
        change24hPct: Number(change24hPct.toFixed(2)),
        change7dPct: Number(change7dPct.toFixed(2)),
        high24hUsd,
        low24hUsd,
        volume24hUsd,
        marketCapUsd,
        sparkline7d: sparklineRaw,
        indicators,
        updatedAt: new Date().toISOString(),
        dataSource: sourceLabel,
      };

      snapshotCache.set(asset.id, { data: snapshot, fetchedAt: now });
      result[asset.id] = snapshot;
    })
  );

  return result;
}

export async function getAssetChartSeries(
  asset: WatchlistAsset,
  range: '24h' | '7d' | '30d'
): Promise<ChartPoint[]> {
  const series = await getSeriesForAsset(asset, range);
  if (!series || series.closes.length === 0) return [];

  const ema9 = calculateEMAArray(series.closes, 9);
  const ema21 = calculateEMAArray(series.closes, 21);
  const bb = calculateBollingerArray(series.closes, 20, 2);
  const rsi = calculateRSIArray(series.closes, 14);

  return series.closes.map((price, idx) => ({
    timestamp: series.timestamps[idx],
    price,
    ema9: ema9[idx],
    ema21: ema21[idx],
    bollingerUpper: bb.upper[idx],
    bollingerLower: bb.lower[idx],
    rsi: rsi[idx],
  }));
}

export async function getPortfolioHistorySeries(
  holdings: Array<{
    coinId: string;
    symbol: string;
    name: string;
    quantity: number;
    costBasisUsd: number;
  }>,
  totalCostBasisUsd: number,
  range: '24h' | '7d' | '30d' | '90d' | 'all'
) {
  const btcAsset: WatchlistAsset = {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    binanceSymbol: 'BTCUSDT',
    addedAt: '',
  };

  const btcSeries = await getSeriesForAsset(btcAsset, range);
  if (!btcSeries || btcSeries.timestamps.length < 2) {
    return [];
  }

  // Fetch historical series for each held coin in parallel
  const coinSeriesMap = new Map<string, CachedSeries>();
  await Promise.all(
    holdings.map(async (h) => {
      if (h.coinId === 'bitcoin') {
        coinSeriesMap.set(h.coinId, btcSeries);
        return;
      }
      const s = await getSeriesForAsset(
        {
          id: h.coinId,
          symbol: h.symbol,
          name: h.name,
          binanceSymbol: `${h.symbol.toUpperCase()}USDT`,
          addedAt: '',
        },
        range
      );
      if (s && s.closes.length > 0) {
        coinSeriesMap.set(h.coinId, s);
      }
    })
  );

  const btcFirst = btcSeries.closes[0] || 1;
  const pointCount = btcSeries.timestamps.length;

  const findPriceAt = (series: CachedSeries, targetTs: number) => {
    // Binary/nearest lookup by ratio for aligned candle lengths
    if (series.closes.length === 0) return 0;
    let bestIdx = 0;
    let minDiff = Math.abs(series.timestamps[0] - targetTs);
    for (let i = 1; i < series.timestamps.length; i++) {
      const diff = Math.abs(series.timestamps[i] - targetTs);
      if (diff <= minDiff) {
        minDiff = diff;
        bestIdx = i;
      } else {
        break;
      }
    }
    return series.closes[bestIdx] ?? 0;
  };

  const points = [];
  for (let i = 0; i < pointCount; i++) {
    const ts = btcSeries.timestamps[i];
    const btcPrice = btcSeries.closes[i];
    const btcTrendPct = ((btcPrice - btcFirst) / btcFirst) * 100;

    let totalValueUsd = 0;
    for (const h of holdings) {
      if (h.quantity <= 0) continue;
      const s = coinSeriesMap.get(h.coinId);
      if (s) {
        totalValueUsd += h.quantity * findPriceAt(s, ts);
      }
    }

    const profitPct =
      totalCostBasisUsd > 0
        ? ((totalValueUsd - totalCostBasisUsd) / totalCostBasisUsd) * 100
        : 0;

    points.push({
      timestamp: ts,
      totalValueUsd: Number(totalValueUsd.toFixed(2)),
      costBasisUsd: Number(totalCostBasisUsd.toFixed(2)),
      profitPct: Number(profitPct.toFixed(2)),
      btcTrendPct: Number(btcTrendPct.toFixed(2)),
    });
  }

  return points;
}

export async function fetchSingleCoinPriceUsd(
  coinId: string,
  symbol: string
): Promise<number | null> {
  const pair = `${symbol.toUpperCase()}USDT`;
  try {
    const res = await fetch(
      `https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`,
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

  const cbPrice = await fetchCryptoComparePrice(symbol);
  if (cbPrice) return cbPrice;

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
        coinId
      )}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const json = (await res.json()) as Record<string, { usd?: number }>;
      const p = Number(json[coinId]?.usd);
      if (Number.isFinite(p) && p > 0) return p;
    }
  } catch {
    // fallback
  }

  return null;
}

const searchCache = new Map<
  string,
  { results: Array<{ id: string; symbol: string; name: string; marketCapRank: number | null }>; fetchedAt: number }
>();

export async function searchCryptos(
  query: string
): Promise<Array<{ id: string; symbol: string; name: string; marketCapRank: number | null }>> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const cached = searchCache.get(q);
  if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) {
    return cached.results;
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const json = (await res.json()) as {
        coins?: Array<{ id: string; symbol: string; name: string; market_cap_rank: number | null }>;
      };
      const results = (json.coins ?? []).slice(0, 10).map((c) => ({
        id: c.id,
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        marketCapRank: c.market_cap_rank,
      }));
      if (results.length > 0) {
        searchCache.set(q, { results, fetchedAt: Date.now() });
        return results;
      }
    }
  } catch {
    // fallback to CoinPaprika search
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
      const results = (json.currencies ?? []).slice(0, 10).map((c) => ({
        id: c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        marketCapRank: c.rank && c.rank > 0 ? c.rank : null,
      }));
      if (results.length > 0) {
        searchCache.set(q, { results, fetchedAt: Date.now() });
        return results;
      }
    }
  } catch {
    // ignore
  }

  return [];
}
