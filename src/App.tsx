import {
  Activity,
  Bell,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cloud,
  CloudCheck,
  Coins,
  Copy,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Sun,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from './hooks/useTheme.ts';
import { AddAssetModal } from './components/AddAssetModal.tsx';
import { AddTransactionModal } from './components/AddTransactionModal.tsx';
import { AddTriggerModal } from './components/AddTriggerModal.tsx';
import { AssetDetailPanel } from './components/AssetDetailPanel.tsx';
import { AutomationSettingsPanel } from './components/AutomationSettingsPanel.tsx';
import { CryptoLogo } from './components/CryptoLogo.tsx';
import { GitHubActionsPythonPanel } from './components/GitHubActionsPythonPanel.tsx';
import { MonitorView } from './components/MonitorView.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { PortfolioView } from './components/PortfolioView.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import { SignalBadge } from './components/SignalBadge.tsx';
import { Sparkline } from './components/Sparkline.tsx';
import { TelegramSettingsPanel } from './components/TelegramSettingsPanel.tsx';
import { TriggersPanel } from './components/TriggersPanel.tsx';
import { WhatsAppSettingsPanel } from './components/WhatsAppSettingsPanel.tsx';
import { protectStoredAnalyses } from './utils/verdictPolicy.ts';
import {
  auth,
  firebaseAuthDomainsSettingsUrl,
  firebaseProjectId,
  formatFriendlyFirestoreError,
  isUnauthorizedDomainError,
  onAuthStateChanged,
  signInWithGoogle,
  signOutCloud,
  type User,
} from './firebase.ts';
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
  apiDispatchTelegram,
  apiDispatchWhatsApp,
  apiFetchSnapshotsForAssets,
  apiGetCoinPrice,
  apiGetState,
  apiGetUsdBrlRate,
  apiMarkAlertsRead,
  apiRemoveWatchlist,
  apiRenamePortfolio,
  apiRunCloudStudy,
  apiRunStudy,
  apiSyncServer24h,
  apiUpdateSettings,
  apiUpdateTransaction,
  apiUpdateTrigger,
  computePortfolioSummaryFromData,
  evaluateCloudAlertsAndTriggers,
  getAccuracyStatsFromAlerts,
  getBackendMode,
} from './services/apiClient.ts';
import {
  cloudAddTransaction,
  cloudAddWatchlistAsset,
  cloudClearAlerts,
  cloudClearStudyHistory,
  cloudClearTriggers,
  cloudCreateTrigger,
  cloudDeleteAlert,
  cloudDeleteStudyCycle,
  cloudDeleteTransaction,
  cloudDeleteTransactionsBatch,
  cloudDeleteTrigger,
  cloudMarkAlertsRead,
  cloudRemoveWatchlistAsset,
  cloudRenamePortfolio,
  cloudSaveAlertsAndTriggerUpdates,
  cloudSaveStudyResults,
  cloudUpdateSettings,
  cloudUpdateTransaction,
  cloudUpdateTrigger,
  ensureUserCloudProfile,
  sanitizeSettings,
  subscribeUserCloudWorkspace,
  type CloudWorkspaceData,
} from './services/firebaseSync.ts';
import type {
  AppSettings,
  AppStatePayload,
  MarketSnapshot,
  PortfolioTransaction,
  PriceTrigger,
  SignalAction,
  SignalAlert,
  TransactionType,
  TriggerActionHint,
  TriggerConditionType,
  TriggerRepeatMode,
  WatchlistAsset,
} from './types/crypto.ts';
import {
  formatCompactVolume,
  formatPercent,
  formatPrice,
  formatRelativeTime,
  formatTimeClock,
} from './utils/format.ts';
import { playAlertChime, sendBrowserNotification } from './utils/notify.ts';

type NavTab = 'painel' | 'monitor' | 'carteira' | 'ativos' | 'autoestudo' | 'alertas';

const VALID_NAV_TABS: readonly NavTab[] = [
  'painel',
  'monitor',
  'carteira',
  'ativos',
  'autoestudo',
  'alertas',
];
const ACTIVE_TAB_STORAGE_KEY = 'sinalcripto_active_tab_v1';
const ALERTS_SUBTAB_STORAGE_KEY = 'sinalcripto_alerts_subtab_v1';
const RIGHT_SETTINGS_SUBTAB_STORAGE_KEY = 'sinalcripto_right_settings_subtab_v1';
const SELECTED_COIN_STORAGE_KEY = 'sinalcripto_selected_coin_v1';

function isValidNavTab(val: string | null | undefined): val is NavTab {
  return typeof val === 'string' && (VALID_NAV_TABS as readonly string[]).includes(val);
}

function getInitialNavTab(): NavTab {
  if (typeof window === 'undefined') return 'painel';
  const hashTab = window.location.hash.replace(/^#/, '').trim();
  if (isValidNavTab(hashTab)) return hashTab;
  try {
    const sTab = sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (isValidNavTab(sTab)) return sTab;
    const lTab = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (isValidNavTab(lTab)) return lTab;
  } catch {
    // ignore storage errors
  }
  return 'painel';
}

function getInitialStorageChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const sVal = sessionStorage.getItem(key);
    if (sVal && (allowed as readonly string[]).includes(sVal)) return sVal as T;
    const lVal = localStorage.getItem(key);
    if (lVal && (allowed as readonly string[]).includes(lVal)) return lVal as T;
  } catch {
    // ignore storage errors
  }
  return fallback;
}

function getInitialSelectedCoinId(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (
      sessionStorage.getItem(SELECTED_COIN_STORAGE_KEY) ||
      localStorage.getItem(SELECTED_COIN_STORAGE_KEY) ||
      ''
    );
  } catch {
    return '';
  }
}

export default function App() {
  const { isDark, toggleTheme } = useTheme();
  const [localState, setLocalState] = useState<AppStatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Firebase Auth & Real-Time Multi-Device Cloud Sync
  const [authReady, setAuthReady] = useState(false);
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudMenuOpen, setCloudMenuOpen] = useState(false);
  const [unauthorizedDomain, setUnauthorizedDomain] = useState<string | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [cloudData, setCloudData] = useState<CloudWorkspaceData | null>(null);
  const [cloudSnapshots, setCloudSnapshots] = useState<Record<string, MarketSnapshot>>({});
  const [cloudUsdBrlRate, setCloudUsdBrlRate] = useState<number>(5.75);
  const [cloudIsStudying, setCloudIsStudying] = useState(false);
  const [cloudNextStudyAt, setCloudNextStudyAt] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>(getInitialNavTab);
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [selectedCoinId, setSelectedCoinId] = useState<string>(getInitialSelectedCoinId);
  const [signalFilter, setSignalFilter] = useState<'TODOS' | SignalAction>('TODOS');
  const [tableSearch, setTableSearch] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<PortfolioTransaction | null>(null);
  const [txPreselectedCoinId, setTxPreselectedCoinId] = useState<string | null>(null);
  const [txPreselectedType, setTxPreselectedType] = useState<TransactionType>('compra');
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [triggerPreselectedCoinId, setTriggerPreselectedCoinId] = useState<string | null>(null);
  const [alertsSubTab, setAlertsSubTab] = useState<'triggers' | 'alerts'>(() =>
    getInitialStorageChoice(ALERTS_SUBTAB_STORAGE_KEY, ['triggers', 'alerts'], 'triggers')
  );
  const [rightSettingsTab, setRightSettingsTab] = useState<
    'whatsapp' | 'telegram' | 'automacao' | 'python24h'
  >(() =>
    getInitialStorageChoice(
      RIGHT_SETTINGS_SUBTAB_STORAGE_KEY,
      ['whatsapp', 'telegram', 'automacao', 'python24h'],
      'telegram'
    )
  );
  const [studyStatusMsg, setStudyStatusMsg] = useState<string | null>(null);
  const [liveBannerAlerts, setLiveBannerAlerts] = useState<SignalAlert[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [countdownLabel, setCountdownLabel] = useState<string>('');
  const [streamConnected, setStreamConnected] = useState(false);
  const [lastMarketUpdateAt, setLastMarketUpdateAt] = useState<number>(() => Date.now());
  const [lastUsdBrlUpdateAt, setLastUsdBrlUpdateAt] = useState<number>(() => Date.now());
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const cloudMenuRef = useRef<HTMLDivElement | null>(null);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const localStateRef = useRef<AppStatePayload | null>(null);
  const cloudDataRef = useRef<CloudWorkspaceData | null>(null);
  const cloudSnapshotsRef = useRef<Record<string, MarketSnapshot>>({});
  const cloudUsdBrlRef = useRef<number>(5.94);
  const settingsRef = useRef<AppSettings | null>(null);
  const usdBrlRef = useRef<number>(5.94);
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  const lastMarketTickAtRef = useRef<number>(0);
  const triggerDispatchLockRef = useRef<Map<string, number>>(new Map());

  const state: AppStatePayload | null = useMemo(() => {
    if (cloudUser && cloudData) {
      const portfolio = computePortfolioSummaryFromData(
        cloudData.portfolioName,
        cloudData.transactions,
        cloudSnapshots
      );
      return {
        watchlist: cloudData.watchlist,
        snapshots: cloudSnapshots,
        analyses: cloudData.analyses,
        alerts: cloudData.alerts,
        triggers: cloudData.triggers,
        studyHistory: cloudData.studyHistory,
        settings: cloudData.settings,
        portfolio,
        usdBrlRate: cloudUsdBrlRate,
        isStudying: cloudIsStudying,
        nextStudyAt: cloudNextStudyAt,
        accuracyStats: getAccuracyStatsFromAlerts(cloudData.alerts),
      };
    }
    return localState;
  }, [
    cloudUser,
    cloudData,
    cloudSnapshots,
    cloudUsdBrlRate,
    cloudIsStudying,
    cloudNextStudyAt,
    localState,
  ]);

  useEffect(() => {
    localStateRef.current = localState;
  }, [localState]);

  useEffect(() => {
    cloudDataRef.current = cloudData;
  }, [cloudData]);

  useEffect(() => {
    cloudSnapshotsRef.current = cloudSnapshots;
  }, [cloudSnapshots]);

  useEffect(() => {
    cloudUsdBrlRef.current = cloudUsdBrlRate;
  }, [cloudUsdBrlRate]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    if (state) {
      settingsRef.current = state.settings;
      usdBrlRef.current = state.usdBrlRate;
    }
  }, [state]);

  useEffect(() => {
    if (!cloudMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (cloudMenuRef.current && !cloudMenuRef.current.contains(event.target as Node)) {
        setCloudMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCloudMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [cloudMenuOpen]);

  useEffect(() => {
    if (!navMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (navMenuRef.current && !navMenuRef.current.contains(event.target as Node)) {
        setNavMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [navMenuOpen]);

  // Persist active tab, subtabs, and selected coin across browser reloads / pull-to-refresh
  useEffect(() => {
    try {
      sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch {
      // ignore storage errors
    }
    const targetHash = `#${activeTab}`;
    if (window.location.hash !== targetHash) {
      window.history.replaceState(null, '', targetHash);
    }
  }, [activeTab]);

  useEffect(() => {
    const handleHashChange = () => {
      const hashTab = window.location.hash.replace(/^#/, '').trim();
      if (isValidNavTab(hashTab)) {
        setActiveTab(hashTab);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(ALERTS_SUBTAB_STORAGE_KEY, alertsSubTab);
      localStorage.setItem(ALERTS_SUBTAB_STORAGE_KEY, alertsSubTab);
    } catch {
      // ignore storage errors
    }
  }, [alertsSubTab]);

  useEffect(() => {
    try {
      sessionStorage.setItem(RIGHT_SETTINGS_SUBTAB_STORAGE_KEY, rightSettingsTab);
      localStorage.setItem(RIGHT_SETTINGS_SUBTAB_STORAGE_KEY, rightSettingsTab);
    } catch {
      // ignore storage errors
    }
  }, [rightSettingsTab]);

  useEffect(() => {
    if (!selectedCoinId) return;
    try {
      sessionStorage.setItem(SELECTED_COIN_STORAGE_KEY, selectedCoinId);
      localStorage.setItem(SELECTED_COIN_STORAGE_KEY, selectedCoinId);
    } catch {
      // ignore storage errors
    }
  }, [selectedCoinId]);

  // Helper to collect union of watchlist, portfolio & trigger assets
  const buildTrackedAssetList = useCallback((workspace: CloudWorkspaceData): WatchlistAsset[] => {
    const map = new Map<string, WatchlistAsset>();
    for (const w of workspace.watchlist) map.set(w.id, w);
    for (const tx of workspace.transactions) {
      if (!map.has(tx.coinId)) {
        map.set(tx.coinId, {
          id: tx.coinId,
          symbol: tx.symbol.toUpperCase(),
          name: tx.name,
          binanceSymbol: `${tx.symbol.toUpperCase()}USDT`,
          addedAt: tx.timestamp,
        });
      }
    }
    for (const trig of workspace.triggers) {
      if (!map.has(trig.coinId)) {
        map.set(trig.coinId, {
          id: trig.coinId,
          symbol: trig.symbol.toUpperCase(),
          name: trig.name,
          binanceSymbol: `${trig.symbol.toUpperCase()}USDT`,
          addedAt: trig.createdAt,
        });
      }
    }
    return Array.from(map.values());
  }, []);

  // Listen to Firebase Auth state changes
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUnauthorizedDomain(null);
        try {
          await ensureUserCloudProfile(user.uid, localStateRef.current);
          setCloudUser(user);
        } catch (err) {
          setError(formatFriendlyFirestoreError(err));
          setCloudUser(user);
        } finally {
          setAuthReady(true);
        }
      } else {
        setCloudUser(null);
        setCloudData(null);
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  // Attach Firestore real-time workspace listeners ONLY when authReady && cloudUser
  useEffect(() => {
    if (!authReady || !cloudUser) return;

    const unsub = subscribeUserCloudWorkspace(
      cloudUser.uid,
      (workspace) => {
        setCloudData(workspace);
        setSelectedCoinId((prev) => {
          if (workspace.watchlist.length === 0) return '';
          return !workspace.watchlist.some((w) => w.id === prev)
            ? workspace.watchlist[0].id
            : prev;
        });
      },
      (err) => {
        setError(formatFriendlyFirestoreError(err));
      }
    );

    return () => unsub();
  }, [authReady, cloudUser]);

  // Schedule next automatic study time when in Cloud Mode
  useEffect(() => {
    if (!cloudUser || !cloudData) {
      setCloudNextStudyAt(null);
      return;
    }
    if (!cloudData.settings.autoStudyEnabled) {
      setCloudNextStudyAt(null);
      return;
    }
    setCloudNextStudyAt((prev) => {
      if (prev && new Date(prev).getTime() > Date.now()) return prev;
      return new Date(
        Date.now() + Math.max(1, cloudData.settings.intervalMinutes) * 60_000
      ).toISOString();
    });
  }, [
    cloudUser,
    cloudData?.settings.autoStudyEnabled,
    cloudData?.settings.intervalMinutes,
  ]);

  const fetchInitialState = useCallback(async () => {
    try {
      const data = await apiGetState(true);
      const nowTs = Date.now();
      lastMarketTickAtRef.current = nowTs;
      setLastMarketUpdateAt(nowTs);
      setLastUsdBrlUpdateAt(nowTs);
      setLocalState(data);
      if (Number.isFinite(data.usdBrlRate) && data.usdBrlRate > 1) {
        setCloudUsdBrlRate(data.usdBrlRate);
      }
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

  // Real-time SSE connection when backend server is active (when not overridden by Cloud Sync)
  useEffect(() => {
    if (loading || cloudUser) return;
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
        const nowTs = Date.now();
        lastMarketTickAtRef.current = nowTs;
        setLastMarketUpdateAt(nowTs);
        setLastUsdBrlUpdateAt(nowTs);
        setStreamConnected(true);
        setLocalState((prev) =>
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
        setLocalState((prev) =>
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
        setLocalState((prev) =>
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
        setLocalState(data.state);
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
  }, [loading, cloudUser]);

  // Cloud-mode live 10-second market price & trigger evaluation loop across all devices
  const cloudAssetSignature = useMemo(() => {
    if (!cloudData) return '';
    return buildTrackedAssetList(cloudData)
      .map((a) => a.id)
      .sort()
      .join(',');
  }, [cloudData, buildTrackedAssetList]);

  const refreshCloudMarketTick = useCallback(async () => {
    const uid = cloudUser?.uid;
    const workspace = cloudDataRef.current;
    if (!uid || !workspace) return;

    const trackedAssets = buildTrackedAssetList(workspace);
    try {
      void apiSyncServer24h({
        watchlist: workspace.watchlist,
        priceTriggers: workspace.triggers,
        settings: workspace.settings,
      });

      if (trackedAssets.length === 0) {
        const liveUsdBrl = await apiGetUsdBrlRate(true);
        const nowTs = Date.now();
        lastMarketTickAtRef.current = nowTs;
        setLastMarketUpdateAt(nowTs);
        setLastUsdBrlUpdateAt(nowTs);
        setCloudUsdBrlRate(liveUsdBrl);
        setStreamConnected(true);
        return;
      }

      const { snapshots, usdBrlRate } = await apiFetchSnapshotsForAssets(trackedAssets, true);
      const nowTs = Date.now();
      lastMarketTickAtRef.current = nowTs;
      setLastMarketUpdateAt(nowTs);
      setLastUsdBrlUpdateAt(nowTs);
      setCloudSnapshots(snapshots);
      setCloudUsdBrlRate(usdBrlRate);
      setStreamConnected(true);

      const evaluated = evaluateCloudAlertsAndTriggers({
        alerts: workspace.alerts,
        triggers: workspace.triggers,
        settings: workspace.settings,
        snapshots,
        usdBrlRate,
      });

      const finalTriggers = [...evaluated.updatedTriggers];
      const nowLock = Date.now();
      const channelOutcomeByTrig = new Map<
        string,
        { sent: string[]; errors: string[] }
      >();

      for (const pending of evaluated.pendingWhatsApps) {
        const lockKey = `${pending.triggerId}:wa`;
        const prevLock = triggerDispatchLockRef.current.get(lockKey) ?? 0;
        if (nowLock - prevLock < 20_000) continue;
        triggerDispatchLockRef.current.set(lockKey, nowLock);

        const delivery = await apiDispatchWhatsApp(
          workspace.settings.whatsapp,
          pending.text,
          pending.metadata
        );
        const rec = channelOutcomeByTrig.get(pending.triggerId) ?? { sent: [], errors: [] };
        if (delivery.ok) rec.sent.push('WhatsApp');
        else rec.errors.push(`WhatsApp: ${delivery.error || 'Falha'}`);
        channelOutcomeByTrig.set(pending.triggerId, rec);
      }

      for (const pending of evaluated.pendingTelegrams) {
        if (!workspace.settings.telegram) continue;
        const lockKey = `${pending.triggerId}:tg`;
        const prevLock = triggerDispatchLockRef.current.get(lockKey) ?? 0;
        if (nowLock - prevLock < 20_000) continue;
        triggerDispatchLockRef.current.set(lockKey, nowLock);

        const delivery = await apiDispatchTelegram(
          workspace.settings.telegram,
          pending.text
        );
        const rec = channelOutcomeByTrig.get(pending.triggerId) ?? { sent: [], errors: [] };
        if (delivery.ok) rec.sent.push('Telegram');
        else rec.errors.push(`Telegram: ${delivery.error || 'Falha'}`);
        channelOutcomeByTrig.set(pending.triggerId, rec);
      }

      for (const [trigId, rec] of channelOutcomeByTrig.entries()) {
        const match = finalTriggers.find((t) => t.id === trigId);
        if (!match) continue;
        if (rec.sent.length > 0) {
          match.lastDeliveryStatus = 'enviado';
          match.lastDeliveryError =
            rec.errors.length > 0
              ? `${rec.sent.join(' + ')} enviado (${rec.errors.join('; ')})`
              : `Enviado via ${rec.sent.join(' e ')}`;
        } else if (rec.errors.length > 0) {
          match.lastDeliveryStatus = 'falha';
          match.lastDeliveryError = rec.errors.join(' | ');
        }
      }

      if (
        finalTriggers.length > 0 ||
        evaluated.newAlerts.length > 0 ||
        evaluated.evaluatedAlerts.length > 0
      ) {
        await cloudSaveAlertsAndTriggerUpdates(
          uid,
          finalTriggers,
          evaluated.newAlerts,
          evaluated.evaluatedAlerts
        );
        if (evaluated.newAlerts.length > 0) {
          setLiveBannerAlerts((prev) => [...evaluated.newAlerts, ...prev].slice(0, 3));
          const first = evaluated.newAlerts[0];
          if (soundEnabledRef.current && first) {
            playAlertChime(first.action);
          }
          if (first) {
            sendBrowserNotification(first, workspace.settings.currency, usdBrlRate);
          }
        }
      }
    } catch {
      // silent retry on next 10s cycle
    }
  }, [cloudUser?.uid, buildTrackedAssetList]);

  useEffect(() => {
    if (!cloudUser || !cloudData) return;
    void refreshCloudMarketTick();
  }, [cloudUser?.uid, cloudAssetSignature, Boolean(cloudData), refreshCloudMarketTick]);

  const handleManualMarketRefresh = useCallback(async () => {
    setManualRefreshing(true);
    try {
      if (cloudUser && cloudDataRef.current) {
        await refreshCloudMarketTick();
      } else {
        const fresh = await apiGetState(true);
        const nowTs = Date.now();
        lastMarketTickAtRef.current = nowTs;
        setLastMarketUpdateAt(nowTs);
        setLastUsdBrlUpdateAt(nowTs);
        setStreamConnected(true);
        setLocalState((prev) =>
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
      }
    } catch {
      // silent retry on next 5s tick
    } finally {
      setManualRefreshing(false);
    }
  }, [cloudUser, refreshCloudMarketTick]);

  // Smooth touch Pull-to-Refresh: refreshes live quotes in place without leaving active tab
  useEffect(() => {
    let startY: number | null = null;
    let startX = 0;
    let pulled = 0;

    const hasScrolledAncestor = (target: EventTarget | null): boolean => {
      let el = target instanceof HTMLElement ? target : null;
      while (el && el !== document.body) {
        if (el.getAttribute('role') === 'dialog') return true;
        if (el.scrollTop > 0) return true;
        el = el.parentElement;
      }
      return false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (window.scrollY > 2 || hasScrolledAncestor(e.target)) {
        startY = null;
        return;
      }
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      pulled = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY === null || e.touches.length !== 1) return;
      if (window.scrollY > 2) {
        startY = null;
        pulled = 0;
        setPullDistance(0);
        return;
      }
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (dy > 14 && Math.abs(dy) > Math.abs(dx) * 1.4) {
        pulled = Math.min(84, Math.round((dy - 14) * 0.65));
        setPullDistance(pulled);
      } else if (dy <= 0) {
        pulled = 0;
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      if (pulled >= 56) {
        void handleManualMarketRefresh();
      }
      startY = null;
      pulled = 0;
      setPullDistance(0);
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [handleManualMarketRefresh]);

  // Guaranteed 5-second live price refresh for watchlist, monitor & portfolio (cloud + server backup + static mode)
  useEffect(() => {
    if (loading) return;
    const timer = setInterval(async () => {
      if (cloudUser && cloudDataRef.current) {
        await refreshCloudMarketTick();
        return;
      }

      const elapsed = Date.now() - lastMarketTickAtRef.current;
      // If SSE just delivered a fresh tick (< 4.5s), skip redundant poll
      if (getBackendMode() === 'server' && elapsed < 4_500) {
        return;
      }
      try {
        const fresh = await apiGetState(true);
        const nowTs = Date.now();
        lastMarketTickAtRef.current = nowTs;
        setLastMarketUpdateAt(nowTs);
        setLastUsdBrlUpdateAt(nowTs);
        setStreamConnected(true);
        setLocalState((prev) =>
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
        // silent retry on next 5s cycle
      }
    }, 5_000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        if (cloudUser && cloudDataRef.current) {
          void refreshCloudMarketTick();
        } else {
          void apiGetUsdBrlRate(true)
            .then((rate) => {
              if (Number.isFinite(rate) && rate > 1) {
                setLastUsdBrlUpdateAt(Date.now());
                setLocalState((prev) => (prev ? { ...prev, usdBrlRate: rate } : prev));
              }
            })
            .catch(() => {});
        }
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [loading, cloudUser, refreshCloudMarketTick]);

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
        (Boolean(cloudUser) || getBackendMode() === 'local') &&
        state.watchlist.length > 0 &&
        !state.isStudying
      ) {
        triggeredLocalCycle = true;
        void handleRunStudy(undefined, 'automatico').catch(() => {
          // retry on next schedule
        });
      }
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [
    state?.nextStudyAt,
    state?.settings.autoStudyEnabled,
    state?.watchlist.length,
    state?.isStudying,
    cloudUser,
  ]);

  async function handleGoogleSignIn() {
    setCloudMenuOpen(false);
    setAuthBusy(true);
    setError(null);
    setUnauthorizedDomain(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        if (isUnauthorizedDomainError(err)) {
          const detectedHost =
            typeof window !== 'undefined' && window.location.hostname
              ? window.location.hostname
              : '';
          setUnauthorizedDomain(detectedHost);
        }
        setError(formatFriendlyFirestoreError(err));
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleCopyDomain() {
    if (!unauthorizedDomain || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(unauthorizedDomain);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2500);
    } catch {
      // ignore clipboard errors on restricted contexts
    }
  }

  async function handleGoogleSignOut() {
    setCloudMenuOpen(false);
    setAuthBusy(true);
    try {
      await signOutCloud();
    } catch (err: any) {
      setError(err?.message || 'Erro ao sair da conta Google.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleRunStudy(
    coinId?: string,
    trigger: 'automatico' | 'manual' | 'novo_ativo' = 'manual'
  ) {
    setError(null);
    if (cloudUser && cloudDataRef.current) {
      const workspace = cloudDataRef.current;
      const targets = coinId
        ? workspace.watchlist.filter((w) => w.id === coinId)
        : workspace.watchlist;
      if (targets.length === 0) {
        setError('Nenhum ativo cadastrado para estudar.');
        return;
      }
      setCloudIsStudying(true);
      setStudyStatusMsg(`Estudando ${targets.length} ativo(s) e sincronizando na nuvem...`);
      try {
        const portfolioSummary = computePortfolioSummaryFromData(
          workspace.portfolioName,
          workspace.transactions,
          cloudSnapshotsRef.current
        );
        const result = await apiRunCloudStudy({
          assetsToStudy: targets,
          allTrackedAssets: buildTrackedAssetList(workspace),
          previousAnalyses: workspace.analyses,
          recentAlerts: workspace.alerts,
          portfolioSummary,
          settings: workspace.settings,
          accuracyStats: getAccuracyStatsFromAlerts(workspace.alerts),
          trigger,
        });

        setCloudSnapshots(result.snapshots);
        await cloudSaveStudyResults(
          cloudUser.uid,
          result.returnedAnalysesList,
          result.newAlerts,
          result.cycle
        );

        if (workspace.settings.autoStudyEnabled) {
          setCloudNextStudyAt(
            new Date(
              Date.now() + Math.max(1, workspace.settings.intervalMinutes) * 60_000
            ).toISOString()
          );
        }

        if (result.newAlerts && result.newAlerts.length > 0) {
          setLiveBannerAlerts(result.newAlerts.slice(0, 3));
          const actionable = result.newAlerts.find(
            (a) => a.action === 'COMPRAR' || a.action === 'VENDER'
          );
          const first = actionable ?? result.newAlerts[0];
          if (soundEnabledRef.current && first) {
            playAlertChime(first.action);
          }
          if (first) {
            sendBrowserNotification(first, workspace.settings.currency, cloudUsdBrlRef.current);
          }
        }
      } catch (err: any) {
        setError(formatFriendlyFirestoreError(err));
      } finally {
        setCloudIsStudying(false);
        setStudyStatusMsg(null);
      }
      return;
    }

    setLocalState((prev) => (prev ? { ...prev, isStudying: true } : prev));
    try {
      const json = await apiRunStudy(coinId);
      setLocalState(json.state);
      if (json.newAlerts && json.newAlerts.length > 0) {
        setLiveBannerAlerts(json.newAlerts.slice(0, 3));
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao executar estudo de IA.');
      setLocalState((prev) => (prev ? { ...prev, isStudying: false } : prev));
    }
  }

  async function handleAddAsset(coin: { id: string; symbol: string; name: string }) {
    if (cloudUser && cloudDataRef.current) {
      const workspace = cloudDataRef.current;
      if (workspace.watchlist.some((w) => w.id === coin.id)) {
        throw new Error(`${coin.symbol.toUpperCase()} já está na lista de monitoramento.`);
      }
      const newAsset: WatchlistAsset = {
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        binanceSymbol: `${coin.symbol.toUpperCase()}USDT`,
        addedAt: new Date().toISOString(),
      };
      await cloudAddWatchlistAsset(cloudUser.uid, newAsset);
      setSelectedCoinId(coin.id);

      void apiFetchSnapshotsForAssets([newAsset, ...buildTrackedAssetList(workspace)], true)
        .then(async ({ snapshots, usdBrlRate }) => {
          setCloudSnapshots((prev) => ({ ...prev, ...snapshots }));
          setCloudUsdBrlRate(usdBrlRate);
          try {
            const summary = computePortfolioSummaryFromData(
              workspace.portfolioName,
              workspace.transactions,
              { ...cloudSnapshotsRef.current, ...snapshots }
            );
            const res = await apiRunCloudStudy({
              assetsToStudy: [newAsset],
              allTrackedAssets: [newAsset, ...buildTrackedAssetList(workspace)],
              previousAnalyses: workspace.analyses,
              recentAlerts: workspace.alerts,
              portfolioSummary: summary,
              settings: workspace.settings,
              accuracyStats: getAccuracyStatsFromAlerts(workspace.alerts),
              trigger: 'novo_ativo',
            });
            await cloudSaveStudyResults(
              cloudUser.uid,
              res.returnedAnalysesList,
              res.newAlerts,
              res.cycle
            );
          } catch {
            // user can re-run manually anytime
          }
        })
        .catch(() => {});
      return;
    }

    const updatedState = await apiAddWatchlist(coin);
    setLocalState(updatedState);
    setSelectedCoinId(coin.id);
  }

  async function handleRemoveAsset(coinId: string) {
    try {
      if (cloudUser) {
        await cloudRemoveWatchlistAsset(cloudUser.uid, coinId);
        return;
      }
      const updatedState = await apiRemoveWatchlist(coinId);
      setLocalState(updatedState);
      if (updatedState.watchlist.length === 0) {
        setSelectedCoinId('');
      } else if (selectedCoinId === coinId) {
        setSelectedCoinId(updatedState.watchlist[0].id);
      }
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Não foi possível remover o ativo.'
      );
    }
  }

  async function handleUpdateSettings(patch: Partial<AppSettings>) {
    if (cloudUser && cloudDataRef.current) {
      const current = cloudDataRef.current.settings;
      const merged = sanitizeSettings({
        ...current,
        ...patch,
        whatsapp: patch.whatsapp
          ? { ...current.whatsapp, ...patch.whatsapp }
          : current.whatsapp,
        telegram: patch.telegram
          ? {
              ...(current.telegram ?? {
                enabled: false,
                botToken: '',
                chatId: '',
                forwardAiSignals: true,
              }),
              ...patch.telegram,
            }
          : current.telegram,
      });
      await cloudUpdateSettings(cloudUser.uid, merged);
      return;
    }

    const updatedState = await apiUpdateSettings(patch);
    setLocalState(updatedState);
  }

  async function handleMarkAlertsRead() {
    try {
      if (cloudUser && cloudDataRef.current) {
        const unreadIds = cloudDataRef.current.alerts
          .filter((a) => !a.read)
          .map((a) => a.id);
        await cloudMarkAlertsRead(cloudUser.uid, unreadIds);
        return;
      }
      await apiMarkAlertsRead();
      setLocalState((prev) =>
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
    if (cloudUser && cloudDataRef.current) {
      const workspace = cloudDataRef.current;
      const upperSym = payload.symbol.toUpperCase();
      const missingFromWatchlist = !workspace.watchlist.some((w) => w.id === payload.coinId);
      const autoAsset: WatchlistAsset | null = missingFromWatchlist
        ? {
            id: payload.coinId,
            symbol: upperSym,
            name: payload.name,
            binanceSymbol: `${upperSym}USDT`,
            addedAt: new Date().toISOString(),
          }
        : null;
      const tx: PortfolioTransaction = {
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        coinId: payload.coinId,
        symbol: upperSym,
        name: payload.name,
        type: payload.type,
        quantity: payload.quantity,
        pricePerCoinUsd: payload.pricePerCoinUsd,
        feeUsd: payload.feeUsd,
        timestamp: payload.timestamp,
        note: payload.note,
      };
      await cloudAddTransaction(cloudUser.uid, tx, autoAsset);

      const assetsToFetch = autoAsset
        ? [autoAsset, ...buildTrackedAssetList(workspace)]
        : buildTrackedAssetList(workspace);
      void apiFetchSnapshotsForAssets(assetsToFetch, true)
        .then(async ({ snapshots, usdBrlRate }) => {
          setCloudSnapshots((prev) => ({ ...prev, ...snapshots }));
          setCloudUsdBrlRate(usdBrlRate);
          if (autoAsset) {
            try {
              const updatedTxs = [tx, ...workspace.transactions];
              const summary = computePortfolioSummaryFromData(
                workspace.portfolioName,
                updatedTxs,
                { ...cloudSnapshotsRef.current, ...snapshots }
              );
              const res = await apiRunCloudStudy({
                assetsToStudy: [autoAsset],
                allTrackedAssets: assetsToFetch,
                previousAnalyses: workspace.analyses,
                recentAlerts: workspace.alerts,
                portfolioSummary: summary,
                settings: workspace.settings,
                accuracyStats: getAccuracyStatsFromAlerts(workspace.alerts),
                trigger: 'novo_ativo',
              });
              await cloudSaveStudyResults(
                cloudUser.uid,
                res.returnedAnalysesList,
                res.newAlerts,
                res.cycle
              );
            } catch {
              // background study optional
            }
          }
        })
        .catch(() => {});
      return;
    }

    const updatedState = await apiAddTransaction(payload);
    setLocalState(updatedState);
  }

  async function handleUpdateTransaction(
    txId: string,
    payload: {
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
  ) {
    if (cloudUser && cloudDataRef.current) {
      const workspace = cloudDataRef.current;
      const upperSym = payload.symbol.toUpperCase();
      const missingFromWatchlist = !workspace.watchlist.some((w) => w.id === payload.coinId);
      const autoAsset: WatchlistAsset | null = missingFromWatchlist
        ? {
            id: payload.coinId,
            symbol: upperSym,
            name: payload.name,
            binanceSymbol: `${upperSym}USDT`,
            addedAt: new Date().toISOString(),
          }
        : null;
      const updatedTx: PortfolioTransaction = {
        id: txId,
        coinId: payload.coinId,
        symbol: upperSym,
        name: payload.name,
        type: payload.type,
        quantity: payload.quantity,
        pricePerCoinUsd: payload.pricePerCoinUsd,
        feeUsd: payload.feeUsd,
        timestamp: payload.timestamp,
        note: payload.note,
      };
      await cloudUpdateTransaction(cloudUser.uid, updatedTx, autoAsset);

      const assetsToFetch = autoAsset
        ? [autoAsset, ...buildTrackedAssetList(workspace)]
        : buildTrackedAssetList(workspace);
      void apiFetchSnapshotsForAssets(assetsToFetch, true)
        .then(({ snapshots, usdBrlRate }) => {
          setCloudSnapshots((prev) => ({ ...prev, ...snapshots }));
          setCloudUsdBrlRate(usdBrlRate);
        })
        .catch(() => {});
      return;
    }

    const updatedState = await apiUpdateTransaction(txId, payload);
    setLocalState(updatedState);
  }

  async function handleDeleteTransaction(txId: string) {
    try {
      if (cloudUser) {
        await cloudDeleteTransaction(cloudUser.uid, txId);
        return;
      }
      const updatedState = await apiDeleteTransaction(txId);
      setLocalState(updatedState);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Falha ao excluir transação.'
      );
    }
  }

  async function handleDeletePortfolioCoin(coinId: string) {
    try {
      if (cloudUser && cloudDataRef.current) {
        const ids = cloudDataRef.current.transactions
          .filter((t) => t.coinId === coinId)
          .map((t) => t.id);
        await cloudDeleteTransactionsBatch(cloudUser.uid, ids);
        return;
      }
      const updatedState = await apiDeletePortfolioAsset(coinId);
      setLocalState(updatedState);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Falha ao excluir ativo e histórico da carteira.'
      );
    }
  }

  async function handleClearPortfolioTransactions() {
    try {
      if (cloudUser && cloudDataRef.current) {
        const ids = cloudDataRef.current.transactions.map((t) => t.id);
        await cloudDeleteTransactionsBatch(cloudUser.uid, ids);
        return;
      }
      const updatedState = await apiClearTransactions();
      setLocalState(updatedState);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Falha ao limpar histórico de transações.'
      );
    }
  }

  async function handleDeleteAlert(alertId: string) {
    try {
      if (cloudUser) {
        await cloudDeleteAlert(cloudUser.uid, alertId);
        setLiveBannerAlerts((prev) => prev.filter((a) => a.id !== alertId));
        return;
      }
      const updatedState = await apiDeleteAlert(alertId);
      setLocalState(updatedState);
      setLiveBannerAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Falha ao excluir alerta.'
      );
    }
  }

  async function handleClearAlerts() {
    try {
      if (cloudUser && cloudDataRef.current) {
        const ids = cloudDataRef.current.alerts.map((a) => a.id);
        await cloudClearAlerts(cloudUser.uid, ids);
        setLiveBannerAlerts([]);
        return;
      }
      const updatedState = await apiClearAlerts();
      setLocalState(updatedState);
      setLiveBannerAlerts([]);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Falha ao limpar histórico de alertas.'
      );
    }
  }

  async function handleDeleteStudyCycle(cycleId: string) {
    try {
      if (cloudUser) {
        await cloudDeleteStudyCycle(cloudUser.uid, cycleId);
        return;
      }
      const updatedState = await apiDeleteStudyCycle(cycleId);
      setLocalState(updatedState);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Falha ao excluir registro de estudo.'
      );
    }
  }

  async function handleClearStudyHistory() {
    try {
      if (cloudUser && cloudDataRef.current) {
        const ids = cloudDataRef.current.studyHistory.map((c) => c.id);
        await cloudClearStudyHistory(cloudUser.uid, ids);
        return;
      }
      const updatedState = await apiClearStudyHistory();
      setLocalState(updatedState);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Falha ao limpar histórico de estudos.'
      );
    }
  }

  async function handleRenamePortfolio(name: string) {
    try {
      if (cloudUser) {
        await cloudRenamePortfolio(cloudUser.uid, name);
        return;
      }
      const updatedState = await apiRenamePortfolio(name);
      setLocalState(updatedState);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Erro ao renomear carteira.'
      );
    }
  }

  function openTransactionModal(coinId?: string, txType: TransactionType = 'compra') {
    setEditingTransaction(null);
    setTxPreselectedCoinId(coinId ?? null);
    setTxPreselectedType(txType);
    setTxModalOpen(true);
  }

  function openEditTransactionModal(tx: PortfolioTransaction) {
    setEditingTransaction(tx);
    setTxPreselectedCoinId(tx.coinId);
    setTxPreselectedType(tx.type);
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
    sendTelegram?: boolean;
    note?: string;
  }) {
    if (cloudUser) {
      let refUsd = Number(payload.referencePriceUsd) || 0;
      if (refUsd <= 0) {
        const fetched = await apiGetCoinPrice(payload.coinId, payload.symbol);
        if (fetched && fetched > 0) refUsd = fetched;
      }
      const newTrig: PriceTrigger = {
        id: `trig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        coinId: payload.coinId,
        symbol: payload.symbol.toUpperCase(),
        name: payload.name,
        conditionType: payload.conditionType,
        targetValue: payload.targetValue,
        referencePriceUsd: refUsd,
        actionHint: payload.actionHint,
        repeatMode: payload.repeatMode,
        cooldownMinutes: payload.cooldownMinutes ?? 60,
        enabled: true,
        sendWhatsApp: payload.sendWhatsApp ?? true,
        sendTelegram: payload.sendTelegram ?? false,
        note: payload.note?.trim() || undefined,
        createdAt: new Date().toISOString(),
        triggerCount: 0,
      };
      await cloudCreateTrigger(cloudUser.uid, newTrig);
      return;
    }

    const updatedState = await apiCreateTrigger(payload);
    setLocalState(updatedState);
  }

  async function handleToggleTrigger(triggerId: string, enabled: boolean) {
    try {
      if (cloudUser) {
        await cloudUpdateTrigger(cloudUser.uid, triggerId, { enabled });
        return;
      }
      const updatedState = await apiUpdateTrigger(triggerId, { enabled });
      setLocalState(updatedState);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Erro ao atualizar gatilho.'
      );
    }
  }

  async function handleUpdateTriggerChannels(
    triggerId: string,
    patch: { sendWhatsApp?: boolean; sendTelegram?: boolean }
  ) {
    try {
      if (cloudUser) {
        await cloudUpdateTrigger(cloudUser.uid, triggerId, patch);
        return;
      }
      const updatedState = await apiUpdateTrigger(triggerId, patch);
      setLocalState(updatedState);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Erro ao atualizar canais do gatilho.'
      );
    }
  }

  async function handleResetTriggerRef(triggerId: string) {
    try {
      if (cloudUser && cloudDataRef.current) {
        const trig = cloudDataRef.current.triggers.find((t) => t.id === triggerId);
        if (!trig) return;
        const live = await apiGetCoinPrice(trig.coinId, trig.symbol);
        if (live && live > 0) {
          await cloudUpdateTrigger(cloudUser.uid, triggerId, {
            referencePriceUsd: live,
          });
        }
        return;
      }
      const updatedState = await apiUpdateTrigger(triggerId, { resetReference: true });
      setLocalState(updatedState);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Erro ao atualizar preço base do gatilho.'
      );
    }
  }

  async function handleDeleteTrigger(triggerId: string) {
    try {
      if (cloudUser) {
        await cloudDeleteTrigger(cloudUser.uid, triggerId);
        return;
      }
      const updatedState = await apiDeleteTrigger(triggerId);
      setLocalState(updatedState);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Erro ao excluir gatilho.'
      );
    }
  }

  async function handleClearTriggers() {
    try {
      if (cloudUser && cloudDataRef.current) {
        const ids = cloudDataRef.current.triggers.map((t) => t.id);
        await cloudClearTriggers(cloudUser.uid, ids);
        return;
      }
      const updatedState = await apiClearTriggers();
      setLocalState(updatedState);
    } catch (err: any) {
      setError(
        cloudUser
          ? formatFriendlyFirestoreError(err)
          : err?.message || 'Erro ao limpar gatilhos.'
      );
    }
  }

  const protectedAnalyses = useMemo(() => {
    if (!state) return {};
    return protectStoredAnalyses(
      state.analyses,
      state.snapshots,
      state.portfolio.holdings
    );
  }, [state]);

  const filteredAssets = useMemo(() => {
    if (!state) return [];
    const q = tableSearch.trim().toLowerCase();
    return state.watchlist.filter((asset) => {
      const analysis = protectedAnalyses[asset.id];
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
  }, [state, protectedAnalyses, signalFilter, tableSearch]);

  const counts = useMemo(() => {
    if (!state) return { buy: 0, sell: 0, hold: 0, unread: 0 };
    let buy = 0;
    let sell = 0;
    let hold = 0;
    for (const asset of state.watchlist) {
      const a = protectedAnalyses[asset.id];
      if (a?.action === 'COMPRAR') buy++;
      else if (a?.action === 'VENDER') sell++;
      else if (a?.action === 'ESPERAR') hold++;
    }
    const unread = state.alerts.filter((al) => !al.read).length;
    return { buy, sell, hold, unread };
  }, [state, protectedAnalyses]);

  const selectedAsset =
    state?.watchlist.find((a) => a.id === selectedCoinId) ??
    state?.watchlist[0] ??
    null;

  const existingIds = useMemo(
    () => new Set((state?.watchlist ?? []).map((w) => w.id)),
    [state?.watchlist]
  );

  const monitorAssets = useMemo(() => {
    if (!state) return [];
    const map = new Map<string, WatchlistAsset>();
    for (const w of state.watchlist) map.set(w.id, w);
    for (const h of state.portfolio.holdings) {
      if (!map.has(h.coinId)) {
        map.set(h.coinId, {
          id: h.coinId,
          symbol: h.symbol.toUpperCase(),
          name: h.name,
          binanceSymbol: `${h.symbol.toUpperCase()}USDT`,
          addedAt: new Date(0).toISOString(),
        });
      }
    }
    for (const t of state.triggers ?? []) {
      if (!map.has(t.coinId)) {
        map.set(t.coinId, {
          id: t.coinId,
          symbol: t.symbol.toUpperCase(),
          name: t.name,
          binanceSymbol: `${t.symbol.toUpperCase()}USDT`,
          addedAt: t.createdAt,
        });
      }
    }
    return Array.from(map.values());
  }, [state]);

  const renderOutcomeText = (alert: SignalAlert) => {
    if (alert.outcome === 'acerto') {
      return (
        <span className="text-emerald-700 dark:text-emerald-400 font-mono tabular-nums">
          Acerto ({formatPercent(alert.evaluatedReturnPct)})
        </span>
      );
    }
    if (alert.outcome === 'erro') {
      return (
        <span className="text-rose-700 dark:text-rose-400 font-mono tabular-nums">
          Desvio ({formatPercent(alert.evaluatedReturnPct)})
        </span>
      );
    }
    if (alert.outcome === 'neutro') {
      return (
        <span className="text-slate-600 dark:text-slate-400 font-mono tabular-nums">
          Lateral ({formatPercent(alert.evaluatedReturnPct)})
        </span>
      );
    }
    return (
      <span className="text-sky-700 dark:text-sky-400 font-mono tabular-nums">
        Aberto ({formatPercent(alert.evaluatedReturnPct ?? 0)})
      </span>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-[#0B0F17] dark:text-slate-100 transition-colors">
      {/* Clean Top Bar with Unified Corner Navigation Menu */}
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-white/[0.08] bg-white/95 dark:bg-[#0B0F17]/95 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
          {/* Left: Brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('painel')}
            className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
          >
            RD Crypto
          </button>

          {/* Right Corner: Cloud sync + Theme toggle + PWA Install + Study CTA + Unified Corner Menu */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {authReady && (
              <div className="relative" ref={cloudMenuRef}>
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => {
                    if (cloudUser) {
                      setCloudMenuOpen((prev) => !prev);
                    } else {
                      void handleGoogleSignIn();
                    }
                  }}
                  title={
                    cloudUser
                      ? `Nuvem sincronizada (${cloudUser.email ?? 'Conta Google'})`
                      : 'Sincronizar conta na nuvem'
                  }
                  aria-label={
                    cloudUser
                      ? `Nuvem sincronizada (${cloudUser.email ?? 'Conta Google'})`
                      : 'Sincronizar conta na nuvem'
                  }
                  className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
                    cloudUser
                      ? 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                      : 'border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300'
                  }`}
                >
                  {authBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : cloudUser ? (
                    <CloudCheck className="w-4 h-4" />
                  ) : (
                    <Cloud className="w-4 h-4" />
                  )}
                </button>

                {cloudUser && cloudMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111827] shadow-2xl p-3 space-y-2.5 z-50">
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <CloudCheck className="w-3.5 h-3.5 shrink-0" />
                        Nuvem sincronizada
                      </p>
                      {cloudUser.email && (
                        <p className="text-[11px] font-mono text-slate-700 dark:text-slate-300 truncate">
                          {cloudUser.email}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-white/[0.08]">
                      <button
                        type="button"
                        disabled={authBusy}
                        onClick={() => void handleGoogleSignIn()}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors disabled:opacity-50"
                      >
                        <Cloud className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                        Trocar conta
                      </button>
                      <button
                        type="button"
                        disabled={authBusy}
                        onClick={() => void handleGoogleSignOut()}
                        className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-slate-300 dark:border-white/10 hover:bg-rose-50 dark:hover:bg-rose-500/15 hover:text-rose-700 dark:hover:text-rose-300 text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50"
                      >
                        <LogOut className="w-3 h-3" />
                        Sair
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={toggleTheme}
              title={isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
              aria-label={isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
              aria-pressed={!isDark}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-amber-300 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <PWAInstallButton />

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
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 dark:hover:bg-sky-500 text-white transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 shadow-xs"
            >
              {state?.isStudying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {state?.isStudying ? (
                <span>Estudando...</span>
              ) : (
                <>
                  <span className="sm:hidden">Estudar</span>
                  <span className="hidden sm:inline">Estudar agora</span>
                </>
              )}
            </button>

            {/* Unified Corner Navigation Menu (Painel, Monitor, Carteira, Ativos, Autoestudo, Alertas) */}
            <div className="relative" ref={navMenuRef}>
              <button
                type="button"
                onClick={() => setNavMenuOpen((prev) => !prev)}
                aria-expanded={navMenuOpen}
                aria-label="Abrir menu de navegação"
                className={`relative inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  navMenuOpen
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300'
                    : 'border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100'
                }`}
              >
                <Menu className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                <span>
                  {activeTab === 'painel'
                    ? 'Painel'
                    : activeTab === 'monitor'
                    ? 'Monitor'
                    : activeTab === 'carteira'
                    ? 'Carteira'
                    : activeTab === 'ativos'
                    ? 'Ativos'
                    : activeTab === 'autoestudo'
                    ? 'Autoestudo'
                    : 'Alertas'}
                </span>
                {counts.unread > 0 && (
                  <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono font-bold rounded-md bg-sky-600 text-white leading-none">
                    {counts.unread}
                  </span>
                )}
                <ChevronDown
                  className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-400 transition-transform ${
                    navMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {navMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 sm:w-72 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111827] shadow-2xl p-2 z-50 space-y-1">
                  <div className="px-2.5 py-1.5 border-b border-slate-200/80 dark:border-white/[0.07] flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Menu Principal
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                      6 seções
                    </span>
                  </div>

                  {(
                    [
                      {
                        id: 'painel',
                        label: 'Painel',
                        desc: 'Resumo, sinais da IA e análise técnica',
                        icon: LayoutDashboard,
                        badge: null,
                      },
                      {
                        id: 'monitor',
                        label: 'Monitor',
                        desc: 'Cotações ao vivo (grande, pequeno ou lista)',
                        icon: Activity,
                        badge: monitorAssets.length > 0 ? String(monitorAssets.length) : null,
                      },
                      {
                        id: 'carteira',
                        label: 'Carteira',
                        desc: 'Patrimônio, ativos e histórico editável',
                        icon: Wallet,
                        badge:
                          (state?.portfolio.transactions.length ?? 0) > 0
                            ? `${state?.portfolio.holdings.length ?? 0} ativos · ${
                                state?.portfolio.transactions.length ?? 0
                              } hist.`
                            : null,
                      },
                      {
                        id: 'ativos',
                        label: 'Ativos',
                        desc: 'Lista completa de criptos monitoradas',
                        icon: Coins,
                        badge:
                          (state?.watchlist.length ?? 0) > 0
                            ? String(state?.watchlist.length)
                            : null,
                      },
                      {
                        id: 'autoestudo',
                        label: 'Autoestudo',
                        desc: 'Ciclos autônomos e memória da IA',
                        icon: BrainCircuit,
                        badge: null,
                      },
                      {
                        id: 'alertas',
                        label: 'Alertas & Robô 24/7',
                        desc: 'Gatilhos, Telegram, WhatsApp e Script Python',
                        icon: Bell,
                        badge:
                          counts.unread > 0
                            ? `${counts.unread} novo(s)`
                            : (state?.triggers?.length ?? 0) > 0
                            ? `${state?.triggers?.length} gat.`
                            : null,
                      },
                    ] as const
                  ).map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setActiveTab(item.id);
                          setNavMenuOpen(false);
                        }}
                        className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                          isActive
                            ? 'bg-sky-600 text-white'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 mt-0.5 shrink-0 ${
                            isActive ? 'text-white' : 'text-sky-600 dark:text-sky-400'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold truncate">
                              {item.label}
                            </span>
                            {item.badge && (
                              <span
                                className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                                  isActive
                                    ? 'bg-white/20 text-white'
                                    : 'bg-slate-100 dark:bg-[#0B0F17] text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-white/10'
                                }`}
                              >
                                {item.badge}
                              </span>
                            )}
                          </div>
                          <p
                            className={`text-[11px] truncate mt-0.5 ${
                              isActive
                                ? 'text-sky-100'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {item.desc}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Pull-to-refresh feedback strip (keeps active page intact while refreshing quotes) */}
      {(pullDistance > 0 || manualRefreshing) && (
        <div className="border-b border-sky-200 dark:border-sky-500/20 bg-sky-50/90 dark:bg-[#0F172A] px-4 py-2 flex items-center justify-center gap-2 text-xs font-medium text-sky-700 dark:text-sky-300 transition-all">
          <RefreshCw
            className={`w-3.5 h-3.5 ${manualRefreshing ? 'animate-spin' : ''}`}
          />
          <span>
            {manualRefreshing
              ? 'Atualizando cotações ao vivo...'
              : pullDistance >= 56
              ? 'Solte para atualizar as cotações'
              : 'Puxe para atualizar as cotações'}
          </span>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5 sm:space-y-6 overflow-x-clip">
        {/* Live Automatic Signal Alert Banner */}
        {liveBannerAlerts.length > 0 && (
          <div className="rounded-xl border border-sky-300 dark:border-sky-500/30 bg-white dark:bg-[#111827] shadow-xs dark:shadow-none px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Bell className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
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
                    className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white underline-offset-4 hover:underline"
                  >
                    <CryptoLogo
                      symbol={al.symbol}
                      coinId={al.coinId}
                      name={al.name}
                      size="xs"
                    />
                    <span className="font-mono font-semibold">{al.symbol}</span>
                    <SignalBadge
                      action={al.action}
                      rsi14={state?.snapshots[al.coinId]?.indicators.rsi14}
                      change7dPct={state?.snapshots[al.coinId]?.change7dPct}
                      headline={al.headline}
                      compact
                    />
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLiveBannerAlerts([])}
              className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              aria-label="Dispensar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="rounded-xl border border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-4 py-3 flex items-center justify-between gap-3 text-xs text-rose-800 dark:text-rose-200">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="font-medium text-rose-700 dark:text-rose-300 hover:text-rose-950 dark:hover:text-white"
            >
              Fechar
            </button>
          </div>
        )}

        {/* Workspace Context Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
              Inteligência Autônoma de Criptomoedas
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span>
                {streamConnected ? 'Tempo real ativo (5s)' : 'Sincronizando mercado'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                Próximo estudo automático: {countdownLabel}
              </span>
              {studyStatusMsg && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-sky-700 dark:text-sky-400 font-medium">{studyStatusMsg}</span>
                </>
              )}
            </div>
          </div>

          {state && (
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1 rounded-lg bg-white dark:bg-[#111827] p-1 border border-slate-300 dark:border-white/[0.08] shadow-xs dark:shadow-none">
                {(['BRL', 'USD'] as const).map((curr) => (
                  <button
                    key={curr}
                    type="button"
                    onClick={() => handleUpdateSettings({ currency: curr })}
                    className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      state.settings.currency === curr
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {curr}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setAddModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 transition-colors whitespace-nowrap shrink-0 shadow-xs dark:shadow-none"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar cripto
              </button>
            </div>
          )}
        </div>

        {/* Domain authorization helper (only shown if Firebase Auth rejects an unauthorized domain) */}
        {authReady && !cloudUser && unauthorizedDomain !== null && (
          <section className="rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/[0.08] p-4 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  Autorize este domínio publicado no Firebase para liberar o login Google
                </p>
                <p className="text-[11px] text-slate-700 dark:text-slate-300">
                  Por segurança, o Firebase Authentication bloqueia o login em endereços novos até que você adicione o domínio no projeto{' '}
                  <span className="font-mono font-semibold text-amber-900 dark:text-amber-200">{firebaseProjectId}</span>.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={firebaseAuthDomainsSettingsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-100 dark:bg-amber-500/20 hover:bg-amber-200 dark:hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-400/30 transition-colors whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir domínios autorizados
                </a>
                <button
                  type="button"
                  onClick={() => setUnauthorizedDomain(null)}
                  className="p-1.5 text-amber-700 dark:text-amber-200/70 hover:text-amber-950 dark:hover:text-amber-100 rounded-md"
                  aria-label="Fechar aviso"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {unauthorizedDomain && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] px-3 py-2">
                <span className="text-[11px] text-slate-600 dark:text-slate-400">Domínio detectado:</span>
                <code className="text-[11px] font-mono text-sky-700 dark:text-sky-300 break-all flex-1">
                  {unauthorizedDomain}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopyDomain()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
                >
                  {copiedDomain ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copiar domínio
                    </>
                  )}
                </button>
              </div>
            )}

            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
              <li>
                Clique em <strong className="text-slate-900 dark:text-slate-100">Abrir domínios autorizados</strong> e vá em{' '}
                <span className="font-mono text-slate-800 dark:text-slate-200">Authentication &gt; Settings &gt; Authorized domains</span>.
              </li>
              <li>
                Clique em <strong className="text-slate-900 dark:text-slate-100">Add domain</strong> e cole o domínio copiado acima.
              </li>
              <li>
                Volte aqui e clique novamente no <strong className="text-slate-900 dark:text-slate-100">ícone da nuvem</strong> no topo.
              </li>
            </ol>
          </section>
        )}

        {/* Loading skeleton */}
        {(loading || (cloudUser && !cloudData)) && !state ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className="h-24 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-[#111827] animate-pulse"
                />
              ))}
            </div>
            <div className="h-96 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-[#111827] animate-pulse" />
          </div>
        ) : state ? (
          <>
            {/* 4-column Summary KPI Strip */}
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none p-4">
                <span className="block text-xs text-slate-600 dark:text-slate-400">Ativos monitorados</span>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {state.watchlist.length}
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                    {counts.hold} em espera
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none p-4">
                <span className="block text-xs text-slate-600 dark:text-slate-400">Sinais de compra</span>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {counts.buy}
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400 truncate">
                    {state.watchlist
                      .filter((w) => protectedAnalyses[w.id]?.action === 'COMPRAR')
                      .map((w) => w.symbol)
                      .slice(0, 4)
                      .join(', ') || 'Nenhum momento'}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none p-4">
                <span className="block text-xs text-slate-600 dark:text-slate-400">Sinais de venda</span>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-mono font-bold text-rose-700 dark:text-rose-400 tabular-nums">
                    {counts.sell}
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400 truncate">
                    {state.watchlist
                      .filter((w) => protectedAnalyses[w.id]?.action === 'VENDER')
                      .map((w) => w.symbol)
                      .slice(0, 4)
                      .join(', ') || 'Nenhum momento'}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none p-4">
                <span className="block text-xs text-slate-600 dark:text-slate-400">
                  Precisão avaliada pela IA
                </span>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {state.accuracyStats.accuracyPct !== null
                      ? `${state.accuracyStats.accuracyPct}%`
                      : 'Inicial'}
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
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
                  <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none overflow-hidden">
                    <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.07] max-w-full overflow-x-auto">
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
                            className={`px-2.5 sm:px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                              signalFilter === tab.id
                                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs dark:shadow-none'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <div className="relative w-full sm:w-auto sm:min-w-[200px] sm:flex-initial">
                        <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={tableSearch}
                          onChange={(e) => setTableSearch(e.target.value)}
                          placeholder="Filtrar moeda..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                        />
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      {state.watchlist.length === 0 ? (
                        <div className="p-10 text-center space-y-4">
                          <BrainCircuit className="w-8 h-8 text-sky-600 dark:text-sky-400 mx-auto" />
                          <div className="max-w-md mx-auto space-y-1.5">
                            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                              Nenhum ativo cadastrado ainda
                            </h2>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                              Adicione suas próprias criptomoedas oficiais ou lance sua carteira para a IA começar a monitorar indicadores e enviar sinais automáticos.
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => setAddModalOpen(true)}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 dark:hover:bg-sky-500 text-white transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Adicionar meu primeiro ativo
                            </button>
                            <button
                              type="button"
                              onClick={() => openTransactionModal()}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors"
                            >
                              <Wallet className="w-3.5 h-3.5" />
                              Lançar na carteira
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Mobile stacked cards (< sm) */}
                          <div className="sm:hidden divide-y divide-slate-200 dark:divide-white/[0.06]">
                            {filteredAssets.length === 0 ? (
                              <div className="py-8 px-4 text-center text-xs text-slate-600 dark:text-slate-400">
                                Nenhum ativo corresponde ao filtro selecionado.
                              </div>
                            ) : (
                              filteredAssets.map((asset) => {
                                const snap = state.snapshots[asset.id];
                                const analysis = protectedAnalyses[asset.id];
                                const isSelected = selectedAsset?.id === asset.id;

                                return (
                                  <div
                                    key={asset.id}
                                    onClick={() => setSelectedCoinId(asset.id)}
                                    className={`p-3.5 space-y-2.5 cursor-pointer transition-colors ${
                                      isSelected
                                        ? 'bg-sky-50 dark:bg-sky-500/[0.08]'
                                        : 'hover:bg-slate-50 dark:hover:bg-white/[0.025]'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        <CryptoLogo
                                          symbol={asset.symbol}
                                          coinId={asset.id}
                                          name={asset.name}
                                          size="sm"
                                        />
                                        <div className="min-w-0">
                                          <div className="font-mono font-bold text-xs text-slate-900 dark:text-slate-100">
                                            {asset.symbol}
                                          </div>
                                          <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                                            {asset.name}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="text-right font-mono tabular-nums shrink-0">
                                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                          {snap
                                            ? formatPrice(
                                                snap.priceUsd,
                                                state.settings.currency,
                                                state.usdBrlRate
                                              )
                                            : '—'}
                                        </div>
                                        <div
                                          className={`text-[11px] font-medium ${
                                            (snap?.change24hPct ?? 0) >= 0
                                              ? 'text-emerald-700 dark:text-emerald-400'
                                              : 'text-rose-700 dark:text-rose-400'
                                          }`}
                                        >
                                          {snap ? formatPercent(snap.change24hPct) : '—'} (24h)
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <SignalBadge
                                          action={analysis?.action}
                                          rsi14={snap?.indicators.rsi14}
                                          change7dPct={snap?.change7dPct}
                                          headline={analysis?.headline}
                                          compact
                                        />
                                        {snap && (
                                          <span className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
                                            RSI {snap.indicators.rsi14.toFixed(1)}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        {analysis && (
                                          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                            {analysis.confidence}%
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleRemoveAsset(asset.id);
                                          }}
                                          title={`Excluir ${asset.symbol} do painel`}
                                          aria-label={`Excluir ${asset.symbol}`}
                                          className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>

                          {/* Tablet & desktop table (>= sm) */}
                          <table className="hidden sm:table w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 dark:border-white/[0.06] bg-slate-50/70 dark:bg-transparent text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                <th className="py-2.5 px-4 lg:px-5">Ativo</th>
                                <th className="py-2.5 px-3 text-right">Preço</th>
                                <th className="py-2.5 px-3 text-right">24h</th>
                                <th className="py-2.5 px-3 hidden md:table-cell">7 dias</th>
                                <th className="py-2.5 px-3 text-right">RSI (14)</th>
                                <th className="py-2.5 px-3">Recomendação</th>
                                <th className="py-2.5 px-3 text-right">Confiança</th>
                                <th className="py-2.5 px-4 text-right">Excluir</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/80 dark:divide-white/[0.05] text-sm">
                              {filteredAssets.length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={8}
                                    className="py-8 text-center text-xs text-slate-600 dark:text-slate-400"
                                  >
                                    Nenhum ativo corresponde ao filtro selecionado.
                                  </td>
                                </tr>
                              ) : (
                                filteredAssets.map((asset) => {
                                  const snap = state.snapshots[asset.id];
                                  const analysis = protectedAnalyses[asset.id];
                                  const isSelected = selectedAsset?.id === asset.id;

                                  return (
                                    <tr
                                      key={asset.id}
                                      onClick={() => setSelectedCoinId(asset.id)}
                                      className={`cursor-pointer transition-colors ${
                                        isSelected
                                          ? 'bg-sky-50 dark:bg-sky-500/[0.08]'
                                          : 'hover:bg-slate-50 dark:hover:bg-white/[0.025]'
                                      }`}
                                    >
                                      <td className="py-3 px-4 lg:px-5">
                                        <div className="flex items-center gap-2.5">
                                          <CryptoLogo
                                            symbol={asset.symbol}
                                            coinId={asset.id}
                                            name={asset.name}
                                            size="sm"
                                          />
                                          <span className="font-mono font-bold text-xs text-slate-900 dark:text-slate-100 shrink-0">
                                            {asset.symbol}
                                          </span>
                                          <span className="text-xs text-slate-600 dark:text-slate-300 truncate max-w-[120px]">
                                            {asset.name}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="py-3 px-3 text-right font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                                        {snap
                                          ? formatPrice(
                                              snap.priceUsd,
                                              state.settings.currency,
                                              state.usdBrlRate
                                            )
                                          : '—'}
                                      </td>
                                      <td
                                        className={`py-3 px-3 text-right font-mono text-xs font-medium tabular-nums whitespace-nowrap ${
                                          (snap?.change24hPct ?? 0) >= 0
                                            ? 'text-emerald-700 dark:text-emerald-400'
                                            : 'text-rose-700 dark:text-rose-400'
                                        }`}
                                      >
                                        {snap ? formatPercent(snap.change24hPct) : '—'}
                                      </td>
                                      <td className="py-3 px-3 hidden md:table-cell">
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
                                                ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                                : snap.indicators.rsi14 >= 68
                                                ? 'text-rose-700 dark:text-rose-400 font-semibold'
                                                : 'text-slate-700 dark:text-slate-300'
                                            }
                                          >
                                            {snap.indicators.rsi14.toFixed(1)}
                                          </span>
                                        ) : (
                                          '—'
                                        )}
                                      </td>
                                      <td className="py-3 px-3">
                                        <SignalBadge
                                          action={analysis?.action}
                                          rsi14={snap?.indicators.rsi14}
                                          change7dPct={snap?.change7dPct}
                                          headline={analysis?.headline}
                                          compact
                                        />
                                      </td>
                                      <td className="py-3 px-3 text-right font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums">
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
                                          className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
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
                        </>
                      )}
                    </div>
                  </section>

                  {/* Deep dive for selected coin */}
                  {selectedAsset && (
                    <AssetDetailPanel
                      asset={selectedAsset}
                      snapshot={state.snapshots[selectedAsset.id]}
                      analysis={protectedAnalyses[selectedAsset.id]}
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
                  <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.07] flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Sugestões automáticas
                        </h2>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                          Sinais emitidos quando a IA detecta ponto de ação
                        </p>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {counts.unread > 0 && (
                          <button
                            type="button"
                            onClick={handleMarkAlertsRead}
                            className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 whitespace-nowrap"
                          >
                            Marcar lidas
                          </button>
                        )}
                        {state.alerts.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void handleClearAlerts()}
                            className="text-xs font-medium text-rose-700 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 whitespace-nowrap"
                          >
                            Limpar
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="divide-y divide-slate-200 dark:divide-white/[0.06] max-h-[540px] overflow-y-auto">
                      {state.alerts.length === 0 ? (
                        <div className="p-6 text-center space-y-2">
                          <Clock className="w-5 h-5 text-slate-400 dark:text-slate-500 mx-auto" />
                          <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
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
                            className={`flex items-start gap-2 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-white/[0.025] transition-colors ${
                              !alert.read ? 'bg-sky-50/70 dark:bg-sky-500/[0.04]' : ''
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedCoinId(alert.coinId)}
                              className="flex-1 text-left space-y-1.5 min-w-0"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <CryptoLogo
                                    symbol={alert.symbol}
                                    coinId={alert.coinId}
                                    name={alert.name}
                                    size="xs"
                                  />
                                  <span className="font-mono font-bold text-xs text-slate-900 dark:text-slate-100">
                                    {alert.symbol}
                                  </span>
                                  <SignalBadge
                                    action={alert.action}
                                    rsi14={state.snapshots[alert.coinId]?.indicators.rsi14}
                                    change7dPct={state.snapshots[alert.coinId]?.change7dPct}
                                    headline={alert.headline}
                                    compact
                                  />
                                </div>
                                <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                                  {formatRelativeTime(alert.createdAt)}
                                </span>
                              </div>

                              <p className="text-xs font-medium text-slate-800 dark:text-slate-200 leading-snug">
                                {alert.headline}
                              </p>

                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400 font-mono tabular-nums">
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
                              className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-rose-700 dark:hover:text-rose-400 transition-colors shrink-0 mt-0.5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  {/* Compact Latest Auto-Study Cycle Summary */}
                  <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none p-5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
                        <BrainCircuit className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                        Último ciclo autônomo
                      </h3>
                      <button
                        type="button"
                        onClick={() => setActiveTab('autoestudo')}
                        className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 whitespace-nowrap"
                      >
                        Ver histórico
                      </button>
                    </div>

                    {state.studyHistory[0] ? (
                      <div className="space-y-2.5">
                        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                          {state.studyHistory[0].marketSummary}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400 font-mono tabular-nums">
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
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        O primeiro ciclo automático está sendo preparado.
                      </p>
                    )}

                    <div className="pt-2 border-t border-slate-200 dark:border-white/[0.07] flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-600 dark:text-slate-400">
                        Frequência: a cada {state.settings.intervalMinutes} min
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateSettings({
                            autoStudyEnabled: !state.settings.autoStudyEnabled,
                          })
                        }
                        className="text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 font-medium whitespace-nowrap"
                      >
                        {state.settings.autoStudyEnabled ? 'Pausar' : 'Ativar'}
                      </button>
                    </div>
                  </section>
                </aside>
              </div>
            )}

            {/* VIEW: MONITOR DE COTAÇÕES (Cards Fracionados em Tempo Real 5s) */}
            {activeTab === 'monitor' && (
              <MonitorView
                assets={monitorAssets}
                snapshots={state.snapshots}
                currency={state.settings.currency}
                usdBrlRate={state.usdBrlRate}
                lastUpdatedAt={lastMarketUpdateAt}
                isRefreshing={manualRefreshing}
                onManualRefresh={() => void handleManualMarketRefresh()}
                onOpenAddAsset={() => setAddModalOpen(true)}
                onLaunchGain={(coinId) => openTransactionModal(coinId, 'ganho')}
                onSelectAsset={(coinId) => {
                  setSelectedCoinId(coinId);
                  setActiveTab('painel');
                }}
              />
            )}

            {/* VIEW: CARTEIRA (Mirror CoinMarketCap Portfolio) */}
            {activeTab === 'carteira' && (
              <PortfolioView
                portfolio={state.portfolio}
                snapshots={state.snapshots}
                analyses={protectedAnalyses}
                currency={state.settings.currency}
                usdBrlRate={state.usdBrlRate}
                onOpenAddTransaction={(coinId) => openTransactionModal(coinId)}
                onEditTransaction={(tx) => openEditTransactionModal(tx)}
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
              <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      Criptoativos monitorados ({state.watchlist.length})
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      Adicione qualquer criptomoeda para que a IA estude seus indicadores automaticamente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 dark:hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Nova criptomoeda
                  </button>
                </div>

                <div className="overflow-x-auto">
                  {state.watchlist.length === 0 ? (
                    <div className="p-10 text-center space-y-3">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        Nenhum criptoativo adicionado ainda
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Cadastre seus ativos oficiais para liberar o monitoramento em tempo real e estudos da IA.
                      </p>
                      <button
                        type="button"
                        onClick={() => setAddModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 dark:hover:bg-sky-500 text-white transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Adicionar meu primeiro ativo
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Mobile stacked cards (< sm) */}
                      <div className="sm:hidden divide-y divide-slate-200 dark:divide-white/[0.06]">
                        {state.watchlist.map((asset) => {
                          const snap = state.snapshots[asset.id];
                          const analysis = protectedAnalyses[asset.id];
                          return (
                            <div key={asset.id} className="p-4 space-y-3 text-xs">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <CryptoLogo
                                    symbol={asset.symbol}
                                    coinId={asset.id}
                                    name={asset.name}
                                    size="sm"
                                  />
                                  <div className="min-w-0">
                                    <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                      {asset.symbol}
                                    </div>
                                    <div className="text-slate-600 dark:text-slate-400 truncate">
                                      {asset.name}
                                    </div>
                                  </div>
                                </div>

                                <div className="text-right font-mono tabular-nums shrink-0">
                                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                                    {snap
                                      ? formatPrice(
                                          snap.priceUsd,
                                          state.settings.currency,
                                          state.usdBrlRate
                                        )
                                      : '—'}
                                  </div>
                                  <div
                                    className={`text-[11px] font-medium ${
                                      (snap?.change24hPct ?? 0) >= 0
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-rose-700 dark:text-rose-400'
                                    }`}
                                  >
                                    {snap ? formatPercent(snap.change24hPct) : '—'} · 7d{' '}
                                    {snap ? formatPercent(snap.change7dPct) : '—'}
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200/80 dark:border-white/[0.06] px-3 py-2">
                                <div>
                                  <span className="block text-[10px] text-slate-500 dark:text-slate-400">Vol 24h</span>
                                  <span className="text-slate-900 dark:text-slate-200">
                                    {snap
                                      ? formatCompactVolume(
                                          snap.volume24hUsd,
                                          state.settings.currency,
                                          state.usdBrlRate
                                        )
                                      : '—'}
                                  </span>
                                </div>
                                <div>
                                  <span className="block text-[10px] text-slate-500 dark:text-slate-400">RSI (14)</span>
                                  <span className="text-slate-900 dark:text-slate-200">
                                    {snap ? snap.indicators.rsi14.toFixed(1) : '—'}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="block text-[10px] text-slate-500 dark:text-slate-400">EMA</span>
                                  <span className="capitalize text-slate-900 dark:text-slate-200">
                                    {snap?.indicators.emaTrend ?? '—'}
                                  </span>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <SignalBadge
                                  action={analysis?.action}
                                  rsi14={snap?.indicators.rsi14}
                                  change7dPct={snap?.change7dPct}
                                  headline={analysis?.headline}
                                  compact
                                />
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedCoinId(asset.id);
                                      setActiveTab('painel');
                                    }}
                                    className="px-2.5 py-1 rounded border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors"
                                  >
                                    Detalhes
                                  </button>
                                  <button
                                    type="button"
                                    disabled={state.isStudying}
                                    onClick={() => handleRunStudy(asset.id)}
                                    className="px-2.5 py-1 rounded bg-sky-50 dark:bg-sky-600/20 border border-sky-300 dark:border-sky-500/30 text-sky-700 dark:text-sky-300 font-medium disabled:opacity-50"
                                  >
                                    Estudar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveAsset(asset.id)}
                                    title={`Excluir ${asset.symbol}`}
                                    aria-label={`Excluir ${asset.symbol}`}
                                    className="p-1.5 rounded border border-slate-300 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Tablet & desktop table (>= sm) */}
                      <table className="hidden sm:table w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-white/[0.06] bg-slate-50/70 dark:bg-transparent text-[11px] font-medium text-slate-600 dark:text-slate-400">
                            <th className="py-3 px-4 lg:px-5">Ativo</th>
                            <th className="py-3 px-3 text-right">Preço</th>
                            <th className="py-3 px-3 text-right">24h / 7d</th>
                            <th className="py-3 px-3 text-right hidden md:table-cell">Volume 24h</th>
                            <th className="py-3 px-3 text-right">RSI (14)</th>
                            <th className="py-3 px-3 hidden lg:table-cell">Tendência EMA</th>
                            <th className="py-3 px-3">Veredito IA</th>
                            <th className="py-3 px-4 lg:px-5 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/80 dark:divide-white/[0.05] text-xs">
                          {state.watchlist.map((asset) => {
                            const snap = state.snapshots[asset.id];
                            const analysis = protectedAnalyses[asset.id];
                            return (
                              <tr key={asset.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                                <td className="py-3.5 px-4 lg:px-5">
                                  <div className="flex items-center gap-3">
                                    <CryptoLogo
                                      symbol={asset.symbol}
                                      coinId={asset.id}
                                      name={asset.name}
                                      size="sm"
                                    />
                                    <div>
                                      <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                        {asset.symbol}
                                      </div>
                                      <div className="text-slate-600 dark:text-slate-400">{asset.name}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3.5 px-3 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                                  {snap
                                    ? formatPrice(
                                        snap.priceUsd,
                                        state.settings.currency,
                                        state.usdBrlRate
                                      )
                                    : '—'}
                                </td>
                                <td className="py-3.5 px-3 text-right font-mono font-medium tabular-nums whitespace-nowrap">
                                  <div
                                    className={
                                      (snap?.change24hPct ?? 0) >= 0
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-rose-700 dark:text-rose-400'
                                    }
                                  >
                                    {snap ? formatPercent(snap.change24hPct) : '—'}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {snap ? formatPercent(snap.change7dPct) : '—'}
                                  </div>
                                </td>
                                <td className="py-3.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums hidden md:table-cell whitespace-nowrap">
                                  {snap
                                    ? formatCompactVolume(
                                        snap.volume24hUsd,
                                        state.settings.currency,
                                        state.usdBrlRate
                                      )
                                    : '—'}
                                </td>
                                <td className="py-3.5 px-3 text-right font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                                  {snap ? snap.indicators.rsi14.toFixed(1) : '—'}
                                </td>
                                <td className="py-3.5 px-3 capitalize text-slate-700 dark:text-slate-300 hidden lg:table-cell">
                                  {snap?.indicators.emaTrend ?? '—'}
                                </td>
                                <td className="py-3.5 px-3">
                                  <SignalBadge
                                    action={analysis?.action}
                                    rsi14={snap?.indicators.rsi14}
                                    change7dPct={snap?.change7dPct}
                                    headline={analysis?.headline}
                                    compact
                                  />
                                </td>
                                <td className="py-3.5 px-4 lg:px-5 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedCoinId(asset.id);
                                        setActiveTab('painel');
                                      }}
                                      className="px-2.5 py-1 rounded border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors"
                                    >
                                      Detalhes
                                    </button>
                                    <button
                                      type="button"
                                      disabled={state.isStudying}
                                      onClick={() => handleRunStudy(asset.id)}
                                      className="px-2.5 py-1 rounded bg-sky-50 dark:bg-sky-600/20 border border-sky-300 dark:border-sky-500/30 hover:bg-sky-100 dark:hover:bg-sky-600/30 text-sky-700 dark:text-sky-300 font-medium transition-colors disabled:opacity-50"
                                    >
                                      Estudar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveAsset(asset.id)}
                                      title={`Excluir ${asset.symbol}`}
                                      aria-label={`Excluir ${asset.symbol}`}
                                      className="p-1.5 rounded border border-slate-300 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 hover:border-rose-300 dark:hover:border-rose-500/30 transition-colors"
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
                    </>
                  )}
                </div>
              </section>
            )}

            {/* VIEW 3: AUTOESTUDO & MEMÓRIA DA IA */}
            {activeTab === 'autoestudo' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Histórico de estudos autônomos
                      </h2>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                        A cada ciclo, a IA compara previsões anteriores com o preço real antes de emitir novos pareceres.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {state.studyHistory.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void handleClearStudyHistory()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-300 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 transition-colors whitespace-nowrap"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Limpar histórico
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={state.isStudying || state.watchlist.length === 0}
                        onClick={() => handleRunStudy()}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-600 hover:bg-sky-700 dark:hover:bg-sky-500 text-white disabled:opacity-50 whitespace-nowrap"
                      >
                        Executar ciclo
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
                    {state.studyHistory.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-600 dark:text-slate-400">
                        Nenhum ciclo registrado até o momento. Adicione ativos e clique em &quot;Executar ciclo&quot; para iniciar.
                      </div>
                    ) : (
                      state.studyHistory.map((cycle) => (
                        <div key={cycle.id} className="p-5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2 font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
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
                              <span className="text-xs font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                                {cycle.buySignals} compra · {cycle.sellSignals} venda ·{' '}
                                {cycle.holdSignals} espera
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleDeleteStudyCycle(cycle.id)}
                                title="Excluir registro de ciclo"
                                aria-label="Excluir registro de ciclo"
                                className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-rose-700 dark:hover:text-rose-400 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                            {cycle.marketSummary}
                          </p>
                          <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono tabular-nums">
                            <span>{cycle.assetsStudied} ativos analisados</span>
                            <span aria-hidden="true">·</span>
                            <span>{cycle.alertsEmitted} novos alertas emitidos</span>
                            {cycle.evaluatedAccuracyPct !== null && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-700 dark:text-emerald-400 font-medium">
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
                    onOpenPythonGenerator={() => {
                      setActiveTab('alertas');
                      setRightSettingsTab('python24h');
                    }}
                    onOpenWhatsAppConfig={() => {
                      setActiveTab('alertas');
                      setRightSettingsTab('whatsapp');
                    }}
                  />
                </div>
              </div>
            )}

            {/* VIEW 4: CENTRAL DE ALERTAS & GATILHOS WHATSAPP 24H */}
            {activeTab === 'alertas' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1 rounded-lg bg-white dark:bg-[#111827] p-1 border border-slate-200 dark:border-white/[0.08] shadow-xs dark:shadow-none">
                    <button
                      type="button"
                      onClick={() => setAlertsSubTab('triggers')}
                      className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        alertsSubTab === 'triggers'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Gatilhos 24h ({(state.triggers ?? []).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setAlertsSubTab('alerts')}
                      className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        alertsSubTab === 'alerts'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Histórico de Alertas ({state.alerts.length})
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1 rounded-lg bg-white dark:bg-[#111827] p-1 border border-slate-200 dark:border-white/[0.08] shadow-xs dark:shadow-none">
                    <button
                      type="button"
                      onClick={() => setRightSettingsTab('telegram')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        rightSettingsTab === 'telegram'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Configurar Telegram
                    </button>
                    <button
                      type="button"
                      onClick={() => setRightSettingsTab('whatsapp')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        rightSettingsTab === 'whatsapp'
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Configurar WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => setRightSettingsTab('python24h')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        rightSettingsTab === 'python24h'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Script Python 24/7
                    </button>
                    <button
                      type="button"
                      onClick={() => setRightSettingsTab('automacao')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        rightSettingsTab === 'automacao'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
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
                        telegramEnabled={Boolean(state.settings.telegram?.enabled)}
                        onOpenNewTrigger={() => openTriggerModal()}
                        onToggleTrigger={handleToggleTrigger}
                        onUpdateChannels={handleUpdateTriggerChannels}
                        onResetReference={handleResetTriggerRef}
                        onDeleteTrigger={handleDeleteTrigger}
                        onClearTriggers={handleClearTriggers}
                      />
                    ) : (
                      <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                              Registro completo de sugestões ({state.alerts.length})
                            </h2>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                              Acompanhamento de retorno real desde o momento em que cada sugestão ou gatilho foi disparado.
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {counts.unread > 0 && (
                              <button
                                type="button"
                                onClick={handleMarkAlertsRead}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 whitespace-nowrap"
                              >
                                Marcar todas como lidas
                              </button>
                            )}
                            {state.alerts.length > 0 && (
                              <button
                                type="button"
                                onClick={() => void handleClearAlerts()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-300 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 transition-colors whitespace-nowrap"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Limpar histórico
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
                          {state.alerts.length === 0 ? (
                            <div className="p-8 text-center text-xs text-slate-600 dark:text-slate-400">
                              Sem alertas registrados ainda.
                            </div>
                          ) : (
                            state.alerts.map((alert) => (
                              <div key={alert.id} className="p-5 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2.5">
                                    <CryptoLogo
                                      symbol={alert.symbol}
                                      coinId={alert.coinId}
                                      name={alert.name}
                                      size="sm"
                                    />
                                    <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                                      {alert.symbol}
                                    </span>
                                    <span className="text-xs text-slate-600 dark:text-slate-400">{alert.name}</span>
                                    <SignalBadge
                                      action={alert.action}
                                      rsi14={state.snapshots[alert.coinId]?.indicators.rsi14}
                                      change7dPct={state.snapshots[alert.coinId]?.change7dPct}
                                      headline={alert.headline}
                                      compact
                                    />
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
                                      className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-rose-700 dark:hover:text-rose-400 transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                  {alert.headline}
                                </p>
                                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                  {alert.reason}
                                </p>

                                <div className="pt-1 flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
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
                    ) : rightSettingsTab === 'telegram' ? (
                      <TelegramSettingsPanel
                        telegram={
                          state.settings.telegram ?? {
                            enabled: false,
                            botToken: '',
                            chatId: '',
                            forwardAiSignals: true,
                          }
                        }
                        onUpdateSettings={handleUpdateSettings}
                      />
                    ) : rightSettingsTab === 'python24h' ? (
                      <GitHubActionsPythonPanel
                        settings={state.settings}
                        watchlist={state.watchlist}
                        holdings={state.portfolio.holdings}
                        triggers={state.triggers ?? []}
                        onUpdateSettings={handleUpdateSettings}
                        onSwitchChannelTab={(ch) => setRightSettingsTab(ch)}
                      />
                    ) : (
                      <AutomationSettingsPanel
                        settings={state.settings}
                        soundEnabled={soundEnabled}
                        onToggleSound={() => setSoundEnabled((v) => !v)}
                        onUpdateSettings={handleUpdateSettings}
                        onOpenPythonGenerator={() => setRightSettingsTab('python24h')}
                        onOpenWhatsAppConfig={() => setRightSettingsTab('whatsapp')}
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
      <footer className="border-t border-slate-200 dark:border-white/[0.06] py-5 px-4 sm:px-6">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600 dark:text-slate-500">
          <span>
            RD Crypto — Análises geradas por inteligência artificial com dados de mercado em tempo real para fins informativos e educacionais. Não constitui recomendação financeira oficial.
          </span>
          {state && (
            <div
              className="inline-flex items-center gap-2 font-mono tabular-nums text-slate-700 dark:text-slate-300"
              title={`Cotação comercial USD/BRL atualizada automaticamente a cada 5s (última atualização: ${new Date(
                lastUsdBrlUpdateAt
              ).toLocaleTimeString('pt-BR')})`}
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  USD/BRL R${' '}
                  {state.usdBrlRate.toLocaleString('pt-BR', {
                    minimumFractionDigits: 4,
                    maximumFractionDigits: 4,
                  })}
                </span>
              </span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                ·{' '}
                {new Date(lastUsdBrlUpdateAt).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            </div>
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
          preselectedType={txPreselectedType}
          editingTransaction={editingTransaction}
          onClose={() => {
            setTxModalOpen(false);
            setEditingTransaction(null);
          }}
          onSubmit={handleAddTransaction}
          onUpdate={handleUpdateTransaction}
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
          telegramEnabled={Boolean(state.settings.telegram?.enabled)}
          preselectedCoinId={triggerPreselectedCoinId}
          onClose={() => setTriggerModalOpen(false)}
          onSubmit={handleCreateTrigger}
        />
      )}
      <OfflineIndicator />
    </div>
  );
}
