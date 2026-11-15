import { Loader2, Plus, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiGetCoinPrice, apiSearchCryptos } from '../services/apiClient.ts';
import type { MarketSnapshot, TransactionType, WatchlistAsset } from '../types/crypto.ts';
import { formatPrice } from '../utils/format.ts';
import { CryptoLogo } from './CryptoLogo.tsx';

interface SearchResult {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number | null;
}

interface AddTransactionModalProps {
  open: boolean;
  watchlist: WatchlistAsset[];
  snapshots: Record<string, MarketSnapshot>;
  currency: 'USD' | 'BRL';
  usdBrlRate: number;
  preselectedCoinId?: string | null;
  preselectedType?: TransactionType;
  onClose: () => void;
  onSubmit: (payload: {
    coinId: string;
    symbol: string;
    name: string;
    type: TransactionType;
    quantity: number;
    pricePerCoinUsd: number;
    feeUsd: number;
    timestamp: string;
    note?: string;
  }) => Promise<void>;
}

function getLocalDatetimeInputValue(): string {
  const d = new Date();
  const offsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function AddTransactionModal({
  open,
  watchlist,
  snapshots,
  currency,
  usdBrlRate,
  preselectedCoinId,
  preselectedType = 'compra',
  onClose,
  onSubmit,
}: AddTransactionModalProps) {
  const [txType, setTxType] = useState<TransactionType>(preselectedType);
  const [selectedCoin, setSelectedCoin] = useState<{
    id: string;
    symbol: string;
    name: string;
  } | null>(null);
  const [coinSearch, setCoinSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [quantity, setQuantity] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [liveFetchedPriceUsd, setLiveFetchedPriceUsd] = useState<number | null>(null);
  const [feeInput, setFeeInput] = useState('0');
  const [timestamp, setTimestamp] = useState(getLocalDatetimeInputValue);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wasOpenRef = useRef(false);
  const userEditedPriceRef = useRef(false);

  // Initialize ONLY when modal transitions from closed -> open (never on live market_tick updates!)
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) {
      return;
    }
    wasOpenRef.current = true;
    userEditedPriceRef.current = false;

    setTxType(preselectedType);
    setError(null);
    setQuantity('');
    setFeeInput('0');
    setNote('');
    setTimestamp(getLocalDatetimeInputValue());
    setCoinSearch('');
    setSearchResults([]);
    setLiveFetchedPriceUsd(null);

    const target =
      (preselectedCoinId && watchlist.find((w) => w.id === preselectedCoinId)) ||
      watchlist[0] ||
      null;

    if (target) {
      setSelectedCoin({ id: target.id, symbol: target.symbol, name: target.name });
      const snap = snapshots[target.id];
      if (snap && snap.priceUsd > 0) {
        const displayPrice =
          currency === 'BRL' ? snap.priceUsd * usdBrlRate : snap.priceUsd;
        setPriceInput(displayPrice.toFixed(displayPrice < 1 ? 4 : 2));
      } else {
        setPriceInput('');
      }
    } else {
      setSelectedCoin(null);
      setPriceInput('');
    }
  }, [open, preselectedCoinId, preselectedType, watchlist, snapshots, currency, usdBrlRate]);

  useEffect(() => {
    const q = coinSearch.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const list = await apiSearchCryptos(q);
        setSearchResults(list);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [coinSearch]);

  if (!open) return null;

  const selectAsset = async (coin: { id: string; symbol: string; name: string }) => {
    setSelectedCoin(coin);
    setCoinSearch('');
    setSearchResults([]);
    setLiveFetchedPriceUsd(null);
    userEditedPriceRef.current = false;

    const snap = snapshots[coin.id];
    if (snap && snap.priceUsd > 0) {
      if (txType !== 'ganho') {
        const displayPrice =
          currency === 'BRL' ? snap.priceUsd * usdBrlRate : snap.priceUsd;
        setPriceInput(displayPrice.toFixed(displayPrice < 1 ? 4 : 2));
      }
      return;
    }

    // Fetch live price for coins not yet in watchlist
    try {
      const priceUsd = await apiGetCoinPrice(coin.id, coin.symbol);
      if (priceUsd && priceUsd > 0) {
        setLiveFetchedPriceUsd(priceUsd);
        if (!userEditedPriceRef.current && txType !== 'ganho') {
          const displayPrice =
            currency === 'BRL' ? priceUsd * usdBrlRate : priceUsd;
          setPriceInput(displayPrice.toFixed(displayPrice < 1 ? 4 : 2));
        }
      }
    } catch {
      // user can still type price manually
    }
  };

  const effectiveLiveUsd =
    (selectedCoin && snapshots[selectedCoin.id]?.priceUsd) || liveFetchedPriceUsd || null;

  const applyLivePrice = () => {
    if (!effectiveLiveUsd) return;
    userEditedPriceRef.current = false;
    const displayPrice =
      currency === 'BRL' ? effectiveLiveUsd * usdBrlRate : effectiveLiveUsd;
    setPriceInput(displayPrice.toFixed(displayPrice < 1 ? 4 : 2));
  };

  const qtyNum = Number(quantity.replace(',', '.'));
  const priceNum = Number(priceInput.replace(',', '.'));
  const feeNum = Number(feeInput.replace(',', '.')) || 0;

  const totalDisplay =
    txType === 'ganho'
      ? 0
      : (Number.isFinite(qtyNum) ? qtyNum : 0) *
          (Number.isFinite(priceNum) ? priceNum : 0) +
        feeNum;

  const toUsd = (val: number) => (currency === 'BRL' ? val / usdBrlRate : val);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCoin) {
      setError('Selecione uma criptomoeda.');
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError('Informe uma quantidade válida maior que zero.');
      return;
    }
    if (txType !== 'ganho' && (!Number.isFinite(priceNum) || priceNum <= 0)) {
      setError('Informe o preço unitário pago ou recebido.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        coinId: selectedCoin.id,
        symbol: selectedCoin.symbol,
        name: selectedCoin.name,
        type: txType,
        quantity: qtyNum,
        pricePerCoinUsd: txType === 'ganho' ? 0 : toUsd(priceNum),
        feeUsd: toUsd(Math.max(0, feeNum)),
        timestamp: new Date(timestamp).toISOString(),
        note: note.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar transação.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 dark:bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-tx-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/[0.08]">
          <div>
            <h2 id="add-tx-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Adicionar transação na carteira
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Os dados da carteira são integrados automaticamente aos sinais da IA.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Type segmented tabs: Compra | Venda | Ganho */}
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.08]">
            {(
              [
                { id: 'compra', label: 'Compra' },
                { id: 'venda', label: 'Venda' },
                { id: 'ganho', label: 'Ganho / Staking' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTxType(tab.id)}
                className={`py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  txType === tab.id
                    ? tab.id === 'compra'
                      ? 'bg-emerald-600 text-white'
                      : tab.id === 'venda'
                      ? 'bg-rose-600 text-white'
                      : 'bg-sky-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Coin selector / search */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Criptomoeda
              </label>
              {selectedCoin ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-mono text-sky-700 dark:text-sky-400 font-semibold">
                  <CryptoLogo
                    symbol={selectedCoin.symbol}
                    coinId={selectedCoin.id}
                    name={selectedCoin.name}
                    size="xs"
                  />
                  Selecionada: {selectedCoin.name} ({selectedCoin.symbol})
                </span>
              ) : (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  Nenhuma selecionada — busque abaixo
                </span>
              )}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                autoFocus={watchlist.length === 0}
                value={coinSearch}
                onChange={(e) => setCoinSearch(e.target.value)}
                placeholder="Buscar qualquer criptomoeda (ex: BTC, ETH, SOL, CAKE...)"
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
              />
              {searching && (
                <Loader2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
              )}
            </div>

            {searchResults.length > 0 ? (
              <div className="max-h-36 overflow-y-auto divide-y divide-slate-200 dark:divide-white/[0.06] rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0B0F17]">
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectAsset(c)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-white/[0.04]"
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <CryptoLogo
                        symbol={c.symbol}
                        coinId={c.id}
                        name={c.name}
                        size="xs"
                      />
                      <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                        {c.symbol}
                      </span>
                      <span className="text-slate-600 dark:text-slate-300 truncate">{c.name}</span>
                    </span>
                    <Plus className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {watchlist.slice(0, 8).map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => selectAsset(w)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md border transition-colors whitespace-nowrap ${
                      selectedCoin?.id === w.id
                        ? 'border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500/50 dark:bg-sky-500/15 dark:text-sky-300'
                        : 'border-slate-300 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17] text-slate-700 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-200'
                    }`}
                  >
                    <CryptoLogo
                      symbol={w.symbol}
                      coinId={w.id}
                      name={w.name}
                      size="xs"
                    />
                    {w.symbol}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Quantity and Price */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Quantidade ({selectedCoin?.symbol || 'Moeda'})
              </label>
              <input
                type="text"
                inputMode="decimal"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            {txType !== 'ganho' ? (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Preço ({currency})
                  </label>
                  {effectiveLiveUsd && (
                    <button
                      type="button"
                      onClick={applyLivePrice}
                      className="text-[11px] text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300"
                    >
                      Usar atual ({formatPrice(effectiveLiveUsd, currency, usdBrlRate)})
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={priceInput}
                  onChange={(e) => {
                    userEditedPriceRef.current = true;
                    setPriceInput(e.target.value);
                  }}
                  placeholder="0.00"
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Custo base do ganho
                </label>
                <div className="px-3 py-2 text-xs font-mono text-emerald-700 dark:text-emerald-400 rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17]">
                  {currency === 'BRL' ? 'R$ 0,00' : 'US$ 0.00'} (Rendimento líquido)
                </div>
              </div>
            )}
          </div>

          {/* Date, Fee, Note */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Data e hora
              </label>
              <input
                type="datetime-local"
                value={timestamp}
                onChange={(e) => setTimestamp(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            {txType !== 'ganho' ? (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Taxa opcional ({currency})
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={feeInput}
                  onChange={(e) => setFeeInput(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Origem do ganho
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex: Staking, Earn, Airdrop"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            )}
          </div>

          {txType !== 'ganho' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Observação opcional
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex: Compra parcial no suporte"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
          )}

          {/* Total summary */}
          <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-[#0B0F17] px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {txType === 'compra'
                ? 'Total investido'
                : txType === 'venda'
                ? 'Total recebido'
                : 'Valor de mercado atual do ganho'}
            </span>
            <span className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {txType === 'ganho' && effectiveLiveUsd
                ? formatPrice(
                    (Number.isFinite(qtyNum) ? qtyNum : 0) * effectiveLiveUsd,
                    currency,
                    usdBrlRate
                  )
                : (currency === 'BRL' ? 'R$ ' : 'US$ ') +
                  totalDisplay.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
            </span>
          </div>

          {error && (
            <p className="text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {txType === 'compra'
                ? 'Registrar compra'
                : txType === 'venda'
                ? 'Registrar venda'
                : 'Registrar ganho'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
