export type SignalAction = 'COMPRAR' | 'VENDER' | 'ESPERAR';

export type SignalOutcome = 'em_aberto' | 'acerto' | 'neutro' | 'erro';

export interface WatchlistAsset {
  id: string; // CoinGecko ID, e.g., 'bitcoin'
  symbol: string; // Uppercase ticker, e.g., 'BTC'
  name: string;
  binanceSymbol?: string; // e.g., 'BTCUSDT'
  image?: string;
  addedAt: string;
}

export interface TechnicalIndicators {
  rsi14: number;
  ema9: number;
  ema21: number;
  ema50: number;
  emaTrend: 'alta' | 'baixa' | 'lateral';
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  macdTrend: 'bullish' | 'bearish' | 'neutral';
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  bollingerPercentB: number; // 0 to 100+
  volatilityPct: number;
  supportLevel: number;
  resistanceLevel: number;
  volumeMomentumPct: number;
}

export interface MarketSnapshot {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  change1hPct?: number;
  change24hPct: number;
  change7dPct: number;
  high24hUsd: number;
  low24hUsd: number;
  volume24hUsd: number;
  marketCapUsd: number;
  sparkline7d: number[];
  indicators: TechnicalIndicators;
  updatedAt: string;
  dataSource: string;
}

export interface AIAnalysisResult {
  coinId: string;
  symbol: string;
  action: SignalAction;
  confidence: number; // 0-100
  horizon: 'curto_prazo' | 'medio_prazo' | 'swing';
  entryZoneLowUsd: number;
  entryZoneHighUsd: number;
  targetPriceUsd: number;
  stopLossUsd: number;
  riskLevel: 'baixo' | 'moderado' | 'elevado';
  headline: string;
  thesis: string;
  portfolioAdvice?: string;
  technicalFactors: string[];
  riskFactors: string[];
  selfLearningNote: string;
  priceAtAnalysisUsd: number;
  analyzedAt: string;
  cycleId: string;
}

export interface SignalAlert {
  id: string;
  coinId: string;
  symbol: string;
  name: string;
  action: SignalAction;
  previousAction?: SignalAction;
  confidence: number;
  priceAtSignalUsd: number;
  targetPriceUsd: number;
  stopLossUsd: number;
  headline: string;
  reason: string;
  createdAt: string;
  read: boolean;
  outcome: SignalOutcome;
  evaluatedReturnPct?: number;
  evaluatedAt?: string;
}

export interface StudyCycleSummary {
  id: string;
  startedAt: string;
  completedAt: string;
  assetsStudied: number;
  buySignals: number;
  sellSignals: number;
  holdSignals: number;
  alertsEmitted: number;
  evaluatedAccuracyPct: number | null;
  trigger: 'automatico' | 'manual' | 'novo_ativo';
  marketSummary: string;
}

export interface AppSettings {
  autoStudyEnabled: boolean;
  intervalMinutes: number;
  currency: 'USD' | 'BRL';
  minConfidenceForAlert: number;
  webhookUrl: string;
}

export interface ChartPoint {
  timestamp: number;
  price: number;
  ema9: number | null;
  ema21: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  rsi: number | null;
}

export type TransactionType = 'compra' | 'venda' | 'ganho';

export interface PortfolioTransaction {
  id: string;
  coinId: string;
  symbol: string;
  name: string;
  type: TransactionType;
  quantity: number;
  pricePerCoinUsd: number;
  feeUsd: number;
  timestamp: string;
  note?: string;
}

export interface PortfolioHolding {
  coinId: string;
  symbol: string;
  name: string;
  quantity: number;
  avgBuyPriceUsd: number;
  costBasisUsd: number;
  currentPriceUsd: number;
  currentValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  realizedPnlUsd: number;
  totalPnlUsd: number;
  totalPnlPct: number;
  allocationPct: number;
  totalBoughtQty: number;
  totalSoldQty: number;
  totalGainedQty: number;
}

export interface PortfolioSummary {
  name: string;
  totalValueUsd: number;
  totalCostBasisUsd: number;
  allTimeProfitUsd: number;
  allTimeProfitPct: number;
  change24hUsd: number;
  change24hPct: number;
  holdings: PortfolioHolding[];
  transactions: PortfolioTransaction[];
  bestPerformer: PortfolioHolding | null;
  worstPerformer: PortfolioHolding | null;
}

export interface PortfolioHistoryPoint {
  timestamp: number;
  totalValueUsd: number;
  costBasisUsd: number;
  profitPct: number;
  btcTrendPct: number;
}

export interface AppStatePayload {
  watchlist: WatchlistAsset[];
  snapshots: Record<string, MarketSnapshot>;
  analyses: Record<string, AIAnalysisResult>;
  alerts: SignalAlert[];
  studyHistory: StudyCycleSummary[];
  settings: AppSettings;
  portfolio: PortfolioSummary;
  usdBrlRate: number;
  isStudying: boolean;
  nextStudyAt: string | null;
  accuracyStats: {
    totalEvaluated: number;
    hits: number;
    neutrals: number;
    misses: number;
    accuracyPct: number | null;
  };
}
