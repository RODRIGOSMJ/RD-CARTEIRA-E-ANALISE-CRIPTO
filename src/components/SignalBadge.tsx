import { ArrowDownRight, ArrowUpRight, Clock } from 'lucide-react';
import type { SignalAction } from '../types/crypto.ts';

interface SignalBadgeProps {
  action?: SignalAction;
  compact?: boolean;
}

export function SignalBadge({ action, compact = false }: SignalBadgeProps) {
  if (!action) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
        <Clock className="w-3.5 h-3.5 text-slate-500" />
        Aguardando estudo
      </span>
    );
  }

  if (action === 'COMPRAR') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-mono font-semibold tracking-tight whitespace-nowrap shrink-0 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 ${
          compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
        }`}
      >
        <ArrowUpRight className="w-3.5 h-3.5" />
        COMPRAR
      </span>
    );
  }

  if (action === 'VENDER') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-mono font-semibold tracking-tight whitespace-nowrap shrink-0 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-400 ${
          compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
        }`}
      >
        <ArrowDownRight className="w-3.5 h-3.5" />
        VENDER
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono font-semibold tracking-tight whitespace-nowrap shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-400 ${
        compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      }`}
    >
      <Clock className="w-3.5 h-3.5" />
      ESPERAR
    </span>
  );
}
