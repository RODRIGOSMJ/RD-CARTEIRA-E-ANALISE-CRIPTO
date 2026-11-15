import type {
  PriceTrigger,
  SignalAlert,
  TelegramSettings,
} from '../src/types/crypto.ts';
import { getVerdictBadgeMeta } from '../src/utils/verdictPolicy.ts';

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

function escapeTelegramHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function describeCondition(trigger: PriceTrigger, actualMovePct?: number): string {
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

export function isValidTelegramTokenFormat(token: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token.trim());
}

export function isTelegramConfigured(t?: TelegramSettings): boolean {
  if (!t || !t.enabled) return false;
  return isValidTelegramTokenFormat(t.botToken) && t.chatId.trim().length > 0;
}

export function translateTelegramApiError(description: string, status?: number): string {
  const lower = String(description || '').toLowerCase();
  if (status === 401 || lower.includes('unauthorized')) {
    return 'Bot Token do Telegram inválido. Confira o token completo copiado do @BotFather.';
  }
  if (lower.includes('chat not found')) {
    return 'Chat ID não encontrado. Abra seu bot no Telegram, envie /start ou "oi" e confira o Chat ID.';
  }
  if (lower.includes('bot was blocked')) {
    return 'O bot foi bloqueado no seu Telegram. Desbloqueie o bot e envie /start.';
  }
  if (lower.includes('user is deactivated')) {
    return 'A conta ou chat informado no Telegram está desativado.';
  }
  if (status === 429 || lower.includes('too many requests')) {
    return 'Limite temporário do Telegram atingido. Aguarde alguns segundos e tente novamente.';
  }
  return description
    ? `Telegram: ${description.slice(0, 180)}`
    : `Erro na API do Telegram (HTTP ${status || 400}).`;
}

export function formatTelegramHtmlFromMarkdown(text: string): string {
  const escaped = escapeTelegramHtml(text);
  return escaped.replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
}

export function formatTriggerTelegramHtml(
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
    `<b>SinalCripto IA — Gatilho Disparado (24h)</b>`,
    ``,
    `<b>Ativo:</b> ${escapeTelegramHtml(trigger.name)} (${escapeTelegramHtml(trigger.symbol)})`,
    `<b>Condição:</b> ${escapeTelegramHtml(describeCondition(trigger, actualMovePct))}`,
    `<b>Preço atual:</b> ${escapeTelegramHtml(formatUsdForMsg(currentPriceUsd))} (${escapeTelegramHtml(
      formatBrlForMsg(currentPriceUsd, usdBrlRate)
    )})`,
  ];

  if (
    (trigger.conditionType === 'queda_pct' || trigger.conditionType === 'alta_pct') &&
    trigger.referencePriceUsd > 0
  ) {
    lines.push(
      `<b>Preço de referência:</b> ${escapeTelegramHtml(
        formatUsdForMsg(trigger.referencePriceUsd)
      )} (${escapeTelegramHtml(formatBrlForMsg(trigger.referencePriceUsd, usdBrlRate))})`
    );
  }

  lines.push(`<b>Ação planejada:</b> ${escapeTelegramHtml(trigger.actionHint)}`);
  if (trigger.note) {
    lines.push(`<b>Observação:</b> ${escapeTelegramHtml(trigger.note)}`);
  }
  lines.push(`<b>Horário:</b> ${escapeTelegramHtml(timeStr)}`);
  return lines.join('\n');
}

export function formatAiAlertsTelegramHtml(
  alerts: SignalAlert[],
  usdBrlRate: number
): string {
  const header = `<b>SinalCripto IA — Novo Sinal Automático</b>`;
  const blocks = alerts.map((a) => {
    const verdictLabel = getVerdictBadgeMeta(a.action, { headline: a.headline }).label;
    return [
      `<b>${escapeTelegramHtml(a.symbol)} (${escapeTelegramHtml(a.name)}): ${escapeTelegramHtml(
        verdictLabel
      )}</b> (Confiança ${a.confidence}%)`,
      `Preço: ${escapeTelegramHtml(formatUsdForMsg(a.priceAtSignalUsd))} (${escapeTelegramHtml(
        formatBrlForMsg(a.priceAtSignalUsd, usdBrlRate)
      )})`,
      `Alvo: ${escapeTelegramHtml(formatUsdForMsg(a.targetPriceUsd))} | Stop: ${escapeTelegramHtml(
        formatUsdForMsg(a.stopLossUsd)
      )}`,
      escapeTelegramHtml(a.headline),
    ].join('\n');
  });
  return `${header}\n\n${blocks.join('\n\n')}`;
}

export async function sendTelegramMessage(
  telegram: TelegramSettings,
  htmlOrMarkdownText: string,
  options?: { isPreformattedHtml?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const token = String(telegram.botToken || '').trim();
  const chatId = String(telegram.chatId || '').trim();

  if (!isValidTelegramTokenFormat(token)) {
    return {
      ok: false,
      error:
        'Informe um Bot Token válido do Telegram (gerado pelo @BotFather, ex: 123456789:AAH...).',
    };
  }
  if (!chatId) {
    return {
      ok: false,
      error: 'Informe o Chat ID do Telegram ou clique em "Detectar Chat ID".',
    };
  }

  const formattedText = options?.isPreformattedHtml
    ? htmlOrMarkdownText
    : formatTelegramHtmlFromMarkdown(htmlOrMarkdownText);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formattedText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
    };
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: translateTelegramApiError(data.description || '', res.status),
      };
    }
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Falha de rede ao conectar à API do Telegram.',
    };
  }
}

export async function detectTelegramChatId(botToken: string): Promise<{
  ok: boolean;
  chatId?: string;
  chatLabel?: string;
  error?: string;
}> {
  const token = String(botToken || '').trim();
  if (!isValidTelegramTokenFormat(token)) {
    return {
      ok: false,
      error: 'Informe primeiro um Bot Token válido do @BotFather.',
    };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?limit=25`,
      { signal: AbortSignal.timeout(10_000) }
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: Array<Record<string, any>>;
    };
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: translateTelegramApiError(data.description || '', res.status),
      };
    }

    const updates = Array.isArray(data.result) ? data.result : [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const chat =
        u?.message?.chat ||
        u?.edited_message?.chat ||
        u?.channel_post?.chat ||
        u?.my_chat_member?.chat;
      if (chat && chat.id !== undefined && chat.id !== null) {
        const label =
          chat.title ||
          [chat.first_name, chat.last_name].filter(Boolean).join(' ') ||
          (chat.username ? `@${chat.username}` : String(chat.id));
        return {
          ok: true,
          chatId: String(chat.id),
          chatLabel: label,
        };
      }
    }

    return {
      ok: false,
      error:
        'Nenhuma mensagem recente encontrada no bot. Abra o seu bot no Telegram, envie /start (ou "oi") e clique novamente em Detectar Chat ID.',
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Erro ao consultar atualizações do bot no Telegram.',
    };
  }
}
