interface TelegramPayload {
  botToken?: string;
  chatId?: string;
}

function isValidBotToken(token: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token.trim());
}

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function markdownToSafeHtml(raw: string): string {
  return escapeHtml(raw).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
}

function translateTelegramError(description: string, status?: number): string {
  const lower = String(description || '').toLowerCase();
  if (status === 401 || lower.includes('unauthorized')) {
    return 'Bot Token do Telegram inválido.';
  }
  if (lower.includes('chat not found')) {
    return 'Chat ID não encontrado. Envie /start para o seu bot no Telegram.';
  }
  if (lower.includes('bot was blocked')) {
    return 'O bot foi bloqueado no Telegram.';
  }
  if (status === 429 || lower.includes('too many requests')) {
    return 'Limite temporário do Telegram atingido. Tente novamente em instantes.';
  }
  return description
    ? `Telegram: ${description.slice(0, 180)}`
    : `Erro na API do Telegram (HTTP ${status || 400}).`;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
    const tg: TelegramPayload = (body.telegram ?? {}) as TelegramPayload;
    const text = String(body.text ?? '').trim();
    const isPreformattedHtml = Boolean(body.isPreformattedHtml);

    if (!text) {
      return res.status(400).json({ error: 'Texto da mensagem é obrigatório.' });
    }
    const token = String(tg.botToken || '').trim();
    const chatId = String(tg.chatId || '').trim();
    if (!isValidBotToken(token) || !chatId) {
      return res.status(400).json({
        error: 'Configure o Bot Token e o Chat ID válidos do Telegram.',
      });
    }

    const upstream = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: isPreformattedHtml ? text : markdownToSafeHtml(text),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await upstream.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
    };
    if (!upstream.ok || !data.ok) {
      return res.status(400).json({
        error: translateTelegramError(data.description || '', upstream.status),
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Erro interno ao enviar mensagem no Telegram.',
    });
  }
}
