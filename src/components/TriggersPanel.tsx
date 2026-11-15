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
  telegramEnabled: boolean;
  onOpenNewTrigger: () => void;
  onToggleTrigger: (triggerId: string, enabled: boolean) => Promise<void>;
  onUpdateChannels: (
    triggerId: string,
    patch: { sendWhatsApp?: boolean; sendTelegram?: boolean }
  ) => Promise<void>;
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
  telegramEnabled,
  onOpenNewTrigger,
  onToggleTrigger,
  onUpdateChannels,
  onResetReference,
  onDeleteTrigger,
  onClearTriggers,
}: TriggersPanelProps) {
  const channelStatusText =
    whatsappEnabled && telegramEnabled
      ? 'WhatsApp e Telegram ativos: seus gatilhos são verificados em tempo real e enviados automaticamente.'
      : whatsappEnabled
      ? 'WhatsApp ativo (Telegram disponível na aba ao lado): gatilhos verificados automaticamente 24h.'
      : telegramEnabled
      ? 'Telegram ativo: seus gatilhos são verificados em tempo real e enviados automaticamente.'
      : 'Ative e configure seu WhatsApp ou Telegram ao lado para receber os disparos automaticamente.';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#111827] shadow-xs dark:shadow-none overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Meus gatilhos automáticos 24h ({triggers.length})
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            {channelStatusText}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {triggers.length > 0 && (
            <button
              type="button"
              onClick={() => void onClearTriggers()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-300 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 transition-colors whitespace-nowrap"
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

      <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
        {triggers.length === 0 ? (
          <div className="p-9 text-center space-y-3">
            <BellRing className="w-7 h-7 text-sky-600 dark:text-sky-400 mx-auto" />
            <div className="space-y-1 max-w-md mx-auto">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-200">
                Nenhum gatilho armazenado ainda
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Armazene regras como &quot;se a Solana cair 10%, avisar no WhatsApp ou Telegram para comprar&quot; e o sistema vigia o mercado 24 horas por dia.
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
                ? 'text-emerald-700 dark:text-emerald-400'
                : trig.actionHint === 'VENDER'
                ? 'text-rose-700 dark:text-rose-400'
                : 'text-amber-700 dark:text-amber-400';

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
                    <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                      {trig.symbol}
                    </span>
                    <span className="text-xs text-slate-600 dark:text-slate-400">{trig.name}</span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                      ·
                    </span>
                    <span className={`text-xs font-mono font-semibold ${actionColor}`}>
                      {trig.actionHint}
                    </span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                      ·
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        trig.enabled
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-slate-500'
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
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Zerar base
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void onToggleTrigger(trig.id, !trig.enabled)}
                      title={trig.enabled ? 'Pausar gatilho' : 'Reativar gatilho'}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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
                      className="p-1.5 rounded border border-slate-300 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 hover:border-rose-300 dark:hover:border-rose-500/30 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  <span className="font-semibold text-sky-700 dark:text-sky-400">{ruleLabel}</span>
                  {targetUsd && (
                    <>
                      <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span>
                        Dispara em {formatPrice(targetUsd, currency, usdBrlRate)}
                      </span>
                    </>
                  )}
                  {currentPriceUsd > 0 && (
                    <>
                      <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span>
                        Atual {formatPrice(currentPriceUsd, currency, usdBrlRate)}
                      </span>
                    </>
                  )}
                  {currentDeltaPct !== null && (
                    <>
                      <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span
                        className={
                          currentDeltaPct >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }
                      >
                        Desde ref: {formatPercent(currentDeltaPct)}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                  <span>
                    Modo: {trig.repeatMode === 'continuo' ? `Contínuo (${trig.cooldownMinutes}m cooldown)` : 'Disparo único'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() =>
                      void onUpdateChannels(trig.id, { sendWhatsApp: !trig.sendWhatsApp })
                    }
                    title="Alternar envio no WhatsApp para este gatilho"
                    className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                      trig.sendWhatsApp
                        ? 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-300 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    WhatsApp: {trig.sendWhatsApp ? 'Sim' : 'Não'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void onUpdateChannels(trig.id, {
                        sendTelegram: !Boolean(trig.sendTelegram),
                      })
                    }
                    title="Alternar envio no Telegram para este gatilho"
                    className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                      trig.sendTelegram
                        ? 'border-sky-300 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300'
                        : 'border-slate-300 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    Telegram: {trig.sendTelegram ? 'Sim' : 'Não'}
                  </button>
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
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {trig.lastDeliveryError || 'Alerta enviado'}
                      </span>
                    </>
                  )}
                  {(trig.lastDeliveryStatus === 'falha' ||
                    trig.lastDeliveryStatus === 'sem_whatsapp' ||
                    trig.lastDeliveryStatus === 'sem_canal') && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-700 dark:text-amber-400">
                        {trig.lastDeliveryError || 'Canal não configurado'}
                      </span>
                    </>
                  )}
                </div>

                {trig.note && (
                  <p className="text-xs text-slate-600 dark:text-slate-400">{trig.note}</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
