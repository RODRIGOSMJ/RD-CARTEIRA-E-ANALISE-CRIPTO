import {
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiDetectTelegramChatId, apiTestTelegram } from '../services/apiClient.ts';
import type {
  AppSettings,
  PortfolioHolding,
  PriceTrigger,
  TelegramSettings,
  WatchlistAsset,
} from '../types/crypto.ts';
import {
  loadAlertChannelCache,
  savePreferredAlertChannel,
  savePythonGenCache,
  saveTelegramCache,
  type AlertChannelChoice,
  type PythonIntervalMinutes,
} from '../utils/alertChannelStorage.ts';
import {
  generateGitHubWorkflowYaml,
  generateMonitorPythonScript,
} from '../utils/pythonScriptGenerator.ts';

interface GitHubActionsPythonPanelProps {
  settings: AppSettings;
  watchlist: WatchlistAsset[];
  holdings: PortfolioHolding[];
  triggers: PriceTrigger[];
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onSwitchChannelTab?: (channel: AlertChannelChoice) => void;
}

const DEFAULT_TG: TelegramSettings = {
  enabled: false,
  botToken: '',
  chatId: '',
  forwardAiSignals: true,
};

export function GitHubActionsPythonPanel({
  settings,
  watchlist,
  holdings,
  triggers,
  onUpdateSettings,
  onSwitchChannelTab,
}: GitHubActionsPythonPanelProps) {
  const initialCache = useMemo(() => loadAlertChannelCache(), []);

  const [channel, setChannel] = useState<AlertChannelChoice>(
    initialCache.preferredChannel
  );
  const [tgToken, setTgToken] = useState<string>(
    settings.telegram?.botToken || initialCache.telegram.botToken || ''
  );
  const [tgChatId, setTgChatId] = useState<string>(
    settings.telegram?.chatId || initialCache.telegram.chatId || ''
  );
  const [showToken, setShowToken] = useState(false);

  const [pythonPrefs, setPythonPrefs] = useState(initialCache.pythonGen);
  const [codeTab, setCodeTab] = useState<'python' | 'yaml'>('python');
  const [copiedTab, setCopiedTab] = useState<'python' | 'yaml' | null>(null);

  const [savingCreds, setSavingCreds] = useState(false);
  const [detectingChat, setDetectingChat] = useState(false);
  const [testingTg, setTestingTg] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Sync from incoming settings updates when available
  useEffect(() => {
    const incomingToken = settings.telegram?.botToken ?? '';
    const incomingChat = settings.telegram?.chatId ?? '';
    if (incomingToken) {
      setTgToken(incomingToken);
      saveTelegramCache({ botToken: incomingToken });
    }
    if (incomingChat) {
      setTgChatId(incomingChat);
      saveTelegramCache({ chatId: incomingChat });
    }
  }, [settings.telegram?.botToken, settings.telegram?.chatId]);

  function handleSelectChannel(next: AlertChannelChoice) {
    setChannel(next);
    savePreferredAlertChannel(next);
    setStatusMsg(null);
  }

  function handleTokenChange(val: string) {
    setTgToken(val);
    saveTelegramCache({ botToken: val.trim() });
  }

  function handleChatIdChange(val: string) {
    setTgChatId(val);
    saveTelegramCache({ chatId: val.trim() });
  }

  function updatePythonPref<K extends keyof typeof pythonPrefs>(
    key: K,
    val: (typeof pythonPrefs)[K]
  ) {
    setPythonPrefs((prev) => {
      const next = { ...prev, [key]: val };
      savePythonGenCache({ [key]: val });
      return next;
    });
  }

  async function handleSaveCredentials() {
    setSavingCreds(true);
    setStatusMsg(null);
    try {
      const baseTg: TelegramSettings = {
        ...DEFAULT_TG,
        ...(settings.telegram ?? {}),
      };
      const cleanToken = tgToken.trim();
      const cleanChat = tgChatId.trim();
      const nextTg: TelegramSettings = {
        ...baseTg,
        botToken: cleanToken,
        chatId: cleanChat,
        enabled: cleanToken.length > 0 && cleanChat.length > 0 ? true : baseTg.enabled,
      };
      saveTelegramCache(nextTg);
      await onUpdateSettings({ telegram: nextTg });
      setStatusMsg({
        type: 'ok',
        text: 'Telegram Bot Token e Chat ID salvos no navegador (localStorage) e sincronizados.',
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Erro ao salvar credenciais do Telegram.',
      });
    } finally {
      setSavingCreds(false);
    }
  }

  async function handleDetectChat() {
    setDetectingChat(true);
    setStatusMsg(null);
    try {
      const res = await apiDetectTelegramChatId(tgToken);
      setTgChatId(res.chatId);
      const baseTg: TelegramSettings = {
        ...DEFAULT_TG,
        ...(settings.telegram ?? {}),
      };
      const nextTg: TelegramSettings = {
        ...baseTg,
        botToken: tgToken.trim(),
        chatId: res.chatId,
        enabled: true,
      };
      saveTelegramCache(nextTg);
      await onUpdateSettings({ telegram: nextTg });
      setStatusMsg({
        type: 'ok',
        text: `Chat ID detectado (${res.chatLabel}: ${res.chatId}) e salvo automaticamente!`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text:
          err?.message ||
          'Não foi possível detectar o Chat ID. Envie /start para o seu bot e tente novamente.',
      });
    } finally {
      setDetectingChat(false);
    }
  }

  async function handleTestTelegram() {
    setTestingTg(true);
    setStatusMsg(null);
    try {
      const baseTg: TelegramSettings = {
        ...DEFAULT_TG,
        ...(settings.telegram ?? {}),
      };
      const nextTg: TelegramSettings = {
        ...baseTg,
        botToken: tgToken.trim(),
        chatId: tgChatId.trim(),
        enabled: true,
      };
      saveTelegramCache(nextTg);
      await onUpdateSettings({ telegram: nextTg });
      await apiTestTelegram(nextTg);
      setStatusMsg({
        type: 'ok',
        text: 'Teste enviado com sucesso via API oficial do Telegram (sendMessage)!',
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Erro ao enviar mensagem de teste no Telegram.',
      });
    } finally {
      setTestingTg(false);
    }
  }

  const effectiveSettings = useMemo<AppSettings>(() => {
    const baseTg: TelegramSettings = {
      ...DEFAULT_TG,
      ...(settings.telegram ?? {}),
    };
    return {
      ...settings,
      telegram: {
        ...baseTg,
        botToken: tgToken.trim() || baseTg.botToken,
        chatId: tgChatId.trim() || baseTg.chatId,
      },
    };
  }, [settings, tgToken, tgChatId]);

  const pythonScript = useMemo(
    () =>
      generateMonitorPythonScript({
        channel,
        settings: effectiveSettings,
        watchlist,
        holdings,
        triggers,
        prefs: pythonPrefs,
      }),
    [channel, effectiveSettings, watchlist, holdings, triggers, pythonPrefs]
  );

  const workflowYaml = useMemo(
    () => generateGitHubWorkflowYaml(channel, pythonPrefs),
    [channel, pythonPrefs]
  );

  const displayedCode = codeTab === 'python' ? pythonScript : workflowYaml;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(displayedCode);
      setCopiedTab(codeTab);
      setTimeout(() => setCopiedTab(null), 2000);
    } catch {
      setStatusMsg({
        type: 'err',
        text: 'Não foi possível copiar automaticamente. Use o botão Baixar.',
      });
    }
  }

  function handleDownload() {
    const filename =
      codeTab === 'python' ? 'monitor_cripto.py' : 'crypto-monitor.yml';
    const mime =
      codeTab === 'python' ? 'text/x-python;charset=utf-8' : 'text/yaml;charset=utf-8';
    const blob = new Blob([displayedCode], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const activeTriggersCount = triggers.filter((t) => t.enabled).length;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            Gerador Python 24/7 (GitHub Actions)
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Monitora Binance + CoinGecko 24h na nuvem e dispara alertas da carteira ({activeTriggersCount} gatilho(s) ativo(s)).
          </p>
        </div>
      </div>

      {/* Channel selector: Telegram vs WhatsApp */}
      <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-white/[0.07]">
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
          Canal de disparo de alertas
        </label>
        <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.07]">
          <button
            type="button"
            onClick={() => handleSelectChannel('telegram')}
            className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              channel === 'telegram'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            Telegram
          </button>
          <button
            type="button"
            onClick={() => handleSelectChannel('whatsapp')}
            className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              channel === 'whatsapp'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            WhatsApp
          </button>
        </div>
      </div>

      {/* Channel credentials inputs */}
      {channel === 'telegram' ? (
        <div className="space-y-3 rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17] p-3.5">
          <div>
            <label className="block text-xs text-slate-700 dark:text-slate-300 mb-1.5">
              Telegram Bot Token (@BotFather)
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={tgToken}
                onChange={(e) => handleTokenChange(e.target.value)}
                placeholder="Ex: 7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full pl-3 pr-9 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-0.5"
              >
                {showToken ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="block text-xs text-slate-700 dark:text-slate-300">
                Telegram Chat ID
              </label>
              <button
                type="button"
                onClick={() => void handleDetectChat()}
                disabled={detectingChat || !tgToken.trim()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 disabled:opacity-45 whitespace-nowrap"
              >
                {detectingChat ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                {detectingChat ? 'Detectando...' : 'Detectar Chat ID'}
              </button>
            </div>
            <input
              type="text"
              value={tgChatId}
              onChange={(e) => handleChatIdChange(e.target.value)}
              placeholder="Ex: 123456789 ou -1001234567890"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => void handleSaveCredentials()}
              disabled={savingCreds}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {savingCreds ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              {savingCreds ? 'Salvando...' : 'Salvar e Sincronizar'}
            </button>

            <button
              type="button"
              onClick={() => void handleTestTelegram()}
              disabled={testingTg}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {testingTg ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {testingTg ? 'Testando...' : 'Testar Telegram'}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17] p-3.5 text-xs space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-700 dark:text-slate-300 font-medium">
              WhatsApp configurado:
            </span>
            <span className="font-mono text-slate-900 dark:text-slate-100">
              {settings.whatsapp.phoneNumber || 'Não configurado'}
            </span>
          </div>
          {onSwitchChannelTab && (
            <button
              type="button"
              onClick={() => onSwitchChannelTab('whatsapp')}
              className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
            >
              Editar número e API Key na aba WhatsApp →
            </button>
          )}
        </div>
      )}

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

      {/* Generator options */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200 dark:border-white/[0.07]">
        <div>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1.5">
            Credenciais no script Python
          </label>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.07]">
            <button
              type="button"
              onClick={() => updatePythonPref('credentialMode', 'secrets')}
              className={`py-1.5 px-2 text-[11px] font-medium rounded-md transition-colors truncate ${
                pythonPrefs.credentialMode === 'secrets'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              GitHub Secrets
            </button>
            <button
              type="button"
              onClick={() => updatePythonPref('credentialMode', 'inline')}
              className={`py-1.5 px-2 text-[11px] font-medium rounded-md transition-colors truncate ${
                pythonPrefs.credentialMode === 'inline'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Direto no código
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1.5">
            Frequência no GitHub Actions
          </label>
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.07]">
            {([5, 10, 15, 30] as PythonIntervalMinutes[]).map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => updatePythonPref('intervalMinutes', mins)}
                className={`py-1.5 text-[11px] font-mono font-medium rounded-md transition-colors ${
                  pythonPrefs.intervalMinutes === mins
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {mins}m
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Code viewer & download */}
      <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-white/[0.07]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.07]">
            <button
              type="button"
              onClick={() => setCodeTab('python')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md transition-colors ${
                codeTab === 'python'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Code2 className="w-3 h-3" />
              monitor_cripto.py
            </button>
            <button
              type="button"
              onClick={() => setCodeTab('yaml')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium rounded-md transition-colors ${
                codeTab === 'yaml'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              crypto-monitor.yml
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors"
            >
              {copiedTab === codeTab ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              {copiedTab === codeTab ? 'Copiado!' : 'Copiar'}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              <Download className="w-3 h-3" />
              Baixar {codeTab === 'python' ? '.py' : '.yml'}
            </button>
          </div>
        </div>

        <pre className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-950 text-slate-100 p-3 text-[11px] leading-relaxed font-mono overflow-x-auto max-h-72 overflow-y-auto">
          <code>{displayedCode}</code>
        </pre>

        <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17] px-3 py-2 text-[11px] text-slate-600 dark:text-slate-400 space-y-1 leading-relaxed">
          <p className="font-semibold text-slate-800 dark:text-slate-200">
            Como rodar 24/7 no GitHub Actions:
          </p>
          <p>
            1. Crie um repositório no GitHub e suba <span className="font-mono text-slate-900 dark:text-slate-100">monitor_cripto.py</span> na raiz e <span className="font-mono text-slate-900 dark:text-slate-100">.github/workflows/crypto-monitor.yml</span>.
          </p>
          {pythonPrefs.credentialMode === 'secrets' && channel === 'telegram' && (
            <p>
              2. Em <strong>Settings → Secrets and variables → Actions</strong>, crie os secrets <span className="font-mono text-slate-900 dark:text-slate-100">TELEGRAM_BOT_TOKEN</span> e <span className="font-mono text-slate-900 dark:text-slate-100">TELEGRAM_CHAT_ID</span>.
            </p>
          )}
          {pythonPrefs.credentialMode === 'inline' && (
            <p className="text-amber-700 dark:text-amber-300">
              Atenção: suas credenciais estão embutidas no script. Use apenas em repositório <strong>Privado</strong> no GitHub.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
