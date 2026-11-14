import { useEffect, useMemo, useState } from 'react';
import { apiGetAssetChart } from '../services/apiClient.ts';
import type { AIAnalysisResult, ChartPoint } from '../types/crypto.ts';
import { formatPrice } from '../utils/format.ts';

interface PriceChartProps {
  coinId: string;
  symbol: string;
  currency: 'USD' | 'BRL';
  usdBrlRate: number;
  analysis?: AIAnalysisResult;
}

export function PriceChart({
  coinId,
  symbol,
  currency,
  usdBrlRate,
  analysis,
}: PriceChartProps) {
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEma, setShowEma] = useState(true);
  const [showBollinger, setShowBollinger] = useState(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setHoverIdx(null);

    apiGetAssetChart(coinId, range, symbol)
      .then((data) => {
        if (!active) return;
        setPoints(data.points ?? []);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || 'Erro ao carregar gráfico');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [coinId, range, symbol]);

  const width = 820;
  const height = 270;
  const padLeft = 12;
  const padRight = 12;
  const padTop = 18;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const values: number[] = [];
    for (const p of points) {
      values.push(p.price);
      if (showEma && p.ema9) values.push(p.ema9);
      if (showEma && p.ema21) values.push(p.ema21);
      if (showBollinger && p.bollingerUpper) values.push(p.bollingerUpper);
      if (showBollinger && p.bollingerLower) values.push(p.bollingerLower);
    }

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const span = maxVal - minVal || minVal * 0.02 || 1;
    const paddedMin = minVal - span * 0.06;
    const paddedMax = maxVal + span * 0.06;
    const paddedSpan = paddedMax - paddedMin;

    const toX = (idx: number) =>
      padLeft + (idx / (points.length - 1)) * plotW;
    const toY = (val: number) =>
      padTop + plotH - ((val - paddedMin) / paddedSpan) * plotH;

    const buildPath = (extractor: (p: ChartPoint) => number | null) => {
      let d = '';
      points.forEach((p, i) => {
        const v = extractor(p);
        if (v === null || !Number.isFinite(v)) return;
        const x = toX(i).toFixed(1);
        const y = toY(v).toFixed(1);
        d += d === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
      });
      return d;
    };

    const pricePath = buildPath((p) => p.price);
    const areaPath = `${pricePath} L ${toX(points.length - 1).toFixed(1)} ${(
      padTop + plotH
    ).toFixed(1)} L ${toX(0).toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`;

    const ema9Path = showEma ? buildPath((p) => p.ema9) : '';
    const ema21Path = showEma ? buildPath((p) => p.ema21) : '';
    const bbUpperPath = showBollinger ? buildPath((p) => p.bollingerUpper) : '';
    const bbLowerPath = showBollinger ? buildPath((p) => p.bollingerLower) : '';

    // Y coordinates for target / stop if within reasonable scale
    const targetY =
      analysis &&
      analysis.targetPriceUsd >= paddedMin &&
      analysis.targetPriceUsd <= paddedMax
        ? toY(analysis.targetPriceUsd)
        : null;

    const stopY =
      analysis &&
      analysis.stopLossUsd >= paddedMin &&
      analysis.stopLossUsd <= paddedMax
        ? toY(analysis.stopLossUsd)
        : null;

    const firstPrice = points[0].price;
    const lastPrice = points[points.length - 1].price;
    const isUp = lastPrice >= firstPrice;

    return {
      paddedMin,
      paddedMax,
      toX,
      toY,
      pricePath,
      areaPath,
      ema9Path,
      ema21Path,
      bbUpperPath,
      bbLowerPath,
      targetY,
      stopY,
      isUp,
    };
  }, [points, showEma, showBollinger, analysis]);

  const activePoint =
    hoverIdx !== null && points[hoverIdx]
      ? points[hoverIdx]
      : points[points.length - 1] ?? null;

  const strokeColor = geometry?.isUp ? '#10B981' : '#EF4444';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-slate-400">
          {activePoint ? (
            <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
              <span className="text-slate-100 font-semibold">
                {formatPrice(activePoint.price, currency, usdBrlRate)}
              </span>
              {activePoint.ema9 !== null && (
                <span className="text-sky-400">
                  EMA9 {formatPrice(activePoint.ema9, currency, usdBrlRate)}
                </span>
              )}
              {activePoint.ema21 !== null && (
                <span className="text-amber-400">
                  EMA21 {formatPrice(activePoint.ema21, currency, usdBrlRate)}
                </span>
              )}
              {activePoint.rsi !== null && (
                <span className="text-slate-300">
                  RSI {activePoint.rsi.toFixed(1)}
                </span>
              )}
              <span className="text-slate-500">
                {new Date(activePoint.timestamp).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          ) : (
            <span>Histórico de preço ({symbol})</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md bg-slate-900/90 p-0.5 border border-white/[0.07]">
            <button
              type="button"
              onClick={() => setShowEma((v) => !v)}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                showEma
                  ? 'bg-slate-800 text-sky-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              EMAs
            </button>
            <button
              type="button"
              onClick={() => setShowBollinger((v) => !v)}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                showBollinger
                  ? 'bg-slate-800 text-slate-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Bollinger
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-md bg-slate-900/90 p-0.5 border border-white/[0.07]">
            {(['24h', '7d', '30d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 text-[11px] font-mono font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  range === r
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative w-full h-[270px] rounded-lg border border-white/[0.07] bg-[#0B0F17] overflow-hidden">
        {loading ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-full h-full animate-pulse bg-slate-900/60" />
          </div>
        ) : error || !geometry ? (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
            {error || 'Série histórica indisponível no momento.'}
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-full select-none"
            onMouseLeave={() => setHoverIdx(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * width;
              const ratio = Math.max(0, Math.min(1, (relX - padLeft) / plotW));
              const idx = Math.round(ratio * (points.length - 1));
              setHoverIdx(idx);
            }}
          >
            <defs>
              <linearGradient id={`grad-${coinId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity="0.24" />
                <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal reference grid */}
            {[0.25, 0.5, 0.75].map((ratio) => {
              const y = padTop + plotH * ratio;
              const val =
                geometry.paddedMax - (geometry.paddedMax - geometry.paddedMin) * ratio;
              return (
                <g key={ratio}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke="rgba(148,163,184,0.1)"
                    strokeDasharray="3 4"
                  />
                  <text
                    x={width - padRight - 4}
                    y={y - 4}
                    textAnchor="end"
                    fill="rgba(148,163,184,0.55)"
                    fontSize="10"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {formatPrice(val, currency, usdBrlRate)}
                  </text>
                </g>
              );
            })}

            {/* AI Target and Stop Loss guide lines */}
            {geometry.targetY !== null && (
              <g>
                <line
                  x1={padLeft}
                  y1={geometry.targetY}
                  x2={width - padRight}
                  y2={geometry.targetY}
                  stroke="#10B981"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  strokeOpacity="0.7"
                />
                <text
                  x={padLeft + 6}
                  y={geometry.targetY - 4}
                  fill="#34D399"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  Alvo IA: {formatPrice(analysis!.targetPriceUsd, currency, usdBrlRate)}
                </text>
              </g>
            )}

            {geometry.stopY !== null && (
              <g>
                <line
                  x1={padLeft}
                  y1={geometry.stopY}
                  x2={width - padRight}
                  y2={geometry.stopY}
                  stroke="#EF4444"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  strokeOpacity="0.65"
                />
                <text
                  x={padLeft + 6}
                  y={geometry.stopY + 12}
                  fill="#F87171"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  Stop: {formatPrice(analysis!.stopLossUsd, currency, usdBrlRate)}
                </text>
              </g>
            )}

            {/* Bollinger bands */}
            {showBollinger && geometry.bbUpperPath && (
              <path
                d={geometry.bbUpperPath}
                fill="none"
                stroke="rgba(148,163,184,0.28)"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
            )}
            {showBollinger && geometry.bbLowerPath && (
              <path
                d={geometry.bbLowerPath}
                fill="none"
                stroke="rgba(148,163,184,0.28)"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
            )}

            {/* Area & Main price line */}
            <path d={geometry.areaPath} fill={`url(#grad-${coinId})`} />
            <path
              d={geometry.pricePath}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2"
              strokeLinejoin="round"
            />

            {/* EMAs */}
            {showEma && geometry.ema9Path && (
              <path
                d={geometry.ema9Path}
                fill="none"
                stroke="#38BDF8"
                strokeWidth="1.25"
                strokeOpacity="0.85"
              />
            )}
            {showEma && geometry.ema21Path && (
              <path
                d={geometry.ema21Path}
                fill="none"
                stroke="#F59E0B"
                strokeWidth="1.25"
                strokeOpacity="0.8"
              />
            )}

            {/* Hover crosshair */}
            {hoverIdx !== null && points[hoverIdx] && (
              <g>
                <line
                  x1={geometry.toX(hoverIdx)}
                  y1={padTop}
                  x2={geometry.toX(hoverIdx)}
                  y2={padTop + plotH}
                  stroke="rgba(241,245,249,0.25)"
                  strokeWidth="1"
                />
                <circle
                  cx={geometry.toX(hoverIdx)}
                  cy={geometry.toY(points[hoverIdx].price)}
                  r="4"
                  fill={strokeColor}
                  stroke="#0B0F17"
                  strokeWidth="1.5"
                />
              </g>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
