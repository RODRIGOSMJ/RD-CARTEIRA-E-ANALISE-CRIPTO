import type { SignalAlert } from '../types/crypto.ts';
import { formatPrice } from './format.ts';

export function playAlertChime(action: 'COMPRAR' | 'VENDER' | 'ESPERAR') {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const freqs =
      action === 'COMPRAR'
        ? [523.25, 659.25, 783.99] // C5-E5-G5 ascending
        : action === 'VENDER'
        ? [659.25, 523.25, 440.0] // E5-C5-A4 descending
        : [523.25, 523.25];

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);

      gain.gain.setValueAtTime(0.001, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.07, now + idx * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.24);
    });
  } catch {
    // Ignore audio context restrictions
  }
}

export function sendBrowserNotification(
  alert: SignalAlert,
  currency: 'USD' | 'BRL',
  usdBrlRate: number
) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const priceFormatted = formatPrice(alert.priceAtSignalUsd, currency, usdBrlRate);
  const title = `${alert.action}: ${alert.symbol} (${alert.confidence}% confiança)`;
  const body = `${priceFormatted} — ${alert.headline}`;

  try {
    new Notification(title, {
      body,
      tag: alert.id,
    });
  } catch {
    // Some iframe sandboxes restrict Notification constructor
  }
}
