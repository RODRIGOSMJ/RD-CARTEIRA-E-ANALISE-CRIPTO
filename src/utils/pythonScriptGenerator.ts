import type {
  AppSettings,
  PortfolioHolding,
  PriceTrigger,
  WatchlistAsset,
} from '../types/crypto.ts';
import type {
  AlertChannelChoice,
  PythonGeneratorPrefs,
} from './alertChannelStorage.ts';

export interface PythonGeneratorInput {
  channel: AlertChannelChoice;
  settings: AppSettings;
  watchlist: WatchlistAsset[];
  holdings: PortfolioHolding[];
  triggers: PriceTrigger[];
  prefs: PythonGeneratorPrefs;
}

function pyEscape(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

export function generateMonitorPythonScript(input: PythonGeneratorInput): string {
  const { channel, settings, watchlist, holdings, triggers, prefs } = input;
  const telegram = settings.telegram ?? {
    enabled: false,
    botToken: '',
    chatId: '',
    forwardAiSignals: true,
  };
  const whatsapp = settings.whatsapp;
  const useInline = prefs.credentialMode === 'inline';

  const tokenLiteral = useInline
    ? pyEscape(telegram.botToken.trim())
    : '';
  const chatIdLiteral = useInline
    ? pyEscape(telegram.chatId.trim())
    : '';

  const waPhoneLiteral = useInline
    ? pyEscape(whatsapp.phoneNumber.trim())
    : '';
  const waKeyLiteral = useInline
    ? pyEscape(whatsapp.callMeBotApiKey.trim())
    : '';
  const waWebhookLiteral = useInline
    ? pyEscape(whatsapp.customWebhookUrl.trim())
    : '';

  const activeTriggers = triggers.filter((t) => t.enabled);

  // Merge watchlist + portfolio holdings into tracked assets list
  const assetMap = new Map<
    string,
    {
      coin_id: string;
      symbol: string;
      name: string;
      quantity: number;
      avg_cost_usd: number;
    }
  >();

  for (const w of watchlist) {
    assetMap.set(w.id, {
      coin_id: w.id,
      symbol: w.symbol.toUpperCase(),
      name: w.name,
      quantity: 0,
      avg_cost_usd: 0,
    });
  }

  for (const h of holdings) {
    if (h.quantity <= 0) continue;
    assetMap.set(h.coinId, {
      coin_id: h.coinId,
      symbol: h.symbol.toUpperCase(),
      name: h.name,
      quantity: Number(h.quantity.toFixed(8)),
      avg_cost_usd: Number((h.avgBuyPriceUsd || 0).toFixed(6)),
    });
  }

  if (assetMap.size === 0) {
    assetMap.set('bitcoin', {
      coin_id: 'bitcoin',
      symbol: 'BTC',
      name: 'Bitcoin',
      quantity: 0,
      avg_cost_usd: 0,
    });
    assetMap.set('solana', {
      coin_id: 'solana',
      symbol: 'SOL',
      name: 'Solana',
      quantity: 0,
      avg_cost_usd: 0,
    });
  }

  const assetsJson = JSON.stringify(Array.from(assetMap.values()), null, 2).replace(
    /"""/g,
    '\\"\\"\\"'
  );
  const triggersJson = JSON.stringify(
    activeTriggers.map((t) => ({
      id: t.id,
      coin_id: t.coinId,
      symbol: t.symbol.toUpperCase(),
      name: t.name,
      condition_type: t.conditionType,
      target_value: t.targetValue,
      reference_price_usd: t.referencePriceUsd,
      action_hint: t.actionHint,
      note: t.note ?? '',
    })),
    null,
    2
  ).replace(/"""/g, '\\"\\"\\"');

  const tokenExpr = useInline
    ? `os.environ.get("TELEGRAM_BOT_TOKEN") or "${tokenLiteral}"`
    : 'os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()';

  const chatIdExpr = useInline
    ? `os.environ.get("TELEGRAM_CHAT_ID") or "${chatIdLiteral}"`
    : 'os.environ.get("TELEGRAM_CHAT_ID", "").strip()';

  const waPhoneExpr = useInline
    ? `os.environ.get("WHATSAPP_PHONE") or "${waPhoneLiteral}"`
    : 'os.environ.get("WHATSAPP_PHONE", "").strip()';

  const waKeyExpr = useInline
    ? `os.environ.get("CALLMEBOT_API_KEY") or "${waKeyLiteral}"`
    : 'os.environ.get("CALLMEBOT_API_KEY", "").strip()';

  const waWebhookExpr = useInline
    ? `os.environ.get("WHATSAPP_WEBHOOK_URL") or "${waWebhookLiteral}"`
    : 'os.environ.get("WHATSAPP_WEBHOOK_URL", "").strip()';

  return `#!/usr/bin/env python3
"""
RG Crypto AI Copilot — Monitor 24/7 (GitHub Actions)
Verifica cotações na Binance (com fallback automático na CoinGecko),
avalia gatilhos 24h e variações da carteira, e envia alertas instantâneos
via API oficial do Telegram (sendMessage) ou WhatsApp.
"""

import html
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus

import requests

# ---------------------------------------------------------------------------
# Configuração do Canal & Credenciais
# ---------------------------------------------------------------------------
ALERT_CHANNEL = "${channel}"  # "telegram" ou "whatsapp"
DISPLAY_CURRENCY = "${settings.currency}"  # "BRL" ou "USD"
INCLUDE_PORTFOLIO_SWING_ALERTS = ${prefs.includePortfolioAlerts ? 'True' : 'False'}
PORTFOLIO_SWING_THRESHOLD_PCT = ${Number(prefs.portfolioSwingPct || 5)}

TELEGRAM_BOT_TOKEN = ${tokenExpr}
TELEGRAM_CHAT_ID = ${chatIdExpr}

WHATSAPP_PHONE = ${waPhoneExpr}
CALLMEBOT_API_KEY = ${waKeyExpr}
WHATSAPP_WEBHOOK_URL = ${waWebhookExpr}

HTTP_TIMEOUT = 12
HEADERS = {
    "User-Agent": "RGCryptoAICopilot/1.0 (GitHubActions-Monitor)",
    "Accept": "application/json",
}

# ---------------------------------------------------------------------------
# Ativos da Carteira / Monitoramento & Gatilhos 24h exportados do aplicativo
# ---------------------------------------------------------------------------
WATCHED_ASSETS: List[Dict[str, Any]] = json.loads(r"""${assetsJson}""")

ACTIVE_TRIGGERS: List[Dict[str, Any]] = json.loads(r"""${triggersJson}""")


def fetch_usd_brl_rate() -> float:
    """Obtém cotação USD/BRL com fallback seguro."""
    endpoints = [
        ("https://open.er-api.com/v6/latest/USD", lambda d: float(d["rates"]["BRL"])),
        (
            "https://economia.awesomeapi.com.br/json/last/USD-BRL",
            lambda d: float(d["USDBRL"]["bid"]),
        ),
    ]
    for url, extractor in endpoints:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            rate = extractor(data)
            if rate > 1.0:
                return rate
        except (requests.RequestException, ValueError, KeyError, TypeError):
            continue
    return 5.75


def fetch_binance_price(symbol: str) -> Optional[Tuple[float, float]]:
    """Consulta preço atual e variação 24h na Binance (par USDT)."""
    pair = f"{symbol.upper()}USDT"
    url = f"https://api.binance.com/api/v3/ticker/24hr?symbol={pair}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
        if not resp.ok:
            return None
        data = resp.json()
        price = float(data.get("lastPrice", 0))
        change_24h = float(data.get("priceChangePercent", 0))
        if price > 0:
            return price, change_24h
    except (requests.RequestException, ValueError, TypeError):
        return None
    return None


def fetch_coingecko_prices(coin_ids: List[str]) -> Dict[str, Tuple[float, float]]:
    """Consulta preços em lote na CoinGecko como fallback/complemento."""
    if not coin_ids:
        return {}
    ids_param = ",".join(sorted(set(coin_ids)))
    url = (
        "https://api.coingecko.com/api/v3/simple/price"
        f"?ids={ids_param}&vs_currencies=usd&include_24hr_change=true"
    )
    results: Dict[str, Tuple[float, float]] = {}
    try:
        resp = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, dict):
            return {}
        for cid, entry in data.items():
            if isinstance(entry, dict):
                price = float(entry.get("usd") or 0)
                change = float(entry.get("usd_24h_change") or 0)
                if price > 0:
                    results[cid] = (price, change)
    except (requests.RequestException, ValueError, TypeError) as exc:
        print(f"[WARN] Falha ao consultar CoinGecko: {exc}", file=sys.stderr)
    return results


def format_currency(price_usd: float, usd_brl: float) -> str:
    val = price_usd * usd_brl if DISPLAY_CURRENCY == "BRL" else price_usd
    prefix = "R$" if DISPLAY_CURRENCY == "BRL" else "US$"
    if val >= 1000:
        return f"{prefix} {val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    if val >= 1:
        return f"{prefix} {val:.2f}".replace(".", ",")
    return f"{prefix} {val:.6f}".replace(".", ",")


def send_telegram_message(html_message: str) -> bool:
    """Envia mensagem formatada usando o endpoint oficial sendMessage do Telegram."""
    token = TELEGRAM_BOT_TOKEN.strip()
    chat_id = TELEGRAM_CHAT_ID.strip()
    if not token or not chat_id:
        print(
            json.dumps(
                {
                    "ok": False,
                    "channel": "telegram",
                    "error": "TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurado.",
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return False

    endpoint = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": html_message,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }

    try:
        resp = requests.post(endpoint, json=payload, timeout=HTTP_TIMEOUT)
        try:
            data = resp.json()
        except ValueError:
            data = {"ok": False, "description": resp.text[:200]}

        if not resp.ok or not data.get("ok"):
            print(
                json.dumps(
                    {
                        "ok": False,
                        "channel": "telegram",
                        "status_code": resp.status_code,
                        "error_code": data.get("error_code"),
                        "description": data.get("description", "Erro desconhecido no Telegram"),
                    },
                    ensure_ascii=False,
                ),
                file=sys.stderr,
            )
            return False

        print(
            json.dumps(
                {"ok": True, "channel": "telegram", "message_id": data.get("result", {}).get("message_id")},
                ensure_ascii=False,
            )
        )
        return True
    except requests.RequestException as exc:
        print(
            json.dumps(
                {"ok": False, "channel": "telegram", "error": str(exc)},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return False


def send_whatsapp_message(plain_message: str) -> bool:
    """Envia alerta no WhatsApp via Webhook REST ou CallMeBot."""
    if WHATSAPP_WEBHOOK_URL.strip():
        try:
            resp = requests.post(
                WHATSAPP_WEBHOOK_URL.strip(),
                json={"phone": WHATSAPP_PHONE.strip(), "message": plain_message, "text": plain_message},
                timeout=HTTP_TIMEOUT,
            )
            if resp.ok:
                print(json.dumps({"ok": True, "channel": "whatsapp_webhook"}))
                return True
            print(
                json.dumps({"ok": False, "channel": "whatsapp_webhook", "status": resp.status_code}),
                file=sys.stderr,
            )
            return False
        except requests.RequestException as exc:
            print(json.dumps({"ok": False, "channel": "whatsapp_webhook", "error": str(exc)}), file=sys.stderr)
            return False

    phone = "".join(ch for ch in WHATSAPP_PHONE if ch.isdigit())
    api_key = CALLMEBOT_API_KEY.strip()
    if not phone or not api_key:
        print(
            json.dumps(
                {
                    "ok": False,
                    "channel": "whatsapp",
                    "error": "WHATSAPP_PHONE ou CALLMEBOT_API_KEY não configurado.",
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return False

    url = (
        "https://api.callmebot.com/whatsapp.php"
        f"?phone={phone}&text={quote_plus(plain_message)}&apikey={quote_plus(api_key)}"
    )
    try:
        resp = requests.get(url, timeout=HTTP_TIMEOUT)
        body_lower = resp.text.lower()
        if not resp.ok or ("error" in body_lower and "queued" not in body_lower):
            print(
                json.dumps(
                    {
                        "ok": False,
                        "channel": "whatsapp_callmebot",
                        "status": resp.status_code,
                        "response": resp.text[:200],
                    },
                    ensure_ascii=False,
                ),
                file=sys.stderr,
            )
            return False
        print(json.dumps({"ok": True, "channel": "whatsapp_callmebot"}))
        return True
    except requests.RequestException as exc:
        print(json.dumps({"ok": False, "channel": "whatsapp_callmebot", "error": str(exc)}), file=sys.stderr)
        return False


def evaluate_trigger(trigger: Dict[str, Any], price_usd: float) -> Tuple[bool, str]:
    cond = trigger.get("condition_type")
    target = float(trigger.get("target_value") or 0)
    ref = float(trigger.get("reference_price_usd") or price_usd)

    if cond == "queda_pct" and ref > 0:
        drop_pct = ((ref - price_usd) / ref) * 100.0
        if drop_pct >= target:
            return True, f"Queda de {drop_pct:.2f}% (gatilho -{target:.2f}%)"
    elif cond == "alta_pct" and ref > 0:
        rise_pct = ((price_usd - ref) / ref) * 100.0
        if rise_pct >= target:
            return True, f"Alta de +{rise_pct:.2f}% (gatilho +{target:.2f}%)"
    elif cond == "abaixo_preco" and price_usd <= target:
        return True, f"Preço atingiu ou ficou abaixo do alvo"
    elif cond == "acima_preco" and price_usd >= target:
        return True, f"Preço atingiu ou superou o alvo"

    return False, ""


def main() -> int:
    usd_brl = fetch_usd_brl_rate()
    prices: Dict[str, Tuple[float, float, str]] = {}

    missing_ids: List[str] = []
    for asset in WATCHED_ASSETS:
        cid = asset["coin_id"]
        sym = asset["symbol"]
        binance_res = fetch_binance_price(sym)
        if binance_res:
            prices[cid] = (binance_res[0], binance_res[1], "Binance")
        else:
            missing_ids.append(cid)

    if missing_ids:
        cg_res = fetch_coingecko_prices(missing_ids)
        for cid, (p, chg) in cg_res.items():
            prices[cid] = (p, chg, "CoinGecko")

    alert_lines_html: List[str] = []
    alert_lines_plain: List[str] = []

    # 1. Avalia todos os gatilhos 24h ativos
    for trig in ACTIVE_TRIGGERS:
        cid = trig["coin_id"]
        if cid not in prices:
            continue
        price_usd, chg_24h, source = prices[cid]
        fired, reason = evaluate_trigger(trig, price_usd)
        if fired:
            sym = trig["symbol"]
            hint = str(trig.get("action_hint") or "ALERTA").upper()
            note = str(trig.get("note") or "").strip()
            formatted_price = format_currency(price_usd, usd_brl)
            note_suffix = f" | Nota: {note}" if note else ""

            alert_lines_html.append(
                f"• <b>{html.escape(sym)}</b> [{html.escape(hint)}] — "
                f"<b>{html.escape(formatted_price)}</b> ({chg_24h:+.2f}% 24h)\\n"
                f"  ↳ {html.escape(reason)} via {html.escape(source)}"
                + (f"\\n  ↳ <i>{html.escape(note)}</i>" if note else "")
            )
            alert_lines_plain.append(
                f"• {sym} [{hint}] — {formatted_price} ({chg_24h:+.2f}% 24h) | {reason}{note_suffix}"
            )

    # 2. Monitora oscilações fortes nos ativos da carteira
    if INCLUDE_PORTFOLIO_SWING_ALERTS:
        for asset in WATCHED_ASSETS:
            cid = asset["coin_id"]
            qty = float(asset.get("quantity") or 0)
            avg_cost = float(asset.get("avg_cost_usd") or 0)
            if cid not in prices or qty <= 0:
                continue
            price_usd, chg_24h, source = prices[cid]
            if abs(chg_24h) >= PORTFOLIO_SWING_THRESHOLD_PCT:
                sym = asset["symbol"]
                formatted_price = format_currency(price_usd, usd_brl)
                pnl_text = ""
                if avg_cost > 0:
                    pnl_pct = ((price_usd - avg_cost) / avg_cost) * 100.0
                    pnl_text = f" | Carteira P&L: {pnl_pct:+.2f}%"
                direction = "ALTA FORTE" if chg_24h > 0 else "QUEDA FORTE"
                alert_lines_html.append(
                    f"• <b>{html.escape(sym)}</b> ({direction} {chg_24h:+.2f}% 24h) — "
                    f"<b>{html.escape(formatted_price)}</b>"
                    f"{html.escape(pnl_text)} ({html.escape(source)})"
                )
                alert_lines_plain.append(
                    f"• {sym} ({direction} {chg_24h:+.2f}% 24h) — {formatted_price}{pnl_text}"
                )

    now_utc = datetime.now(timezone.utc).strftime("%d/%m %H:%M UTC")
    print(
        json.dumps(
            {
                "ok": True,
                "checked_assets": len(prices),
                "active_triggers": len(ACTIVE_TRIGGERS),
                "alerts_triggered": len(alert_lines_html),
                "channel": ALERT_CHANNEL,
                "timestamp": now_utc,
            },
            ensure_ascii=False,
        )
    )

    if not alert_lines_html:
        return 0

    if ALERT_CHANNEL == "telegram":
        msg_html = (
            "🚨 <b>RG Crypto AI Copilot — Alerta 24h</b>\\n"
            f"<i>{html.escape(now_utc)}</i>\\n\\n"
            + "\\n\\n".join(alert_lines_html)
        )
        ok = send_telegram_message(msg_html)
        return 0 if ok else 1

    msg_plain = (
        f"*RG Crypto AI Copilot — Alerta 24h ({now_utc})*\\n\\n"
        + "\\n\\n".join(alert_lines_plain)
    )
    ok = send_whatsapp_message(msg_plain)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
`;
}

export function generateGitHubWorkflowYaml(
  channel: AlertChannelChoice,
  prefs: PythonGeneratorPrefs
): string {
  const cronExpr = `*/${prefs.intervalMinutes} * * * *`;
  const envBlock =
    channel === 'telegram'
      ? `          TELEGRAM_BOT_TOKEN: \${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: \${{ secrets.TELEGRAM_CHAT_ID }}`
      : `          WHATSAPP_PHONE: \${{ secrets.WHATSAPP_PHONE }}
          CALLMEBOT_API_KEY: \${{ secrets.CALLMEBOT_API_KEY }}
          WHATSAPP_WEBHOOK_URL: \${{ secrets.WHATSAPP_WEBHOOK_URL }}`;

  return `name: RG Crypto AI Copilot - Monitor 24h

on:
  schedule:
    - cron: '${cronExpr}'
  workflow_dispatch:

jobs:
  monitor-cripto:
    runs-on: ubuntu-latest
    steps:
      - name: Baixar repositório
        uses: actions/checkout@v4

      - name: Configurar Python 3.11
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Instalar dependências
        run: pip install requests

      - name: Executar verificação de cotações e alertas 24h
        env:
${envBlock}
        run: python monitor_cripto.py
`;
}
