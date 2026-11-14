export function formatPrice(
  valueUsd: number,
  currency: 'USD' | 'BRL',
  usdBrlRate: number
): string {
  if (!Number.isFinite(valueUsd) || valueUsd <= 0) return '—';
  const converted = currency === 'BRL' ? valueUsd * usdBrlRate : valueUsd;
  const prefix = currency === 'BRL' ? 'R$ ' : 'US$ ';

  let fractionDigits = 2;
  if (converted < 0.01) fractionDigits = 6;
  else if (converted < 1) fractionDigits = 4;
  else if (converted < 20) fractionDigits = 3;

  return (
    prefix +
    converted.toLocaleString('pt-BR', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
  );
}

export function formatCurrencyValue(
  valueUsd: number,
  currency: 'USD' | 'BRL',
  usdBrlRate: number
): string {
  if (!Number.isFinite(valueUsd)) return '—';
  const safeVal = Math.abs(valueUsd) < 1e-8 ? 0 : valueUsd;
  const sign = safeVal < 0 ? '-' : '';
  const converted = Math.abs(currency === 'BRL' ? safeVal * usdBrlRate : safeVal);
  const prefix = currency === 'BRL' ? 'R$ ' : 'US$ ';

  let fractionDigits = 2;
  if (converted > 0 && converted < 0.01) fractionDigits = 4;
  else if (converted > 0 && converted < 1) fractionDigits = 4;

  return `${sign}${prefix}${converted.toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

export function formatSignedCurrency(
  valueUsd: number,
  currency: 'USD' | 'BRL',
  usdBrlRate: number
): string {
  if (!Number.isFinite(valueUsd)) return '—';
  const safeVal = Math.abs(valueUsd) < 1e-8 ? 0 : valueUsd;
  const sign = safeVal > 0 ? '+' : safeVal < 0 ? '-' : '';
  const converted = Math.abs(currency === 'BRL' ? safeVal * usdBrlRate : safeVal);
  const prefix = currency === 'BRL' ? 'R$ ' : 'US$ ';

  let fractionDigits = 2;
  if (converted > 0 && converted < 0.01) fractionDigits = 4;
  else if (converted > 0 && converted < 1) fractionDigits = 4;

  return `${sign}${prefix}${converted.toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

export function formatCompactVolume(
  valueUsd: number,
  currency: 'USD' | 'BRL',
  usdBrlRate: number
): string {
  if (!Number.isFinite(valueUsd) || valueUsd <= 0) return '—';
  const converted = currency === 'BRL' ? valueUsd * usdBrlRate : valueUsd;
  const prefix = currency === 'BRL' ? 'R$ ' : 'US$ ';

  if (converted >= 1e9) {
    return `${prefix}${(converted / 1e9).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} B`;
  }
  if (converted >= 1e6) {
    return `${prefix}${(converted / 1e6).toLocaleString('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} M`;
  }
  if (converted >= 1e3) {
    return `${prefix}${(converted / 1e3).toLocaleString('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} K`;
  }
  return formatPrice(valueUsd, currency, usdBrlRate);
}

export function formatPercent(pct: number | undefined | null): string {
  if (pct === undefined || pct === null || !Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export function formatRelativeTime(isoDate: string | undefined | null): string {
  if (!isoDate) return 'Pendente';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
  if (diffSec < 15) return 'agora';
  if (diffSec < 60) return `há ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `há ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `há ${diffDays}d`;
}

export function formatTimeClock(isoDate: string | undefined | null): string {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
