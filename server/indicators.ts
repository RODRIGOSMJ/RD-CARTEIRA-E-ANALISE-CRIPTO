import type { TechnicalIndicators } from '../src/types/crypto.ts';

export function calculateEMAArray(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let ema = sum / period;
  result[period - 1] = ema;

  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
    result[i] = ema;
  }

  return result;
}

export function calculateRSIArray(values: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return result;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  const computeRsi = (g: number, l: number) => {
    if (l === 0) return 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  };

  result[period] = computeRsi(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = computeRsi(avgGain, avgLoss);
  }

  return result;
}

export function calculateBollingerArray(
  values: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const middle: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);

  if (values.length < period) {
    return { upper, middle, lower };
  }

  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((acc, v) => acc + v, 0) / period;
    const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);

    middle[i] = mean;
    upper[i] = mean + stdDevMultiplier * std;
    lower[i] = Math.max(0, mean - stdDevMultiplier * std);
  }

  return { upper, middle, lower };
}

export function computeTechnicalIndicators(
  closes: number[],
  volumes?: number[]
): TechnicalIndicators {
  const validCloses = closes.filter((v) => Number.isFinite(v) && v > 0);
  if (validCloses.length < 5) {
    const fallbackPrice = validCloses[validCloses.length - 1] ?? 1;
    return {
      rsi14: 50,
      ema9: fallbackPrice,
      ema21: fallbackPrice,
      ema50: fallbackPrice,
      emaTrend: 'lateral',
      macdLine: 0,
      macdSignal: 0,
      macdHistogram: 0,
      macdTrend: 'neutral',
      bollingerUpper: fallbackPrice * 1.03,
      bollingerMiddle: fallbackPrice,
      bollingerLower: fallbackPrice * 0.97,
      bollingerPercentB: 50,
      volatilityPct: 2.5,
      supportLevel: fallbackPrice * 0.96,
      resistanceLevel: fallbackPrice * 1.04,
      volumeMomentumPct: 0,
    };
  }

  const lastPrice = validCloses[validCloses.length - 1];
  const rsiArr = calculateRSIArray(validCloses, Math.min(14, validCloses.length - 1));
  const rsi14 = rsiArr[rsiArr.length - 1] ?? 50;

  const ema9Arr = calculateEMAArray(validCloses, Math.min(9, validCloses.length));
  const ema21Arr = calculateEMAArray(validCloses, Math.min(21, validCloses.length));
  const ema50Arr = calculateEMAArray(validCloses, Math.min(50, validCloses.length));

  const ema9 = ema9Arr[ema9Arr.length - 1] ?? lastPrice;
  const ema21 = ema21Arr[ema21Arr.length - 1] ?? lastPrice;
  const ema50 = ema50Arr[ema50Arr.length - 1] ?? ema21;

  let emaTrend: 'alta' | 'baixa' | 'lateral' = 'lateral';
  if (ema9 > ema21 * 1.002 && lastPrice > ema21) {
    emaTrend = 'alta';
  } else if (ema9 < ema21 * 0.998 && lastPrice < ema21) {
    emaTrend = 'baixa';
  }

  // MACD (12, 26, 9)
  const ema12Arr = calculateEMAArray(validCloses, Math.min(12, validCloses.length));
  const ema26Arr = calculateEMAArray(validCloses, Math.min(26, validCloses.length));
  const macdSeries: number[] = [];
  for (let i = 0; i < validCloses.length; i++) {
    const e12 = ema12Arr[i];
    const e26 = ema26Arr[i];
    if (e12 !== null && e26 !== null) {
      macdSeries.push(e12 - e26);
    }
  }
  const macdSignalArr = calculateEMAArray(macdSeries, Math.min(9, Math.max(2, macdSeries.length)));
  const macdLine = macdSeries[macdSeries.length - 1] ?? 0;
  const macdSignal = macdSignalArr[macdSignalArr.length - 1] ?? macdLine;
  const macdHistogram = macdLine - macdSignal;

  let macdTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (macdHistogram > 0 && macdLine > macdSignal) macdTrend = 'bullish';
  else if (macdHistogram < 0 && macdLine < macdSignal) macdTrend = 'bearish';

  // Bollinger Bands (20, 2)
  const bb = calculateBollingerArray(validCloses, Math.min(20, validCloses.length), 2);
  const bollingerUpper = bb.upper[bb.upper.length - 1] ?? lastPrice * 1.03;
  const bollingerMiddle = bb.middle[bb.middle.length - 1] ?? lastPrice;
  const bollingerLower = bb.lower[bb.lower.length - 1] ?? lastPrice * 0.97;
  const bandWidth = bollingerUpper - bollingerLower;
  const bollingerPercentB =
    bandWidth > 0 ? ((lastPrice - bollingerLower) / bandWidth) * 100 : 50;

  // Volatility (standard deviation of period returns)
  const returns: number[] = [];
  for (let i = Math.max(1, validCloses.length - 30); i < validCloses.length; i++) {
    returns.push(((validCloses[i] - validCloses[i - 1]) / validCloses[i - 1]) * 100);
  }
  const meanReturn = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const varianceReturn =
    returns.reduce((a, b) => a + (b - meanReturn) ** 2, 0) / Math.max(1, returns.length);
  const volatilityPct = Math.sqrt(varianceReturn);

  // Recent support & resistance (last 48 candles or available window)
  const windowSlice = validCloses.slice(-Math.min(48, validCloses.length));
  const supportLevel = Math.min(...windowSlice);
  const resistanceLevel = Math.max(...windowSlice);

  // Volume momentum
  let volumeMomentumPct = 0;
  if (volumes && volumes.length >= 10) {
    const recentVol =
      volumes.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, volumes.length);
    const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    if (avgVol > 0) {
      volumeMomentumPct = ((recentVol - avgVol) / avgVol) * 100;
    }
  }

  return {
    rsi14: Number(rsi14.toFixed(2)),
    ema9,
    ema21,
    ema50,
    emaTrend,
    macdLine,
    macdSignal,
    macdHistogram,
    macdTrend,
    bollingerUpper,
    bollingerMiddle,
    bollingerLower,
    bollingerPercentB: Number(bollingerPercentB.toFixed(1)),
    volatilityPct: Number(volatilityPct.toFixed(2)),
    supportLevel,
    resistanceLevel,
    volumeMomentumPct: Number(volumeMomentumPct.toFixed(1)),
  };
}
