import {
  Bell,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddAssetModal } from './components/AddAssetModal.tsx';
import { AddTransactionModal } from './components/AddTransactionModal.tsx';
import { AddTriggerModal } from './components/AddTriggerModal.tsx';
import { AssetDetailPanel } from './components/AssetDetailPanel.tsx';
import { AutomationSettingsPanel } from './components/AutomationSettingsPanel.tsx';
import { PortfolioView } from './components/PortfolioView.tsx';
import { SignalBadge } from './components/SignalBadge.tsx';
import { Sparkline } from './components/Sparkline.tsx';
import { TriggersPanel } from './components/TriggersPanel.tsx';
import { WhatsAppSettingsPanel } from './components/WhatsAppSettingsPanel.tsx';
import {
  apiAddTransaction,
  apiAddWatchlist,
  apiClearAlerts,
  apiClearStudyHistory,
  apiClearTransactions,
  apiClearTriggers,
  apiCreateTrigger,
  apiDeleteAlert,
  apiDeletePortfolioAsset,
  apiDeleteStudyCycle,
  apiDeleteTransaction,
  apiDeleteTrigger,
  apiGetState,
  apiMarkAlertsRead,
  apiRemoveWatchlist,
  apiRenamePortfolio,
  apiRunStudy,
  apiUpdateSettings,
  apiUpdateTrigger,
  getBackendMode,
} from './services/apiClient.ts';
import type {
  AppSettings,
  AppStatePayload,
  PriceTrigger,
  SignalAction,
  SignalAlert,
  TransactionType,
  TriggerActionHint,
  TriggerConditionType,
  TriggerRepeatMode,
} from './types/crypto.ts';
import {
  formatCompactVolume,
  formatPercent,
  formatPrice,
  formatRelativeTime,
  formatTimeClock,
} from './utils/format.ts';
import { playAlertChime, sendBrowserNotification } from './utils/notify.ts';

type NavTab = 'painel' | 'carteira' | 'ativos' | 'autoestudo' | 'alertas';

export default function App() {
  const [state, setState] = useState<AppStatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('painel');
  const [selectedCoinId, setSelectedCoinId] = useState<string>('');
  const [signalFilter, setSignalFilter] = useState<'TODOS' | SignalAction>('TODOS');
  const [tableSearch, setTableSearch] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txPreselectedCoinId, setTxPreselectedCoinId] = useState<string | null>(null);
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [triggerPreselectedCoinId, setTriggerPreselectedCoinId] = useState<string | null>(null);
  const [alertsSubTab, setAlertsSubTab] = useState<'triggers' | 'alerts'>('triggers');
  const [rightSettingsTab, setRightSettingsTab] = useState<'whatsapp' | 'automacao'>('whatsapp');
  const [studyStatusMsg, setStudyStatusMsg] = useState<string | null>(null);
  const [liveBannerAlerts, setLiveBannerAlerts] = useState<SignalAlert[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [countdownLabel, setCountdownLabel] = useState<string>('');
  const [streamConnected, setStreamConnected] = useState(false);

  const settingsRef = useRef<AppSettings | null>(null);
  const usdBrlRef = useRef<number>(5.75);
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  const lastMarketTickAtRef = useRef<number>(0);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    if (state) {
      settingsRef.current = state.settings;
      usdBrlRef.current = state.usdBrlRate;
    }
  }, [state]);

  const fetchInitialState = useCallback(async () => {
    try {
      const data = await apiGetState(true);
      lastMarketTickAtRef.current = Date.now();
      setState(data);
      setError(null);
      if (getBackendMode() === 'local') {
        setStreamConnected(true);
      }
      setSelectedCoinId((prev) => {
        if (data.watchlist.length === 0) return '';
        return !data.watchlist.some((w) => w.id === prev)
          ? data.watchlist[0].id
          : prev;
      });
    } catch (err: any) {
      setError(err?.message || 'Não foi possível conectar ao mercado.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitialState();
  }, [fetchInitialState]);

  // Real-time SSE connection when backend server is active
  useEffect(() => {
    if (loading) return;
    if (getBackendMode() === 'local') {
      setStreamConnected(true);
      return;
    }

    const es = new EventSource('/api/stream');

    es.addEventListener('connected', () => {
      setStreamConnected(true);
    });

    es.addEventListener('market_tick', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          snapshots: AppStatePayload['snapshots'];
          usdBrlRate: number;
          accuracyStats: AppStatePayload['accuracyStats'];
          alerts: AppStatePayload['alerts'];
          triggers?: PriceTrigger[];
          portfolio: AppStatePayload['portfolio'];
        };
        lastMarketTickAtRef.current = Date.now();
        setStreamConnected(true);
        setState((prev) =>
          prev
            ? {
                ...prev,
                snapshots: data.snapshots,
                usdBrlRate: data.usdBrlRate,
                accuracyStats: data.accuracyStats,
                alerts: data.alerts,
                triggers: data.triggers ?? prev.triggers,
                portfolio: data.portfolio,
              }
            : prev
        );
      } catch {
        // ignore parse error
      }
    });

    es.addEventListener('trigger_fired', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          alerts: SignalAlert[];
          triggers: PriceTrigger[];
        };
        if (data.alerts && data.alerts.length > 0) {
          setLiveBannerAlerts((prev) => [...data.alerts, ...prev].slice(0, 3));
          const first = data.alerts[0];
          if (soundEnabledRef.current && first) {
            playAlertChime(first.action);
          }
          if (first && settingsRef.current) {
            sendBrowserNotification(
              first,
              settingsRef.current.currency,
              usdBrlRef.current
            );
          }
        }
        setState((prev) =>
          prev
            ? {
                ...prev,
                triggers: data.triggers ?? prev.triggers,
              }
            : prev
        );
      } catch {
        // ignore
      }
    });

    es.addEventListener('study_status', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          isStudying: boolean;
        };
        setState((prev) =>
          prev ? { ...prev, isStudying: data.isStudying } : prev
        );
        if (!data.isStudying) {
          setStudyStatusMsg(null);
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener('study_progress', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { message: string };
        setStudyStatusMsg(data.message);
      } catch {
        // ignore
      }
    });

    es.addEventListener('study_completed', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          newAlerts: SignalAlert[];
          state: AppStatePayload;
        };
        lastMarketTickAtRef.current = Date.now();
        setState(data.state);
        setStudyStatusMsg(null);

        if (data.newAlerts && data.newAlerts.length > 0) {
          setLiveBannerAlerts(data.newAlerts.slice(0, 3));
          const actionable = data.newAlerts.find(
            (a) => a.action === 'COMPRAR' || a.action === 'VENDER'
          );
          const first = actionable ?? data.newAlerts[0];

          if (soundEnabledRef.current && first) {
            playAlertChime(first.action);
          }
          if (first && settingsRef.current) {
            sendBrowserNotification(
              first,
              settingsRef.current.currency,
              usdBrlRef.current
            );
          }
        }
      } catch {
        // ignore
      }
    });

    es.onerror = () => {
      if (getBackendMode() === 'local') {
        es.close();
        setStreamConnected(true);
      } else {
        setStreamConnected(false);
      }
    };

    return () => {
      es.close();
    };
  }, [loading]);

  // Guaranteed 10-second live price refresh for watchlist + portfolio (server backup + static mode)
  useEffect(() => {
    if (loading) return;
    const timer = setInterval(async () => {
      const elapsed = Date.now() - lastMarketTickAtRef.current;
      // If SSE just delivered a fresh tick (< 9s), skip redundant poll
      if (getBackendMode() === 'server' && elapsed < 9_000) {
        return;
      }
      try {
        const fresh = await apiGetState(true);
        lastMarketTickAtRef.current = Date.now();
        setStreamConnected(true);
        setState((prev) =>
          prev
            ? {
                ...prev,
                snapshots: fresh.snapshots,
                usdBrlRate: fresh.usdBrlRate,
                accuracyStats: fresh.accuracyStats,
                alerts: fresh.alerts,
                triggers: fresh.triggers,
                portfolio: fresh.portfolio,
                analyses: fresh.analyses,
                studyHistory: fresh.studyHistory,
              }
            : fresh
        );
      } catch {
        // silent retry on next 10s cycle
      }
    }, 10_000);

    return () => clearInterval(timer);
  }, [loading]);

  // Countdown timer for next automatic AI study
  useEffect(() => {
    let triggeredLocalCycle = false;
    const updateCountdown = () => {
      if (!state?.settings.autoStudyEnabled || !state.nextStudyAt) {
        setCountdownLabel(state?.settings.autoStudyEnabled ? 'Agendando...' : 'Pausado');
        return;
      }
      const diffSec = Math.max(
        0,
        Math.floor((new Date(state.nextStudyAt).getTime() - Date.now()) / 1000)
      );
      const mins = Math.floor(diffSec / 60);
      const secs = diffSec % 60;
      setCountdownLabel(
        `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      );

      if (
        diffSec === 0 &&
        !triggeredLocalCycle &&
        getBackendMode() === 'local' &&
        state.watchlist.length > 0 &&
        !state.isStudying
      ) {
        triggeredLocalCycle = true;
        void apiRunStudy()
          .then((res) => {
            setState(res.state);
            if (res.newAlerts && res.newAlerts.length > 0) {
              setLiveBannerAlerts(res.newAlerts.slice(0, 3));
            }
          })
          .catch(() => {
            // retry on next schedule
          });
      }
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [state?.nextStudyAt, state?.settings.autoStudyEnabled, state?.watchlist.length, state?.isStudying]);

  async function handleRunStudy(coinId?: string) {
    setError(null);
    setState((prev) => (prev ? { ...prev, isStudying: true } : prev));
    try {
      const json = await apiRunStudy(coinId);
      setState(json.state);
      if (json.newAlerts && json.newAlerts.length > 0) {
        setLiveBannerAlerts(json.newAlerts.slice(0, 3));
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao executar estudo de IA.');
      setState((prev) => (prev ? { ...prev, isStudying: false } : prev));
    }
  }

  async function handleAddAsset(coin: { id: string; symbol: string; name: string }) {
    const updatedState = await apiAddWatchlist(coin);
    setState(updatedState);
    setSelectedCoinId(coin.id);
  }

  async function handleRemoveAsset(coinId: string) {
    try {
      const updatedState = await apiRemoveWatchlist(coinId);
      setState(updatedState);
      if (updatedState.watchlist.length === 0) {
        setSelectedCoinId('');
      } else if (selectedCoinId === coinId) {
        setSelectedCoinId(updatedState.watchlist[0].id);
      }
    } catch (err: any) {
      setError(err?.message || 'Não foi possível remover o ativo.');
    }
  }

  async function handleUpdateSettings(patch: Partial<AppSettings>) {
    const updatedState = await apiUpdateSettings(patch);
    setState(updatedState);
  }

  async function handleMarkAlertsRead() {
    try {
      await apiMarkAlertsRead();
      setState((prev) =>
        prev
          ? {
              ...prev,
              alerts: prev.alerts.map((a) => ({ ...a, read: true })),
            }
          : prev
      );
    } catch {
      // ignore
    }
  }

  async function handleAddTransaction(payload: {
    coinId: string;
    symbol: string;
    name: string;
    type: TransactionType;
    quantity: number;
    pricePerCoinUsd: number;
    feeUsd: number;
    timestamp: string;
    note?: string;
  }) {
    const updatedState = await apiAddTransaction(payload);
    setState(updatedState);
  }

  async function handleDeleteTransaction(txId: string) {
    try {
      const updatedState = await apiDeleteTransaction(txId);
      setState(updatedState);
    } catch (err: any) {
      setError(err?.message || 'Falha ao excluir transação.');
    }
  }

  async function handleDeletePortfolioCoin(coinId: string) {
    try {
      const updatedState = await apiDeletePortfolioAsset(coinId);
      setState(updatedState);
    } catch (err: any) {
      setError(err?.message || 'Falha ao excluir ativo e histórico da carteira.');
    }
  }

  async function handleClearPortfolioTransactions() {
    try {
      const updatedState = await apiClearTransactions();
      setState(updatedState);
    } catch (err: any) {
      setError(err?.message || 'Falha ao limpar histórico de transações.');
    }
  }

  async function handleDeleteAlert(alertId: string) {
    try {
      const updatedState = await apiDeleteAlert(alertId);
      setState(updatedState);
      setLiveBannerAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err: any) {
      setError(err?.message || 'Falha ao excluir alerta.');
    }
  }

  async function handleClearAlerts() {
    try {
      const updatedState = await apiClearAlerts();
      setState(updatedState);
      setLiveBannerAlerts([]);
    } catch (err: any) {
      setError(err?.message || 'Falha ao limpar histórico de alertas.');
    }
  }

  async function handleDeleteStudyCycle(cycleId: string) {
    try {
      const updatedState = await apiDeleteStudyCycle(cycleId);
      setState(updatedState);
    } catch (err: any) {
      setError(err?.message || 'Falha ao excluir registro de estudo.');
    }
  }

  async function handleClearStudyHistory() {
    try {
      const updatedState = await apiClearStudyHistory();
      setState(updatedState);
    } catch (err: any) {
      setError(err?.message || 'Falha ao limpar histórico de estudos.');
    }
  }

  async function handleRenamePortfolio(name: string) {
    try {
      const updatedState = await apiRenamePortfolio(name);
      setState(updatedState);
    } catch (err: any) {
      setError(err?.message || 'Erro ao renomear carteira.');
    }
  }

  function openTransactionModal(coinId?: string) {
    setTxPreselectedCoinId(coinId ?? null);
    setTxModalOpen(true);
  }

  function openTriggerModal(coinId?: string) {
    setTriggerPreselectedCoinId(coinId ?? null);
    setTriggerModalOpen(true);
  }

  async function handleCreateTrigger(payload: {
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
    note?: string;
  }) {
    const updatedState = await apiCreateTrigger(payload);
    setState(updatedState);
  }

  async function handleToggleTrigger(triggerId: string, enabled: boolean) {
    try {
      const updatedState = await apiUpdateTrigger(triggerId, { enabled });
      setState(updatedState);
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar gatilho.');
    }
  }

  async function handleResetTriggerRef(triggerId: string) {
    try {
      const updatedState = await apiUpdateTrigger(triggerId, { resetReference: true });
      setState(updatedState);
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar preço base do gatilho.');
    }
  }

  async function handleDeleteTrigger(triggerId: string) {
    try {
      const updatedState = await apiDeleteTrigger(triggerId);
      setState(updatedState);
    } catch (err: any) {
      setError(err?.message || 'Erro ao excluir gatilho.');
    }
  }

  async function handleClearTriggers() {
    try {
      const updatedState = await apiClearTriggers();
      setState(updatedState);
    } catch (err: any) {
      setError(err?.message || 'Erro ao limpar gatilhos.');
    }
  }

  const filteredAssets = useMemo(() => {
    if (!state) return [];
    const q = tableSearch.trim().toLowerCase();
    return state.watchlist.filter((asset) => {
      const analysis = state.analyses[asset.id];
      if (signalFilter !== 'TODOS') {
        if (!analysis || analysis.action !== signalFilter) return false;
      }
      if (q) {
        return (
          asset.name.toLowerCase().includes(q) ||
          asset.symbol.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [state, signalFilter, tableSearch]);

  const counts = useMemo(() => {
    if (!state) return { buy: 0, sell: 0, hold: 0, unread: 0 };
    let buy = 0;
    let sell = 0;
    let hold = 0;
    for (const asset of state.watchlist) {
      const a = state.analyses[asset.id];
      if (a?.action === 'COMPRAR') buy++;
      else if (a?.action === 'VENDER') sell++;
      else if (a?.action === 'ESPERAR') hold++;
    }
    const unread = state.alerts.filter((al) => !al.read).length;
    return { buy, sell, hold, unread };
  }, [state]);

  const selectedAsset =
    state?.watchlist.find((a) => a.id === selectedCoinId) ??
    state?.watchlist[0] ??
    null;

  const existingIds = useMemo(
    () => new Set((state?.watchlist ?? []).map((w) => w.id)),
    [state?.watchlist]
  );

  const renderOutcomeText = (alert: SignalAlert) => {
    if (alert.outcome === 'acerto') {
      return (
        <span className="text-emerald-400 font-mono tabular-nums">
          Acerto ({formatPercent(alert.evaluatedReturnPct)})
        </span>
      );
    }
    if (alert.outcome === 'erro') {
      return (
        <span className="text-rose-400 font-mono tabular-nums">
          Desvio ({formatPercent(alert.evaluatedReturnPct)})
        </span>
      );
    }
    if (alert.outcome === 'neutro') {
      return (
        <span className="text-slate-400 font-mono tabular-nums">
          Lateral ({formatPercent(alert.evaluatedReturnPct)})
        </span>
      );
    }
    return (
      <span className="text-sky-400 font-mono tabular-nums">
        Aberto ({formatPercent(alert.evaluatedReturnPct ?? 0)})
      </span>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#0B0F17]/95 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('painel')}
            className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
          >
            SinalCripto IA
          </button>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {(
              [
                { id: 'painel', label: 'Painel' },
                { id: 'carteira', label: 'Carteira' },
                { id: 'ativos', label: 'Ativos' },
                { id: 'autoestudo', label: 'Autoestudo' },
                {
                  id: 'alertas',
                  label:
                    counts.unread > 0 ? `Alertas (${counts.unread})` : 'Alertas',
                },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  activeTab === item.id
                    ? 'text-slate-100 border-sky-500'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1 primary CTA button */}
          <div className="shrink-0">
            <button
              type="button"
              disabled={
                loading ||
                Boolean(state?.isStudying) ||
                (state?.watchlist.length ?? 0) === 0
              }
              title={
                (state?.watchlist.length ?? 0) === 0
                  ? 'Adicione ao menos uma criptomoeda para estudar'
                  : 'Executar estudo completo agora'
              }
              onClick={() => handleRunStudy()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {state?.isStudying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {state?.isStudying ? 'Estudando...' : 'Estudar agora'}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile secondary nav */}
      <div className="md:hidden border-b border-white/[0.07] bg-[#0F1520] px-4 py-2 flex items-center gap-4 overflow-x-auto text-xs font-medium">
        {(
          [
            { id: 'painel', label: 'Painel' },
            { id: 'carteira', label: 'Carteira' },
            { id: 'ativos', label: 'Ativos' },
            { id: 'autoestudo', label: 'Autoestudo' },
            {
              id: 'alertas',
              label: counts.unread > 0 ? `Alertas (${counts.unread})` : 'Alertas',
            },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            className={`py-1.5 whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === item.id
                ? 'text-slate-100 border-sky-500'
                : 'text-slate-400 border-transparent'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Live Automatic Signal Alert Banner */}
        {liveBannerAlerts.length > 0 && (
          <div className="rounded-xl border border-sky-500/30 bg-[#111827] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Bell className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-100">
                Novas sugestões automáticas geradas pela IA:
              </span>
              <div className="flex flex-wrap items-center gap-3">
                {liveBannerAlerts.map((al) => (
                  <button
                    key={al.id}
                    type="button"
                    onClick={() => {
                      setSelectedCoinId(al.coinId);
                      setActiveTab('painel');
                    }}
                    className="inline-flex items-center gap-2 text-xs text-slate-200 hover:text-white underline-offset-4 hover:underline"
                  >
                    <span className="font-mono font-semibold">{al.symbol}</span>
                    <SignalBadge action={al.action} compact />
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLiveBannerAlerts([])}
              className="p-1 text-slate-400 hover:text-slate-200"
              aria-label="Dispensar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 flex items-center justify-between gap-3 text-xs text-rose-200">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-rose-300 hover:text-white"
            >
              Fechar
            </button>
          </div>
        )}

        {/* Workspace Context Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100 text-balance">
              Inteligência Autônoma de Criptomoedas
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>
                {streamConnected ? 'Tempo real ativo (10s)' : 'Sincronizando mercado'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                Próximo estudo automático: {countdownLabel}
              </span>
              {studyStatusMsg && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-sky-400">{studyStatusMsg}</span>
                </>
              )}
            </div>
          </div>

          {state && (
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1 rounded-lg bg-[#111827] p-1 border border-white/[0.08]">
                {(['BRL', 'USD'] as const).map((curr) => (
                  <button
                    key={curr}
                    type="button"
                    onClick={() => handleUpdateSettings({ currency: curr })}
                    className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      state.settings.currency === curr
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {curr}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setAddModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-white/10 bg-[#111827] hover:bg-slate-800 text-slate-100 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar cripto
              </button>
            </div>
          )}
        </div>

        {/* Loading skeleton */}
        {loading && !state ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className="h-24 rounded-xl border border-white/[0.07] bg-[#111827] animate-pulse"
                />
              ))}
            </div>
            <div className="h-96 rounded-xl border border-white/[0.07] bg-[#111827] animate-pulse" />
          </div>
        ) : state ? (
          <>
            {/* 4-column Summary KPI Strip */}
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-white/[0.08] bg-[#111827] p-4">
                <span className="block text-xs text-slate-400">Ativos monitorados</span>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-mono font-bold text-slate-100 tabular-nums">
                    {state.watchlist.length}
                  </span>
                  <span className="text-xs text-slate-400 font-mono tabular-nums">
                    {counts.hold} em espera
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-[#111827] p-4">
                <span className="block text-xs text-slate-400">Sinais de compra</span>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-mono font-bold text-emerald-400 tabular-nums">
                    {counts.buy}
                  </span>
                  <span className="text-xs text-slate-400 truncate">
                    {state.watchlist
                      .filter((w) => state.analyses[w.id]?.action === 'COMPRAR')
                      .map((w) => w.symbol)
                      .slice(0, 4)
                      .join(', ') || 'Nenhum momento'}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-[#111827] p-4">
                <span className="block text-xs text-slate-400">Sinais de venda</span>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-mono font-bold text-rose-400 tabular-nums">
                    {counts.sell}
                  </span>
                  <span className="text-xs text-slate-400 truncate">
                    {state.watchlist
                      .filter((w) => state.analyses[w.id]?.action === 'VENDER')
                      .map((w) => w.symbol)
                      .slice(0, 4)
                      .join(', ') || 'Nenhum momento'}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-[#111827] p-4">
                <span className="block text-xs text-slate-400">
                  Precisão avaliada pela IA
                </span>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-mono font-bold text-slate-100 tabular-nums">
                    {state.accuracyStats.accuracyPct !== null
                      ? `${state.accuracyStats.accuracyPct}%`
                      : 'Inicial'}
                  </span>
                  <span className="text-xs text-slate-400 font-mono tabular-nums">
                    {state.accuracyStats.totalEvaluated > 0
                      ? `${state.accuracyStats.hits}/${state.accuracyStats.totalEvaluated} sinais`
                      : `${state.studyHistory.length} ciclos`}
                  </span>
                </div>
              </div>
            </section>

            {/* VIEW 1: PAINEL PRINCIPAL */}
            {activeTab === 'painel' && (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                {/* Left 8 columns: Watchlist table + Selected Asset Detail */}
                <div className="xl:col-span-8 space-y-6">
                  <section className="rounded-xl border border-white/[0.08] bg-[#111827] overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-1 rounded-lg bg-[#0B0F17] p-1 border border-white/[0.07]">
                        {(
                          [
                            { id: 'TODOS', label: 'Todos' },
                            { id: 'COMPRAR', label: 'Comprar' },
                            { id: 'VENDER', label: 'Vender' },
                            { id: 'ESPERAR', label: 'Esperar' },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setSignalFilter(tab.id)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                              signalFilter === tab.id
                                ? 'bg-slate-800 text-slate-100'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <div className="relative min-w-[200px] flex-1 sm:flex-initial">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={tableSearch}
                          onChange={(e) => setTableSearch(e.target.value)}
                          placeholder="Filtrar moeda..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-white/10 bg-[#0B0F17] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                        />
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      {state.watchlist.length === 0 ? (
                        <div className="p-10 text-center space-y-4">
                          <BrainCircuit className="w-8 h-8 text-sky-400 mx-auto" />
                          <div className="max-w-md mx-auto space-y-1.5">
                            <h2 className="text-base font-semibold text-slate-100">
                              Nenhum ativo cadastrado ainda
                            </h2>
                            <p className="text-xs text-slate-400 leading-relaxed">
                              Adicione suas próprias criptomoedas oficiais ou lance sua carteira para a IA começar a monitorar indicadores e enviar sinais automáticos.
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => setAddModalOpen(true)}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Adicionar meu primeiro ativo
                            </button>
                            <button
                              type="button"
                              onClick={() => openTransactionModal()}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-white/10 bg-[#0B0F17] hover:bg-slate-800 text-slate-200 transition-colors"
                            >
                              <Wallet className="w-3.5 h-3.5" />
                              Lançar na carteira
                            </button>
                          </div>
                        </div>
                      ) : (
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-white/[0.06] text-[11px] font-medium text-slate-400">
                              <th className="py-2.5 px-5">Ativo</th>
                              <th className="py-2.5 px-3 text-right">Preço</th>
                              <th className="py-2.5 px-3 text-right">24h</th>
                              <th className="py-2.5 px-3 hidden sm:table-cell">7 dias</th>
                              <th className="py-2.5 px-3 text-right">RSI (14)</th>
                              <th className="py-2.5 px-3">Recomendação</th>
                              <th className="py-2.5 px-3 text-right">Confiança</th>
                              <th className="py-2.5 px-4 text-right">Excluir</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.05] text-sm">
                            {filteredAssets.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={8}
                                  className="py-8 text-center text-xs text-slate-400"
                                >
                                  Nenhum ativo corresponde ao filtro selecionado.
                                </td>
                              </tr>
                            ) : (
                              filteredAssets.map((asset) => {
                                const snap = state.snapshots[asset.id];
                                const analysis = state.analyses[asset.id];
                                const isSelected = selectedAsset?.id === asset.id;

                                return (
                                  <tr
                                    key={asset.id}
                                    onClick={() => setSelectedCoinId(asset.id)}
                                    className={`cursor-pointer transition-colors ${
                                      isSelected
                                        ? 'bg-sky-500/[0.08]'
                                        : 'hover:bg-white/[0.025]'
                                    }`}
                                  >
                                    <td className="py-3 px-5">
                                      <div className="flex items-center gap-2.5">
                                        <span className="font-mono font-bold text-xs text-slate-100 w-11 shrink-0">
                                          {asset.symbol}
                                        </span>
                                        <span className="text-xs text-slate-300 truncate max-w-[120px]">
                                          {asset.name}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-3 text-right font-mono text-xs font-semibold text-slate-100 tabular-nums whitespace-nowrap">
                                      {snap
                                        ? formatPrice(
                                            snap.priceUsd,
                                            state.settings.currency,
                                            state.usdBrlRate
                                          )
                                        : '—'}
                                    </td>
                                    <td
                                      className={`py-3 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap ${
                                        (snap?.change24hPct ?? 0) >= 0
                                          ? 'text-emerald-400'
                                          : 'text-rose-400'
                                      }`}
                                    >
                                      {snap ? formatPercent(snap.change24hPct) : '—'}
                                    </td>
                                    <td className="py-3 px-3 hidden sm:table-cell">
                                      <Sparkline
                                        data={snap?.sparkline7d ?? []}
                                        positive={(snap?.change7dPct ?? 0) >= 0}
                                      />
                                    </td>
                                    <td className="py-3 px-3 text-right font-mono text-xs tabular-nums">
                                      {snap ? (
                                        <span
                                          className={
                                            snap.indicators.rsi14 <= 32
                                              ? 'text-emerald-400 font-semibold'
                                              : snap.indicators.rsi14 >= 68
                                              ? 'text-rose-400 font-semibold'
                                              : 'text-slate-300'
                                          }
                                        >
                                          {snap.indicators.rsi14.toFixed(1)}
                                        </span>
                                      ) : (
                                        '—'
                                      )}
                                    </td>
                                    <td className="py-3 px-3">
                                      <SignalBadge action={analysis?.action} compact />
                                    </td>
                                    <td className="py-3 px-3 text-right font-mono text-xs text-slate-300 tabular-nums">
                                      {analysis ? `${analysis.confidence}%` : '—'}
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleRemoveAsset(asset.id);
                                        }}
                                        title={`Excluir ${asset.symbol} do painel`}
                                        aria-label={`Excluir ${asset.symbol}`}
                                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </section>

                  {/* Deep dive for selected coin */}
                  {selectedAsset && (
                    <AssetDetailPanel
                      asset={selectedAsset}
                      snapshot={state.snapshots[selectedAsset.id]}
                      analysis={state.analyses[selectedAsset.id]}
                      holding={state.portfolio.holdings.find(
                        (h) => h.coinId === selectedAsset.id
                      )}
                      currency={state.settings.currency}
                      usdBrlRate={state.usdBrlRate}
                      isStudying={state.isStudying}
                      canRemove={true}
                      onStudySingle={(coinId) => handleRunStudy(coinId)}
                      onRemoveAsset={handleRemoveAsset}
                      onAddTransaction={(coinId) => openTransactionModal(coinId)}
                      onCreateTrigger={(coinId) => openTriggerModal(coinId)}
                    />
                  )}
                </div>

                {/* Right 4 columns: Automatic Suggestions Feed + Quick Study Summary */}
                <aside className="xl:col-span-4 space-y-6">
                  <section className="rounded-xl border border-white/[0.08] bg-[#111827] overflow-hidden">
                    <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-100">
                          Sugestões automáticas
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Sinais emitidos quando a IA detecta ponto de ação
                        </p>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {counts.unread > 0 && (
                          <button
                            type="button"
                            onClick={handleMarkAlertsRead}
                            className="text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap"
                          >
                            Marcar lidas
                          </button>
                        )}
                        {state.alerts.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void handleClearAlerts()}
                            className="text-xs text-rose-400 hover:text-rose-300 whitespace-nowrap"
                          >
                            Limpar
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="divide-y divide-white/[0.06] max-h-[540px] overflow-y-auto">
                      {state.alerts.length === 0 ? (
                        <div className="p-6 text-center space-y-2">
                          <Clock className="w-5 h-5 text-slate-500 mx-auto" />
                          <p className="text-xs text-slate-300 font-medium">
                            Nenhum alerta emitido ainda
                          </p>
                          <p className="text-xs text-slate-500">
                            Adicione suas moedas e clique em &quot;Estudar agora&quot; para gerar recomendações.
                          </p>
                        </div>
                      ) : (
                        state.alerts.slice(0, 14).map((alert) => (
                          <div
                            key={alert.id}
                            className={`flex items-start gap-2 px-5 py-3.5 hover:bg-white/[0.025] transition-colors ${
                              !alert.read ? 'bg-sky-500/[0.04]' : ''
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedCoinId(alert.coinId)}
                              className="flex-1 text-left space-y-1.5 min-w-0"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono font-bold text-xs text-slate-100">
                                    {alert.symbol}
                                  </span>
                                  <SignalBadge action={alert.action} compact />
                                </div>
                                <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                                  {formatRelativeTime(alert.createdAt)}
                                </span>
                              </div>

                              <p className="text-xs font-medium text-slate-200 leading-snug">
                                {alert.headline}
                              </p>

                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                                <span>
                                  {formatPrice(
                                    alert.priceAtSignalUsd,
                                    state.settings.currency,
                                    state.usdBrlRate
                                  )}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>Conf. {alert.confidence}%</span>
                                <span aria-hidden="true">·</span>
                                {renderOutcomeText(alert)}
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteAlert(alert.id)}
                              title="Excluir alerta"
                              aria-label="Excluir alerta"
                              className="p-1 rounded text-slate-500 hover:text-rose-400 transition-colors shrink-0 mt-0.5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  {/* Compact Latest Auto-Study Cycle Summary */}
                  <section className="rounded-xl border border-white/[0.08] bg-[#111827] p-5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-2">
                        <BrainCircuit className="w-4 h-4 text-sky-400" />
                        Último ciclo autônomo
                      </h3>
                      <button
                        type="button"
                        onClick={() => setActiveTab('autoestudo')}
                        className="text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap"
                      >
                        Ver histórico
                      </button>
                    </div>

                    {state.studyHistory[0] ? (
                      <div className="space-y-2.5">
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {state.studyHistory[0].marketSummary}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                          <span>
                            Concluído às {formatTimeClock(state.studyHistory[0].completedAt)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{state.studyHistory[0].assetsStudied} ativos</span>
                          <span aria-hidden="true">·</span>
                          <span>{state.studyHistory[0].alertsEmitted} alertas</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        O primeiro ciclo automático está sendo preparado.
                      </p>
                    )}

                    <div className="pt-2 border-t border-white/[0.07] flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-400">
                        Frequência: a cada {state.settings.intervalMinutes} min
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateSettings({
                            autoStudyEnabled: !state.settings.autoStudyEnabled,
                          })
                        }
                        className="text-sky-400 hover:text-sky-300 font-medium whitespace-nowrap"
                      >
                        {state.settings.autoStudyEnabled ? 'Pausar' : 'Ativar'}
                      </button>
                    </div>
                  </section>
                </aside>
              </div>
            )}

            {/* VIEW: CARTEIRA (Mirror CoinMarketCap Portfolio) */}
            {activeTab === 'carteira' && (
              <PortfolioView
                portfolio={state.portfolio}
                snapshots={state.snapshots}
                analyses={state.analyses}
                currency={state.settings.currency}
                usdBrlRate={state.usdBrlRate}
                onOpenAddTransaction={(coinId) => openTransactionModal(coinId)}
                onDeleteTransaction={handleDeleteTransaction}
                onDeleteCoinHistory={handleDeletePortfolioCoin}
                onClearTransactions={handleClearPortfolioTransactions}
                onRenamePortfolio={handleRenamePortfolio}
                onSelectAssetForAI={(coinId) => {
                  setSelectedCoinId(coinId);
                  setActiveTab('painel');
                }}
                onOpenCreateTrigger={(coinId) => openTriggerModal(coinId)}
              />
            )}

            {/* VIEW 2: ATIVOS (Extended Matrix) */}
            {activeTab === 'ativos' && (
              <section className="rounded-xl border border-white/[0.08] bg-[#111827] overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      Criptoativos monitorados ({state.watchlist.length})
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Adicione qualquer criptomoeda para que a IA estude seus indicadores automaticamente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Nova criptomoeda
                  </button>
                </div>

                <div className="overflow-x-auto">
                  {state.watchlist.length === 0 ? (
                    <div className="p-10 text-center space-y-3">
                      <p className="text-sm font-medium text-slate-200">
                        Nenhum criptoativo adicionado ainda
                      </p>
                      <p className="text-xs text-slate-400">
                        Cadastre seus ativos oficiais para liberar o monitoramento em tempo real e estudos da IA.
                      </p>
                      <button
                        type="button"
                        onClick={() => setAddModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Adicionar meu primeiro ativo
                      </button>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-white/[0.06] text-[11px] font-medium text-slate-400">
                          <th className="py-3 px-5">Ativo</th>
                          <th className="py-3 px-3 text-right">Preço</th>
                          <th className="py-3 px-3 text-right">24h / 7d</th>
                          <th className="py-3 px-3 text-right">Volume 24h</th>
                          <th className="py-3 px-3 text-right">RSI (14)</th>
                          <th className="py-3 px-3">Tendência EMA</th>
                          <th className="py-3 px-3">Veredito IA</th>
                          <th className="py-3 px-5 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05] text-xs">
                        {state.watchlist.map((asset) => {
                          const snap = state.snapshots[asset.id];
                          const analysis = state.analyses[asset.id];
                          return (
                            <tr key={asset.id} className="hover:bg-white/[0.02]">
                              <td className="py-3.5 px-5">
                                <div className="font-mono font-bold text-slate-100">
                                  {asset.symbol}
                                </div>
                                <div className="text-slate-400">{asset.name}</div>
                              </td>
                              <td className="py-3.5 px-3 text-right font-mono font-semibold text-slate-100 tabular-nums whitespace-nowrap">
                                {snap
                                  ? formatPrice(
                                      snap.priceUsd,
                                      state.settings.currency,
                                      state.usdBrlRate
                                    )
                                  : '—'}
                              </td>
                              <td className="py-3.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                <div
                                  className={
                                    (snap?.change24hPct ?? 0) >= 0
                                      ? 'text-emerald-400'
                                      : 'text-rose-400'
                                  }
                                >
                                  {snap ? formatPercent(snap.change24hPct) : '—'}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {snap ? formatPercent(snap.change7dPct) : '—'}
                                </div>
                              </td>
                              <td className="py-3.5 px-3 text-right font-mono text-slate-300 tabular-nums whitespace-nowrap">
                                {snap
                                  ? formatCompactVolume(
                                      snap.volume24hUsd,
                                      state.settings.currency,
                                      state.usdBrlRate
                                    )
                                  : '—'}
                              </td>
                              <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                                {snap ? snap.indicators.rsi14.toFixed(1) : '—'}
                              </td>
                              <td className="py-3.5 px-3 capitalize text-slate-300">
                                {snap?.indicators.emaTrend ?? '—'}
                              </td>
                              <td className="py-3.5 px-3">
                                <SignalBadge action={analysis?.action} compact />
                              </td>
                              <td className="py-3.5 px-5 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedCoinId(asset.id);
                                      setActiveTab('painel');
                                    }}
                                    className="px-2.5 py-1 rounded border border-white/10 hover:bg-slate-800 text-slate-200 transition-colors"
                                  >
                                    Detalhes
                                  </button>
                                  <button
                                    type="button"
                                    disabled={state.isStudying}
                                    onClick={() => handleRunStudy(asset.id)}
                                    className="px-2.5 py-1 rounded bg-sky-600/20 border border-sky-500/30 hover:bg-sky-600/30 text-sky-300 transition-colors disabled:opacity-50"
                                  >
                                    Estudar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveAsset(asset.id)}
                                    title={`Excluir ${asset.symbol}`}
                                    aria-label={`Excluir ${asset.symbol}`}
                                    className="p-1.5 rounded border border-white/10 text-slate-400 hover:text-rose-400 hover:border-rose-500/30 transition-colors"
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
                  )}
                </div>
              </section>
            )}

            {/* VIEW 3: AUTOESTUDO & MEMÓRIA DA IA */}
            {activeTab === 'autoestudo' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-7 rounded-xl border border-white/[0.08] bg-[#111827] overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-slate-100">
                        Histórico de estudos autônomos
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        A cada ciclo, a IA compara previsões anteriores com o preço real antes de emitir novos pareceres.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {state.studyHistory.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void handleClearStudyHistory()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition-colors whitespace-nowrap"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Limpar histórico
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={state.isStudying || state.watchlist.length === 0}
                        onClick={() => handleRunStudy()}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 whitespace-nowrap"
                      >
                        Executar ciclo
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-white/[0.06]">
                    {state.studyHistory.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400">
                        Nenhum ciclo registrado até o momento. Adicione ativos e clique em &quot;Executar ciclo&quot; para iniciar.
                      </div>
                    ) : (
                      state.studyHistory.map((cycle) => (
                        <div key={cycle.id} className="p-5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2 font-mono text-slate-300 tabular-nums">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>
                                {new Date(cycle.completedAt).toLocaleString('pt-BR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="capitalize">
                                Gatilho: {cycle.trigger.replace('_', ' ')}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono text-slate-400 tabular-nums">
                                {cycle.buySignals} compra · {cycle.sellSignals} venda ·{' '}
                                {cycle.holdSignals} espera
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleDeleteStudyCycle(cycle.id)}
                                title="Excluir registro de ciclo"
                                aria-label="Excluir registro de ciclo"
                                className="p-1 rounded text-slate-500 hover:text-rose-400 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            {cycle.marketSummary}
                          </p>
                          <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono tabular-nums">
                            <span>{cycle.assetsStudied} ativos analisados</span>
                            <span aria-hidden="true">·</span>
                            <span>{cycle.alertsEmitted} novos alertas emitidos</span>
                            {cycle.evaluatedAccuracyPct !== null && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-400">
                                  Acerto acumulado: {cycle.evaluatedAccuracyPct}%
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="lg:col-span-5">
                  <AutomationSettingsPanel
                    settings={state.settings}
                    soundEnabled={soundEnabled}
                    onToggleSound={() => setSoundEnabled((v) => !v)}
                    onUpdateSettings={handleUpdateSettings}
                  />
                </div>
              </div>
            )}

            {/* VIEW 4: CENTRAL DE ALERTAS & GATILHOS WHATSAPP 24H */}
            {activeTab === 'alertas' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1 rounded-lg bg-[#111827] p-1 border border-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => setAlertsSubTab('triggers')}
                      className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        alertsSubTab === 'triggers'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Gatilhos WhatsApp 24h ({(state.triggers ?? []).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setAlertsSubTab('alerts')}
                      className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        alertsSubTab === 'alerts'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Histórico de Alertas ({state.alerts.length})
                    </button>
                  </div>

                  <div className="flex items-center gap-1 rounded-lg bg-[#111827] p-1 border border-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => setRightSettingsTab('whatsapp')}
                      className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        rightSettingsTab === 'whatsapp'
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Configurar WhatsApp 24h
                    </button>
                    <button
                      type="button"
                      onClick={() => setRightSettingsTab('automacao')}
                      className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        rightSettingsTab === 'automacao'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Automação IA & Webhook
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  <div className="lg:col-span-7">
                    {alertsSubTab === 'triggers' ? (
                      <TriggersPanel
                        triggers={state.triggers ?? []}
                        snapshots={state.snapshots}
                        currency={state.settings.currency}
                        usdBrlRate={state.usdBrlRate}
                        whatsappEnabled={Boolean(state.settings.whatsapp?.enabled)}
                        onOpenNewTrigger={() => openTriggerModal()}
                        onToggleTrigger={handleToggleTrigger}
                        onResetReference={handleResetTriggerRef}
                        onDeleteTrigger={handleDeleteTrigger}
                        onClearTriggers={handleClearTriggers}
                      />
                    ) : (
                      <div className="rounded-xl border border-white/[0.08] bg-[#111827] overflow-hidden">
                        <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h2 className="text-base font-semibold text-slate-100">
                              Registro completo de sugestões ({state.alerts.length})
                            </h2>
                            <p className="text-xs text-slate-400 mt-0.5">
                              Acompanhamento de retorno real desde o momento em que cada sugestão ou gatilho foi disparado.
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {counts.unread > 0 && (
                              <button
                                type="button"
                                onClick={handleMarkAlertsRead}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 hover:bg-slate-800 text-slate-200 whitespace-nowrap"
                              >
                                Marcar todas como lidas
                              </button>
                            )}
                            {state.alerts.length > 0 && (
                              <button
                                type="button"
                                onClick={() => void handleClearAlerts()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition-colors whitespace-nowrap"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Limpar histórico
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="divide-y divide-white/[0.06]">
                          {state.alerts.length === 0 ? (
                            <div className="p-8 text-center text-xs text-slate-400">
                              Sem alertas registrados ainda.
                            </div>
                          ) : (
                            state.alerts.map((alert) => (
                              <div key={alert.id} className="p-5 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2.5">
                                    <span className="font-mono font-bold text-sm text-slate-100">
                                      {alert.symbol}
                                    </span>
                                    <span className="text-xs text-slate-400">{alert.name}</span>
                                    <SignalBadge action={alert.action} compact />
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs font-mono text-slate-500 tabular-nums">
                                      {new Date(alert.createdAt).toLocaleString('pt-BR', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteAlert(alert.id)}
                                      title="Excluir alerta"
                                      aria-label="Excluir alerta"
                                      className="p-1 rounded text-slate-500 hover:text-rose-400 transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                <p className="text-sm font-medium text-slate-200">
                                  {alert.headline}
                                </p>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                  {alert.reason}
                                </p>

                                <div className="pt-1 flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-slate-400">
                                  <span>
                                    Sinal em{' '}
                                    {formatPrice(
                                      alert.priceAtSignalUsd,
                                      state.settings.currency,
                                      state.usdBrlRate
                                    )}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    Alvo{' '}
                                    {formatPrice(
                                      alert.targetPriceUsd,
                                      state.settings.currency,
                                      state.usdBrlRate
                                    )}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>Confiança {alert.confidence}%</span>
                                  <span aria-hidden="true">·</span>
                                  {renderOutcomeText(alert)}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="lg:col-span-5">
                    {rightSettingsTab === 'whatsapp' ? (
                      <WhatsAppSettingsPanel
                        whatsapp={state.settings.whatsapp}
                        onUpdateSettings={handleUpdateSettings}
                      />
                    ) : (
                      <AutomationSettingsPanel
                        settings={state.settings}
                        soundEnabled={soundEnabled}
                        onToggleSound={() => setSoundEnabled((v) => !v)}
                        onUpdateSettings={handleUpdateSettings}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : null}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-white/[0.06] py-5 px-4 sm:px-6">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>
            SinalCripto IA — Análises geradas por inteligência artificial com dados de mercado em tempo real para fins informativos e educacionais. Não constitui recomendação financeira oficial.
          </span>
          {state && (
            <span className="font-mono tabular-nums">
              USD/BRL R$ {state.usdBrlRate.toFixed(2)}
            </span>
          )}
        </div>
      </footer>

      <AddAssetModal
        open={addModalOpen}
        existingIds={existingIds}
        onClose={() => setAddModalOpen(false)}
        onAdd={handleAddAsset}
      />

      {state && (
        <AddTransactionModal
          open={txModalOpen}
          watchlist={state.watchlist}
          snapshots={state.snapshots}
          currency={state.settings.currency}
          usdBrlRate={state.usdBrlRate}
          preselectedCoinId={txPreselectedCoinId}
          onClose={() => setTxModalOpen(false)}
          onSubmit={handleAddTransaction}
        />
      )}

      {state && (
        <AddTriggerModal
          open={triggerModalOpen}
          watchlist={state.watchlist}
          snapshots={state.snapshots}
          currency={state.settings.currency}
          usdBrlRate={state.usdBrlRate}
          whatsappEnabled={Boolean(state.settings.whatsapp?.enabled)}
          preselectedCoinId={triggerPreselectedCoinId}
          onClose={() => setTriggerModalOpen(false)}
          onSubmit={handleCreateTrigger}
        />
      )}
    </div>
  );
}
