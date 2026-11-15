import { AlertTriangle, Check, ExternalLink, Loader2, MessageSquare, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiTestWhatsApp } from '../services/apiClient.ts';
import type {
  AppSettings,
  WhatsAppProvider,
  WhatsAppSettings,
} from '../types/crypto.ts';
import {
  looksLikePhoneInsteadOfCallMeBotKey,
  normalizeWhatsAppPhone,
} from '../utils/whatsappFormat.ts';
import {
  loadAlertChannelCache,
  savePreferredAlertChannel,
  saveWhatsAppCache,
} from '../utils/alertChannelStorage.ts';

interface WhatsAppSettingsPanelProps {
  whatsapp: WhatsAppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const CALLMEBOT_ACTIVATION_URL =
  'https://wa.me/34644718199?text=' +
  encodeURIComponent('I allow callmebot to send me messages');

function hasRequiredCredentials(w: WhatsAppSettings): boolean {
  const { digits } = normalizeWhatsAppPhone(w.phoneNumber);
  if (w.provider === 'callmebot') {
    return (
      digits.length >= 11 &&
      w.callMeBotApiKey.trim().length > 0 &&
      !looksLikePhoneInsteadOfCallMeBotKey(w.phoneNumber, w.callMeBotApiKey)
    );
  }
  if (w.provider === 'webhook_rest') {
    return w.customWebhookUrl.trim().startsWith('http');
  }
  if (w.provider === 'meta_cloud') {
    return (
      digits.length >= 11 &&
      w.metaPhoneNumberId.trim().length > 0 &&
      w.metaAccessToken.trim().length > 0
    );
  }
  return false;
}

export function WhatsAppSettingsPanel({
  whatsapp,
  onUpdateSettings,
}: WhatsAppSettingsPanelProps) {
  const [draft, setDraft] = useState<WhatsAppSettings>(() => {
    const cached = loadAlertChannelCache().whatsapp;
    return {
      ...whatsapp,
      phoneNumber: whatsapp.phoneNumber || cached.phoneNumber || '',
      callMeBotApiKey: whatsapp.callMeBotApiKey || cached.callMeBotApiKey || '',
    };
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  useEffect(() => {
    const cached = loadAlertChannelCache().whatsapp;
    setDraft((prev) => ({
      ...whatsapp,
      phoneNumber: whatsapp.phoneNumber || prev.phoneNumber || cached.phoneNumber || '',
      callMeBotApiKey:
        whatsapp.callMeBotApiKey || prev.callMeBotApiKey || cached.callMeBotApiKey || '',
    }));
  }, [whatsapp]);

  const normalizedPhone = useMemo(
    () => normalizeWhatsAppPhone(draft.phoneNumber),
    [draft.phoneNumber]
  );

  const keyLooksLikePhone = useMemo(
    () =>
      draft.provider === 'callmebot' &&
      looksLikePhoneInsteadOfCallMeBotKey(draft.phoneNumber, draft.callMeBotApiKey),
    [draft.provider, draft.phoneNumber, draft.callMeBotApiKey]
  );

  const setField = <K extends keyof WhatsAppSettings>(
    key: K,
    val: WhatsAppSettings[K]
  ) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: val };
      saveWhatsAppCache(next);
      return next;
    });
  };

  function prepareNormalizedDraft(autoActivateIfReady: boolean): WhatsAppSettings {
    const phone = normalizeWhatsAppPhone(draft.phoneNumber);
    const nextPhone =
      phone.autoAppliedBrDdi && phone.e164 ? phone.e164 : draft.phoneNumber.trim();
    const cleaned: WhatsAppSettings = {
      ...draft,
      phoneNumber: nextPhone,
      callMeBotApiKey: draft.callMeBotApiKey.trim(),
      customWebhookUrl: draft.customWebhookUrl.trim(),
      customWebhookToken: draft.customWebhookToken.trim(),
      metaPhoneNumberId: draft.metaPhoneNumberId.trim(),
      metaAccessToken: draft.metaAccessToken.trim(),
    };
    if (autoActivateIfReady && !cleaned.enabled && hasRequiredCredentials(cleaned)) {
      cleaned.enabled = true;
    }
    return cleaned;
  }

  async function handleSave() {
    setSaving(true);
    setStatusMsg(null);
    try {
      const prepared = prepareNormalizedDraft(true);
      setDraft(prepared);
      saveWhatsAppCache(prepared);
      savePreferredAlertChannel('whatsapp');
      await onUpdateSettings({ whatsapp: prepared });
      setStatusMsg({
        type: 'ok',
        text: prepared.enabled
          ? 'Configuração salva e WhatsApp 24h ativado com sucesso.'
          : 'Configuração de WhatsApp 24h salva com sucesso.',
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Erro ao salvar configuração de WhatsApp.',
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
      await onUpdateSettings({ whatsapp: next });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Erro ao atualizar status do WhatsApp.',
      });
    }
  }

  async function handleTest() {
    setTesting(true);
    setStatusMsg(null);
    try {
      const prepared = prepareNormalizedDraft(false);
      setDraft(prepared);
      await onUpdateSettings({ whatsapp: prepared });
      const res = await apiTestWhatsApp(prepared);

      // Automatically activate WhatsApp 24h after a successful test
      if (!prepared.enabled) {
        const activated = { ...prepared, enabled: true };
        setDraft(activated);
        await onUpdateSettings({ whatsapp: activated });
      }

      setStatusMsg({
        type: 'ok',
        text: res.opaqueStatic
          ? 'Solicitação de teste enviada ao CallMeBot. Confira se a mensagem chegou no seu WhatsApp em alguns segundos.'
          : 'Mensagem de teste enviada para seu WhatsApp e alertas 24h ativados!',
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Falha ao enviar teste no WhatsApp.',
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
            <MessageSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Envio automático no WhatsApp (24h)
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            O servidor monitora os preços a cada 10s e envia seus gatilhos mesmo com a aba fechada.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleToggleEnabled()}
          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
            draft.enabled
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'
              : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {draft.enabled ? 'WhatsApp ativo' : 'WhatsApp pausado'}
        </button>
      </div>

      {/* Provider selector */}
      <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-white/[0.07]">
        <label className="block text-xs text-slate-600 dark:text-slate-400">
          Método de envio automático
        </label>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] p-1 border border-slate-200 dark:border-white/[0.07]">
          {(
            [
              { id: 'callmebot', label: 'CallMeBot (Grátis)' },
              { id: 'webhook_rest', label: 'Z-API / Evolution' },
              { id: 'meta_cloud', label: 'Meta Oficial' },
            ] as Array<{ id: WhatsAppProvider; label: string }>
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setField('provider', opt.id)}
              className={`py-1.5 px-2 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap truncate ${
                draft.provider === opt.id
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Phone input */}
      <div>
        <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
          Seu número de WhatsApp (com DDI + DDD)
        </label>
        <input
          type="tel"
          value={draft.phoneNumber}
          onChange={(e) => setField('phoneNumber', e.target.value)}
          placeholder="+5538991292495"
          className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
        />
        {normalizedPhone.digits && (
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            Envio para: <span className="text-slate-800 dark:text-slate-200">{normalizedPhone.e164}</span>
            {normalizedPhone.autoAppliedBrDdi && (
              <span className="font-sans text-emerald-700 dark:text-emerald-400 ml-1.5">
                (DDI +55 do Brasil adicionado automaticamente)
              </span>
            )}
          </p>
        )}
      </div>

      {/* Provider-specific fields */}
      {draft.provider === 'callmebot' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#0B0F17] px-3.5 py-2.5 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed space-y-2">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              Ativação gratuita em 30 segundos (CallMeBot):
            </p>
            <p>
              1. Salve o contato <span className="font-mono text-emerald-700 dark:text-emerald-400">+34 644 71 81 99</span> no WhatsApp e envie: <span className="font-mono text-slate-900 dark:text-slate-100">I allow callmebot to send me messages</span>
            </p>
            <a
              href={CALLMEBOT_ACTIVATION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-medium transition-colors"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              Abrir WhatsApp do CallMeBot para pegar API Key
            </a>
            <p>2. Cole abaixo a API Key curta (ex: 1234567) que o bot responder no seu WhatsApp.</p>
          </div>
          <div>
            <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
              CallMeBot API Key
            </label>
            <input
              type="text"
              value={draft.callMeBotApiKey}
              onChange={(e) => setField('callMeBotApiKey', e.target.value)}
              placeholder="Ex: 1234567"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
            />
            {keyLooksLikePhone && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/25 rounded-md px-2.5 py-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Esse número parece o seu telefone, não a API Key. Use o botão acima para enviar a frase no WhatsApp e cole o código curto de 6–7 dígitos que o bot responder.
                </span>
              </p>
            )}
          </div>
        </div>
      )}

      {draft.provider === 'webhook_rest' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
              URL do Endpoint (Evolution API, Z-API, Make ou n8n)
            </label>
            <input
              type="url"
              value={draft.customWebhookUrl}
              onChange={(e) => setField('customWebhookUrl', e.target.value)}
              placeholder="https://seu-servidor.com/message/sendText/instancia"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
              Token / API Key do gateway (opcional)
            </label>
            <input
              type="password"
              value={draft.customWebhookToken}
              onChange={(e) => setField('customWebhookToken', e.target.value)}
              placeholder="Enviado em apikey e Authorization Bearer"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>
      )}

      {draft.provider === 'meta_cloud' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
              Phone Number ID (Meta Developers)
            </label>
            <input
              type="text"
              value={draft.metaPhoneNumberId}
              onChange={(e) => setField('metaPhoneNumberId', e.target.value)}
              placeholder="Ex: 109876543210987"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-700 dark:text-slate-400 mb-1.5">
              Access Token (Bearer)
            </label>
            <input
              type="password"
              value={draft.metaAccessToken}
              onChange={(e) => setField('metaAccessToken', e.target.value)}
              placeholder="EAAG..."
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>
      )}

      {/* Forward AI Signals Toggle */}
      <label className="flex items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-white/[0.07] cursor-pointer">
        <span className="text-xs text-slate-700 dark:text-slate-300">
          Enviar também sinais automáticos de Compra/Venda da IA no WhatsApp
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
          {saving ? 'Salvando...' : 'Salvar WhatsApp'}
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
          {testing ? 'Enviando teste...' : 'Enviar teste no WhatsApp'}
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
