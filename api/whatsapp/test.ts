interface WhatsAppPayload {
  provider?: 'callmebot' | 'webhook_rest' | 'meta_cloud';
  phoneNumber?: string;
  callMeBotApiKey?: string;
  customWebhookUrl?: string;
  customWebhookToken?: string;
  metaPhoneNumberId?: string;
  metaAccessToken?: string;
}

function normalizePhone(raw: string): string {
  const trimmed = String(raw || '').trim();
  const hasExplicitPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '').replace(/^00/, '');
  if (!hasExplicitPlus && digits && !digits.startsWith('55')) {
    if (
      (digits.length === 11 && /^[1-9]{2}9\d{8}$/.test(digits)) ||
      (digits.length === 10 && /^[1-9]{2}[2-8]\d{7}$/.test(digits))
    ) {
      digits = `55${digits}`;
    }
  }
  return digits;
}

function cleanText(raw: string): string {
  return String(raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function translateCallMeBotError(rawBody: string, status: number): string {
  const clean = cleanText(rawBody);
  const lower = clean.toLowerCase();
  if (lower.includes('apikey is invalid') || lower.includes('invalid apikey')) {
    return 'API Key do CallMeBot inválida. Envie "I allow callmebot to send me messages" para +34 644 71 81 99 no WhatsApp e cole o código curto retornado pelo bot.';
  }
  if (
    lower.includes('not registered') ||
    lower.includes('not allowed') ||
    lower.includes('i allow callmebot')
  ) {
    return 'Número ainda não autorizado no CallMeBot. Salve +34 644 71 81 99 no WhatsApp e envie "I allow callmebot to send me messages".';
  }
  if (lower.includes('wait') || lower.includes('too many') || status === 429) {
    return 'Limite temporário do CallMeBot atingido. Aguarde cerca de 30 segundos e tente novamente.';
  }
  return clean.slice(0, 180) || `CallMeBot respondeu HTTP ${status}.`;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
    const wa: WhatsAppPayload = (body.whatsapp ?? body ?? {}) as WhatsAppPayload;
    const provider = wa.provider || 'callmebot';
    const phoneDigits = normalizePhone(wa.phoneNumber || '');
    const testText =
      '*RD Crypto — Teste de Conexão 24h*\n\nSeu WhatsApp está conectado e pronto para receber automaticamente seus gatilhos de queda, alta e sinais da IA 24 horas por dia.';

    if (provider === 'callmebot') {
      if (phoneDigits.length < 11) {
        return res.status(400).json({
          error: 'Informe um número de WhatsApp válido com DDI + DDD (ex: +5538991292495).',
        });
      }
      const apiKey = String(wa.callMeBotApiKey || '').trim();
      if (!apiKey) {
        return res.status(400).json({
          error: 'Informe a API Key do CallMeBot enviada pelo bot no WhatsApp.',
        });
      }
      if (/^\d{10,}$/.test(apiKey) && (apiKey === phoneDigits || apiKey.startsWith('55'))) {
        return res.status(400).json({
          error:
            'O campo "CallMeBot API Key" contém um número de telefone em vez da API Key. Envie "I allow callmebot to send me messages" para +34 644 71 81 99 no WhatsApp e cole aqui o código curto recebido.',
        });
      }

      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(
        phoneDigits
      )}&text=${encodeURIComponent(testText)}&apikey=${encodeURIComponent(apiKey)}`;
      const upstream = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const textBody = await upstream.text();
      const lower = cleanText(textBody).toLowerCase();
      const bodyHasError =
        !lower.includes('message queued') &&
        (lower.includes('error') ||
          lower.includes('invalid') ||
          lower.includes('not allowed') ||
          lower.includes('not registered'));

      if (!upstream.ok || bodyHasError) {
        return res.status(400).json({
          error: translateCallMeBotError(textBody, upstream.status),
        });
      }
      return res.status(200).json({ ok: true });
    }

    if (provider === 'webhook_rest') {
      const endpoint = String(wa.customWebhookUrl || '').trim();
      if (!endpoint.startsWith('http')) {
        return res.status(400).json({
          error: 'Informe uma URL HTTP/HTTPS válida para o gateway WhatsApp.',
        });
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = String(wa.customWebhookToken || '').trim();
      if (token) {
        headers['apikey'] = token;
        headers['Client-Token'] = token;
        headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      }
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          number: phoneDigits || undefined,
          phone: phoneDigits || undefined,
          text: testText,
          message: testText,
          textMessage: { text: testText },
          source: 'RD Crypto',
          metadata: { type: 'whatsapp_test' },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!upstream.ok) {
        const errBody = await upstream.text().catch(() => '');
        return res.status(400).json({
          error: `Gateway retornou HTTP ${upstream.status}${
            errBody ? `: ${cleanText(errBody).slice(0, 120)}` : ''
          }`,
        });
      }
      return res.status(200).json({ ok: true });
    }

    if (provider === 'meta_cloud') {
      const phoneNumberId = String(wa.metaPhoneNumberId || '').trim();
      const accessToken = String(wa.metaAccessToken || '').trim();
      if (phoneDigits.length < 11 || !phoneNumberId || !accessToken) {
        return res.status(400).json({
          error: 'Informe número destino com DDI, Phone Number ID e Access Token da Meta.',
        });
      }
      const upstream = await fetch(
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
            text: { body: testText },
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!upstream.ok) {
        const errBody = await upstream.text().catch(() => '');
        return res.status(400).json({
          error: `Meta API HTTP ${upstream.status}${
            errBody ? `: ${cleanText(errBody).slice(0, 140)}` : ''
          }`,
        });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Provedor de WhatsApp inválido.' });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Erro interno ao enviar teste no WhatsApp.',
    });
  }
}
