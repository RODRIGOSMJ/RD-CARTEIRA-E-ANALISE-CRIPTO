import { BellRing, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { MarketSnapshot, PriceTrigger } from '../types/crypto.ts';
import { formatPercent, formatPrice } from '../utils/format.ts';
import { CryptoLogo } from './CryptoLogo.tsx';

interface TriggersPanelProps {
  triggers: PriceTrigger[];
  snapshots: Record<string, MarketSnapshot>;
  currency: 'USD' | 'BRL';
  usdBrlRate: number;
  whatsappEnabled: boolean;
  onOpenNewTrigger: () => void;
  onToggleTrigger: (triggerId: string, enabled: boolean) => Promise<void>;
  onResetReference: (triggerId: string) => Promise<void>;
  onDeleteTrigger: (triggerId: string) => Promise<void>;
  onClearTriggers: () => Promise<void>;
}

function getConditionSummary(
  trigger: PriceTrigger,
  currency: 'USD' | 'BRL',
  usdBrlRate: number
): { ruleLabel: string; targetUsd: number | null } {
  if (trigger.conditionType === 'queda_pct') {
    const targetUsd =
      trigger.referencePriceUsd > 0
        ? trigger.referencePriceUsd * (1 - trigger.targetValue / 100)
        : null;
    return {
      ruleLabel: `Cair ${trigger.targetValue.toLocaleString('pt-BR', {
        maximumFractionDigits: 2,
      })}%`,
      targetUsd,
    };
  }
  if (trigger.conditionType === 'alta_pct') {
    const targetUsd =
      trigger.referencePriceUsd > 0
        ? trigger.referencePriceUsd * (1 + trigger.targetValue / 100)
        : null;
    return {
      ruleLabel: `Subir ${trigger.targetValue.toLocaleString('pt-BR', {
        maximumFractionDigits: 2,
      })}%`,
      targetUsd,
    };
  }
  if (trigger.conditionType === 'abaixo_preco') {
    return {
      ruleLabel: `Abaixo de ${formatPrice(trigger.targetValue, currency, usdBrlRate)}`,
      targetUsd: trigger.targetValue,
    };
  }
  return {
    ruleLabel: `Acima de ${formatPrice(trigger.targetValue, currency, usdBrlRate)}`,
    targetUsd: trigger.targetValue,
  };
}

export function TriggersPanel({
  triggers,
  snapshots,
  currency,
  usdBrlRate,
  whatsappEnabled,
  onOpenNewTrigger,
  onToggleTrigger,
  onResetReference,
  onDeleteTrigger,
  onClearTriggers,
}: TriggersPanelProps) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#111827] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            Meus gatilhos automáticos 24h ({triggers.length})
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {whatsappEnabled
              ? 'WhatsApp ativo: seus gatilhos são verificados a cada 10s e enviados automaticamente.'
              : 'Ative e configure seu WhatsApp ao lado para receber os disparos automaticamente.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {triggers.length > 0 && (
            <button
              type="button"
              onClick={() => void onClearTriggers()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpar tudo
            </button>
          )}
          <button
            type="button"
            onClick={onOpenNewTrigger}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo gatilho
          </button>
        </div>
      </div>

      <div className="divide-y divide-white/[0.06]">
        {triggers.length === 0 ? (
          <div className="p-9 text-center space-y-3">
            <BellRing className="w-7 h-7 text-sky-400 mx-auto" />
            <div className="space-y-1 max-w-md mx-auto">
              <p className="text-sm font-medium text-slate-200">
                Nenhum gatilho armazenado ainda
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                Armazene regras como &quot;se a Solana cair 10%, enviar no meu WhatsApp para comprar&quot; e o sistema vigia o mercado 24 horas por dia.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenNewTrigger}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Criar primeiro gatilho
            </button>
          </div>
        ) : (
          triggers.map((trig) => {
            const snap = snapshots[trig.coinId];
            const currentPriceUsd = snap?.priceUsd ?? 0;
            const { ruleLabel, targetUsd } = getConditionSummary(
              trig,
              currency,
              usdBrlRate
            );

            let currentDeltaPct: number | null = null;
            if (
              currentPriceUsd > 0 &&
              trig.referencePriceUsd > 0 &&
              (trig.conditionType === 'queda_pct' || trig.conditionType === 'alta_pct')
            ) {
              currentDeltaPct =
                ((currentPriceUsd - trig.referencePriceUsd) / trig.referencePriceUsd) *
                100;
            }

            const actionColor =
              trig.actionHint === 'COMPRAR'
                ? 'text-emerald-400'
                : trig.actionHint === 'VENDER'
                ? 'text-rose-400'
                : 'text-amber-400';

            return (
              <div key={trig.id} className="p-5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <CryptoLogo
                      symbol={trig.symbol}
                      coinId={trig.coinId}
                      name={trig.name}
                      size="sm"
                    />
                    <span className="font-mono font-bold text-sm text-slate-100">
                      {trig.symbol}
                    </span>
                    <span className="text-xs text-slate-400">{trig.name}</span>
                    <span aria-hidden="true" className="text-slate-600">
                      ·
                    </span>
                    <span className={`text-xs font-mono font-semibold ${actionColor}`}>
                      {trig.actionHint}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">
                      ·
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        trig.enabled ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {trig.enabled ? 'Monitorando 24h' : 'Pausado'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {(trig.conditionType === 'queda_pct' ||
                      trig.conditionType === 'alta_pct') && (
                      <button
                        type="button"
                        onClick={() => void onResetReference(trig.id)}
                        title="Atualizar preço base para a cotação atual"
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-white/10 text-slate-300 hover:bg-slate-800 transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Zerar base
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void onToggleTrigger(trig.id, !trig.enabled)}
                      title={trig.enabled ? 'Pausar gatilho' : 'Reativar gatilho'}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-white/10 text-slate-300 hover:bg-slate-800 transition-colors"
                    >
                      {trig.enabled ? (
                        <>
                          <Pause className="w-3 h-3" />
                          Pausar
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3" />
                          Ativar
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => void onDeleteTrigger(trig.id)}
                      title="Excluir gatilho"
                      aria-label={`Excluir gatilho ${trig.symbol}`}
                      className="p-1.5 rounded border border-white/10 text-slate-400 hover:text-rose-400 hover:border-rose-500/30 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono tabular-nums text-slate-300">
                  <span className="font-semibold text-sky-400">{ruleLabel}</span>
                  {targetUsd && (
                    <>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span>
                        Dispara em {formatPrice(targetUsd, currency, usdBrlRate)}
                      </span>
                    </>
                  )}
                  {currentPriceUsd > 0 && (
                    <>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span>
                        Atual {formatPrice(currentPriceUsd, currency, usdBrlRate)}
                      </span>
                    </>
                  )}
                  {currentDeltaPct !== null && (
                    <>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span
                        className={
                          currentDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }
                      >
                        Desde ref: {formatPercent(currentDeltaPct)}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 font-mono tabular-nums">
                  <span>
                    Modo: {trig.repeatMode === 'continuo' ? `Contínuo (${trig.cooldownMinutes}m cooldown)` : 'Disparo único'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    WhatsApp: {trig.sendWhatsApp ? 'Sim' : 'Não'}
                  </span>
                  {trig.triggerCount > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Disparos: {trig.triggerCount}</span>
                    </>
                  )}
                  {trig.lastTriggeredAt && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Último:{' '}
                        {new Date(trig.lastTriggeredAt).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </>
                  )}
                  {trig.lastDeliveryStatus === 'enviado' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-400">WhatsApp enviado</span>
                    </>
                  )}
                  {(trig.lastDeliveryStatus === 'falha' ||
                    trig.lastDeliveryStatus === 'sem_whatsapp') && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-400">
                        {trig.lastDeliveryError || 'WhatsApp não configurado'}
                      </span>
                    </>
                  )}
                </div>

                {trig.note && (
                  <p className="text-xs text-slate-400">{trig.note}</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
