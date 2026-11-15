import {
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  Download,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiGetPortfolioHistory } from '../services/apiClient.ts';
import type {
  AIAnalysisResult,
  MarketSnapshot,
  PortfolioHistoryPoint,
  PortfolioSummary,
} from '../types/crypto.ts';
import {
  formatCurrencyValue,
  formatPercent,
  formatPrice,
  formatSignedCurrency,
} from '../utils/format.ts';
import { SignalBadge } from './SignalBadge.tsx';

interface PortfolioViewProps {
  portfolio: PortfolioSummary;
  snapshots: Record<string, MarketSnapshot>;
  analyses: Record<string, AIAnalysisResult>;
  currency: 'USD' | 'BRL';
  usdBrlRate: number;
  onOpenAddTransaction: (coinId?: string) => void;
  onDeleteTransaction: (txId: string) => Promise<void>;
  onDeleteCoinHistory: (coinId: string) => Promise<void>;
  onClearTransactions: () => Promise<void>;
  onRenamePortfolio: (name: string) => Promise<void>;
  onSelectAssetForAI: (coinId: string) => void;
  onOpenCreateTrigger: (coinId: string) => void;
}

const ALLOCATION_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#EF4444',
  '#84CC16',
];

export function PortfolioView({
  portfolio,
  snapshots,
  analyses,
  currency,
  usdBrlRate,
  onOpenAddTransaction,
  onDeleteTransaction,
  onDeleteCoinHistory,
  onClearTransactions,
  onRenamePortfolio,
  onSelectAssetForAI,
  onOpenCreateTrigger,
}: PortfolioViewProps) {
  const [hideBalances, setHideBalances] = useState(false);
  const [chartRange, setChartRange] = useState<'24h' | '7d' | '30d' | '90d' | 'all'>('7d');
  const [chartMode, setChartMode] = useState<'history' | 'allocation'>('history');
  const [subTab, setSubTab] = useState<'assets' | 'transactions'>('assets');
  const [historyPoints, setHistoryPoints] = useState<PortfolioHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [perfHoverIdx, setPerfHoverIdx] = useState<number | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(portfolio.name);

  useEffect(() => {
    setNameDraft(portfolio.name);
  }, [portfolio.name]);

  useEffect(() => {
    if (portfolio.holdings.filter((h) => h.quantity > 0).length === 0) {
      setHistoryPoints([]);
      return;
    }

    let active = true;
    setHistoryLoading(true);
    apiGetPortfolioHistory(chartRange, {
      holdings: portfolio.holdings,
      totalCostBasisUsd: portfolio.totalCostBasisUsd,
    })
      .then((data) => {
        if (!active) return;
        setHistoryPoints(data.points ?? []);
        setHistoryLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setHistoryLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    chartRange,
    portfolio.holdings.length,
    portfolio.transactions.length,
    portfolio.totalCostBasisUsd,
  ]);

  const maskValue = (val: string) => (hideBalances ? '••••••' : val);

  function handleExportCsv() {
    const header = [
      'Data',
      'Tipo',
      'Simbolo',
      'Ativo',
      'Quantidade',
      'Preco_Unitario_USD',
      'Taxa_USD',
      'Total_USD',
      'Nota',
    ];
    const rows = portfolio.transactions.map((tx) => {
      const total = tx.type === 'ganho' ? 0 : tx.quantity * tx.pricePerCoinUsd + tx.feeUsd;
      return [
        tx.timestamp,
        tx.type,
        tx.symbol,
        tx.name,
        tx.quantity,
        tx.pricePerCoinUsd,
        tx.feeUsd,
        total.toFixed(2),
        (tx.note || '').replace(/"/g, '""'),
      ]
        .map((c) => `"${c}"`)
        .join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${portfolio.name.toLowerCase().replace(/\s+/g, '_')}_transacoes.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function savePortfolioName() {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (trimmed && trimmed !== portfolio.name) {
      await onRenamePortfolio(trimmed);
    }
  }

  // Holdings SVG Chart Geometry
  const holdingsGeo = useMemo(() => {
    if (historyPoints.length < 2) return null;
    const w = 680;
    const h = 230;
    const padX = 10;
    const padY = 18;
    const plotW = w - padX * 2;
    const plotH = h - padY * 2;

    const vals = historyPoints.map((p) => p.totalValueUsd);
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const span = maxVal - minVal || maxVal * 0.05 || 1;
    const pMin = Math.max(0, minVal - span * 0.08);
    const pMax = maxVal + span * 0.08;
    const pSpan = pMax - pMin || 1;

    const toX = (i: number) => padX + (i / (historyPoints.length - 1)) * plotW;
    const toY = (v: number) => padY + plotH - ((v - pMin) / pSpan) * plotH;

    const linePath = historyPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.totalValueUsd).toFixed(1)}`)
      .join(' ');
    const areaPath = `${linePath} L ${toX(historyPoints.length - 1).toFixed(1)} ${(
      padY + plotH
    ).toFixed(1)} L ${toX(0).toFixed(1)} ${(padY + plotH).toFixed(1)} Z`;

    const isPositive =
      historyPoints[historyPoints.length - 1].totalValueUsd >= historyPoints[0].totalValueUsd;

    return { w, h, padX, padY, plotW, plotH, pMin, pMax, toX, toY, linePath, areaPath, isPositive };
  }, [historyPoints]);

  // Performance (Profit % vs BTC Trend %) SVG Geometry
  const perfGeo = useMemo(() => {
    if (historyPoints.length < 2) return null;
    const w = 420;
    const h = 230;
    const padX = 10;
    const padY = 18;
    const plotW = w - padX * 2;
    const plotH = h - padY * 2;

    const allPcts = historyPoints.flatMap((p) => [p.profitPct, p.btcTrendPct]);
    const minVal = Math.min(0, ...allPcts);
    const maxVal = Math.max(0, ...allPcts);
    const span = maxVal - minVal || 10;
    const pMin = minVal - span * 0.08;
    const pMax = maxVal + span * 0.08;
    const pSpan = pMax - pMin || 1;

    const toX = (i: number) => padX + (i / (historyPoints.length - 1)) * plotW;
    const toY = (v: number) => padY + plotH - ((v - pMin) / pSpan) * plotH;

    const profitPath = historyPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.profitPct).toFixed(1)}`)
      .join(' ');
    const btcPath = historyPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.btcTrendPct).toFixed(1)}`)
      .join(' ');
    const zeroY = toY(0);

    return { w, h, padX, padY, plotW, plotH, pMin, pMax, zeroY, toX, toY, profitPath, btcPath };
  }, [historyPoints]);

  const activeHoldings = portfolio.holdings.filter((h) => h.quantity > 0);
  const hasAnyHistory = portfolio.transactions.length > 0;

  return (
    <div className="space-y-6">
      {/* Portfolio Header mirroring CoinMarketCap layout */}
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {editingName ? (
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={savePortfolioName}
                onKeyDown={(e) => e.key === 'Enter' && savePortfolioName()}
                autoFocus
                className="px-2 py-0.5 text-xs font-semibold rounded border border-sky-500 bg-[#0B0F17] text-slate-100 focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                title="Clique para renomear a carteira"
              >
                <span>{portfolio.name}</span>
                <Pencil className="w-3 h-3 text-slate-500" />
              </button>
            )}
            <span className="text-xs text-slate-500" aria-hidden="true">
              ·
            </span>
            <span className="text-xs text-slate-400">Carteira principal</span>
          </div>

          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-mono font-bold text-slate-100 tabular-nums">
              {maskValue(formatCurrencyValue(portfolio.totalValueUsd, currency, usdBrlRate))}
            </span>
            <span
              className={`inline-flex items-center gap-1 text-sm font-mono font-semibold tabular-nums ${
                portfolio.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {portfolio.change24hPct >= 0 ? (
                <ArrowUpRight className="w-4 h-4" />
              ) : (
                <ArrowDownRight className="w-4 h-4" />
              )}
              {formatPercent(portfolio.change24hPct)} (24h)
            </span>
            <button
              type="button"
              onClick={() => setHideBalances((v) => !v)}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors"
              aria-label={hideBalances ? 'Mostrar saldos' : 'Ocultar saldos'}
            >
              {hideBalances ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onOpenAddTransaction()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar transação
          </button>

          {hasAnyHistory && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-white/10 bg-[#111827] hover:bg-slate-800 text-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar
            </button>
          )}
        </div>
      </section>

      {!hasAnyHistory ? (
        <section className="rounded-xl border border-white/[0.08] bg-[#111827] p-10 text-center space-y-4">
          <Wallet className="w-8 h-8 text-sky-400 mx-auto" />
          <div className="max-w-md mx-auto space-y-1.5">
            <h2 className="text-base font-semibold text-slate-100">
              Monte sua carteira para o robô estudar junto com você
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Adicione suas compras, vendas ou ganhos de staking/airdrop. O SinalCripto IA calculará seu preço médio, lucro real e passará a indicar quando realizar lucro ou segurar com base na sua posição.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenAddTransaction()}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
          >
            <Plus className="w-4 h-4" />
            Adicionar primeira transação
          </button>
        </section>
      ) : (
        <>
          {/* 2-Card Chart Row: Holdings (8 cols) + Performance vs BTC (4 cols) */}
          <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            {/* Holdings Card */}
            <div className="xl:col-span-8 rounded-xl border border-white/[0.08] bg-[#111827] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-100">Patrimônio</h2>

                <div className="flex flex-wrap items-center gap-2">
                  {chartMode === 'history' && (
                    <div className="flex items-center gap-1 rounded-lg bg-[#0B0F17] p-0.5 border border-white/[0.07]">
                      {(['24h', '7d', '30d', '90d', 'all'] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setChartRange(r)}
                          className={`px-2.5 py-1 text-[11px] font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                            chartRange === r
                              ? 'bg-slate-800 text-slate-100'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {r === 'all' ? 'Tudo' : r.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1 rounded-lg bg-[#0B0F17] p-0.5 border border-white/[0.07]">
                    <button
                      type="button"
                      onClick={() => setChartMode('history')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                        chartMode === 'history'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Histórico
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartMode('allocation')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                        chartMode === 'allocation'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Alocação
                    </button>
                  </div>
                </div>
              </div>

              {chartMode === 'allocation' ? (
                <div className="space-y-3 py-2">
                  {activeHoldings.length === 0 ? (
                    <p className="text-xs text-slate-400 py-8 text-center">
                      Nenhum saldo positivo em carteira no momento.
                    </p>
                  ) : (
                    activeHoldings.map((h, idx) => (
                      <div key={h.coinId} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-sm shrink-0"
                              style={{
                                backgroundColor:
                                  ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length],
                              }}
                            />
                            <span className="font-mono font-semibold text-slate-100">
                              {h.symbol}
                            </span>
                            <span className="text-slate-400">{h.name}</span>
                          </div>
                          <div className="font-mono tabular-nums text-slate-200">
                            {maskValue(
                              formatPrice(h.currentValueUsd, currency, usdBrlRate)
                            )}{' '}
                            <span className="text-slate-400">
                              ({h.allocationPct.toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                        <div className="h-2 rounded-full bg-[#0B0F17] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.max(2, h.allocationPct)}%`,
                              backgroundColor:
                                ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : historyLoading ? (
                <div className="h-[230px] rounded-lg bg-[#0B0F17] animate-pulse" />
              ) : holdingsGeo ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-400">
                    <span>
                      {hoverIdx !== null && historyPoints[hoverIdx]
                        ? new Date(historyPoints[hoverIdx].timestamp).toLocaleString(
                            'pt-BR',
                            {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            }
                          )
                        : 'Evolução estimada da posição atual'}
                    </span>
                    <span className="text-slate-100 font-semibold">
                      {hoverIdx !== null && historyPoints[hoverIdx]
                        ? maskValue(
                            formatPrice(
                              historyPoints[hoverIdx].totalValueUsd,
                              currency,
                              usdBrlRate
                            )
                          )
                        : maskValue(
                            formatPrice(portfolio.totalValueUsd, currency, usdBrlRate)
                          )}
                    </span>
                  </div>

                  <div className="relative h-[230px] rounded-lg border border-white/[0.06] bg-[#0B0F17] overflow-hidden">
                    <svg
                      viewBox={`0 0 ${holdingsGeo.w} ${holdingsGeo.h}`}
                      className="w-full h-full select-none"
                      onMouseLeave={() => setHoverIdx(null)}
                      onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const relX =
                          ((e.clientX - rect.left) / rect.width) * holdingsGeo.w;
                        const ratio = Math.max(
                          0,
                          Math.min(1, (relX - holdingsGeo.padX) / holdingsGeo.plotW)
                        );
                        setHoverIdx(Math.round(ratio * (historyPoints.length - 1)));
                      }}
                    >
                      <defs>
                        <linearGradient id="portfolioArea" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor={holdingsGeo.isPositive ? '#10B981' : '#EF4444'}
                            stopOpacity="0.28"
                          />
                          <stop
                            offset="100%"
                            stopColor={holdingsGeo.isPositive ? '#10B981' : '#EF4444'}
                            stopOpacity="0"
                          />
                        </linearGradient>
                      </defs>
                      {[0.25, 0.5, 0.75].map((ratio) => {
                        const y = holdingsGeo.padY + holdingsGeo.plotH * ratio;
                        const val =
                          holdingsGeo.pMax -
                          (holdingsGeo.pMax - holdingsGeo.pMin) * ratio;
                        return (
                          <g key={ratio}>
                            <line
                              x1={holdingsGeo.padX}
                              y1={y}
                              x2={holdingsGeo.w - holdingsGeo.padX}
                              y2={y}
                              stroke="rgba(148,163,184,0.1)"
                              strokeDasharray="3 4"
                            />
                            <text
                              x={holdingsGeo.w - holdingsGeo.padX - 4}
                              y={y - 4}
                              textAnchor="end"
                              fill="rgba(148,163,184,0.55)"
                              fontSize="10"
                              fontFamily="JetBrains Mono, monospace"
                            >
                              {hideBalances
                                ? '••••'
                                : formatPrice(val, currency, usdBrlRate)}
                            </text>
                          </g>
                        );
                      })}

                      <path d={holdingsGeo.areaPath} fill="url(#portfolioArea)" />
                      <path
                        d={holdingsGeo.linePath}
                        fill="none"
                        stroke={holdingsGeo.isPositive ? '#10B981' : '#EF4444'}
                        strokeWidth="2"
                      />

                      {hoverIdx !== null && historyPoints[hoverIdx] && (
                        <g>
                          <line
                            x1={holdingsGeo.toX(hoverIdx)}
                            y1={holdingsGeo.padY}
                            x2={holdingsGeo.toX(hoverIdx)}
                            y2={holdingsGeo.padY + holdingsGeo.plotH}
                            stroke="rgba(241,245,249,0.25)"
                          />
                          <circle
                            cx={holdingsGeo.toX(hoverIdx)}
                            cy={holdingsGeo.toY(historyPoints[hoverIdx].totalValueUsd)}
                            r="4"
                            fill={holdingsGeo.isPositive ? '#10B981' : '#EF4444'}
                            stroke="#0B0F17"
                            strokeWidth="1.5"
                          />
                        </g>
                      )}
                    </svg>
                  </div>
                </div>
              ) : (
                <div className="h-[230px] rounded-lg border border-white/[0.06] bg-[#0B0F17] flex items-center justify-center text-xs text-slate-400">
                  Histórico em processamento para os ativos da carteira.
                </div>
              )}
            </div>

            {/* Performance vs BTC Card */}
            <div className="xl:col-span-4 rounded-xl border border-white/[0.08] bg-[#111827] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-100">Desempenho</h2>
                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    Sua carteira
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    BTC
                  </span>
                </div>
              </div>

              {perfGeo ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                    <span className="text-sky-400">
                      Carteira:{' '}
                      {formatPercent(
                        perfHoverIdx !== null && historyPoints[perfHoverIdx]
                          ? historyPoints[perfHoverIdx].profitPct
                          : portfolio.allTimeProfitPct
                      )}
                    </span>
                    <span className="text-amber-400">
                      BTC:{' '}
                      {formatPercent(
                        perfHoverIdx !== null && historyPoints[perfHoverIdx]
                          ? historyPoints[perfHoverIdx].btcTrendPct
                          : historyPoints[historyPoints.length - 1]?.btcTrendPct ?? 0
                      )}
                    </span>
                  </div>

                  <div className="relative h-[230px] rounded-lg border border-white/[0.06] bg-[#0B0F17] overflow-hidden">
                    <svg
                      viewBox={`0 0 ${perfGeo.w} ${perfGeo.h}`}
                      className="w-full h-full select-none"
                      onMouseLeave={() => setPerfHoverIdx(null)}
                      onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const relX = ((e.clientX - rect.left) / rect.width) * perfGeo.w;
                        const ratio = Math.max(
                          0,
                          Math.min(1, (relX - perfGeo.padX) / perfGeo.plotW)
                        );
                        setPerfHoverIdx(Math.round(ratio * (historyPoints.length - 1)));
                      }}
                    >
                      <line
                        x1={perfGeo.padX}
                        y1={perfGeo.zeroY}
                        x2={perfGeo.w - perfGeo.padX}
                        y2={perfGeo.zeroY}
                        stroke="rgba(148,163,184,0.22)"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={perfGeo.w - perfGeo.padX - 4}
                        y={perfGeo.zeroY - 4}
                        textAnchor="end"
                        fill="rgba(148,163,184,0.6)"
                        fontSize="10"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        0%
                      </text>

                      <path
                        d={perfGeo.btcPath}
                        fill="none"
                        stroke="#F59E0B"
                        strokeWidth="1.75"
                      />
                      <path
                        d={perfGeo.profitPath}
                        fill="none"
                        stroke="#38BDF8"
                        strokeWidth="2"
                      />

                      {perfHoverIdx !== null && historyPoints[perfHoverIdx] && (
                        <line
                          x1={perfGeo.toX(perfHoverIdx)}
                          y1={perfGeo.padY}
                          x2={perfGeo.toX(perfHoverIdx)}
                          y2={perfGeo.padY + perfGeo.plotH}
                          stroke="rgba(241,245,249,0.25)"
                        />
                      )}
                    </svg>
                  </div>
                </div>
              ) : (
                <div className="h-[230px] rounded-lg border border-white/[0.06] bg-[#0B0F17] flex items-center justify-center text-xs text-slate-400">
                  Comparativo disponível após carregamento do histórico.
                </div>
              )}
            </div>
          </section>

          {/* 3-Card KPI Strip mirroring All-time profit | Cost Basis | Best & Worst Performer */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-white/[0.08] bg-[#111827] p-5">
              <span className="block text-xs text-slate-400">Lucro total acumulado</span>
              <div
                className={`mt-2 text-2xl font-mono font-bold tabular-nums ${
                  portfolio.allTimeProfitUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {maskValue(
                  formatSignedCurrency(portfolio.allTimeProfitUsd, currency, usdBrlRate)
                )}
              </div>
              <span
                className={`mt-1 inline-block text-xs font-mono tabular-nums ${
                  portfolio.allTimeProfitPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatPercent(portfolio.allTimeProfitPct)}
              </span>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#111827] p-5">
              <span className="block text-xs text-slate-400">
                Custo base investido
              </span>
              <div className="mt-2 text-2xl font-mono font-bold text-slate-100 tabular-nums">
                {maskValue(formatCurrencyValue(portfolio.totalCostBasisUsd, currency, usdBrlRate))}
              </div>
              <span className="mt-1 inline-block text-xs text-slate-400 font-mono tabular-nums">
                {portfolio.transactions.length} transações registradas
              </span>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#111827] p-5 grid grid-cols-2 gap-4">
              <div className="min-w-0">
                <span className="block text-xs text-slate-400">Melhor ativo</span>
                {portfolio.bestPerformer ? (
                  <div className="mt-2 space-y-0.5">
                    <div className="font-mono font-bold text-base text-slate-100 truncate">
                      {portfolio.bestPerformer.symbol}
                    </div>
                    <div
                      className={`text-xs font-mono tabular-nums ${
                        portfolio.bestPerformer.totalPnlUsd >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {maskValue(
                        formatSignedCurrency(
                          portfolio.bestPerformer.totalPnlUsd,
                          currency,
                          usdBrlRate
                        )
                      )}{' '}
                      ({formatPercent(portfolio.bestPerformer.totalPnlPct)})
                    </div>
                  </div>
                ) : (
                  <span className="mt-2 block text-xs text-slate-500">—</span>
                )}
              </div>

              <div className="min-w-0 border-l border-white/[0.07] pl-4">
                <span className="block text-xs text-slate-400">Pior ativo</span>
                {portfolio.worstPerformer ? (
                  <div className="mt-2 space-y-0.5">
                    <div className="font-mono font-bold text-base text-slate-100 truncate">
                      {portfolio.worstPerformer.symbol}
                    </div>
                    <div
                      className={`text-xs font-mono tabular-nums ${
                        portfolio.worstPerformer.totalPnlUsd >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {maskValue(
                        formatSignedCurrency(
                          portfolio.worstPerformer.totalPnlUsd,
                          currency,
                          usdBrlRate
                        )
                      )}{' '}
                      ({formatPercent(portfolio.worstPerformer.totalPnlPct)})
                    </div>
                  </div>
                ) : (
                  <span className="mt-2 block text-xs text-slate-500">—</span>
                )}
              </div>
            </div>
          </section>

          {/* Bottom Sub-Tabs: Ativos | Transações */}
          <section className="rounded-xl border border-white/[0.08] bg-[#111827] overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.07] flex items-center justify-between gap-4">
              <div className="flex items-center gap-1 rounded-lg bg-[#0B0F17] p-1 border border-white/[0.07]">
                <button
                  type="button"
                  onClick={() => setSubTab('assets')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    subTab === 'assets'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Ativos ({portfolio.holdings.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('transactions')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    subTab === 'transactions'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Transações ({portfolio.transactions.length})
                </button>
              </div>

              {subTab === 'transactions' && portfolio.transactions.length > 0 && (
                <button
                  type="button"
                  onClick={() => void onClearTransactions()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition-colors whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Limpar histórico
                </button>
              )}
            </div>

            {subTab === 'assets' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-[11px] font-medium text-slate-400">
                      <th className="py-3 px-5">Nome</th>
                      <th className="py-3 px-3 text-right">Preço</th>
                      <th className="py-3 px-3 text-right hidden md:table-cell">1h%</th>
                      <th className="py-3 px-3 text-right">24h%</th>
                      <th className="py-3 px-3 text-right hidden sm:table-cell">7d%</th>
                      <th className="py-3 px-3 text-right">Saldo (Holdings)</th>
                      <th className="py-3 px-3 text-right">Preço Médio</th>
                      <th className="py-3 px-3 text-right">Lucro / Prejuízo</th>
                      <th className="py-3 px-3">Sinal IA</th>
                      <th className="py-3 px-5 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05] text-xs">
                    {portfolio.holdings.map((h) => {
                      const snap = snapshots[h.coinId];
                      const analysis = analyses[h.coinId];
                      return (
                        <tr
                          key={h.coinId}
                          className="hover:bg-white/[0.025] transition-colors"
                        >
                          <td className="py-3.5 px-5">
                            <button
                              type="button"
                              onClick={() => onSelectAssetForAI(h.coinId)}
                              className="text-left group"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-100 group-hover:text-sky-400 transition-colors">
                                  {h.name}
                                </span>
                                <span className="font-mono text-slate-400">
                                  {h.symbol}
                                </span>
                              </div>
                            </button>
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono text-slate-100 tabular-nums whitespace-nowrap">
                            {formatPrice(h.currentPriceUsd, currency, usdBrlRate)}
                          </td>

                          <td
                            className={`py-3.5 px-3 text-right font-mono tabular-nums hidden md:table-cell whitespace-nowrap ${
                              (snap?.change1hPct ?? 0) >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {snap?.change1hPct !== undefined
                              ? formatPercent(snap.change1hPct)
                              : '—'}
                          </td>

                          <td
                            className={`py-3.5 px-3 text-right font-mono tabular-nums whitespace-nowrap ${
                              (snap?.change24hPct ?? 0) >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {snap ? formatPercent(snap.change24hPct) : '—'}
                          </td>

                          <td
                            className={`py-3.5 px-3 text-right font-mono tabular-nums hidden sm:table-cell whitespace-nowrap ${
                              (snap?.change7dPct ?? 0) >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {snap ? formatPercent(snap.change7dPct) : '—'}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-slate-100">
                              {maskValue(
                                formatCurrencyValue(h.currentValueUsd, currency, usdBrlRate)
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {hideBalances
                                ? '••••'
                                : `${h.quantity.toLocaleString('pt-BR', {
                                    maximumFractionDigits: 6,
                                  })} ${h.symbol}`}
                            </div>
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono text-slate-300 tabular-nums whitespace-nowrap">
                            {h.avgBuyPriceUsd > 0
                              ? formatPrice(h.avgBuyPriceUsd, currency, usdBrlRate)
                              : 'Ganho (R$ 0)'}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div
                              className={`font-semibold ${
                                h.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {maskValue(
                                formatSignedCurrency(
                                  h.totalPnlUsd,
                                  currency,
                                  usdBrlRate
                                )
                              )}
                            </div>
                            <div
                              className={`text-[11px] ${
                                h.totalPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {formatPercent(h.totalPnlPct)}
                            </div>
                          </td>

                          <td className="py-3.5 px-3">
                            <button
                              type="button"
                              onClick={() => onSelectAssetForAI(h.coinId)}
                              title={analysis?.portfolioAdvice || 'Ver parecer completo da IA'}
                            >
                              <SignalBadge action={analysis?.action} compact />
                            </button>
                          </td>

                          <td className="py-3.5 px-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onOpenCreateTrigger(h.coinId)}
                                title={`Criar gatilho WhatsApp 24h em ${h.symbol}`}
                                className="p-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 transition-colors"
                              >
                                <BellRing className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenAddTransaction(h.coinId)}
                                title={`Nova transação em ${h.symbol}`}
                                className="p-1.5 rounded-md border border-white/10 hover:bg-slate-800 text-slate-200 transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onSelectAssetForAI(h.coinId)}
                                className="px-2.5 py-1 text-[11px] rounded-md border border-white/10 hover:bg-slate-800 text-slate-300 transition-colors"
                              >
                                Ver IA
                              </button>
                              <button
                                type="button"
                                onClick={() => void onDeleteCoinHistory(h.coinId)}
                                title={`Excluir ${h.symbol} e todo o histórico da carteira`}
                                aria-label={`Excluir histórico de ${h.symbol}`}
                                className="p-1.5 rounded-md border border-white/10 text-slate-400 hover:text-rose-400 hover:border-rose-500/30 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-[11px] font-medium text-slate-400">
                      <th className="py-3 px-5">Data</th>
                      <th className="py-3 px-3">Tipo</th>
                      <th className="py-3 px-3">Ativo</th>
                      <th className="py-3 px-3 text-right">Quantidade</th>
                      <th className="py-3 px-3 text-right">Preço Unitário</th>
                      <th className="py-3 px-3 text-right">Total</th>
                      <th className="py-3 px-3">Nota</th>
                      <th className="py-3 px-5 text-right">Remover</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05] text-xs">
                    {portfolio.transactions.map((tx) => {
                      const totalUsd =
                        tx.type === 'ganho'
                          ? 0
                          : tx.quantity * tx.pricePerCoinUsd + tx.feeUsd;
                      return (
                        <tr key={tx.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-5 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                            {new Date(tx.timestamp).toLocaleString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`font-mono font-semibold uppercase text-[11px] ${
                                tx.type === 'compra'
                                  ? 'text-emerald-400'
                                  : tx.type === 'venda'
                                  ? 'text-rose-400'
                                  : 'text-sky-400'
                              }`}
                            >
                              {tx.type}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-medium text-slate-200">
                            <span className="font-mono font-bold mr-1.5">{tx.symbol}</span>
                            <span className="text-slate-400">{tx.name}</span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-200 tabular-nums">
                            {hideBalances
                              ? '••••'
                              : tx.quantity.toLocaleString('pt-BR', {
                                  maximumFractionDigits: 6,
                                })}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-300 tabular-nums">
                            {tx.type === 'ganho'
                              ? 'Ganho'
                              : formatPrice(tx.pricePerCoinUsd, currency, usdBrlRate)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-semibold text-slate-100 tabular-nums">
                            {maskValue(formatCurrencyValue(totalUsd, currency, usdBrlRate))}
                          </td>
                          <td className="py-3 px-3 text-slate-400 max-w-[160px] truncate">
                            {tx.note || '—'}
                          </td>
                          <td className="py-3 px-5 text-right">
                            <button
                              type="button"
                              onClick={() => onDeleteTransaction(tx.id)}
                              className="p-1.5 rounded text-slate-400 hover:text-rose-400 transition-colors"
                              aria-label="Excluir transação"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
