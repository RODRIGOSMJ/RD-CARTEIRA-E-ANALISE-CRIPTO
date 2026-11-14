import { Bell, Check, Send, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppSettings } from '../types/crypto.ts';

interface AutomationSettingsPanelProps {
  settings: AppSettings;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

export function AutomationSettingsPanel({
  settings,
  soundEnabled,
  onToggleSound,
  onUpdateSettings,
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

  useEffect(() => {
    setWebhookInput(settings.webhookUrl);
  }, [settings.webhookUrl]);

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
      const res = await fetch('/api/settings/test-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: webhookInput }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || 'Falha no envio');
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
    <div className="rounded-xl border border-white/[0.08] bg-[#111827] p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Automação e alertas
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
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
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-white/10 bg-slate-800 text-slate-300'
          }`}
        >
          {settings.autoStudyEnabled ? 'Autoestudo ativo' : 'Autoestudo pausado'}
        </button>
      </div>

      {/* Interval & Currency */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-white/[0.07]">
        <div>
          <label className="block text-xs text-slate-400 mb-2">
            Intervalo de estudo autônomo
          </label>
          <div className="flex items-center gap-1 rounded-lg bg-[#0B0F17] p-1 border border-white/[0.07]">
            {[1, 5, 15, 30].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => onUpdateSettings({ intervalMinutes: mins })}
                className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                  settings.intervalMinutes === mins
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mins}m
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-2">
            Moeda de exibição
          </label>
          <div className="flex items-center gap-1 rounded-lg bg-[#0B0F17] p-1 border border-white/[0.07]">
            {(['BRL', 'USD'] as const).map((curr) => (
              <button
                key={curr}
                type="button"
                onClick={() => onUpdateSettings({ currency: curr })}
                className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                  settings.currency === curr
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {curr === 'BRL' ? 'Real (R$)' : 'Dólar (US$)'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Confidence threshold */}
      <div className="pt-3 border-t border-white/[0.07]">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-slate-400">
            Confiança mínima para disparar alerta automático
          </span>
          <span className="font-mono font-semibold text-slate-100 tabular-nums">
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
          className="w-full accent-sky-500 cursor-pointer"
        />
      </div>

      {/* Browser Push & Sound */}
      <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-white/[0.07]">
        {notifPerm !== 'unsupported' && (
          <button
            type="button"
            onClick={requestNotificationPermission}
            disabled={notifPerm === 'granted'}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              notifPerm === 'granted'
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400 cursor-default'
                : 'border-white/10 bg-[#0B0F17] hover:bg-slate-800 text-slate-200'
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
              ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
              : 'border-white/10 bg-[#0B0F17] hover:bg-slate-800 text-slate-300'
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

      {/* Optional Webhook Integration */}
      <div className="pt-3 border-t border-white/[0.07] space-y-2">
        <label className="block text-xs text-slate-400">
          Webhook externo opcional (Discord, Slack ou endpoint próprio)
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            type="url"
            value={webhookInput}
            onChange={(e) => setWebhookInput(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className="flex-1 min-w-[200px] px-3 py-2 text-xs rounded-lg border border-white/10 bg-[#0B0F17] text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500 font-mono"
          />
          <button
            type="button"
            onClick={handleSaveWebhook}
            disabled={savingWebhook}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-white/10 bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            {savingWebhook ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={handleTestWebhook}
            disabled={testingWebhook || !webhookInput.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-white/10 bg-[#0B0F17] hover:bg-slate-800 text-slate-200 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            Testar
          </button>
        </div>
        {webhookStatus && (
          <p
            className={`text-xs ${
              webhookStatus.type === 'ok' ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {webhookStatus.msg}
          </p>
        )}
      </div>
    </div>
  );
}
