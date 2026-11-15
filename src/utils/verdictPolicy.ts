import type {
  MarketSnapshot,
  PortfolioHolding,
  SignalAction,
} from '../types/crypto.ts';

export interface VerdictPolicyInput {
  rawAction: SignalAction;
  snap: MarketSnapshot;
  holding?: PortfolioHolding | null;
  headline?: string;
  thesis?: string;
  portfolioAdvice?: string;
}

export interface VerdictPolicyOutput {
  action: SignalAction;
  headline: string;
  thesis: string;
  portfolioAdvice: string;
  canSellForProfit: boolean;
  isAccumulationZone: boolean;
}

/**
 * Portfolio & HODL protection rules:
 * 1. Never output VENDER during a 7d/24h selloff, panic, or when RSI <= 70 or user is at a loss.
 * 2. During drops/bleeding market:
 *    - RSI <= 45 (especially <= 40) -> COMPRAR (Preço Médio) / ACUMULAR
 *    - Consolidation / unclear direction -> ESPERAR / MANTER (HODL)
 * 3. VENDER / Venda Parcial only when asset is in a prolonged uptrend AND RSI > 70 (and in profit if held).
 */
export function applyPortfolioProtectionPolicy(
  input: VerdictPolicyInput
): VerdictPolicyOutput {
  const { rawAction, snap, holding } = input;
  const ind = snap.indicators;
  const rsi = ind.rsi14;
  const chg7d = snap.change7dPct ?? 0;
  const chg24h = snap.change24hPct ?? 0;
  const hasHolding = Boolean(holding && holding.quantity > 0);
  const inProfit = !hasHolding || (holding?.unrealizedPnlPct ?? 0) > 0;

  const isProlongedUptrend =
    ind.emaTrend === 'alta' &&
    chg7d > 3 &&
    snap.priceUsd >= (ind.ema21 || snap.priceUsd) * 0.995;

  // Rule 3: VENDER only strictly when RSI > 70 in a strong prolonged uptrend & never at a loss
  const canSellForProfit = rsi > 70 && isProlongedUptrend && inProfit;

  const isMarketBleeding = chg7d <= -3 || chg24h <= -3.5;
  const isOversoldDca = rsi <= 45;
  const isDeepOversold = rsi <= 40 || (rsi <= 45 && ind.bollingerPercentB <= 30);
  const isAccumulationZone = isOversoldDca && (isMarketBleeding || ind.bollingerPercentB <= 35 || rsi <= 40);

  let finalAction: SignalAction = rawAction;

  if (rawAction === 'VENDER' && !canSellForProfit) {
    // Block panic / loss-making sell verdicts immediately
    finalAction = isDeepOversold || (isMarketBleeding && isOversoldDca)
      ? 'COMPRAR'
      : 'ESPERAR';
  } else if (rawAction === 'ESPERAR' && isMarketBleeding && rsi <= 40) {
    // Opportunity to lower average cost (Preço Médio) on deep oversold drops
    finalAction = 'COMPRAR';
  } else if (rawAction === 'COMPRAR' && rsi > 66) {
    // Avoid buying right below overbought resistance
    finalAction = 'ESPERAR';
  }

  let headline = String(input.headline || '').trim();
  let thesis = String(input.thesis || '').trim();
  let portfolioAdvice = String(input.portfolioAdvice || '').trim();

  const wasDowngradedFromSell = rawAction === 'VENDER' && finalAction !== 'VENDER';

  if (finalAction === 'COMPRAR') {
    if (isAccumulationZone || wasDowngradedFromSell) {
      if (!headline || wasDowngradedFromSell || /vender|venda/i.test(headline)) {
        headline = `COMPRAR (Preço Médio) — Acumular ${snap.symbol} com RSI ${rsi.toFixed(1)}`;
      }
      if (!thesis || wasDowngradedFromSell) {
        thesis = `Mercado em recuo (${chg7d.toFixed(1)}% em 7d) com RSI(14) em ${rsi.toFixed(
          1
        )} apontando região de desconto/sobrevenda. Estratégia HODL prioriza acumulação gradual para reduzir o preço médio em vez de vender na baixa.`;
      }
      if (!portfolioAdvice || wasDowngradedFromSell) {
        portfolioAdvice = hasHolding && holding
          ? `Sua posição em ${snap.symbol} está em ${holding.unrealizedPnlPct.toFixed(
              1
            )}%. Evite vender no prejuízo; avalie aportes fracionados para baratear seu preço médio (US$ ${holding.avgBuyPriceUsd.toFixed(
              4
            )}).`
          : `Região técnica descontada (RSI ${rsi.toFixed(
              1
            )}) favorável para iniciar compras fracionadas com foco em acumulação.`;
      }
    } else if (!headline) {
      headline = `COMPRAR / ACUMULAR — ${snap.symbol} em zona construtiva`;
    }
  } else if (finalAction === 'ESPERAR') {
    if (wasDowngradedFromSell || !headline || /vender|venda/i.test(headline)) {
      headline = isMarketBleeding
        ? `ESPERAR / MANTER (HODL) — Proteção contra venda na baixa`
        : `ESPERAR / MANTER (HODL) — Consolidação sem sobrecompra`;
    }
    if (wasDowngradedFromSell || !thesis) {
      thesis = `Variação de 7d em ${chg7d.toFixed(1)}% e RSI(14) em ${rsi.toFixed(
        1
      )} (abaixo da zona de sobrecompra > 70). A política de proteção de patrimônio bloqueia vendas em queda ou consolidação para evitar realizar prejuízos.`;
    }
    if (wasDowngradedFromSell || !portfolioAdvice) {
      portfolioAdvice = hasHolding && holding
        ? `Mantenha (HODL) seus ${holding.quantity.toLocaleString('pt-BR', {
            maximumFractionDigits: 6,
          })} ${snap.symbol}. Realizações de lucro só são indicadas em forte tendência de alta com RSI > 70.`
        : `Ativo sem sobrecompra ou tendência explosiva confirmada. Aguarde definição ou RSI abaixo de 45 para acumular.`;
    }
  } else {
    // finalAction === 'VENDER' (strictly RSI > 70 + strong 7d uptrend + profit)
    if (!headline) {
      headline = `VENDER (Venda Parcial) — Realizar lucro com RSI ${rsi.toFixed(1)}`;
    }
  }

  return {
    action: finalAction,
    headline: headline.slice(0, 120),
    thesis,
    portfolioAdvice,
    canSellForProfit,
    isAccumulationZone,
  };
}

export function getVerdictBadgeMeta(
  action?: SignalAction,
  opts?: {
    rsi14?: number;
    change7dPct?: number;
    headline?: string;
  }
): {
  label: string;
  compactLabel: string;
  tooltip: string;
} {
  if (!action) {
    return {
      label: 'Aguardando estudo',
      compactLabel: 'Aguardando',
      tooltip: 'Aguardando estudo automático da IA',
    };
  }

  if (action === 'COMPRAR') {
    const isDca =
      (opts?.rsi14 !== undefined && opts.rsi14 <= 45) ||
      (opts?.change7dPct !== undefined && opts.change7dPct <= -2) ||
      Boolean(opts?.headline && /pre[cç]o m[eé]dio|acumular/i.test(opts.headline));

    return isDca
      ? {
          label: 'COMPRAR (Preço Médio)',
          compactLabel: 'COMPRAR (PM)',
          tooltip: 'COMPRAR (Preço Médio) / ACUMULAR — RSI em sobrevenda ou queda para baixar preço médio',
        }
      : {
          label: 'COMPRAR / ACUMULAR',
          compactLabel: 'COMPRAR',
          tooltip: 'COMPRAR / ACUMULAR',
        };
  }

  if (action === 'VENDER') {
    return {
      label: 'VENDER (Venda Parcial)',
      compactLabel: 'VENDA PARCIAL',
      tooltip: 'VENDER (Venda Parcial) — Tendência de alta prolongada com RSI > 70 para realizar lucro',
    };
  }

  return {
    label: 'ESPERAR / MANTER (HODL)',
    compactLabel: 'MANTER (HODL)',
    tooltip: 'ESPERAR / MANTER (HODL) — Consolidação ou proteção contra venda na baixa',
  };
}
