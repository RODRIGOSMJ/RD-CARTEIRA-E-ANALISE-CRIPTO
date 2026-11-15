import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Send,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiDetectTelegramChatId, apiTestTelegram } from '../services/apiClient.ts';
import type { AppSettings, TelegramSettings } from '../types/crypto.ts';
import {
  loadAlertChannelCache,
  savePreferredAlertChannel,
  saveTelegramCache,
} from '../utils/alertChannelStorage.ts';

interface TelegramSettingsPanelProps {
  telegram: TelegramSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const DEFAULT_TELEGRAM_DRAFT: TelegramSettings = {
  enabled: false,
  botToken: '',
  chatId: '',
  forwardAiSignals: true,
};

function isValidToken(token: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token.trim());
}

function hasRequiredTelegramCredentials(t: TelegramSettings): boolean {
  return isValidToken(t.botToken) && t.chatId.trim().length > 0;
}

export function TelegramSettingsPanel({
  telegram,
  onUpdateSettings,
}: TelegramSettingsPanelProps) {
  const [draft, setDraft] = useState<TelegramSettings>(() => {
    const cached = loadAlertChannelCache().telegram;
    return {
      ...DEFAULT_TELEGRAM_DRAFT,
      ...telegram,
      botToken: telegram.botToken || cached.botToken || '',
      chatId: telegram.chatId || cached.chatId || '',
    };
  });
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  useEffect(() => {
    const cached = loadAlertChannelCache().telegram;
    setDraft((prev) => ({
      ...DEFAULT_TELEGRAM_DRAFT,
      ...telegram,
      botToken: telegram.botToken || prev.botToken || cached.botToken || '',
      chatId: telegram.chatId || prev.chatId || cached.chatId || '',
    }));
  }, [telegram]);

  const setField = <K extends keyof TelegramSettings>(
    key: K,
    val: TelegramSettings[K]
  ) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: val };
      saveTelegramCache(next);
      return next;
    });
  };

  function prepareCleaned(autoActivateIfReady: boolean): TelegramSettings {
    const cleaned: TelegramSettings = {
      enabled: draft.enabled,
      botToken: draft.botToken.trim(),
      chatId: draft.chatId.trim(),
      forwardAiSignals: draft.forwardAiSignals,
    };
    if (autoActivateIfReady && !cleaned.enabled && hasRequiredTelegramCredentials(cleaned)) {
      cleaned.enabled = true;
    }
    return cleaned;
  }

  async function handleSave() {
    setSaving(true);
    setStatusMsg(null);
    try {
      const prepared = prepareCleaned(true);
      setDraft(prepared);
      saveTelegramCache(prepared);
      savePreferredAlertChannel('telegram');
      await onUpdateSettings({ telegram: prepared });
      setStatusMsg({
        type: 'ok',
        text: prepared.enabled
          ? 'Configuração salva e Telegram 24h ativado com sucesso.'
          : 'Configuração de Telegram 24h salva com sucesso.',
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Erro ao salvar configuração do Telegram.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled() {
    const next = { ...draft, enabled: !draft.enabled };
    setDraft(next);
    setStatusMsg(null);
    try {
      await onUpdateSettings({ telegram: next });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Erro ao atualizar status do Telegram.',
      });
    }
  }

  async function handleDetectChatId() {
    setDetecting(true);
    setStatusMsg(null);
    try {
      const res = await apiDetectTelegramChatId(draft.botToken);
      const next: TelegramSettings = {
        ...draft,
        botToken: draft.botToken.trim(),
        chatId: res.chatId,
        enabled: isValidToken(draft.botToken) ? true : draft.enabled,
      };
      setDraft(next);
      await onUpdateSettings({ telegram: next });
      setStatusMsg({
        type: 'ok',
        text: `Chat ID detectado (${res.chatLabel}: ${res.chatId}) e salvo automaticamente!`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text:
          err?.message ||
          'Não foi possível detectar o Chat ID. Envie /start para o seu bot no Telegram e tente novamente.',
      });
    } finally {
      setDetecting(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setStatusMsg(null);
    try {
      const prepared = prepareCleaned(false);
      setDraft(prepared);
      await onUpdateSettings({ telegram: prepared });
      await apiTestTelegram(prepared);

      if (!prepared.enabled) {
        const activated = { ...prepared, enabled: true };
        setDraft(activated);
        await onUpdateSettings({ telegram: activated });
      }

      setStatusMsg({
        type: 'ok',
        text: 'Mensagem de teste enviada para o seu Telegram e alertas 24h ativados!',
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Falha ao enviar teste no Telegram.',
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Send className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            Envio automático no Telegram (24h)
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Alertas instantâneos e gratuitos via bot oficial do Telegram no celular, tablet ou PC.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleToggleEnabled()}
          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
            draft.enabled
              ? 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
              : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {draft.enabled ? 'Telegram ativo' : 'Telegram pausado'}
        </button>
      </div>

      {/* Quick setup guide */}
      <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17] px-3.5 py-2.5 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed space-y-1.5">
        <p className="font-semibold text-slate-900 dark:text-slate-100">
          Ativação gratuita e ilimitada em 1 minuto:
        </p>
        <p>
          1. Abra o{' '}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono font-semibold text-sky-700 dark:text-sky-400 hover:underline"
          >
            @BotFather
            <ExternalLink className="w-2.5 h-2.5" />
          </a>{' '}
          no Telegram, envie <span className="font-mono text-slate-900 dark:text-slate-100">/newbot</span> e cole o <strong>Bot Token</strong> abaixo.
        </p>
        <p>
          2. Abra o seu novo bot no Telegram e envie <span className="font-mono text-slate-900 dark:text-slate-100">/start</span> (ou &quot;oi&quot;).
        </p>
        <p>
          3. Clique em <strong>Detectar Chat ID</strong> abaixo para preencher automaticamente.
        </p>
      </div>

      {/* Bot Token */}
      <div>
        <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
          Telegram Bot Token (@BotFather)
        </label>
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={draft.botToken}
            onChange={(e) => setField('botToken', e.target.value)}
            placeholder="Ex: 7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="w-full pl-3 pr-9 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            title={showToken ? 'Ocultar token' : 'Mostrar token'}
            aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-0.5"
          >
            {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Chat ID + auto detect */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label className="block text-xs text-slate-700 dark:text-slate-400">
            Telegram Chat ID (seu usuário, grupo ou canal)
          </label>
          <button
            type="button"
            onClick={() => void handleDetectChatId()}
            disabled={detecting || !draft.botToken.trim()}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 disabled:opacity-45 whitespace-nowrap"
          >
            {detecting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {detecting ? 'Detectando...' : 'Detectar Chat ID'}
          </button>
        </div>
        <input
          type="text"
          value={draft.chatId}
          onChange={(e) => setField('chatId', e.target.value)}
          placeholder="Ex: 123456789 ou -1001234567890"
          className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
        />
      </div>

      {/* Forward AI signals */}
      <label className="flex items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-white/[0.07] cursor-pointer">
        <span className="text-xs text-slate-700 dark:text-slate-300">
          Enviar também sinais automáticos de Compra/Venda da IA no Telegram
        </span>
        <input
          type="checkbox"
          checked={draft.forwardAiSignals}
          onChange={(e) => setField('forwardAiSignals', e.target.checked)}
          className="w-4 h-4 accent-sky-600 dark:accent-sky-500 cursor-pointer shrink-0"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          {saving ? 'Salvando...' : 'Salvar Telegram'}
        </button>

        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {testing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          {testing ? 'Enviando teste...' : 'Enviar teste no Telegram'}
        </button>
      </div>

      {statusMsg && (
        <p
          className={`text-xs rounded-lg px-3 py-2 border ${
            statusMsg.type === 'ok'
              ? 'text-emerald-700 bg-emerald-50 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-500/10 dark:border-emerald-500/25'
              : 'text-rose-700 bg-rose-50 border-rose-300 dark:text-rose-300 dark:bg-rose-500/10 dark:border-rose-500/25'
          }`}
        >
          {statusMsg.text}
        </p>
      )}
    </div>
  );
}
