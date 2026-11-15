import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase.ts';
import type {
  AIAnalysisResult,
  AppSettings,
  AppStatePayload,
  PortfolioTransaction,
  PriceTrigger,
  SignalAlert,
  StudyCycleSummary,
  WatchlistAsset,
  WhatsAppSettings,
} from '../types/crypto.ts';

export interface CloudWorkspaceData {
  portfolioName: string;
  settings: AppSettings;
  watchlist: WatchlistAsset[];
  transactions: PortfolioTransaction[];
  triggers: PriceTrigger[];
  alerts: SignalAlert[];
  analyses: Record<string, AIAnalysisResult>;
  studyHistory: StudyCycleSummary[];
}

export const DEFAULT_CLOUD_WHATSAPP: WhatsAppSettings = {
  enabled: false,
  provider: 'callmebot',
  phoneNumber: '',
  callMeBotApiKey: '',
  customWebhookUrl: '',
  customWebhookToken: '',
  metaPhoneNumberId: '',
  metaAccessToken: '',
  forwardAiSignals: true,
};

export const DEFAULT_CLOUD_SETTINGS: AppSettings = {
  autoStudyEnabled: true,
  intervalMinutes: 5,
  currency: 'BRL',
  minConfidenceForAlert: 65,
  webhookUrl: '',
  whatsapp: DEFAULT_CLOUD_WHATSAPP,
};

export function toSafeDocId(rawId: string): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned.length > 0 ? cleaned : `id_${Date.now()}`;
}

function clampStr(value: unknown, maxLen: number): string {
  return String(value ?? '').slice(0, maxLen);
}

function clampNonEmptyStr(value: unknown, fallback: string, maxLen: number): string {
  const trimmed = String(value ?? '').trim();
  return (trimmed || fallback).slice(0, maxLen);
}

function clampStringArray(arr: unknown, maxItems = 10, maxLen = 400): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLen));
}

export function sanitizeWhatsAppSettings(w?: Partial<WhatsAppSettings>): WhatsAppSettings {
  const provider =
    w?.provider === 'webhook_rest' || w?.provider === 'meta_cloud'
      ? w.provider
      : 'callmebot';
  return {
    enabled: Boolean(w?.enabled),
    provider,
    phoneNumber: clampStr(w?.phoneNumber, 32),
    callMeBotApiKey: clampStr(w?.callMeBotApiKey, 200),
    customWebhookUrl: clampStr(w?.customWebhookUrl, 500),
    customWebhookToken: clampStr(w?.customWebhookToken, 300),
    metaPhoneNumberId: clampStr(w?.metaPhoneNumberId, 100),
    metaAccessToken: clampStr(w?.metaAccessToken, 500),
    forwardAiSignals:
      typeof w?.forwardAiSignals === 'boolean' ? w.forwardAiSignals : true,
  };
}

export function sanitizeSettings(s?: Partial<AppSettings>): AppSettings {
  return {
    autoStudyEnabled:
      typeof s?.autoStudyEnabled === 'boolean' ? s.autoStudyEnabled : true,
    intervalMinutes: Math.max(1, Math.min(120, Math.round(Number(s?.intervalMinutes) || 5))),
    currency: s?.currency === 'USD' ? 'USD' : 'BRL',
    minConfidenceForAlert: Math.max(
      40,
      Math.min(95, Math.round(Number(s?.minConfidenceForAlert) || 65))
    ),
    webhookUrl: clampStr(s?.webhookUrl, 500),
    whatsapp: sanitizeWhatsAppSettings(s?.whatsapp),
  };
}

function buildWatchlistPayload(uid: string, asset: WatchlistAsset) {
  const payload: Record<string, unknown> = {
    ownerId: uid,
    id: clampNonEmptyStr(asset.id, 'crypto', 128),
    symbol: clampNonEmptyStr(asset.symbol?.toUpperCase(), 'CRYPTO', 24),
    name: clampNonEmptyStr(asset.name, asset.symbol || 'Crypto', 100),
    addedAt: clampNonEmptyStr(asset.addedAt, new Date().toISOString(), 48),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (asset.binanceSymbol && asset.binanceSymbol.trim()) {
    payload.binanceSymbol = clampStr(asset.binanceSymbol.trim(), 36);
  }
  return payload;
}

function buildTransactionPayload(uid: string, tx: PortfolioTransaction) {
  const safeId = toSafeDocId(tx.id);
  const type =
    tx.type === 'compra' || tx.type === 'venda' || tx.type === 'ganho'
      ? tx.type
      : 'compra';
  const payload: Record<string, unknown> = {
    ownerId: uid,
    id: safeId,
    coinId: clampNonEmptyStr(tx.coinId, 'crypto', 128),
    symbol: clampNonEmptyStr(tx.symbol?.toUpperCase(), 'CRYPTO', 24),
    name: clampNonEmptyStr(tx.name, tx.symbol || 'Crypto', 100),
    type,
    quantity: Math.max(1e-9, Number(tx.quantity) || 1e-9),
    pricePerCoinUsd: Math.max(0, Number(tx.pricePerCoinUsd) || 0),
    feeUsd: Math.max(0, Number(tx.feeUsd) || 0),
    timestamp: clampNonEmptyStr(tx.timestamp, new Date().toISOString(), 48),
    createdAt: serverTimestamp(),
  };
  if (tx.note && tx.note.trim()) {
    payload.note = clampStr(tx.note.trim(), 200);
  }
  return { safeId, payload };
}

function buildTriggerPayload(uid: string, trig: PriceTrigger) {
  const safeId = toSafeDocId(trig.id);
  const conditionType =
    trig.conditionType === 'queda_pct' ||
    trig.conditionType === 'alta_pct' ||
    trig.conditionType === 'abaixo_preco' ||
    trig.conditionType === 'acima_preco'
      ? trig.conditionType
      : 'queda_pct';
  const actionHint =
    trig.actionHint === 'COMPRAR' ||
    trig.actionHint === 'VENDER' ||
    trig.actionHint === 'AVALIAR'
      ? trig.actionHint
      : 'COMPRAR';
  const repeatMode = trig.repeatMode === 'continuo' ? 'continuo' : 'uma_vez';

  const payload: Record<string, unknown> = {
    ownerId: uid,
    id: safeId,
    coinId: clampNonEmptyStr(trig.coinId, 'crypto', 128),
    symbol: clampNonEmptyStr(trig.symbol?.toUpperCase(), 'CRYPTO', 24),
    name: clampNonEmptyStr(trig.name, trig.symbol || 'Crypto', 100),
    conditionType,
    targetValue: Math.max(1e-8, Number(trig.targetValue) || 1),
    referencePriceUsd: Math.max(0, Number(trig.referencePriceUsd) || 0),
    actionHint,
    repeatMode,
    cooldownMinutes: Math.max(1, Math.min(1440, Math.round(Number(trig.cooldownMinutes) || 60))),
    enabled: Boolean(trig.enabled),
    sendWhatsApp: Boolean(trig.sendWhatsApp),
    createdAtStr: clampNonEmptyStr(trig.createdAt, new Date().toISOString(), 48),
    triggerCount: Math.max(0, Math.round(Number(trig.triggerCount) || 0)),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (trig.note && trig.note.trim()) {
    payload.note = clampStr(trig.note.trim(), 200);
  }
  if (trig.lastTriggeredAt && trig.lastTriggeredAt.trim()) {
    payload.lastTriggeredAt = clampStr(trig.lastTriggeredAt.trim(), 48);
  }
  if (typeof trig.lastTriggeredPriceUsd === 'number' && Number.isFinite(trig.lastTriggeredPriceUsd)) {
    payload.lastTriggeredPriceUsd = Math.max(0, trig.lastTriggeredPriceUsd);
  }
  if (
    trig.lastDeliveryStatus === 'enviado' ||
    trig.lastDeliveryStatus === 'falha' ||
    trig.lastDeliveryStatus === 'sem_whatsapp'
  ) {
    payload.lastDeliveryStatus = trig.lastDeliveryStatus;
  }
  if (trig.lastDeliveryError && trig.lastDeliveryError.trim()) {
    payload.lastDeliveryError = clampStr(trig.lastDeliveryError.trim(), 300);
  }
  return { safeId, payload };
}

function buildAlertPayload(uid: string, alert: SignalAlert) {
  const safeId = toSafeDocId(alert.id);
  const action =
    alert.action === 'COMPRAR' || alert.action === 'VENDER' ? alert.action : 'ESPERAR';
  const outcome =
    alert.outcome === 'acerto' || alert.outcome === 'neutro' || alert.outcome === 'erro'
      ? alert.outcome
      : 'em_aberto';
  const payload: Record<string, unknown> = {
    ownerId: uid,
    id: safeId,
    coinId: clampNonEmptyStr(alert.coinId, 'crypto', 128),
    symbol: clampNonEmptyStr(alert.symbol?.toUpperCase(), 'CRYPTO', 24),
    name: clampNonEmptyStr(alert.name, alert.symbol || 'Crypto', 100),
    action,
    confidence: Math.max(0, Math.min(100, Number(alert.confidence) || 0)),
    priceAtSignalUsd: Math.max(0, Number(alert.priceAtSignalUsd) || 0),
    targetPriceUsd: Math.max(0, Number(alert.targetPriceUsd) || 0),
    stopLossUsd: Math.max(0, Number(alert.stopLossUsd) || 0),
    headline: clampStr(alert.headline, 300),
    reason: clampStr(alert.reason, 2000),
    createdAtStr: clampNonEmptyStr(alert.createdAt, new Date().toISOString(), 48),
    read: Boolean(alert.read),
    outcome,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (
    alert.previousAction === 'COMPRAR' ||
    alert.previousAction === 'VENDER' ||
    alert.previousAction === 'ESPERAR'
  ) {
    payload.previousAction = alert.previousAction;
  }
  if (typeof alert.evaluatedReturnPct === 'number' && Number.isFinite(alert.evaluatedReturnPct)) {
    payload.evaluatedReturnPct = alert.evaluatedReturnPct;
  }
  if (alert.evaluatedAt && alert.evaluatedAt.trim()) {
    payload.evaluatedAt = clampStr(alert.evaluatedAt.trim(), 48);
  }
  return { safeId, payload };
}

function buildAnalysisPayload(uid: string, analysis: AIAnalysisResult) {
  const docId = toSafeDocId(analysis.coinId);
  const action =
    analysis.action === 'COMPRAR' || analysis.action === 'VENDER'
      ? analysis.action
      : 'ESPERAR';
  const horizon =
    analysis.horizon === 'medio_prazo' || analysis.horizon === 'swing'
      ? analysis.horizon
      : 'curto_prazo';
  const riskLevel =
    analysis.riskLevel === 'baixo' || analysis.riskLevel === 'elevado'
      ? analysis.riskLevel
      : 'moderado';

  const payload: Record<string, unknown> = {
    ownerId: uid,
    coinId: clampNonEmptyStr(analysis.coinId, docId, 128),
    symbol: clampNonEmptyStr(analysis.symbol?.toUpperCase(), 'CRYPTO', 24),
    action,
    confidence: Math.max(0, Math.min(100, Number(analysis.confidence) || 0)),
    horizon,
    entryZoneLowUsd: Math.max(0, Number(analysis.entryZoneLowUsd) || 0),
    entryZoneHighUsd: Math.max(0, Number(analysis.entryZoneHighUsd) || 0),
    targetPriceUsd: Math.max(0, Number(analysis.targetPriceUsd) || 0),
    stopLossUsd: Math.max(0, Number(analysis.stopLossUsd) || 0),
    riskLevel,
    headline: clampStr(analysis.headline, 300),
    thesis: clampStr(analysis.thesis, 3000),
    technicalFactors: clampStringArray(analysis.technicalFactors, 10, 400),
    riskFactors: clampStringArray(analysis.riskFactors, 10, 400),
    selfLearningNote: clampStr(analysis.selfLearningNote, 1000),
    priceAtAnalysisUsd: Math.max(0, Number(analysis.priceAtAnalysisUsd) || 0),
    analyzedAt: clampNonEmptyStr(analysis.analyzedAt, new Date().toISOString(), 48),
    cycleId: clampNonEmptyStr(analysis.cycleId, `cyc_${Date.now()}`, 128),
    updatedAt: serverTimestamp(),
  };

  if (analysis.portfolioAdvice && analysis.portfolioAdvice.trim()) {
    payload.portfolioAdvice = clampStr(analysis.portfolioAdvice.trim(), 1500);
  }
  return { docId, payload };
}

function buildStudyCyclePayload(uid: string, cycle: StudyCycleSummary) {
  const safeId = toSafeDocId(cycle.id);
  const trigger =
    cycle.trigger === 'manual' || cycle.trigger === 'novo_ativo'
      ? cycle.trigger
      : 'automatico';
  const payload: Record<string, unknown> = {
    ownerId: uid,
    id: safeId,
    startedAt: clampNonEmptyStr(cycle.startedAt, new Date().toISOString(), 48),
    completedAt: clampNonEmptyStr(cycle.completedAt, new Date().toISOString(), 48),
    assetsStudied: Math.max(0, Number(cycle.assetsStudied) || 0),
    buySignals: Math.max(0, Number(cycle.buySignals) || 0),
    sellSignals: Math.max(0, Number(cycle.sellSignals) || 0),
    holdSignals: Math.max(0, Number(cycle.holdSignals) || 0),
    alertsEmitted: Math.max(0, Number(cycle.alertsEmitted) || 0),
    evaluatedAccuracyPct:
      typeof cycle.evaluatedAccuracyPct === 'number' &&
      Number.isFinite(cycle.evaluatedAccuracyPct)
        ? cycle.evaluatedAccuracyPct
        : null,
    trigger,
    marketSummary: clampStr(cycle.marketSummary, 2000),
    createdAt: serverTimestamp(),
  };
  return { safeId, payload };
}

async function commitOperationsInChunks(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  pathForError: string
) {
  if (ops.length === 0) return;
  const CHUNK_SIZE = 350;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + CHUNK_SIZE)) {
      op(batch);
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, pathForError);
    }
  }
}

export async function ensureUserCloudProfile(
  uid: string,
  localSeed?: AppStatePayload | null
): Promise<void> {
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  if (snap.exists()) {
    return;
  }

  const initialName = clampNonEmptyStr(
    localSeed?.portfolio?.name,
    'MINHA CARTEIRA',
    60
  );
  const initialSettings = sanitizeSettings(localSeed?.settings);

  try {
    await setDoc(userRef, {
      ownerId: uid,
      portfolioName: initialName,
      settings: initialSettings,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, userPath);
  }

  if (!localSeed) return;

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  for (const asset of localSeed.watchlist) {
    const docId = toSafeDocId(asset.id);
    const ref = doc(db, 'users', uid, 'watchlist', docId);
    const data = buildWatchlistPayload(uid, asset);
    ops.push((b) => b.set(ref, data));
  }

  for (const tx of localSeed.portfolio.transactions) {
    const { safeId, payload } = buildTransactionPayload(uid, tx);
    const ref = doc(db, 'users', uid, 'transactions', safeId);
    ops.push((b) => b.set(ref, payload));
  }

  for (const trig of localSeed.triggers ?? []) {
    const { safeId, payload } = buildTriggerPayload(uid, trig);
    const ref = doc(db, 'users', uid, 'triggers', safeId);
    ops.push((b) => b.set(ref, payload));
  }

  for (const alert of (localSeed.alerts ?? []).slice(0, 60)) {
    const { safeId, payload } = buildAlertPayload(uid, alert);
    const ref = doc(db, 'users', uid, 'alerts', safeId);
    ops.push((b) => b.set(ref, payload));
  }

  for (const analysis of Object.values(localSeed.analyses ?? {})) {
    const { docId, payload } = buildAnalysisPayload(uid, analysis);
    const ref = doc(db, 'users', uid, 'analyses', docId);
    ops.push((b) => b.set(ref, payload));
  }

  for (const cycle of (localSeed.studyHistory ?? []).slice(0, 25)) {
    const { safeId, payload } = buildStudyCyclePayload(uid, cycle);
    const ref = doc(db, 'users', uid, 'studyHistory', safeId);
    ops.push((b) => b.set(ref, payload));
  }

  await commitOperationsInChunks(ops, `${userPath}/migration`);
}

export function subscribeUserCloudWorkspace(
  uid: string,
  onData: (data: CloudWorkspaceData) => void,
  onError: (err: unknown) => void
): Unsubscribe {
  let portfolioName = 'MINHA CARTEIRA';
  let settings: AppSettings = { ...DEFAULT_CLOUD_SETTINGS };
  let watchlist: WatchlistAsset[] = [];
  let transactions: PortfolioTransaction[] = [];
  let triggers: PriceTrigger[] = [];
  let alerts: SignalAlert[] = [];
  let analyses: Record<string, AIAnalysisResult> = {};
  let studyHistory: StudyCycleSummary[] = [];

  const ready = {
    profile: false,
    watchlist: false,
    transactions: false,
    triggers: false,
    alerts: false,
    analyses: false,
    studyHistory: false,
  };

  const emitIfReady = () => {
    if (
      ready.profile &&
      ready.watchlist &&
      ready.transactions &&
      ready.triggers &&
      ready.alerts &&
      ready.analyses &&
      ready.studyHistory
    ) {
      onData({
        portfolioName,
        settings,
        watchlist: [...watchlist],
        transactions: [...transactions],
        triggers: [...triggers],
        alerts: [...alerts],
        analyses: { ...analyses },
        studyHistory: [...studyHistory],
      });
    }
  };

  const reportSnapshotError = (err: unknown, op: OperationType, path: string) => {
    try {
      handleFirestoreError(err, op, path);
    } catch (wrapped) {
      onError(wrapped);
    }
  };

  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as Record<string, any>;
          portfolioName = clampNonEmptyStr(d.portfolioName, 'MINHA CARTEIRA', 60);
          settings = sanitizeSettings(d.settings);
        }
        ready.profile = true;
        emitIfReady();
      },
      (err) => reportSnapshotError(err, OperationType.GET, `users/${uid}`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'watchlist'), where('ownerId', '==', uid)),
      (snap) => {
        watchlist = snap.docs
          .map((d) => {
            const v = d.data() as Record<string, any>;
            return {
              id: String(v.id || d.id),
              symbol: String(v.symbol || '').toUpperCase(),
              name: String(v.name || ''),
              binanceSymbol: v.binanceSymbol ? String(v.binanceSymbol) : undefined,
              addedAt: String(v.addedAt || new Date().toISOString()),
            } satisfies WatchlistAsset;
          })
          .sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime());
        ready.watchlist = true;
        emitIfReady();
      },
      (err) => reportSnapshotError(err, OperationType.LIST, `users/${uid}/watchlist`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'transactions'), where('ownerId', '==', uid)),
      (snap) => {
        transactions = snap.docs
          .map((d) => {
            const v = d.data() as Record<string, any>;
            return {
              id: String(v.id || d.id),
              coinId: String(v.coinId || ''),
              symbol: String(v.symbol || '').toUpperCase(),
              name: String(v.name || ''),
              type: (v.type as PortfolioTransaction['type']) || 'compra',
              quantity: Number(v.quantity) || 0,
              pricePerCoinUsd: Number(v.pricePerCoinUsd) || 0,
              feeUsd: Number(v.feeUsd) || 0,
              timestamp: String(v.timestamp || new Date().toISOString()),
              note: v.note ? String(v.note) : undefined,
            } satisfies PortfolioTransaction;
          })
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        ready.transactions = true;
        emitIfReady();
      },
      (err) => reportSnapshotError(err, OperationType.LIST, `users/${uid}/transactions`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'triggers'), where('ownerId', '==', uid)),
      (snap) => {
        triggers = snap.docs
          .map((d) => {
            const v = d.data() as Record<string, any>;
            return {
              id: String(v.id || d.id),
              coinId: String(v.coinId || ''),
              symbol: String(v.symbol || '').toUpperCase(),
              name: String(v.name || ''),
              conditionType: v.conditionType,
              targetValue: Number(v.targetValue) || 0,
              referencePriceUsd: Number(v.referencePriceUsd) || 0,
              actionHint: v.actionHint,
              repeatMode: v.repeatMode,
              cooldownMinutes: Number(v.cooldownMinutes) || 60,
              enabled: Boolean(v.enabled),
              sendWhatsApp: Boolean(v.sendWhatsApp),
              note: v.note ? String(v.note) : undefined,
              createdAt: String(v.createdAtStr || new Date().toISOString()),
              lastTriggeredAt: v.lastTriggeredAt ? String(v.lastTriggeredAt) : undefined,
              lastTriggeredPriceUsd:
                typeof v.lastTriggeredPriceUsd === 'number'
                  ? v.lastTriggeredPriceUsd
                  : undefined,
              lastDeliveryStatus: v.lastDeliveryStatus,
              lastDeliveryError: v.lastDeliveryError
                ? String(v.lastDeliveryError)
                : undefined,
              triggerCount: Number(v.triggerCount) || 0,
            } satisfies PriceTrigger;
          })
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        ready.triggers = true;
        emitIfReady();
      },
      (err) => reportSnapshotError(err, OperationType.LIST, `users/${uid}/triggers`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'alerts'), where('ownerId', '==', uid)),
      (snap) => {
        alerts = snap.docs
          .map((d) => {
            const v = d.data() as Record<string, any>;
            return {
              id: String(v.id || d.id),
              coinId: String(v.coinId || ''),
              symbol: String(v.symbol || '').toUpperCase(),
              name: String(v.name || ''),
              action: v.action,
              previousAction: v.previousAction,
              confidence: Number(v.confidence) || 0,
              priceAtSignalUsd: Number(v.priceAtSignalUsd) || 0,
              targetPriceUsd: Number(v.targetPriceUsd) || 0,
              stopLossUsd: Number(v.stopLossUsd) || 0,
              headline: String(v.headline || ''),
              reason: String(v.reason || ''),
              createdAt: String(v.createdAtStr || new Date().toISOString()),
              read: Boolean(v.read),
              outcome: v.outcome || 'em_aberto',
              evaluatedReturnPct:
                typeof v.evaluatedReturnPct === 'number'
                  ? v.evaluatedReturnPct
                  : undefined,
              evaluatedAt: v.evaluatedAt ? String(v.evaluatedAt) : undefined,
            } satisfies SignalAlert;
          })
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        ready.alerts = true;
        emitIfReady();
      },
      (err) => reportSnapshotError(err, OperationType.LIST, `users/${uid}/alerts`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'analyses'), where('ownerId', '==', uid)),
      (snap) => {
        const nextMap: Record<string, AIAnalysisResult> = {};
        for (const d of snap.docs) {
          const v = d.data() as Record<string, any>;
          const cid = String(v.coinId || d.id);
          nextMap[cid] = {
            coinId: cid,
            symbol: String(v.symbol || '').toUpperCase(),
            action: v.action,
            confidence: Number(v.confidence) || 0,
            horizon: v.horizon || 'curto_prazo',
            entryZoneLowUsd: Number(v.entryZoneLowUsd) || 0,
            entryZoneHighUsd: Number(v.entryZoneHighUsd) || 0,
            targetPriceUsd: Number(v.targetPriceUsd) || 0,
            stopLossUsd: Number(v.stopLossUsd) || 0,
            riskLevel: v.riskLevel || 'moderado',
            headline: String(v.headline || ''),
            thesis: String(v.thesis || ''),
            portfolioAdvice: v.portfolioAdvice ? String(v.portfolioAdvice) : undefined,
            technicalFactors: Array.isArray(v.technicalFactors) ? v.technicalFactors : [],
            riskFactors: Array.isArray(v.riskFactors) ? v.riskFactors : [],
            selfLearningNote: String(v.selfLearningNote || ''),
            priceAtAnalysisUsd: Number(v.priceAtAnalysisUsd) || 0,
            analyzedAt: String(v.analyzedAt || new Date().toISOString()),
            cycleId: String(v.cycleId || ''),
          };
        }
        analyses = nextMap;
        ready.analyses = true;
        emitIfReady();
      },
      (err) => reportSnapshotError(err, OperationType.LIST, `users/${uid}/analyses`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'studyHistory'), where('ownerId', '==', uid)),
      (snap) => {
        studyHistory = snap.docs
          .map((d) => {
            const v = d.data() as Record<string, any>;
            return {
              id: String(v.id || d.id),
              startedAt: String(v.startedAt || ''),
              completedAt: String(v.completedAt || ''),
              assetsStudied: Number(v.assetsStudied) || 0,
              buySignals: Number(v.buySignals) || 0,
              sellSignals: Number(v.sellSignals) || 0,
              holdSignals: Number(v.holdSignals) || 0,
              alertsEmitted: Number(v.alertsEmitted) || 0,
              evaluatedAccuracyPct:
                typeof v.evaluatedAccuracyPct === 'number'
                  ? v.evaluatedAccuracyPct
                  : null,
              trigger: v.trigger || 'automatico',
              marketSummary: String(v.marketSummary || ''),
            } satisfies StudyCycleSummary;
          })
          .sort(
            (a, b) =>
              new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
          );
        ready.studyHistory = true;
        emitIfReady();
      },
      (err) => reportSnapshotError(err, OperationType.LIST, `users/${uid}/studyHistory`)
    )
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}

// ============================================================================
// Cloud Mutations
// ============================================================================

export async function cloudUpdateSettings(
  uid: string,
  nextSettings: AppSettings
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      settings: sanitizeSettings(nextSettings),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function cloudRenamePortfolio(uid: string, name: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      portfolioName: clampNonEmptyStr(name, 'MINHA CARTEIRA', 60),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function cloudAddWatchlistAsset(
  uid: string,
  asset: WatchlistAsset
): Promise<void> {
  const docId = toSafeDocId(asset.id);
  const path = `users/${uid}/watchlist/${docId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'watchlist', docId), buildWatchlistPayload(uid, asset));
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function cloudRemoveWatchlistAsset(
  uid: string,
  coinId: string
): Promise<void> {
  const docId = toSafeDocId(coinId);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid, 'watchlist', docId));
  batch.delete(doc(db, 'users', uid, 'analyses', docId));
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}/watchlist/${docId}`);
  }
}

export async function cloudAddTransaction(
  uid: string,
  tx: PortfolioTransaction,
  autoWatchlistAsset?: WatchlistAsset | null
): Promise<void> {
  const batch = writeBatch(db);
  if (autoWatchlistAsset) {
    const assetDocId = toSafeDocId(autoWatchlistAsset.id);
    batch.set(
      doc(db, 'users', uid, 'watchlist', assetDocId),
      buildWatchlistPayload(uid, autoWatchlistAsset)
    );
  }
  const { safeId, payload } = buildTransactionPayload(uid, tx);
  batch.set(doc(db, 'users', uid, 'transactions', safeId), payload);
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${uid}/transactions/${safeId}`);
  }
}

export async function cloudDeleteTransaction(uid: string, txId: string): Promise<void> {
  const docId = toSafeDocId(txId);
  const path = `users/${uid}/transactions/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'transactions', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function cloudDeleteTransactionsBatch(
  uid: string,
  txIds: string[]
): Promise<void> {
  const ops = txIds.map((id) => {
    const docId = toSafeDocId(id);
    return (b: ReturnType<typeof writeBatch>) =>
      b.delete(doc(db, 'users', uid, 'transactions', docId));
  });
  await commitOperationsInChunks(ops, `users/${uid}/transactions`);
}

export async function cloudCreateTrigger(
  uid: string,
  trig: PriceTrigger
): Promise<void> {
  const { safeId, payload } = buildTriggerPayload(uid, trig);
  const path = `users/${uid}/triggers/${safeId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'triggers', safeId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function cloudUpdateTrigger(
  uid: string,
  triggerId: string,
  patch: Partial<PriceTrigger>
): Promise<void> {
  const docId = toSafeDocId(triggerId);
  const path = `users/${uid}/triggers/${docId}`;
  const updateBody: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (typeof patch.enabled === 'boolean') updateBody.enabled = patch.enabled;
  if (typeof patch.sendWhatsApp === 'boolean') updateBody.sendWhatsApp = patch.sendWhatsApp;
  if (typeof patch.targetValue === 'number' && patch.targetValue > 0) {
    updateBody.targetValue = patch.targetValue;
  }
  if (typeof patch.referencePriceUsd === 'number' && patch.referencePriceUsd >= 0) {
    updateBody.referencePriceUsd = patch.referencePriceUsd;
  }
  if (
    patch.actionHint === 'COMPRAR' ||
    patch.actionHint === 'VENDER' ||
    patch.actionHint === 'AVALIAR'
  ) {
    updateBody.actionHint = patch.actionHint;
  }
  if (patch.repeatMode === 'uma_vez' || patch.repeatMode === 'continuo') {
    updateBody.repeatMode = patch.repeatMode;
  }
  if (typeof patch.cooldownMinutes === 'number') {
    updateBody.cooldownMinutes = Math.max(1, Math.min(1440, Math.round(patch.cooldownMinutes)));
  }
  if (typeof patch.triggerCount === 'number' && patch.triggerCount >= 0) {
    updateBody.triggerCount = Math.round(patch.triggerCount);
  }
  if (patch.lastTriggeredAt) {
    updateBody.lastTriggeredAt = clampStr(patch.lastTriggeredAt, 48);
  }
  if (typeof patch.lastTriggeredPriceUsd === 'number') {
    updateBody.lastTriggeredPriceUsd = patch.lastTriggeredPriceUsd;
  }
  if (patch.lastDeliveryStatus) {
    updateBody.lastDeliveryStatus = patch.lastDeliveryStatus;
  }
  if (patch.lastDeliveryError !== undefined) {
    updateBody.lastDeliveryError = patch.lastDeliveryError
      ? clampStr(patch.lastDeliveryError, 300)
      : deleteField();
  }

  try {
    await updateDoc(doc(db, 'users', uid, 'triggers', docId), updateBody);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function cloudDeleteTrigger(
  uid: string,
  triggerId: string
): Promise<void> {
  const docId = toSafeDocId(triggerId);
  const path = `users/${uid}/triggers/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'triggers', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function cloudClearTriggers(
  uid: string,
  triggerIds: string[]
): Promise<void> {
  const ops = triggerIds.map((id) => {
    const docId = toSafeDocId(id);
    return (b: ReturnType<typeof writeBatch>) =>
      b.delete(doc(db, 'users', uid, 'triggers', docId));
  });
  await commitOperationsInChunks(ops, `users/${uid}/triggers`);
}

export async function cloudMarkAlertsRead(
  uid: string,
  unreadAlertIds: string[]
): Promise<void> {
  const ops = unreadAlertIds.map((id) => {
    const docId = toSafeDocId(id);
    return (b: ReturnType<typeof writeBatch>) =>
      b.update(doc(db, 'users', uid, 'alerts', docId), {
        read: true,
        updatedAt: serverTimestamp(),
      });
  });
  await commitOperationsInChunks(ops, `users/${uid}/alerts`);
}

export async function cloudDeleteAlert(uid: string, alertId: string): Promise<void> {
  const docId = toSafeDocId(alertId);
  const path = `users/${uid}/alerts/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'alerts', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function cloudClearAlerts(uid: string, alertIds: string[]): Promise<void> {
  const ops = alertIds.map((id) => {
    const docId = toSafeDocId(id);
    return (b: ReturnType<typeof writeBatch>) =>
      b.delete(doc(db, 'users', uid, 'alerts', docId));
  });
  await commitOperationsInChunks(ops, `users/${uid}/alerts`);
}

export async function cloudDeleteStudyCycle(
  uid: string,
  cycleId: string
): Promise<void> {
  const docId = toSafeDocId(cycleId);
  const path = `users/${uid}/studyHistory/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'studyHistory', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function cloudClearStudyHistory(
  uid: string,
  cycleIds: string[]
): Promise<void> {
  const ops = cycleIds.map((id) => {
    const docId = toSafeDocId(id);
    return (b: ReturnType<typeof writeBatch>) =>
      b.delete(doc(db, 'users', uid, 'studyHistory', docId));
  });
  await commitOperationsInChunks(ops, `users/${uid}/studyHistory`);
}

export async function cloudSaveStudyResults(
  uid: string,
  analyses: AIAnalysisResult[],
  newAlerts: SignalAlert[],
  cycle?: StudyCycleSummary | null
): Promise<void> {
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  for (const analysis of analyses) {
    const { docId, payload } = buildAnalysisPayload(uid, analysis);
    const ref = doc(db, 'users', uid, 'analyses', docId);
    ops.push((b) => b.set(ref, payload));
  }

  for (const alert of newAlerts) {
    const { safeId, payload } = buildAlertPayload(uid, alert);
    const ref = doc(db, 'users', uid, 'alerts', safeId);
    ops.push((b) => b.set(ref, payload));
  }

  if (cycle) {
    const { safeId, payload } = buildStudyCyclePayload(uid, cycle);
    const ref = doc(db, 'users', uid, 'studyHistory', safeId);
    ops.push((b) => b.set(ref, payload));
  }

  await commitOperationsInChunks(ops, `users/${uid}/studyResults`);
}

export async function cloudSaveAlertsAndTriggerUpdates(
  uid: string,
  updatedTriggers: PriceTrigger[],
  newAlerts: SignalAlert[],
  evaluatedAlerts: Array<{
    id: string;
    outcome: SignalAlert['outcome'];
    evaluatedReturnPct: number;
    evaluatedAt: string;
  }> = []
): Promise<void> {
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  for (const trig of updatedTriggers) {
    const docId = toSafeDocId(trig.id);
    const patch: Record<string, unknown> = {
      enabled: Boolean(trig.enabled),
      referencePriceUsd: Math.max(0, Number(trig.referencePriceUsd) || 0),
      triggerCount: Math.max(0, Math.round(Number(trig.triggerCount) || 0)),
      updatedAt: serverTimestamp(),
    };
    if (trig.lastTriggeredAt) patch.lastTriggeredAt = clampStr(trig.lastTriggeredAt, 48);
    if (typeof trig.lastTriggeredPriceUsd === 'number') {
      patch.lastTriggeredPriceUsd = trig.lastTriggeredPriceUsd;
    }
    if (trig.lastDeliveryStatus) patch.lastDeliveryStatus = trig.lastDeliveryStatus;
    if (trig.lastDeliveryError) {
      patch.lastDeliveryError = clampStr(trig.lastDeliveryError, 300);
    } else {
      patch.lastDeliveryError = deleteField();
    }
    ops.push((b) => b.update(doc(db, 'users', uid, 'triggers', docId), patch));
  }

  for (const alert of newAlerts) {
    const { safeId, payload } = buildAlertPayload(uid, alert);
    ops.push((b) => b.set(doc(db, 'users', uid, 'alerts', safeId), payload));
  }

  for (const ev of evaluatedAlerts) {
    const docId = toSafeDocId(ev.id);
    ops.push((b) =>
      b.update(doc(db, 'users', uid, 'alerts', docId), {
        outcome: ev.outcome,
        evaluatedReturnPct: ev.evaluatedReturnPct,
        evaluatedAt: clampStr(ev.evaluatedAt, 48),
        updatedAt: serverTimestamp(),
      })
    );
  }

  await commitOperationsInChunks(ops, `users/${uid}/triggerUpdates`);
}
