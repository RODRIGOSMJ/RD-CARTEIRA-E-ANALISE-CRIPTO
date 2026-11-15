import type { TelegramSettings, WhatsAppSettings } from '../types/crypto.ts';

export type AlertChannelChoice = 'telegram' | 'whatsapp';
export type PythonCredentialMode = 'secrets' | 'inline';
export type PythonIntervalMinutes = 5 | 10 | 15 | 30;

export interface PythonGeneratorPrefs {
  credentialMode: PythonCredentialMode;
  intervalMinutes: PythonIntervalMinutes;
  includePortfolioAlerts: boolean;
  portfolioSwingPct: number;
  enableDailyNewsSummary: boolean;
  dailySummaryHourBrt: number;
  useGeminiSummary: boolean;
}

export interface AlertChannelLocalCache {
  preferredChannel: AlertChannelChoice;
  telegram: TelegramSettings;
  whatsapp: Partial<WhatsAppSettings>;
  pythonGen: PythonGeneratorPrefs;
}

const ALERT_CHANNEL_STORAGE_KEY = 'sinalcripto_alert_channels_v1';

const DEFAULT_CACHE: AlertChannelLocalCache = {
  preferredChannel: 'telegram',
  telegram: {
    enabled: false,
    botToken: '',
    chatId: '',
    forwardAiSignals: true,
  },
  whatsapp: {},
  pythonGen: {
    credentialMode: 'secrets',
    intervalMinutes: 5,
    includePortfolioAlerts: true,
    portfolioSwingPct: 5,
    enableDailyNewsSummary: true,
    dailySummaryHourBrt: 8,
    useGeminiSummary: true,
  },
};

export function loadAlertChannelCache(): AlertChannelLocalCache {
  if (typeof window === 'undefined') return { ...DEFAULT_CACHE };
  try {
    const raw = window.localStorage.getItem(ALERT_CHANNEL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CACHE };
    const parsed = JSON.parse(raw) as Partial<AlertChannelLocalCache>;
    const interval = Number(parsed?.pythonGen?.intervalMinutes);
    const validInterval: PythonIntervalMinutes =
      interval === 10 || interval === 15 || interval === 30 ? interval : 5;
    const swing = Number(parsed?.pythonGen?.portfolioSwingPct);
    const summaryHour = Number(parsed?.pythonGen?.dailySummaryHourBrt);
    return {
      preferredChannel:
        parsed?.preferredChannel === 'whatsapp' ? 'whatsapp' : 'telegram',
      telegram: {
        ...DEFAULT_CACHE.telegram,
        ...(parsed?.telegram ?? {}),
        botToken: String(parsed?.telegram?.botToken ?? ''),
        chatId: String(parsed?.telegram?.chatId ?? ''),
        enabled: Boolean(parsed?.telegram?.enabled),
        forwardAiSignals:
          typeof parsed?.telegram?.forwardAiSignals === 'boolean'
            ? parsed.telegram.forwardAiSignals
            : true,
      },
      whatsapp: parsed?.whatsapp ?? {},
      pythonGen: {
        credentialMode:
          parsed?.pythonGen?.credentialMode === 'inline' ? 'inline' : 'secrets',
        intervalMinutes: validInterval,
        includePortfolioAlerts:
          typeof parsed?.pythonGen?.includePortfolioAlerts === 'boolean'
            ? parsed.pythonGen.includePortfolioAlerts
            : true,
        portfolioSwingPct:
          Number.isFinite(swing) && swing >= 1 && swing <= 50 ? swing : 5,
        enableDailyNewsSummary:
          typeof parsed?.pythonGen?.enableDailyNewsSummary === 'boolean'
            ? parsed.pythonGen.enableDailyNewsSummary
            : true,
        dailySummaryHourBrt:
          Number.isFinite(summaryHour) && summaryHour >= 0 && summaryHour <= 23
            ? Math.floor(summaryHour)
            : 8,
        useGeminiSummary:
          typeof parsed?.pythonGen?.useGeminiSummary === 'boolean'
            ? parsed.pythonGen.useGeminiSummary
            : true,
      },
    };
  } catch {
    return { ...DEFAULT_CACHE };
  }
}

function writeCache(next: AlertChannelLocalCache): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ALERT_CHANNEL_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage quota errors
  }
}

export function savePreferredAlertChannel(channel: AlertChannelChoice): void {
  const curr = loadAlertChannelCache();
  writeCache({ ...curr, preferredChannel: channel });
}

export function saveTelegramCache(telegram: Partial<TelegramSettings>): void {
  const curr = loadAlertChannelCache();
  writeCache({
    ...curr,
    telegram: {
      ...curr.telegram,
      ...telegram,
    },
  });
}

export function saveWhatsAppCache(whatsapp: Partial<WhatsAppSettings>): void {
  const curr = loadAlertChannelCache();
  writeCache({
    ...curr,
    whatsapp: {
      ...curr.whatsapp,
      ...whatsapp,
    },
  });
}

export function savePythonGenCache(prefs: Partial<PythonGeneratorPrefs>): void {
  const curr = loadAlertChannelCache();
  writeCache({
    ...curr,
    pythonGen: {
      ...curr.pythonGen,
      ...prefs,
    },
  });
}
