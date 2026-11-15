function isValidBotToken(token: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token.trim());
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
    const token = String(body.botToken || '').trim();
    if (!isValidBotToken(token)) {
      return res.status(400).json({
        error: 'Informe primeiro um Bot Token válido do @BotFather.',
      });
    }

    const upstream = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?limit=25`,
      { signal: AbortSignal.timeout(10_000) }
    );
    const data = (await upstream.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: Array<Record<string, any>>;
    };
    if (!upstream.ok || !data.ok) {
      return res.status(400).json({
        error:
          upstream.status === 401
            ? 'Bot Token do Telegram inválido.'
            : data.description || 'Falha ao consultar o bot no Telegram.',
      });
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
        return res.status(200).json({
          ok: true,
          chatId: String(chat.id),
          chatLabel: label,
        });
      }
    }

    return res.status(400).json({
      error:
        'Nenhuma mensagem recente encontrada no bot. Abra o seu bot no Telegram, envie /start (ou "oi") e clique novamente em Detectar Chat ID.',
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Erro ao detectar Chat ID do Telegram.',
    });
  }
}
