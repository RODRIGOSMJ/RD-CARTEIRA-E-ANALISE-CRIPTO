export interface NormalizedWhatsAppPhone {
  digits: string;
  e164: string;
  autoAppliedBrDdi: boolean;
}

/**
 * Normalizes a WhatsApp phone input to pure DDI + DDD + number digits.
 * If a Brazilian mobile/landline number (10 or 11 digits without leading '+' or '55')
 * is entered, automatically prepends Brazil's country code '55'.
 */
export function normalizeWhatsAppPhone(raw: string): NormalizedWhatsAppPhone {
  const trimmed = String(raw || '').trim();
  const hasExplicitPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '').replace(/^00/, '');

  let autoAppliedBrDdi = false;
  if (!hasExplicitPlus && digits && !digits.startsWith('55')) {
    const isBrMobile11 = digits.length === 11 && /^[1-9]{2}9\d{8}$/.test(digits);
    const isBrLandline10 = digits.length === 10 && /^[1-9]{2}[2-8]\d{7}$/.test(digits);
    if (isBrMobile11 || isBrLandline10) {
      digits = `55${digits}`;
      autoAppliedBrDdi = true;
    }
  }

  return {
    digits,
    e164: digits ? `+${digits}` : '',
    autoAppliedBrDdi,
  };
}

export function looksLikePhoneInsteadOfCallMeBotKey(
  phoneRaw: string,
  apiKeyRaw: string
): boolean {
  const keyClean = String(apiKeyRaw || '').trim();
  const keyDigits = keyClean.replace(/\D/g, '');
  if (!keyDigits || keyDigits !== keyClean || keyDigits.length < 10) {
    return false;
  }
  const normalizedPhone = normalizeWhatsAppPhone(phoneRaw).digits;
  const localPhone = normalizedPhone.replace(/^55/, '');
  if (
    keyDigits === normalizedPhone ||
    (localPhone && keyDigits === localPhone) ||
    /^55[1-9]{2}9?\d{8}$/.test(keyDigits) ||
    /^[1-9]{2}9\d{8}$/.test(keyDigits)
  ) {
    return true;
  }
  return false;
}

export function stripHtmlTags(raw: string): string {
  return String(raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatCallMeBotError(rawBody: string, status?: number): string {
  const clean = stripHtmlTags(rawBody);
  const lower = clean.toLowerCase();

  if (lower.includes('apikey is invalid') || lower.includes('invalid apikey')) {
    return 'API Key do CallMeBot inválida. Envie "I allow callmebot to send me messages" para +34 644 71 81 99 no WhatsApp e cole o código curto retornado pelo bot.';
  }
  if (
    lower.includes('not registered') ||
    lower.includes('not allowed') ||
    lower.includes('i allow callmebot')
  ) {
    return 'Número ainda não autorizado no CallMeBot. Salve +34 644 71 81 99 no WhatsApp, envie "I allow callmebot to send me messages" e tente novamente.';
  }
  if (lower.includes('wait') || lower.includes('too many') || status === 429) {
    return 'Limite temporário de envios do CallMeBot atingido. Aguarde cerca de 30 segundos e tente novamente.';
  }
  if (lower.includes('phone') && (lower.includes('invalid') || lower.includes('error'))) {
    return 'Número de WhatsApp inválido. Informe com DDI + DDD (ex: +5538991292495).';
  }
  if (clean) {
    return clean.slice(0, 180);
  }
  return status ? `CallMeBot respondeu HTTP ${status}.` : 'Falha ao enviar via CallMeBot.';
}

export function isCallMeBotBodyError(rawBody: string): boolean {
  const lower = stripHtmlTags(rawBody).toLowerCase();
  if (!lower) return false;
  if (lower.includes('message queued') || lower.includes('you will receive it')) {
    return false;
  }
  return (
    lower.includes('error') ||
    lower.includes('invalid') ||
    lower.includes('not allowed') ||
    lower.includes('not registered') ||
    lower.includes('apikey')
  );
}
