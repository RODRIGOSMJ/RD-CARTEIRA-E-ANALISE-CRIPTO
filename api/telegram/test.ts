interface TelegramPayload {
  botToken?: string;
  chatId?: string;
}

function isValidBotToken(token: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token.trim());
}

function translateTelegramError(description: string, status?: number): string {
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
  if (status === 429 || lower.includes('too many requests')) {
    return 'Limite temporário do Telegram atingido. Aguarde alguns segundos e tente novamente.';
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
    const tg: TelegramPayload = (body.telegram ?? body ?? {}) as TelegramPayload;
    const token = String(tg.botToken || '').trim();
    const chatId = String(tg.chatId || '').trim();

    if (!isValidBotToken(token)) {
      return res.status(400).json({
        error: 'Informe um Bot Token válido do Telegram (gerado pelo @BotFather, ex: 123456789:AAH...).',
      });
    }
    if (!chatId) {
      return res.status(400).json({
        error: 'Informe o Chat ID do Telegram ou clique em "Detectar Chat ID".',
      });
    }

    const testHtml =
      '<b>RD Crypto — Teste de Conexão 24h</b>\n\nSeu Telegram está conectado e pronto para receber automaticamente seus gatilhos de queda, alta e sinais da IA 24 horas por dia.';

    const upstream = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: testHtml,
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
      error: err?.message || 'Erro interno ao enviar teste no Telegram.',
    });
  }
}
