import {
  Bell,
  Check,
  Eye,
  EyeOff,
  Loader2,
  MessageSquare,
  Send,
  Terminal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiTestTelegram, apiTestWebhook } from '../services/apiClient.ts';
import type { AppSettings, TelegramSettings } from '../types/crypto.ts';
import {
  loadAlertChannelCache,
  savePreferredAlertChannel,
  saveTelegramCache,
  type AlertChannelChoice,
} from '../utils/alertChannelStorage.ts';

interface AutomationSettingsPanelProps {
  settings: AppSettings;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onOpenPythonGenerator?: () => void;
  onOpenWhatsAppConfig?: () => void;
}

const DEFAULT_TG: TelegramSettings = {
  enabled: false,
  botToken: '',
  chatId: '',
  forwardAiSignals: true,
};

export function AutomationSettingsPanel({
  settings,
  soundEnabled,
  onToggleSound,
  onUpdateSettings,
  onOpenPythonGenerator,
  onOpenWhatsAppConfig,
}: AutomationSettingsPanelProps) {
  const [webhookInput, setWebhookInput] = useState(settings.webhookUrl);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);
  const [notifPerm, setNotifPerm] = useState<string>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  );

  const [selectedChannel, setSelectedChannel] = useState<AlertChannelChoice>(
    () => loadAlertChannelCache().preferredChannel
  );
  const [tgToken, setTgToken] = useState<string>(
    () =>
      settings.telegram?.botToken ||
      loadAlertChannelCache().telegram.botToken ||
      ''
  );
  const [tgChatId, setTgChatId] = useState<string>(
    () =>
      settings.telegram?.chatId ||
      loadAlertChannelCache().telegram.chatId ||
      ''
  );
  const [showTgToken, setShowTgToken] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [testingChannel, setTestingChannel] = useState(false);
  const [channelStatus, setChannelStatus] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);

  useEffect(() => {
    setWebhookInput(settings.webhookUrl);
  }, [settings.webhookUrl]);

  useEffect(() => {
    if (settings.telegram?.botToken) {
      setTgToken(settings.telegram.botToken);
    }
    if (settings.telegram?.chatId) {
      setTgChatId(settings.telegram.chatId);
    }
  }, [settings.telegram?.botToken, settings.telegram?.chatId]);

  function handleChannelSelect(ch: AlertChannelChoice) {
    setSelectedChannel(ch);
    savePreferredAlertChannel(ch);
    setChannelStatus(null);
  }

  function handleTgTokenChange(val: string) {
    setTgToken(val);
    saveTelegramCache({ botToken: val.trim() });
  }

  function handleTgChatIdChange(val: string) {
    setTgChatId(val);
    saveTelegramCache({ chatId: val.trim() });
  }

  async function handleSaveTelegramQuick() {
    setSavingChannel(true);
    setChannelStatus(null);
    try {
      const nextTg: TelegramSettings = {
        ...DEFAULT_TG,
        ...(settings.telegram ?? {}),
        botToken: tgToken.trim(),
        chatId: tgChatId.trim(),
        enabled: tgToken.trim().length > 0 && tgChatId.trim().length > 0,
      };
      saveTelegramCache(nextTg);
      savePreferredAlertChannel('telegram');
      await onUpdateSettings({ telegram: nextTg });
      setChannelStatus({
        type: 'ok',
        msg: 'Telegram Bot Token e Chat ID salvos no localStorage e ativados.',
      });
    } catch (err: any) {
      setChannelStatus({
        type: 'err',
        msg: err?.message || 'Erro ao salvar configuração do Telegram.',
      });
    } finally {
      setSavingChannel(false);
    }
  }

  async function handleTestTelegramQuick() {
    setTestingChannel(true);
    setChannelStatus(null);
    try {
      const nextTg: TelegramSettings = {
        ...DEFAULT_TG,
        ...(settings.telegram ?? {}),
        botToken: tgToken.trim(),
        chatId: tgChatId.trim(),
        enabled: true,
      };
      saveTelegramCache(nextTg);
      await onUpdateSettings({ telegram: nextTg });
      await apiTestTelegram(nextTg);
      setChannelStatus({
        type: 'ok',
        msg: 'Alerta de teste enviado no Telegram com sucesso!',
      });
    } catch (err: any) {
      setChannelStatus({
        type: 'err',
        msg: err?.message || 'Erro ao enviar teste no Telegram.',
      });
    } finally {
      setTestingChannel(false);
    }
  }

  async function requestNotificationPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setNotifPerm(perm);
    } catch {
      // ignore
    }
  }

  async function handleSaveWebhook() {
    setSavingWebhook(true);
    setWebhookStatus(null);
    try {
      await onUpdateSettings({ webhookUrl: webhookInput });
      setWebhookStatus({ type: 'ok', msg: 'Webhook salvo com sucesso.' });
    } catch (err: any) {
      setWebhookStatus({
        type: 'err',
        msg: err?.message || 'Erro ao salvar webhook.',
      });
    } finally {
      setSavingWebhook(false);
    }
  }

  async function handleTestWebhook() {
    setTestingWebhook(true);
    setWebhookStatus(null);
    try {
      await apiTestWebhook(webhookInput);
      setWebhookStatus({ type: 'ok', msg: 'Mensagem de teste enviada.' });
    } catch (err: any) {
      setWebhookStatus({
        type: 'err',
        msg: err?.message || 'Erro ao testar webhook.',
      });
    } finally {
      setTestingWebhook(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Automação e alertas
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Configure a frequência com que a IA estuda o mercado sozinha.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            onUpdateSettings({ autoStudyEnabled: !settings.autoStudyEnabled })
          }
          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
            settings.autoStudyEnabled
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'
              : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {settings.autoStudyEnabled ? 'Autoestudo ativo' : 'Autoestudo pausado'}
        </button>
      </div>

      {/* Interval & Currency */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-200 dark:border-white/[0.07]">
        <div>
          <label className="block text-xs text-slate-600 dark:text-slate-400 mb-2">
            Intervalo de estudo autônomo
          </label>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.07]">
            {[1, 5, 15, 30].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => onUpdateSettings({ intervalMinutes: mins })}
                className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                  settings.intervalMinutes === mins
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {mins}m
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-600 dark:text-slate-400 mb-2">
            Moeda de exibição
          </label>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.07]">
            {(['BRL', 'USD'] as const).map((curr) => (
              <button
                key={curr}
                type="button"
                onClick={() => onUpdateSettings({ currency: curr })}
                className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                  settings.currency === curr
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {curr === 'BRL' ? 'Real (R$)' : 'Dólar (US$)'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Confidence threshold */}
      <div className="pt-3 border-t border-slate-200 dark:border-white/[0.07]">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-slate-600 dark:text-slate-400">
            Confiança mínima para disparar alerta automático
          </span>
          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {settings.minConfidenceForAlert}%
          </span>
        </div>
        <input
          type="range"
          min={50}
          max={90}
          step={5}
          value={settings.minConfidenceForAlert}
          onChange={(e) =>
            onUpdateSettings({ minConfidenceForAlert: Number(e.target.value) })
          }
          className="w-full accent-sky-600 dark:accent-sky-500 cursor-pointer"
        />
      </div>

      {/* Browser Push & Sound */}
      <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-slate-200 dark:border-white/[0.07]">
        {notifPerm !== 'unsupported' && (
          <button
            type="button"
            onClick={requestNotificationPermission}
            disabled={notifPerm === 'granted'}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              notifPerm === 'granted'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 cursor-default'
                : 'border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
          >
            {notifPerm === 'granted' ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Bell className="w-3.5 h-3.5" />
            )}
            {notifPerm === 'granted'
              ? 'Notificações do navegador ativas'
              : 'Ativar alertas no navegador'}
          </button>
        )}

        <button
          type="button"
          onClick={onToggleSound}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
            soundEnabled
              ? 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
              : 'border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
          }`}
        >
          {soundEnabled ? (
            <Volume2 className="w-3.5 h-3.5" />
          ) : (
            <VolumeX className="w-3.5 h-3.5" />
          )}
          {soundEnabled ? 'Som de alerta ligado' : 'Som desligado'}
        </button>
      </div>

      {/* Alert Channel Selector: Telegram vs WhatsApp */}
      <div className="pt-3 border-t border-slate-200 dark:border-white/[0.07] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Canal de Alertas Automáticos
          </label>
          {onOpenPythonGenerator && (
            <button
              type="button"
              onClick={onOpenPythonGenerator}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:underline whitespace-nowrap"
            >
              <Terminal className="w-3 h-3" />
              Gerador Python 24/7
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.07]">
          <button
            type="button"
            onClick={() => handleChannelSelect('telegram')}
            className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              selectedChannel === 'telegram'
                ? 'bg-sky-600 text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            Telegram
          </button>
          <button
            type="button"
            onClick={() => handleChannelSelect('whatsapp')}
            className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              selectedChannel === 'whatsapp'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            WhatsApp
          </button>
        </div>

        {selectedChannel === 'telegram' ? (
          <div className="space-y-2.5 rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17] p-3">
            <div>
              <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                Telegram Bot Token (@BotFather)
              </label>
              <div className="relative">
                <input
                  type={showTgToken ? 'text' : 'password'}
                  value={tgToken}
                  onChange={(e) => handleTgTokenChange(e.target.value)}
                  placeholder="Ex: 7123456789:AAHxxxxxxxx..."
                  className="w-full pl-3 pr-9 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  onClick={() => setShowTgToken((v) => !v)}
                  aria-label={showTgToken ? 'Ocultar token' : 'Mostrar token'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-0.5"
                >
                  {showTgToken ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                Telegram Chat ID
              </label>
              <input
                type="text"
                value={tgChatId}
                onChange={(e) => handleTgChatIdChange(e.target.value)}
                placeholder="Ex: 123456789"
                className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => void handleSaveTelegramQuick()}
                disabled={savingChannel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50"
              >
                {savingChannel ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                {savingChannel ? 'Salvando...' : 'Salvar Telegram'}
              </button>
              <button
                type="button"
                onClick={() => void handleTestTelegramQuick()}
                disabled={testingChannel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50"
              >
                {testingChannel ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Testar Telegram
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17] p-3 text-xs flex items-center justify-between gap-2">
            <div>
              <p className="text-slate-700 dark:text-slate-300 font-medium">
                WhatsApp: {settings.whatsapp.phoneNumber || 'Não configurado'}
              </p>
              <p className="text-[11px] text-slate-500">
                {settings.whatsapp.enabled ? 'Envio 24h ativo' : 'Envio pausado'}
              </p>
            </div>
            {onOpenWhatsAppConfig && (
              <button
                type="button"
                onClick={onOpenWhatsAppConfig}
                className="px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 whitespace-nowrap"
              >
                Configurar WhatsApp
              </button>
            )}
          </div>
        )}

        {channelStatus && (
          <p
            className={`text-xs ${
              channelStatus.type === 'ok'
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-rose-700 dark:text-rose-400'
            }`}
          >
            {channelStatus.msg}
          </p>
        )}
      </div>

      {/* Optional Webhook Integration */}
      <div className="pt-3 border-t border-slate-200 dark:border-white/[0.07] space-y-2">
        <label className="block text-xs text-slate-600 dark:text-slate-400">
          Webhook externo opcional (Discord, Slack ou endpoint próprio)
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            type="url"
            value={webhookInput}
            onChange={(e) => setWebhookInput(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className="flex-1 min-w-[200px] px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500 font-mono"
          />
          <button
            type="button"
            onClick={handleSaveWebhook}
            disabled={savingWebhook}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            {savingWebhook ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={handleTestWebhook}
            disabled={testingWebhook || !webhookInput.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            Testar
          </button>
        </div>
        {webhookStatus && (
          <p
            className={`text-xs ${
              webhookStatus.type === 'ok'
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-rose-700 dark:text-rose-400'
            }`}
          >
            {webhookStatus.msg}
          </p>
        )}
      </div>
    </div>
  );
}
