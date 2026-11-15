import {
  ArrowLeft,
  ArrowRight,
  Check,
  Coins,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MarketSnapshot, WatchlistAsset } from '../types/crypto.ts';
import { CryptoLogo } from './CryptoLogo.tsx';

interface MonitorViewProps {
  assets: WatchlistAsset[];
  snapshots: Record<string, MarketSnapshot>;
  currency: 'USD' | 'BRL';
  usdBrlRate: number;
  lastUpdatedAt: number;
  isRefreshing: boolean;
  onManualRefresh: () => void;
  onOpenAddAsset: () => void;
  onLaunchGain: (coinId: string) => void;
  onSelectAsset?: (coinId: string) => void;
}

const MONITOR_ORDER_KEY = 'sinalcripto_monitor_order_v1';
const MONITOR_CUSTOM_PRICES_KEY = 'sinalcripto_monitor_custom_prices_v1';

function loadSavedOrder(): string[] {
  try {
    const raw = localStorage.getItem(MONITOR_ORDER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    }
  } catch {
    // ignore storage read errors
  }
  return [];
}

function loadCustomPrices(): Record<string, number> {
  try {
    const raw = localStorage.getItem(MONITOR_CUSTOM_PRICES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const cleaned: Record<string, number> = {};
      for (const [key, val] of Object.entries(parsed)) {
        const num = Number(val);
        if (Number.isFinite(num) && num > 0) cleaned[key] = num;
      }
      return cleaned;
    }
  } catch {
    // ignore storage read errors
  }
  return {};
}

function formatMonitorPrice(
  valueUsd: number,
  currency: 'USD' | 'BRL',
  usdBrlRate: number
): string {
  if (!Number.isFinite(valueUsd) || valueUsd <= 0) return '—';
  const converted = currency === 'BRL' ? valueUsd * usdBrlRate : valueUsd;

  let fractionDigits = 2;
  if (converted < 0.001) fractionDigits = 6;
  else if (converted < 0.1) fractionDigits = 5;
  else if (converted < 1) fractionDigits = 4;

  if (currency === 'BRL') {
    return (
      'R$ ' +
      converted.toLocaleString('pt-BR', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      })
    );
  }

  return (
    '$' +
    converted.toLocaleString('en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
  );
}

function formatSigned24h(pct: number | undefined): string {
  if (pct === undefined || !Number.isFinite(pct)) return '0.00%';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function MonitorView({
  assets,
  snapshots,
  currency,
  usdBrlRate,
  lastUpdatedAt,
  isRefreshing,
  onManualRefresh,
  onOpenAddAsset,
  onLaunchGain,
  onSelectAsset,
}: MonitorViewProps) {
  const [savedOrder, setSavedOrder] = useState<string[]>(loadSavedOrder);
  const [customPricesUsd, setCustomPricesUsd] = useState<Record<string, number>>(loadCustomPrices);
  const [editOrderMode, setEditOrderMode] = useState(false);
  const [editingPriceCoinId, setEditingPriceCoinId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [flashMap, setFlashMap] = useState<Record<string, 'up' | 'down'>>({});

  const prevPricesRef = useRef<Record<string, number>>({});

  // Sync saved order cleanly as assets are added/removed
  const orderedAssets = useMemo(() => {
    const byId = new Map(assets.map((a) => [a.id, a]));
    const seen = new Set<string>();
    const sorted: WatchlistAsset[] = [];

    for (const id of savedOrder) {
      const asset = byId.get(id);
      if (asset && !seen.has(id)) {
        sorted.push(asset);
        seen.add(id);
      }
    }

    for (const asset of assets) {
      if (!seen.has(asset.id)) {
        sorted.push(asset);
        seen.add(asset.id);
      }
    }

    return sorted;
  }, [assets, savedOrder]);

  useEffect(() => {
    try {
      localStorage.setItem(MONITOR_ORDER_KEY, JSON.stringify(savedOrder));
    } catch {
      // ignore storage quota errors
    }
  }, [savedOrder]);

  useEffect(() => {
    try {
      localStorage.setItem(MONITOR_CUSTOM_PRICES_KEY, JSON.stringify(customPricesUsd));
    } catch {
      // ignore storage quota errors
    }
  }, [customPricesUsd]);

  // Subtle tick highlight when 5-second prices update
  useEffect(() => {
    const nextFlashes: Record<string, 'up' | 'down'> = {};
    let hasChanges = false;

    for (const asset of orderedAssets) {
      const currentPrice = snapshots[asset.id]?.priceUsd ?? 0;
      const prevPrice = prevPricesRef.current[asset.id];
      if (currentPrice > 0 && prevPrice && prevPrice !== currentPrice) {
        nextFlashes[asset.id] = currentPrice > prevPrice ? 'up' : 'down';
        hasChanges = true;
      }
      if (currentPrice > 0) {
        prevPricesRef.current[asset.id] = currentPrice;
      }
    }

    if (!hasChanges) return;
    setFlashMap(nextFlashes);
    const timer = setTimeout(() => setFlashMap({}), 700);
    return () => clearTimeout(timer);
  }, [snapshots, orderedAssets]);

  function commitOrderFromAssets(nextList: WatchlistAsset[]) {
    setSavedOrder(nextList.map((a) => a.id));
  }

  function moveAsset(index: number, delta: number) {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= orderedAssets.length) return;
    const copy = [...orderedAssets];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, moved);
    commitOrderFromAssets(copy);
  }

  function moveAssetToPosition(currentIndex: number, targetPositionOneBased: number) {
    const clampedTarget = Math.max(
      0,
      Math.min(orderedAssets.length - 1, targetPositionOneBased - 1)
    );
    if (clampedTarget === currentIndex) return;
    const copy = [...orderedAssets];
    const [moved] = copy.splice(currentIndex, 1);
    copy.splice(clampedTarget, 0, moved);
    commitOrderFromAssets(copy);
  }

  function resetOrder() {
    setSavedOrder(assets.map((a) => a.id));
  }

  function openAdjustPrice(coinId: string, currentUsd: number) {
    setEditingPriceCoinId(coinId);
    if (currentUsd > 0) {
      const val = currency === 'BRL' ? currentUsd * usdBrlRate : currentUsd;
      setPriceDraft(val < 1 ? val.toFixed(5) : val.toFixed(2));
    } else {
      setPriceDraft('');
    }
  }

  function saveAdjustedPrice(coinId: string) {
    const parsed = Number(priceDraft.replace(',', '.').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const usdVal = currency === 'BRL' ? parsed / usdBrlRate : parsed;
    setCustomPricesUsd((prev) => ({ ...prev, [coinId]: usdVal }));
    setEditingPriceCoinId(null);
  }

  function clearAdjustedPrice(coinId: string) {
    setCustomPricesUsd((prev) => {
      const next = { ...prev };
      delete next[coinId];
      return next;
    });
    setEditingPriceCoinId(null);
  }

  const lastUpdateTimeStr = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '--:--:--';

  return (
    <section className="space-y-5">
      {/* Section Header matching reference */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Coins className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0" />
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Monitor de Cotações ({orderedAssets.length}{' '}
              {orderedAssets.length === 1 ? 'Cripto' : 'Criptos'})
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-[11px] font-mono font-medium text-emerald-700 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Ao vivo 5s · {lastUpdateTimeStr}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Cotações ao vivo na ordem das suas colocações personalizadas
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onManualRefresh}
            disabled={isRefreshing}
            title="Atualizar cotações agora"
            aria-label="Atualizar cotações agora"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </button>

          <button
            type="button"
            onClick={onOpenAddAsset}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar cripto
          </button>

          {editOrderMode && orderedAssets.length > 1 && (
            <button
              type="button"
              onClick={resetOrder}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restaurar padrão
            </button>
          )}

          <button
            type="button"
            onClick={() => setEditOrderMode((v) => !v)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
              editOrderMode
                ? 'border-emerald-400 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/25'
                : 'border-amber-400/70 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20'
            }`}
          >
            {editOrderMode ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Concluir Colocações
              </>
            ) : (
              <>
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Editar Minhas Colocações
              </>
            )}
          </button>
        </div>
      </div>

      {editOrderMode && orderedAssets.length > 0 && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/[0.08] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
          <span>
            Use as setas ou escolha a posição (#1 a #{orderedAssets.length}) em cada card para
            organizar a ordem do seu painel.
          </span>
          <button
            type="button"
            onClick={() => setEditOrderMode(false)}
            className="font-semibold underline underline-offset-4 hover:text-amber-700 dark:hover:text-amber-100"
          >
            Salvar e fechar edição
          </button>
        </div>
      )}

      {/* Empty state */}
      {orderedAssets.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] p-12 text-center space-y-3">
          <Coins className="w-8 h-8 text-amber-500 dark:text-amber-400 mx-auto opacity-80" />
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Nenhuma criptomoeda no monitor ainda
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            Adicione suas criptomoedas favoritas para acompanhar todas elas lado a lado em cards
            fracionados com atualização automática a cada 5 segundos.
          </p>
          <button
            type="button"
            onClick={onOpenAddAsset}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 dark:hover:bg-sky-500 text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar criptomoeda
          </button>
        </div>
      ) : (
        /* 4-column Responsive Card Grid matching reference */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {orderedAssets.map((asset, index) => {
            const snap = snapshots[asset.id];
            const overrideUsd = customPricesUsd[asset.id];
            const livePriceUsd = snap?.priceUsd ?? 0;
            const effectivePriceUsd =
              overrideUsd && overrideUsd > 0 ? overrideUsd : livePriceUsd;
            const change24h = snap?.change24hPct ?? 0;
            const isPositive = change24h >= 0;
            const flashDir = flashMap[asset.id];
            const isEditingPrice = editingPriceCoinId === asset.id;

            return (
              <article
                key={asset.id}
                className={`group relative rounded-xl border bg-white dark:bg-[#111827] shadow-xs dark:shadow-none p-4 flex flex-col justify-between gap-4 transition-colors ${
                  flashDir === 'up'
                    ? 'border-emerald-400 dark:border-emerald-500/50'
                    : flashDir === 'down'
                    ? 'border-rose-400 dark:border-rose-500/50'
                    : 'border-slate-200 dark:border-white/[0.08] hover:border-sky-400/50 dark:hover:border-sky-500/30'
                }`}
              >
                {/* Top Rank Tag (#1, #2, ...) + Reorder controls when editing */}
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#1B2333] border border-slate-200 dark:border-white/[0.08] text-[10px] font-mono font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
                    #{index + 1}
                  </span>

                  {editOrderMode ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveAsset(index, -1)}
                        title="Mover para trás"
                        aria-label={`Mover ${asset.symbol} para posição anterior`}
                        className="p-1 rounded border border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-[#0B0F17] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30"
                      >
                        <ArrowLeft className="w-3 h-3" />
                      </button>
                      <select
                        value={index + 1}
                        onChange={(e) => moveAssetToPosition(index, Number(e.target.value))}
                        aria-label={`Posição de ${asset.symbol}`}
                        className="px-1.5 py-0.5 text-[11px] font-mono rounded border border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-[#0B0F17] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-sky-500"
                      >
                        {orderedAssets.map((_, posIdx) => (
                          <option key={posIdx + 1} value={posIdx + 1}>
                            #{posIdx + 1}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={index === orderedAssets.length - 1}
                        onClick={() => moveAsset(index, 1)}
                        title="Mover para frente"
                        aria-label={`Mover ${asset.symbol} para próxima posição`}
                        className="p-1 rounded border border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-[#0B0F17] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-mono font-semibold tabular-nums whitespace-nowrap ${
                        isPositive
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                          : 'bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-500/30 text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {isPositive ? (
                        <TrendingUp className="w-3 h-3 shrink-0" />
                      ) : (
                        <TrendingDown className="w-3 h-3 shrink-0" />
                      )}
                      {formatSigned24h(change24h)}
                    </span>
                  )}
                </div>

                {/* Coin Identity Row: Logo + Symbol + Name */}
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelectAsset?.(asset.id)}
                    className="flex items-center gap-3 min-w-0 text-left group/title focus-visible:outline-none"
                    title={`Abrir análise técnica de ${asset.name} (${asset.symbol})`}
                  >
                    <CryptoLogo
                      symbol={asset.symbol}
                      coinId={asset.id}
                      name={asset.name}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-base text-slate-900 dark:text-slate-100 leading-tight group-hover/title:text-sky-600 dark:group-hover/title:text-sky-400 transition-colors">
                        {asset.symbol}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                        {asset.name}
                      </div>
                    </div>
                  </button>
                </div>

                {/* Price Section */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                      PREÇO ATUAL ({currency})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        isEditingPrice
                          ? setEditingPriceCoinId(null)
                          : openAdjustPrice(asset.id, effectivePriceUsd)
                      }
                      className={`text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 underline underline-offset-2 transition-opacity ${
                        effectivePriceUsd <= 0 || overrideUsd || isEditingPrice
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                      }`}
                    >
                      {overrideUsd ? 'Cotação manual' : 'Ajustar Cotação'}
                    </button>
                  </div>

                  {isEditingPrice ? (
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={priceDraft}
                        onChange={(e) => setPriceDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveAdjustedPrice(asset.id);
                          if (e.key === 'Escape') setEditingPriceCoinId(null);
                        }}
                        placeholder={currency === 'BRL' ? '0.00 BRL' : '0.00 USD'}
                        className="w-full min-w-0 px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg border border-sky-400 dark:border-sky-500/50 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => saveAdjustedPrice(asset.id)}
                        className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white shrink-0"
                      >
                        OK
                      </button>
                      {overrideUsd && (
                        <button
                          type="button"
                          onClick={() => clearAdjustedPrice(asset.id)}
                          title="Voltar para cotação ao vivo"
                          className="px-2 py-1.5 text-[11px] rounded-lg border border-slate-300 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                        >
                          Auto
                        </button>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`text-2xl font-mono font-bold tabular-nums tracking-tight transition-colors ${
                        flashDir === 'up'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : flashDir === 'down'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {formatMonitorPrice(effectivePriceUsd, currency, usdBrlRate)}
                    </div>
                  )}
                </div>

                {/* Bottom Action CTA matching screenshot */}
                <button
                  type="button"
                  onClick={() => onLaunchGain(asset.id)}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-sky-300/80 dark:border-sky-500/25 bg-sky-50/70 dark:bg-[#132238] hover:bg-sky-100 dark:hover:bg-[#192D4A] text-sky-800 dark:text-sky-200 text-xs font-medium transition-colors"
                >
                  <Zap className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                  <span className="truncate">Lançar Ganho com {asset.symbol}</span>
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
