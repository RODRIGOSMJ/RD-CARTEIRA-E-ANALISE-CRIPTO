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

  const dailyHourBrt = Math.min(23, Math.max(0, Math.floor(prefs.dailySummaryHourBrt ?? 8)));
  const intervalMin = Number(prefs.intervalMinutes || 5);

  return `#!/usr/bin/env python3
"""
RD Crypto — Monitor 24/7 + Resumo Diário & Notícias (GitHub Actions)
- Vertente 1: Alertas em tempo real (gatilhos 24h + oscilações da carteira)
- Vertente 2: Resumo Diário da Manhã com Índice Fear & Greed, macro global,
  notícias de impacto e análise executiva via Gemini API (com fallback automático).
- Envio formatado em Markdown limpo via API oficial do Telegram (sendMessage)
  ou WhatsApp.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus

import requests

# ---------------------------------------------------------------------------
# Configuração do Canal, Horários & Credenciais
# ---------------------------------------------------------------------------
ALERT_CHANNEL = "${channel}"  # "telegram" ou "whatsapp"
DISPLAY_CURRENCY = "${settings.currency}"  # "BRL" ou "USD"
INCLUDE_PORTFOLIO_SWING_ALERTS = ${prefs.includePortfolioAlerts ? 'True' : 'False'}
PORTFOLIO_SWING_THRESHOLD_PCT = ${Number(prefs.portfolioSwingPct || 5)}

# Configuração do Resumo Diário da Manhã & Notícias
ENABLE_DAILY_NEWS_SUMMARY = ${prefs.enableDailyNewsSummary ? 'True' : 'False'}
DAILY_SUMMARY_HOUR_BRT = ${dailyHourBrt}  # Horário de Brasília (UTC-3), ex: 8 = 08:00
CHECK_INTERVAL_MINUTES = ${intervalMin}
USE_GEMINI_DAILY_SUMMARY = ${prefs.useGeminiSummary ? 'True' : 'False'}
FORCE_DAILY_SUMMARY = os.environ.get("FORCE_DAILY_SUMMARY", "").strip().lower() in ("1", "true", "yes", "sim")
STATE_FILE = ".rg_crypto_bot_state.json"

TELEGRAM_BOT_TOKEN = ${tokenExpr}
TELEGRAM_CHAT_ID = ${chatIdExpr}
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()

WHATSAPP_PHONE = ${waPhoneExpr}
CALLMEBOT_API_KEY = ${waKeyExpr}
WHATSAPP_WEBHOOK_URL = ${waWebhookExpr}

HTTP_TIMEOUT = 14
HEADERS = {
    "User-Agent": "RGCryptoAICopilot/2.0 (GitHubActions-Monitor)",
    "Accept": "application/json",
}
BRT_TZ = timezone(timedelta(hours=-3))

# ---------------------------------------------------------------------------
# Ativos da Carteira / Monitoramento & Gatilhos 24h exportados do aplicativo
# ---------------------------------------------------------------------------
WATCHED_ASSETS: List[Dict[str, Any]] = json.loads(r"""${assetsJson}""")

ACTIVE_TRIGGERS: List[Dict[str, Any]] = json.loads(r"""${triggersJson}""")


def escape_md(text: Any) -> str:
    """Escapa caracteres especiais do Markdown clássico do Telegram."""
    s = str(text or "")
    for ch in ("_", "*", "\`", "["):
        s = s.replace(ch, f"\\\\{ch}")
    return s


def load_bot_state() -> Dict[str, Any]:
    if not os.path.exists(STATE_FILE):
        return {}
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_bot_state(state: Dict[str, Any]) -> None:
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except OSError as exc:
        print(json.dumps({"ok": False, "step": "save_state", "error": str(exc)}), file=sys.stderr)


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
        print(json.dumps({"ok": False, "source": "coingecko_prices", "error": str(exc)}), file=sys.stderr)
    return results


def fetch_fear_and_greed() -> Dict[str, Any]:
    """Consulta o Índice Fear & Greed (Alternative.me) para medir o sentimento global."""
    url = "https://api.alternative.me/fng/?limit=2"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        payload = resp.json()
        items = payload.get("data") or []
        if items:
            current = items[0]
            prev = items[1] if len(items) > 1 else current
            value = int(current.get("value", 50))
            prev_value = int(prev.get("value", value))
            raw_class = str(current.get("value_classification", "Neutral"))
            pt_map = {
                "Extreme Fear": "Medo Extremo",
                "Fear": "Medo",
                "Neutral": "Neutro",
                "Greed": "Ganância",
                "Extreme Greed": "Ganância Extrema",
            }
            return {
                "value": value,
                "delta": value - prev_value,
                "classification": pt_map.get(raw_class, raw_class),
            }
    except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
        print(json.dumps({"ok": False, "source": "fear_and_greed", "error": str(exc)}), file=sys.stderr)
    return {"value": 50, "delta": 0, "classification": "Neutro (indisponível)"}


def fetch_global_macro_pulse() -> Dict[str, Any]:
    """Consulta dominância do BTC e variação do Market Cap global na CoinGecko."""
    url = "https://api.coingecko.com/api/v3/global"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        data = (resp.json() or {}).get("data") or {}
        mcap_change = float(data.get("market_cap_change_percentage_24h_usd") or 0.0)
        btc_dom = float((data.get("market_cap_percentage") or {}).get("btc") or 0.0)
        return {"market_cap_change_24h": mcap_change, "btc_dominance": btc_dom}
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return {"market_cap_change_24h": 0.0, "btc_dominance": 0.0}


def fetch_crypto_news(limit: int = 5) -> List[Dict[str, str]]:
    """
    Busca as principais notícias recentes do mercado cripto via CryptoCompare News API
    (sem necessidade de chave), priorizando manchetes com impacto macro ou nos ativos.
    """
    url = "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular"
    news_items: List[Dict[str, str]] = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        payload = resp.json()
        raw_list = payload.get("Data") if isinstance(payload, dict) else []
        if not isinstance(raw_list, list):
            return []

        impact_keywords = (
            "fed", "cpi", "inflation", "etf", "sec", "bitcoin", "btc",
            "ethereum", "solana", "rate", "crash", "rally", "macro", "whale",
        )
        scored: List[Tuple[int, Dict[str, Any]]] = []
        for idx, item in enumerate(raw_list[:25]):
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            title_low = title.lower()
            score = sum(2 for kw in impact_keywords if kw in title_low)
            scored.append((score * 100 - idx, item))

        scored.sort(key=lambda x: x[0], reverse=True)
        for _, item in scored[:limit]:
            news_items.append(
                {
                    "title": str(item.get("title") or "").strip(),
                    "source": str(item.get("source_info", {}).get("name") or item.get("source") or "CryptoNews"),
                    "url": str(item.get("url") or "").strip(),
                    "categories": str(item.get("categories") or "").strip(),
                }
            )
    except (requests.RequestException, ValueError, TypeError) as exc:
        print(json.dumps({"ok": False, "source": "cryptocompare_news", "error": str(exc)}), file=sys.stderr)
    return news_items


def generate_gemini_executive_summary(
    prices: Dict[str, Tuple[float, float, str]],
    usd_brl: float,
    fng: Dict[str, Any],
    macro: Dict[str, Any],
    news_items: List[Dict[str, str]],
) -> Optional[str]:
    """
    Usa a API do Gemini para gerar um resumo executivo diário em português,
    unindo cotações, Índice Fear & Greed, macroeconomia e notícias.
    """
    if not USE_GEMINI_DAILY_SUMMARY or not GEMINI_API_KEY:
        return None

    quotes_summary = []
    for asset in WATCHED_ASSETS[:10]:
        cid = asset["coin_id"]
        if cid in prices:
            p_usd, chg_24h, _ = prices[cid]
            quotes_summary.append(f"{asset['symbol']}: {format_currency(p_usd, usd_brl)} ({chg_24h:+.2f}% 24h)")

    headlines = [f"- {n['title']} ({n['source']})" for n in news_items[:5]]
    prompt = (
        "Você é o analista chefe do RD Crypto (foco em proteção de patrimônio e HODL).\\n"
        "Escreva um Resumo Executivo Diário curto (máximo 4 tópicos objetivos em português) "
        "com base nos dados reais abaixo. Não use hashtags e nunca recomende vender no prejuízo.\\n\\n"
        f"Fear & Greed Index: {fng['value']}/100 ({fng['classification']}, delta {fng['delta']:+d})\\n"
        f"Market Cap Global 24h: {macro['market_cap_change_24h']:+.2f}% | Dominância BTC: {macro['btc_dominance']:.1f}%\\n"
        f"Cotações da Carteira: {', '.join(quotes_summary)}\\n"
        f"Principais Notícias:\\n{chr(10).join(headlines)}\\n\\n"
        "Entregue apenas os 4 tópicos iniciando cada linha com '• '."
    )

    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    )
    try:
        resp = requests.post(
            endpoint,
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.35, "maxOutputTokens": 450},
            },
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        candidates = data.get("candidates") or []
        if candidates:
            parts = candidates[0].get("content", {}).get("parts") or []
            text = "".join(str(p.get("text") or "") for p in parts).strip()
            if text:
                return text
    except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
        print(json.dumps({"ok": False, "source": "gemini_summary", "error": str(exc)}), file=sys.stderr)
    return None


def format_currency(price_usd: float, usd_brl: float) -> str:
    val = price_usd * usd_brl if DISPLAY_CURRENCY == "BRL" else price_usd
    prefix = "R$" if DISPLAY_CURRENCY == "BRL" else "US$"
    if val >= 1000:
        return f"{prefix} {val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    if val >= 1:
        return f"{prefix} {val:.2f}".replace(".", ",")
    return f"{prefix} {val:.6f}".replace(".", ",")


def send_telegram_message(markdown_message: str) -> bool:
    """Envia mensagem organizada em Markdown usando o endpoint oficial sendMessage do Telegram."""
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
        "text": markdown_message[:4090],
        "parse_mode": "Markdown",
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
        return True, "Preço atingiu ou ficou abaixo do alvo"
    elif cond == "acima_preco" and price_usd >= target:
        return True, "Preço atingiu ou superou o alvo"

    return False, ""


def should_send_daily_summary(now_brt: datetime, state: Dict[str, Any]) -> bool:
    if not ENABLE_DAILY_NEWS_SUMMARY:
        return False
    if FORCE_DAILY_SUMMARY:
        return True
    today_key = now_brt.strftime("%Y-%m-%d")
    if state.get("last_daily_summary_date") == today_key:
        return False
    # Dispara uma única vez na primeira janela do horário configurado (horário de Brasília)
    window_minutes = max(CHECK_INTERVAL_MINUTES, 5)
    return now_brt.hour == DAILY_SUMMARY_HOUR_BRT and now_brt.minute < window_minutes


def build_daily_summary_messages(
    prices: Dict[str, Tuple[float, float, str]],
    usd_brl: float,
    now_brt: datetime,
) -> Tuple[str, str]:
    """Monta a mensagem 'Resumo Diário da Manhã' em Markdown (Telegram) e texto (WhatsApp)."""
    fng = fetch_fear_and_greed()
    macro = fetch_global_macro_pulse()
    news_items = fetch_crypto_news(limit=5)
    ai_exec = generate_gemini_executive_summary(prices, usd_brl, fng, macro, news_items)

    date_label = now_brt.strftime("%d/%m/%Y %H:%M BRT")
    fng_emoji = "🟢" if fng["value"] >= 60 else ("🔴" if fng["value"] <= 35 else "🟡")

    # Tópicos de cotações da carteira
    asset_bullets_md: List[str] = []
    asset_bullets_plain: List[str] = []
    for asset in WATCHED_ASSETS[:10]:
        cid = asset["coin_id"]
        if cid not in prices:
            continue
        p_usd, chg_24h, _ = prices[cid]
        sym = asset["symbol"]
        price_str = format_currency(p_usd, usd_brl)
        qty = float(asset.get("quantity") or 0)
        avg_cost = float(asset.get("avg_cost_usd") or 0)
        pnl_part = ""
        if qty > 0 and avg_cost > 0:
            pnl_pct = ((p_usd - avg_cost) / avg_cost) * 100.0
            pnl_part = f" | P&L: {pnl_pct:+.1f}%"
        icon = "📈" if chg_24h >= 0 else "📉"
        asset_bullets_md.append(
            f"• {icon} *{escape_md(sym)}*: {escape_md(price_str)} (\`{chg_24h:+.2f}%\` 24h{escape_md(pnl_part)})"
        )
        asset_bullets_plain.append(f"• {sym}: {price_str} ({chg_24h:+.2f}% 24h{pnl_part})")

    # Tópicos de notícias de impacto
    news_bullets_md: List[str] = []
    news_bullets_plain: List[str] = []
    if news_items:
        for item in news_items:
            safe_title = escape_md(item["title"])
            safe_src = escape_md(item["source"])
            if item.get("url"):
                safe_url = item["url"].replace(")", "%29")
                news_bullets_md.append(f"• [{safe_title}]({safe_url}) — _{safe_src}_")
            else:
                news_bullets_md.append(f"• {safe_title} — _{safe_src}_")
            news_bullets_plain.append(f"• {item['title']} ({item['source']})")
    else:
        news_bullets_md.append("• Sem manchetes críticas retornadas no momento.")
        news_bullets_plain.append("• Sem manchetes críticas retornadas no momento.")

    # Resumo executivo (Gemini ou fallback quantitativo)
    if ai_exec:
        exec_md = "\\n".join(escape_md(line) for line in ai_exec.splitlines() if line.strip())
        exec_plain = ai_exec
        exec_source_label = "Análise Executiva IA (Gemini)"
    else:
        mcap_chg = macro["market_cap_change_24h"]
        mood_hint = (
            "Sentimento de medo favorece acumulação gradual (Preço Médio) e proteção HODL."
            if fng["value"] <= 40
            else (
                "Sentimento de ganância pede cautela com compras em topo e atenção a realizações parciais acima de RSI 70."
                if fng["value"] >= 70
                else "Mercado em equilíbrio/consolidação — manter disciplina na carteira e aguardar gatilhos."
            )
        )
        exec_md = (
            f"• *Pulso Macro 24h*: Market Cap global em \`{mcap_chg:+.2f}%\` | Dominância BTC em \`{macro['btc_dominance']:.1f}%\`\\n"
            f"• *Leitura HODL*: {escape_md(mood_hint)}"
        )
        exec_plain = (
            f"• Pulso Macro 24h: Market Cap {mcap_chg:+.2f}% | Dominância BTC {macro['btc_dominance']:.1f}%\\n"
            f"• Leitura HODL: {mood_hint}"
        )
        exec_source_label = "Resumo Quantitativo de Mercado"

    md_sections = [
        f"☀️ *RD Crypto — Resumo Diário da Manhã*",
        f"_{escape_md(date_label)}_",
        "",
        f"*1. Sentimento & Macro Global*",
        f"• {fng_emoji} *Fear & Greed Index*: *{fng['value']}/100* — {escape_md(fng['classification'])} ({fng['delta']:+d} vs ontem)",
        f"• 🌐 *Market Cap 24h*: \`{macro['market_cap_change_24h']:+.2f}%\` | *BTC Dom.*: \`{macro['btc_dominance']:.1f}%\`",
        "",
        f"*2. {escape_md(exec_source_label)}*",
        exec_md,
        "",
        "*3. Radar da Sua Carteira*",
        "\\n".join(asset_bullets_md) if asset_bullets_md else "• Nenhum ativo monitorado.",
        "",
        "*4. Principais Notícias de Impacto*",
        "\\n".join(news_bullets_md),
    ]

    plain_sections = [
        f"*RD Crypto — Resumo Diário da Manhã ({date_label})*",
        f"Fear & Greed: {fng['value']}/100 ({fng['classification']})",
        "",
        exec_plain,
        "",
        "*Cotações:*",
        "\\n".join(asset_bullets_plain),
        "",
        "*Principais Notícias:*",
        "\\n".join(news_bullets_plain),
    ]

    return "\\n".join(md_sections), "\\n".join(plain_sections)


def dispatch_message(md_text: str, plain_text: str) -> bool:
    if ALERT_CHANNEL == "telegram":
        return send_telegram_message(md_text)
    return send_whatsapp_message(plain_text)


def main() -> int:
    now_brt = datetime.now(BRT_TZ)
    now_utc = datetime.now(timezone.utc).strftime("%d/%m %H:%M UTC")
    state = load_bot_state()
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

    alert_lines_md: List[str] = []
    alert_lines_plain: List[str] = []

    # -----------------------------------------------------------------------
    # VERTENTE 1: Alertas de gatilho em tempo real e carteira
    # -----------------------------------------------------------------------
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

            alert_lines_md.append(
                f"• *{escape_md(sym)}* \\[{escape_md(hint)}\\] — "
                f"*{escape_md(formatted_price)}* (\`{chg_24h:+.2f}%\` 24h)\\n"
                f"  ↳ {escape_md(reason)} via _{escape_md(source)}_"
                + (f"\\n  ↳ _{escape_md(note)}_" if note else "")
            )
            alert_lines_plain.append(
                f"• {sym} [{hint}] — {formatted_price} ({chg_24h:+.2f}% 24h) | {reason}{note_suffix}"
            )

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
                alert_lines_md.append(
                    f"• *{escape_md(sym)}* ({direction} \`{chg_24h:+.2f}%\` 24h) — "
                    f"*{escape_md(formatted_price)}*"
                    f"{escape_md(pnl_text)} (_{escape_md(source)}_)"
                )
                alert_lines_plain.append(
                    f"• {sym} ({direction} {chg_24h:+.2f}% 24h) — {formatted_price}{pnl_text}"
                )

    send_daily = should_send_daily_summary(now_brt, state)
    print(
        json.dumps(
            {
                "ok": True,
                "checked_assets": len(prices),
                "active_triggers": len(ACTIVE_TRIGGERS),
                "alerts_triggered": len(alert_lines_md),
                "daily_summary_scheduled": send_daily,
                "channel": ALERT_CHANNEL,
                "timestamp_utc": now_utc,
                "timestamp_brt": now_brt.strftime("%d/%m %H:%M BRT"),
            },
            ensure_ascii=False,
        )
    )

    overall_ok = True

    if alert_lines_md:
        msg_md = (
            "🚨 *RD Crypto — Alerta em Tempo Real*\\n"
            f"_{escape_md(now_utc)}_\\n\\n"
            + "\\n\\n".join(alert_lines_md)
        )
        msg_plain = (
            f"*RD Crypto — Alerta 24h ({now_utc})*\\n\\n"
            + "\\n\\n".join(alert_lines_plain)
        )
        if not dispatch_message(msg_md, msg_plain):
            overall_ok = False

    # -----------------------------------------------------------------------
    # VERTENTE 2: Resumo Diário da Manhã & Principais Notícias de Impacto
    # -----------------------------------------------------------------------
    if send_daily:
        daily_md, daily_plain = build_daily_summary_messages(prices, usd_brl, now_brt)
        if dispatch_message(daily_md, daily_plain):
            state["last_daily_summary_date"] = now_brt.strftime("%Y-%m-%d")
            save_bot_state(state)
        else:
            overall_ok = False

    return 0 if overall_ok else 1


if __name__ == "__main__":
    sys.exit(main())
`;
}

export function generateGitHubWorkflowYaml(
  channel: AlertChannelChoice,
  prefs: PythonGeneratorPrefs
): string {
  const cronExpr = `*/${prefs.intervalMinutes} * * * *`;
  const channelEnv =
    channel === 'telegram'
      ? `          TELEGRAM_BOT_TOKEN: \${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: \${{ secrets.TELEGRAM_CHAT_ID }}`
      : `          WHATSAPP_PHONE: \${{ secrets.WHATSAPP_PHONE }}
          CALLMEBOT_API_KEY: \${{ secrets.CALLMEBOT_API_KEY }}
          WHATSAPP_WEBHOOK_URL: \${{ secrets.WHATSAPP_WEBHOOK_URL }}`;

  const extraEnv = prefs.useGeminiSummary
    ? `\n          GEMINI_API_KEY: \${{ secrets.GEMINI_API_KEY }}`
    : '';

  return `name: RD Crypto - Monitor 24h & Resumo Diário

on:
  schedule:
    - cron: '${cronExpr}'
  workflow_dispatch:
    inputs:
      force_daily_summary:
        description: 'Enviar Resumo Diário da Manhã agora'
        required: false
        default: 'false'
        type: choice
        options:
          - 'false'
          - 'true'

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

      - name: Executar monitor, notícias e alertas 24h
        env:
${channelEnv}${extraEnv}
          FORCE_DAILY_SUMMARY: \${{ github.event.inputs.force_daily_summary || 'false' }}
        run: python monitor_cripto.py
`;
}
