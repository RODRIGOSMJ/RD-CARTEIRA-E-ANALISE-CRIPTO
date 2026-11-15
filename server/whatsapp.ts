import type {
  MarketSnapshot,
  PriceTrigger,
  SignalAction,
  SignalAlert,
  WhatsAppSettings,
} from '../src/types/crypto.ts';
import {
  formatCallMeBotError,
  isCallMeBotBodyError,
  looksLikePhoneInsteadOfCallMeBotKey,
  normalizeWhatsAppPhone,
} from '../src/utils/whatsappFormat.ts';
import { getStore, saveStore } from './store.ts';

function formatUsdForMsg(usd: number): string {
  if (!Number.isFinite(usd)) return 'US$ 0,00';
  const digits = usd > 0 && usd < 0.01 ? 6 : usd > 0 && usd < 1 ? 4 : 2;
  return `US$ ${usd.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatBrlForMsg(usd: number, rate: number): string {
  if (!Number.isFinite(usd)) return 'R$ 0,00';
  const brl = usd * (rate > 0 ? rate : 5.75);
  const digits = brl > 0 && brl < 0.01 ? 6 : brl > 0 && brl < 1 ? 4 : 2;
  return `R$ ${brl.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function normalizePhoneDigits(phone: string): string {
  return normalizeWhatsAppPhone(phone).digits;
}

export function isWhatsAppConfigured(w?: WhatsAppSettings): boolean {
  if (!w || !w.enabled) return false;
  const phone = normalizePhoneDigits(w.phoneNumber);
  if (w.provider === 'callmebot') {
    return (
      phone.length >= 11 &&
      w.callMeBotApiKey.trim().length > 0 &&
      !looksLikePhoneInsteadOfCallMeBotKey(w.phoneNumber, w.callMeBotApiKey)
    );
  }
  if (w.provider === 'webhook_rest') {
    return w.customWebhookUrl.trim().startsWith('http');
  }
  if (w.provider === 'meta_cloud') {
    return (
      phone.length >= 11 &&
      w.metaPhoneNumberId.trim().length > 0 &&
      w.metaAccessToken.trim().length > 0
    );
  }
  return false;
}

export async function sendWhatsAppMessage(
  whatsapp: WhatsAppSettings,
  text: string,
  metadata?: unknown
): Promise<{ ok: boolean; error?: string }> {
  const phoneDigits = normalizePhoneDigits(whatsapp.phoneNumber);

  if (whatsapp.provider === 'callmebot') {
    if (phoneDigits.length < 11) {
      return {
        ok: false,
        error: 'Informe um número de WhatsApp válido com DDI + DDD (ex: +5538991292495).',
      };
    }
    const apiKey = whatsapp.callMeBotApiKey.trim();
    if (!apiKey) {
      return { ok: false, error: 'Informe a API Key do CallMeBot para envio automático.' };
    }
    if (looksLikePhoneInsteadOfCallMeBotKey(whatsapp.phoneNumber, apiKey)) {
      return {
        ok: false,
        error:
          'O campo "CallMeBot API Key" parece conter um número de telefone, não a API Key. Envie "I allow callmebot to send me messages" para +34 644 71 81 99 no WhatsApp e cole aqui o código curto recebido.',
      };
    }
    try {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(
        phoneDigits
      )}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const body = await res.text();
      if (!res.ok || isCallMeBotBodyError(body)) {
        return {
          ok: false,
          error: formatCallMeBotError(body, res.status),
        };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Falha de conexão com CallMeBot.' };
    }
  }

  if (whatsapp.provider === 'webhook_rest') {
    const endpoint = whatsapp.customWebhookUrl.trim();
    if (!endpoint.startsWith('http')) {
      return { ok: false, error: 'Informe uma URL HTTP/HTTPS válida para o gateway WhatsApp.' };
    }
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const token = whatsapp.customWebhookToken.trim();
      if (token) {
        headers['apikey'] = token;
        headers['Client-Token'] = token;
        headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          number: phoneDigits || undefined,
          phone: phoneDigits || undefined,
          text,
          message: text,
          textMessage: { text },
          source: 'SinalCripto IA',
          metadata,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return {
          ok: false,
          error: `Gateway retornou HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`,
        };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Falha ao enviar para o gateway WhatsApp.' };
    }
  }

  if (whatsapp.provider === 'meta_cloud') {
    if (phoneDigits.length < 10) {
      return { ok: false, error: 'Informe um número destino válido com DDI.' };
    }
    const phoneNumberId = whatsapp.metaPhoneNumberId.trim();
    const accessToken = whatsapp.metaAccessToken.trim();
    if (!phoneNumberId || !accessToken) {
      return { ok: false, error: 'Informe o Phone Number ID e o Access Token da Meta.' };
    }
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phoneDigits,
            type: 'text',
            text: { body: text },
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return {
          ok: false,
          error: `Meta API HTTP ${res.status}${body ? `: ${body.slice(0, 140)}` : ''}`,
        };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Falha ao conectar na Meta Cloud API.' };
    }
  }

  return { ok: false, error: 'Provedor de WhatsApp desconhecido.' };
}

export function describeTriggerCondition(
  trigger: PriceTrigger,
  actualMovePct?: number
): string {
  if (trigger.conditionType === 'queda_pct') {
    const moveStr =
      actualMovePct !== undefined
        ? ` (caiu ${Math.abs(actualMovePct).toFixed(2).replace('.', ',')}%)`
        : '';
    return `Queda de ${trigger.targetValue.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%${moveStr}`;
  }
  if (trigger.conditionType === 'alta_pct') {
    const moveStr =
      actualMovePct !== undefined
        ? ` (subiu ${Math.abs(actualMovePct).toFixed(2).replace('.', ',')}%)`
        : '';
    return `Alta de ${trigger.targetValue.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%${moveStr}`;
  }
  if (trigger.conditionType === 'abaixo_preco') {
    return `Preço abaixo de ${formatUsdForMsg(trigger.targetValue)}`;
  }
  return `Preço acima de ${formatUsdForMsg(trigger.targetValue)}`;
}

export function formatTriggerWhatsAppText(
  trigger: PriceTrigger,
  currentPriceUsd: number,
  usdBrlRate: number,
  actualMovePct?: number
): string {
  const timeStr = new Date().toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const lines = [
    `*SinalCripto IA — Gatilho Disparado (24h)*`,
    ``,
    `*Ativo:* ${trigger.name} (${trigger.symbol})`,
    `*Condição:* ${describeTriggerCondition(trigger, actualMovePct)}`,
    `*Preço atual:* ${formatUsdForMsg(currentPriceUsd)} (${formatBrlForMsg(currentPriceUsd, usdBrlRate)})`,
  ];

  if (
    (trigger.conditionType === 'queda_pct' || trigger.conditionType === 'alta_pct') &&
    trigger.referencePriceUsd > 0
  ) {
    lines.push(
      `*Preço de referência:* ${formatUsdForMsg(trigger.referencePriceUsd)} (${formatBrlForMsg(
        trigger.referencePriceUsd,
        usdBrlRate
      )})`
    );
  }

  lines.push(`*Ação planejada:* ${trigger.actionHint}`);
  if (trigger.note) {
    lines.push(`*Observação:* ${trigger.note}`);
  }
  lines.push(`*Horário:* ${timeStr}`);
  return lines.join('\n');
}

export function formatAiAlertsWhatsAppText(
  alerts: SignalAlert[],
  usdBrlRate: number
): string {
  const header = `*SinalCripto IA — Novo Sinal Automático*`;
  const blocks = alerts.map((a) => {
    return [
      `*${a.symbol} (${a.name})*: *${a.action}* (Confiança ${a.confidence}%)`,
      `Preço: ${formatUsdForMsg(a.priceAtSignalUsd)} (${formatBrlForMsg(a.priceAtSignalUsd, usdBrlRate)})`,
      `Alvo: ${formatUsdForMsg(a.targetPriceUsd)} | Stop: ${formatUsdForMsg(a.stopLossUsd)}`,
      `${a.headline}`,
    ].join('\n');
  });
  return `${header}\n\n${blocks.join('\n\n')}`;
}

export async function evaluatePriceTriggers(
  snapshots: Record<string, MarketSnapshot>,
  usdBrlRate: number
): Promise<{ triggeredAlerts: SignalAlert[]; updated: boolean }> {
  const store = getStore();
  const triggeredAlerts: SignalAlert[] = [];
  let updated = false;

  if (!store.priceTriggers || store.priceTriggers.length === 0) {
    return { triggeredAlerts, updated: false };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  for (const trigger of store.priceTriggers) {
    const snap = snapshots[trigger.coinId];
    if (!snap || !Number.isFinite(snap.priceUsd) || snap.priceUsd <= 0) {
      continue;
    }

    const currentPrice = snap.priceUsd;

    // Initialize referencePriceUsd if it wasn't available when created
    if (
      (trigger.conditionType === 'queda_pct' || trigger.conditionType === 'alta_pct') &&
      trigger.referencePriceUsd <= 0
    ) {
      trigger.referencePriceUsd = currentPrice;
      updated = true;
    }

    if (!trigger.enabled) continue;

    // Respect cooldown on continuous triggers
    if (trigger.repeatMode === 'continuo' && trigger.lastTriggeredAt) {
      const elapsedMin = (nowMs - new Date(trigger.lastTriggeredAt).getTime()) / 60_000;
      const cooldown = Math.max(1, trigger.cooldownMinutes || 60);
      if (elapsedMin < cooldown) continue;
    }

    let fired = false;
    let actualMovePct: number | undefined;

    if (trigger.conditionType === 'queda_pct' && trigger.referencePriceUsd > 0) {
      const dropPct = ((trigger.referencePriceUsd - currentPrice) / trigger.referencePriceUsd) * 100;
      actualMovePct = -dropPct;
      if (dropPct >= trigger.targetValue) fired = true;
    } else if (trigger.conditionType === 'alta_pct' && trigger.referencePriceUsd > 0) {
      const risePct = ((currentPrice - trigger.referencePriceUsd) / trigger.referencePriceUsd) * 100;
      actualMovePct = risePct;
      if (risePct >= trigger.targetValue) fired = true;
    } else if (trigger.conditionType === 'abaixo_preco') {
      if (currentPrice <= trigger.targetValue) fired = true;
    } else if (trigger.conditionType === 'acima_preco') {
      if (currentPrice >= trigger.targetValue) fired = true;
    }

    if (!fired) continue;

    const conditionLabel = describeTriggerCondition(trigger, actualMovePct);
    const prevRefPrice = trigger.referencePriceUsd;

    trigger.lastTriggeredAt = nowIso;
    trigger.lastTriggeredPriceUsd = currentPrice;
    trigger.triggerCount = (trigger.triggerCount || 0) + 1;

    if (trigger.repeatMode === 'uma_vez') {
      trigger.enabled = false;
    } else if (
      trigger.conditionType === 'queda_pct' ||
      trigger.conditionType === 'alta_pct'
    ) {
      // Shift reference price for continuous % monitoring so next move is measured from here
      trigger.referencePriceUsd = currentPrice;
    }

    const mappedAction: SignalAction =
      trigger.actionHint === 'COMPRAR'
        ? 'COMPRAR'
        : trigger.actionHint === 'VENDER'
        ? 'VENDER'
        : 'ESPERAR';

    const targetEst =
      mappedAction === 'VENDER' ? currentPrice * 0.94 : currentPrice * 1.06;
    const stopEst =
      mappedAction === 'VENDER' ? currentPrice * 1.04 : currentPrice * 0.95;

    const alert: SignalAlert = {
      id: `trig_alert_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      coinId: trigger.coinId,
      symbol: trigger.symbol,
      name: trigger.name,
      action: mappedAction,
      confidence: 100,
      priceAtSignalUsd: currentPrice,
      targetPriceUsd: targetEst,
      stopLossUsd: stopEst,
      headline: `Gatilho atingido: ${trigger.symbol} (${conditionLabel}) — ${trigger.actionHint}`,
      reason:
        trigger.note ||
        `Gatilho configurado por você foi atingido em ${formatUsdForMsg(currentPrice)}${
          prevRefPrice > 0 ? ` (ref. ${formatUsdForMsg(prevRefPrice)})` : ''
        }.`,
      createdAt: nowIso,
      read: false,
      outcome: 'em_aberto',
    };

    store.alerts.unshift(alert);
    store.alerts = store.alerts.slice(0, 120);
    triggeredAlerts.push(alert);
    updated = true;

    // Send WhatsApp message automatically if enabled
    if (trigger.sendWhatsApp) {
      if (isWhatsAppConfigured(store.settings.whatsapp)) {
        const msgText = formatTriggerWhatsAppText(
          { ...trigger, referencePriceUsd: prevRefPrice },
          currentPrice,
          usdBrlRate,
          actualMovePct
        );
        const delivery = await sendWhatsAppMessage(store.settings.whatsapp, msgText, {
          type: 'price_trigger',
          trigger,
          currentPriceUsd: currentPrice,
        });
        trigger.lastDeliveryStatus = delivery.ok ? 'enviado' : 'falha';
        trigger.lastDeliveryError = delivery.ok ? undefined : delivery.error;
      } else {
        trigger.lastDeliveryStatus = 'sem_whatsapp';
        trigger.lastDeliveryError =
          'WhatsApp automático desativado ou sem credenciais configuradas.';
      }
    }
  }

  if (updated) {
    saveStore();
  }

  return { triggeredAlerts, updated };
}
