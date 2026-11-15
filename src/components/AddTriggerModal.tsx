import { BellRing, Loader2, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiGetCoinPrice, apiSearchCryptos } from '../services/apiClient.ts';
import type {
  MarketSnapshot,
  TriggerActionHint,
  TriggerConditionType,
  TriggerRepeatMode,
  WatchlistAsset,
} from '../types/crypto.ts';
import { formatPrice } from '../utils/format.ts';
import { CryptoLogo } from './CryptoLogo.tsx';

interface SearchResult {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number | null;
}

interface AddTriggerModalProps {
  open: boolean;
  watchlist: WatchlistAsset[];
  snapshots: Record<string, MarketSnapshot>;
  currency: 'USD' | 'BRL';
  usdBrlRate: number;
  whatsappEnabled: boolean;
  telegramEnabled: boolean;
  preselectedCoinId?: string | null;
  onClose: () => void;
  onSubmit: (payload: {
    coinId: string;
    symbol: string;
    name: string;
    conditionType: TriggerConditionType;
    targetValue: number;
    referencePriceUsd?: number;
    actionHint: TriggerActionHint;
    repeatMode: TriggerRepeatMode;
    cooldownMinutes?: number;
    sendWhatsApp?: boolean;
    sendTelegram?: boolean;
    note?: string;
  }) => Promise<void>;
}

export function AddTriggerModal({
  open,
  watchlist,
  snapshots,
  currency,
  usdBrlRate,
  whatsappEnabled,
  telegramEnabled,
  preselectedCoinId,
  onClose,
  onSubmit,
}: AddTriggerModalProps) {
  const [selectedCoin, setSelectedCoin] = useState<{
    id: string;
    symbol: string;
    name: string;
  } | null>(null);
  const [coinSearch, setCoinSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [conditionType, setConditionType] = useState<TriggerConditionType>('queda_pct');
  const [targetInput, setTargetInput] = useState('10');
  const [refPriceInput, setRefPriceInput] = useState('');
  const [liveFetchedPriceUsd, setLiveFetchedPriceUsd] = useState<number | null>(null);
  const [actionHint, setActionHint] = useState<TriggerActionHint>('COMPRAR');
  const [repeatMode, setRepeatMode] = useState<TriggerRepeatMode>('continuo');
  const [cooldownMinutes, setCooldownMinutes] = useState('60');
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [sendTelegram, setSendTelegram] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wasOpenRef = useRef(false);
  const userEditedRefPrice = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    userEditedRefPrice.current = false;

    setError(null);
    setConditionType('queda_pct');
    setTargetInput('10');
    setActionHint('COMPRAR');
    setRepeatMode('continuo');
    setCooldownMinutes('60');
    setSendWhatsApp(whatsappEnabled || !telegramEnabled);
    setSendTelegram(telegramEnabled);
    setNote('');
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
        setRefPriceInput(displayPrice.toFixed(displayPrice < 1 ? 4 : 2));
      } else {
        setRefPriceInput('');
      }
    } else {
      setSelectedCoin(null);
      setRefPriceInput('');
    }
  }, [open, preselectedCoinId, watchlist, snapshots, currency, usdBrlRate]);

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
    }, 280);
    return () => clearTimeout(timer);
  }, [coinSearch]);

  if (!open) return null;

  const selectAsset = async (coin: { id: string; symbol: string; name: string }) => {
    setSelectedCoin(coin);
    setCoinSearch('');
    setSearchResults([]);
    setLiveFetchedPriceUsd(null);
    userEditedRefPrice.current = false;

    const snap = snapshots[coin.id];
    if (snap && snap.priceUsd > 0) {
      const displayPrice =
        currency === 'BRL' ? snap.priceUsd * usdBrlRate : snap.priceUsd;
      setRefPriceInput(displayPrice.toFixed(displayPrice < 1 ? 4 : 2));
      return;
    }

    try {
      const priceUsd = await apiGetCoinPrice(coin.id, coin.symbol);
      if (priceUsd && priceUsd > 0) {
        setLiveFetchedPriceUsd(priceUsd);
        if (!userEditedRefPrice.current) {
          const displayPrice =
            currency === 'BRL' ? priceUsd * usdBrlRate : priceUsd;
          setRefPriceInput(displayPrice.toFixed(displayPrice < 1 ? 4 : 2));
        }
      }
    } catch {
      // user can still input reference manually
    }
  };

  const handleConditionChange = (next: TriggerConditionType) => {
    setConditionType(next);
    if (next === 'queda_pct') {
      setActionHint('COMPRAR');
      if (!targetInput || Number(targetInput) > 95) setTargetInput('10');
    } else if (next === 'alta_pct') {
      setActionHint('VENDER');
      if (!targetInput) setTargetInput('10');
    } else if (next === 'abaixo_preco') {
      setActionHint('COMPRAR');
    } else {
      setActionHint('VENDER');
    }
  };

  const effectiveLiveUsd =
    (selectedCoin && snapshots[selectedCoin.id]?.priceUsd) || liveFetchedPriceUsd || null;

  const applyLiveRefPrice = () => {
    if (!effectiveLiveUsd) return;
    userEditedRefPrice.current = false;
    const displayPrice =
      currency === 'BRL' ? effectiveLiveUsd * usdBrlRate : effectiveLiveUsd;
    setRefPriceInput(displayPrice.toFixed(displayPrice < 1 ? 4 : 2));
  };

  const toUsd = (val: number) => (currency === 'BRL' ? val / usdBrlRate : val);
  const targetNum = Number(targetInput.replace(',', '.'));
  const refNum = Number(refPriceInput.replace(',', '.'));
  const refUsd = Number.isFinite(refNum) && refNum > 0 ? toUsd(refNum) : effectiveLiveUsd ?? 0;

  let estimatedTriggerPriceUsd: number | null = null;
  if (Number.isFinite(targetNum) && targetNum > 0) {
    if (conditionType === 'queda_pct' && refUsd > 0) {
      estimatedTriggerPriceUsd = refUsd * (1 - targetNum / 100);
    } else if (conditionType === 'alta_pct' && refUsd > 0) {
      estimatedTriggerPriceUsd = refUsd * (1 + targetNum / 100);
    } else if (conditionType === 'abaixo_preco' || conditionType === 'acima_preco') {
      estimatedTriggerPriceUsd = toUsd(targetNum);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCoin) {
      setError('Selecione uma criptomoeda para monitorar.');
      return;
    }
    if (!Number.isFinite(targetNum) || targetNum <= 0) {
      setError('Informe um valor alvo maior que zero.');
      return;
    }
    if (conditionType === 'queda_pct' && targetNum >= 100) {
      setError('A queda percentual deve ser menor que 100%.');
      return;
    }

    const finalTargetValue =
      conditionType === 'abaixo_preco' || conditionType === 'acima_preco'
        ? toUsd(targetNum)
        : targetNum;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        coinId: selectedCoin.id,
        symbol: selectedCoin.symbol,
        name: selectedCoin.name,
        conditionType,
        targetValue: finalTargetValue,
        referencePriceUsd:
          conditionType === 'queda_pct' || conditionType === 'alta_pct'
            ? refUsd > 0
              ? refUsd
              : undefined
            : undefined,
        actionHint,
        repeatMode,
        cooldownMinutes: Math.max(1, Number(cooldownMinutes) || 60),
        sendWhatsApp,
        sendTelegram,
        note: note.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível criar o gatilho.');
    } finally {
      setSubmitting(false);
    }
  }

  const isPercentCondition =
    conditionType === 'queda_pct' || conditionType === 'alta_pct';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 dark:bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/[0.07]">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Novo Gatilho 24h (WhatsApp e Telegram)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Monitorado a cada 5 segundos em tempo real para avisar no momento exato.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {/* Selected coin & search */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Criptomoeda
            </label>

            {selectedCoin && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-sky-300 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/10 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <CryptoLogo
                    symbol={selectedCoin.symbol}
                    coinId={selectedCoin.id}
                    name={selectedCoin.name}
                    size="sm"
                  />
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{selectedCoin.name}</span>
                  <span className="font-mono text-sky-700 dark:text-sky-400">{selectedCoin.symbol}</span>
                  {effectiveLiveUsd && (
                    <span className="font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                      · Atual {formatPrice(effectiveLiveUsd, currency, usdBrlRate)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCoin(null);
                    setRefPriceInput('');
                  }}
                  className="text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"
                >
                  Trocar
                </button>
              </div>
            )}

            {(!selectedCoin || coinSearch.length > 0) && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={coinSearch}
                    onChange={(e) => setCoinSearch(e.target.value)}
                    placeholder="Buscar moeda (ex: Solana, Bitcoin, XRP, ETH...)"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  {searching && (
                    <Loader2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                </div>

                {watchlist.length > 0 && coinSearch.trim().length < 2 && (
                  <div className="flex flex-wrap gap-1.5">
                    {watchlist.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => void selectAsset(w)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono rounded-md border border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-[#0B0F17] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors"
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

                {searchResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0B0F17] divide-y divide-slate-200 dark:divide-white/[0.06]">
                    {searchResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => void selectAsset(c)}
                        className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <CryptoLogo
                            symbol={c.symbol}
                            coinId={c.id}
                            name={c.name}
                            size="xs"
                          />
                          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{c.symbol}</span>
                          <span className="text-slate-600 dark:text-slate-400 truncate">{c.name}</span>
                        </div>
                        {c.marketCapRank && (
                          <span className="font-mono text-[11px] text-slate-500">
                            #{c.marketCapRank}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Condition type */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Regra do gatilho
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.08]">
              {(
                [
                  { id: 'queda_pct', label: 'Queda %' },
                  { id: 'alta_pct', label: 'Alta %' },
                  { id: 'abaixo_preco', label: 'Abaixo de' },
                  { id: 'acima_preco', label: 'Acima de' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleConditionChange(item.id)}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    conditionType === item.id
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target value & Reference price */}
          <div className={`grid gap-3 ${isPercentCondition ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            <div>
              <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
                {conditionType === 'queda_pct'
                  ? 'Avisar quando cair (%)'
                  : conditionType === 'alta_pct'
                  ? 'Avisar quando subir (%)'
                  : conditionType === 'abaixo_preco'
                  ? `Avisar se preço cair até (${currency === 'BRL' ? 'R$' : 'US$'})`
                  : `Avisar se preço subir até (${currency === 'BRL' ? 'R$' : 'US$'})`}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                placeholder={isPercentCondition ? 'Ex: 10' : 'Ex: 60,00'}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 tabular-nums"
              />
            </div>

            {isPercentCondition && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-700 dark:text-slate-400">
                    Preço base ({currency === 'BRL' ? 'R$' : 'US$'})
                  </label>
                  {effectiveLiveUsd && (
                    <button
                      type="button"
                      onClick={applyLiveRefPrice}
                      className="text-[11px] text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300"
                    >
                      Usar atual
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={refPriceInput}
                  onChange={(e) => {
                    userEditedRefPrice.current = true;
                    setRefPriceInput(e.target.value);
                  }}
                  placeholder="Preço atual"
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 tabular-nums"
                />
              </div>
            )}
          </div>

          {estimatedTriggerPriceUsd && estimatedTriggerPriceUsd > 0 && (
            <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17] px-3.5 py-2.5 flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">Disparo automático estimado em</span>
              <span className="font-mono font-semibold text-sky-700 dark:text-sky-400 tabular-nums">
                {formatPrice(estimatedTriggerPriceUsd, currency, usdBrlRate)}
              </span>
            </div>
          )}

          {/* Action hint & Repeat mode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
                Finalidade do alerta
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.08]">
                {(['COMPRAR', 'VENDER', 'AVALIAR'] as const).map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => setActionHint(hint)}
                    className={`py-1.5 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap ${
                      actionHint === hint
                        ? hint === 'COMPRAR'
                          ? 'bg-emerald-600 text-white'
                          : hint === 'VENDER'
                          ? 'bg-rose-600 text-white'
                          : 'bg-amber-600 text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
                Frequência de disparo
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setRepeatMode('continuo')}
                  className={`py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    repeatMode === 'continuo'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Contínuo 24h
                </button>
                <button
                  type="button"
                  onClick={() => setRepeatMode('uma_vez')}
                  className={`py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    repeatMode === 'uma_vez'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Uma vez
                </button>
              </div>
            </div>
          </div>

          {repeatMode === 'continuo' && (
            <div>
              <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
                Intervalo mínimo entre disparos repetidos (minutos)
              </label>
              <input
                type="number"
                min={1}
                max={1440}
                value={cooldownMinutes}
                onChange={(e) => setCooldownMinutes(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 tabular-nums"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
              Observação opcional na mensagem (WhatsApp / Telegram)
            </label>
            <input
              type="text"
              maxLength={140}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: Hora de aportar na queda"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs text-slate-700 dark:text-slate-400">
              Canais de envio automático
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17] cursor-pointer">
                <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Enviar no WhatsApp
                </span>
                <input
                  type="checkbox"
                  checked={sendWhatsApp}
                  onChange={(e) => setSendWhatsApp(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 dark:accent-emerald-500 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17] cursor-pointer">
                <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Enviar no Telegram
                </span>
                <input
                  type="checkbox"
                  checked={sendTelegram}
                  onChange={(e) => setSendTelegram(e.target.checked)}
                  className="w-4 h-4 accent-sky-600 dark:accent-sky-500 cursor-pointer"
                />
              </label>
            </div>
          </div>

          {sendWhatsApp && !whatsappEnabled && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Lembrete WhatsApp: ative e conecte seu número em Alertas → Configurar WhatsApp para receber mensagens no WhatsApp.
            </p>
          )}

          {sendTelegram && !telegramEnabled && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Lembrete Telegram: ative seu bot em Alertas → Configurar Telegram para receber mensagens no Telegram.
            </p>
          )}

          {error && (
            <p className="text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/25 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <BellRing className="w-3.5 h-3.5" />
              )}
              {submitting ? 'Salvando...' : 'Salvar gatilho 24h'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
