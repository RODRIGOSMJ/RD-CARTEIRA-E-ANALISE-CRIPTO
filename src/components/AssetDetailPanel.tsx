import { BellRing, BrainCircuit, Plus, RefreshCw, ShieldAlert, Trash2, Wallet } from 'lucide-react';
import type {
  AIAnalysisResult,
  MarketSnapshot,
  PortfolioHolding,
  WatchlistAsset,
} from '../types/crypto.ts';
import {
  formatCompactVolume,
  formatPercent,
  formatPrice,
  formatRelativeTime,
  formatSignedCurrency,
} from '../utils/format.ts';
import { CryptoLogo } from './CryptoLogo.tsx';
import { PriceChart } from './PriceChart.tsx';
import { SignalBadge } from './SignalBadge.tsx';

interface AssetDetailPanelProps {
  asset: WatchlistAsset;
  snapshot?: MarketSnapshot;
  analysis?: AIAnalysisResult;
  holding?: PortfolioHolding;
  currency: 'USD' | 'BRL';
  usdBrlRate: number;
  isStudying: boolean;
  canRemove: boolean;
  onStudySingle: (coinId: string) => void;
  onRemoveAsset: (coinId: string) => void;
  onAddTransaction: (coinId: string) => void;
  onCreateTrigger: (coinId: string) => void;
}

export function AssetDetailPanel({
  asset,
  snapshot,
  analysis,
  holding,
  currency,
  usdBrlRate,
  isStudying,
  canRemove,
  onStudySingle,
  onRemoveAsset,
  onAddTransaction,
  onCreateTrigger,
}: AssetDetailPanelProps) {
  const ind = snapshot?.indicators;

  const horizonLabel =
    analysis?.horizon === 'curto_prazo'
      ? 'Curto prazo'
      : analysis?.horizon === 'medio_prazo'
      ? 'Médio prazo'
      : 'Swing trade';

  const riskLabel =
    analysis?.riskLevel === 'baixo'
      ? 'Risco baixo'
      : analysis?.riskLevel === 'elevado'
      ? 'Risco elevado'
      : 'Risco moderado';

  return (
    <section className="rounded-xl border border-white/[0.08] bg-[#111827] overflow-hidden">
      {/* Asset header */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-white/[0.07]">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <CryptoLogo
              symbol={asset.symbol}
              coinId={asset.id}
              name={asset.name}
              size="lg"
            />
            <h2 className="text-lg font-bold text-slate-100 tracking-tight">
              {asset.name}
            </h2>
            <span className="text-sm font-mono font-medium text-slate-400">
              {asset.symbol}
            </span>
            <SignalBadge action={analysis?.action} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
            <span>{snapshot?.dataSource || 'Mercado'}</span>
            <span aria-hidden="true">·</span>
            <span>Atualizado {formatRelativeTime(snapshot?.updatedAt)}</span>
            {snapshot && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Vol 24h {formatCompactVolume(snapshot.volume24hUsd, currency, usdBrlRate)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {snapshot && (
            <div className="text-right mr-2">
              <div className="text-xl font-mono font-bold text-slate-100 tabular-nums">
                {formatPrice(snapshot.priceUsd, currency, usdBrlRate)}
              </div>
              <div
                className={`text-xs font-mono font-medium tabular-nums ${
                  snapshot.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatPercent(snapshot.change24hPct)} (24h) ·{' '}
                {formatPercent(snapshot.change7dPct)} (7d)
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => onCreateTrigger(asset.id)}
            title={`Criar gatilho WhatsApp 24h para ${asset.symbol}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 transition-colors whitespace-nowrap shrink-0"
          >
            <BellRing className="w-3.5 h-3.5" />
            Gatilho
          </button>

          <button
            type="button"
            onClick={() => onAddTransaction(asset.id)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-white/10 bg-[#0B0F17] hover:bg-slate-800 text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Carteira
          </button>

          <button
            type="button"
            disabled={isStudying}
            onClick={() => onStudySingle(asset.id)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-white/10 bg-slate-800/80 hover:bg-slate-800 text-slate-100 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isStudying ? 'animate-spin' : ''}`} />
            Reestudar {asset.symbol}
          </button>

          {canRemove && (
            <button
              type="button"
              onClick={() => onRemoveAsset(asset.id)}
              title={`Remover ${asset.symbol} da lista`}
              aria-label={`Remover ${asset.symbol}`}
              className="p-2 rounded-lg border border-white/[0.08] text-slate-400 hover:text-rose-400 hover:border-rose-500/30 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* User Portfolio Position strip when asset is held */}
      {holding && holding.quantity > 0 && (
        <div className="px-5 py-3 border-b border-white/[0.07] bg-sky-500/[0.04] flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-semibold text-sky-400">
              <Wallet className="w-3.5 h-3.5" />
              Na sua carteira
            </span>
            <span className="font-mono text-slate-200 tabular-nums">
              {holding.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}{' '}
              {holding.symbol}
            </span>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <span className="font-mono text-slate-300 tabular-nums">
              Saldo {formatPrice(holding.currentValueUsd, currency, usdBrlRate)} ({holding.allocationPct.toFixed(1)}%)
            </span>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <span className="font-mono text-slate-300 tabular-nums">
              PM {holding.avgBuyPriceUsd > 0 ? formatPrice(holding.avgBuyPriceUsd, currency, usdBrlRate) : 'Ganho'}
            </span>
          </div>
          <div
            className={`font-mono font-semibold tabular-nums ${
              holding.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            Resultado: {formatSignedCurrency(holding.totalPnlUsd, currency, usdBrlRate)} (
            {formatPercent(holding.totalPnlPct)})
          </div>
        </div>
      )}

      {/* Main chart + levels */}
      <div className="p-5 space-y-6">
        <PriceChart
          coinId={asset.id}
          symbol={asset.symbol}
          currency={currency}
          usdBrlRate={usdBrlRate}
          analysis={analysis}
        />

        {/* AI Verdict & Levels */}
        {analysis ? (
          <div className="pt-5 border-t border-white/[0.07] space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="font-medium text-sky-400 inline-flex items-center gap-1.5">
                    <BrainCircuit className="w-3.5 h-3.5" />
                    Parecer autônomo da IA
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Confiança {analysis.confidence}%
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{horizonLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span>{riskLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Estudado {formatRelativeTime(analysis.analyzedAt)}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-slate-100">
                  {analysis.headline}
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {analysis.thesis}
                </p>
              </div>
            </div>

            {analysis.portfolioAdvice && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3">
                <span className="block text-[11px] font-semibold text-emerald-400 mb-1">
                  Estratégia personalizada para sua carteira
                </span>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {analysis.portfolioAdvice}
                </p>
              </div>
            )}

            {/* Key Price Zones */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="rounded-lg border border-white/[0.07] bg-[#0B0F17] p-3">
                <span className="block text-[11px] text-slate-400">Zona de entrada</span>
                <span className="mt-1 block text-xs font-mono font-semibold text-slate-100 tabular-nums">
                  {formatPrice(analysis.entryZoneLowUsd, currency, usdBrlRate)} –{' '}
                  {formatPrice(analysis.entryZoneHighUsd, currency, usdBrlRate)}
                </span>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-[#0B0F17] p-3">
                <span className="block text-[11px] text-slate-400">Alvo sugerido</span>
                <span className="mt-1 block text-xs font-mono font-semibold text-emerald-400 tabular-nums">
                  {formatPrice(analysis.targetPriceUsd, currency, usdBrlRate)}
                </span>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-[#0B0F17] p-3">
                <span className="block text-[11px] text-slate-400">Stop técnico</span>
                <span className="mt-1 block text-xs font-mono font-semibold text-rose-400 tabular-nums">
                  {formatPrice(analysis.stopLossUsd, currency, usdBrlRate)}
                </span>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-[#0B0F17] p-3">
                <span className="block text-[11px] text-slate-400">Preço no estudo</span>
                <span className="mt-1 block text-xs font-mono font-semibold text-slate-200 tabular-nums">
                  {formatPrice(analysis.priceAtAnalysisUsd, currency, usdBrlRate)}
                </span>
              </div>
            </div>

            {/* Factors & Self-learning */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-2">
                  Fatores técnicos observados
                </h4>
                <ul className="space-y-1.5 text-xs text-slate-400">
                  {analysis.technicalFactors.map((factor, i) => (
                    <li key={i} className="leading-relaxed">
                      • {factor}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-2 inline-flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  Riscos e pontos de invalidação
                </h4>
                <ul className="space-y-1.5 text-xs text-slate-400">
                  {analysis.riskFactors.map((risk, i) => (
                    <li key={i} className="leading-relaxed">
                      • {risk}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {analysis.selfLearningNote && (
              <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.04] px-4 py-3">
                <span className="block text-[11px] font-semibold text-sky-400 mb-1">
                  Autoavaliação e aprendizado contínuo da IA
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {analysis.selfLearningNote}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="pt-5 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">
                Estudo de IA ainda não gerado para {asset.name}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Clique em Reestudar {asset.symbol} ou aguarde o próximo ciclo automático.
              </p>
            </div>
            <button
              type="button"
              disabled={isStudying}
              onClick={() => onStudySingle(asset.id)}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Analisar {asset.symbol} agora
            </button>
          </div>
        )}

        {/* Quantitative Indicators Breakdown */}
        {ind && (
          <div className="pt-5 border-t border-white/[0.07]">
            <h4 className="text-xs font-semibold text-slate-300 mb-3">
              Indicadores quantitativos calculados ao vivo
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
              <div className="rounded-lg border border-white/[0.06] bg-[#0B0F17] p-2.5">
                <span className="block text-[11px] text-slate-400">RSI (14)</span>
                <span
                  className={`mt-1 block font-mono font-semibold tabular-nums ${
                    ind.rsi14 <= 32
                      ? 'text-emerald-400'
                      : ind.rsi14 >= 68
                      ? 'text-rose-400'
                      : 'text-slate-100'
                  }`}
                >
                  {ind.rsi14.toFixed(1)}
                </span>
                <span className="text-[11px] text-slate-500">
                  {ind.rsi14 <= 32
                    ? 'Sobrevendido'
                    : ind.rsi14 >= 68
                    ? 'Sobrecomprado'
                    : 'Neutro'}
                </span>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-[#0B0F17] p-2.5">
                <span className="block text-[11px] text-slate-400">Tendência EMA</span>
                <span
                  className={`mt-1 block font-mono font-semibold capitalize ${
                    ind.emaTrend === 'alta'
                      ? 'text-emerald-400'
                      : ind.emaTrend === 'baixa'
                      ? 'text-rose-400'
                      : 'text-amber-400'
                  }`}
                >
                  {ind.emaTrend}
                </span>
                <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                  EMA9 vs EMA21
                </span>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-[#0B0F17] p-2.5">
                <span className="block text-[11px] text-slate-400">MACD</span>
                <span
                  className={`mt-1 block font-mono font-semibold ${
                    ind.macdTrend === 'bullish'
                      ? 'text-emerald-400'
                      : ind.macdTrend === 'bearish'
                      ? 'text-rose-400'
                      : 'text-slate-300'
                  }`}
                >
                  {ind.macdTrend === 'bullish'
                    ? 'Positivo'
                    : ind.macdTrend === 'bearish'
                    ? 'Negativo'
                    : 'Neutro'}
                </span>
                <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                  Hist {ind.macdHistogram >= 0 ? '+' : ''}
                  {ind.macdHistogram.toFixed(4)}
                </span>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-[#0B0F17] p-2.5">
                <span className="block text-[11px] text-slate-400">Bollinger %B</span>
                <span className="mt-1 block font-mono font-semibold text-slate-100 tabular-nums">
                  {ind.bollingerPercentB.toFixed(0)}%
                </span>
                <span className="text-[11px] text-slate-500">
                  {ind.bollingerPercentB < 20
                    ? 'Banda inferior'
                    : ind.bollingerPercentB > 80
                    ? 'Banda superior'
                    : 'Faixa central'}
                </span>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-[#0B0F17] p-2.5">
                <span className="block text-[11px] text-slate-400">Suporte recente</span>
                <span className="mt-1 block font-mono font-semibold text-slate-100 tabular-nums">
                  {formatPrice(ind.supportLevel, currency, usdBrlRate)}
                </span>
                <span className="text-[11px] text-slate-500">Mínima janela</span>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-[#0B0F17] p-2.5">
                <span className="block text-[11px] text-slate-400">Resistência</span>
                <span className="mt-1 block font-mono font-semibold text-slate-100 tabular-nums">
                  {formatPrice(ind.resistanceLevel, currency, usdBrlRate)}
                </span>
                <span className="text-[11px] text-slate-500">Máxima janela</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
