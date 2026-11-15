import { useEffect, useMemo, useState } from 'react';

interface CryptoLogoProps {
  symbol: string;
  coinId?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

interface BrandStyle {
  bg: string;
  fg: string;
  border?: string;
  glyph?: string;
}

const BRAND_STYLES: Record<string, BrandStyle> = {
  BTC: { bg: '#F7931A', fg: '#FFFFFF', glyph: '₿' },
  ETH: { bg: '#627EEA', fg: '#FFFFFF', glyph: 'Ξ' },
  SOL: { bg: '#141B29', fg: '#14F195', border: '#9945FF' },
  BNB: { bg: '#F3BA2F', fg: '#111827' },
  XRP: { bg: '#111827', fg: '#FFFFFF', border: '#38BDF8' },
  DOGE: { bg: '#C2A633', fg: '#FFFFFF', glyph: 'Ð' },
  TRX: { bg: '#EF0027', fg: '#FFFFFF' },
  ADA: { bg: '#0033AD', fg: '#FFFFFF' },
  AVAX: { bg: '#E84142', fg: '#FFFFFF' },
  TON: { bg: '#0098EA', fg: '#FFFFFF' },
  DOT: { bg: '#E6007A', fg: '#FFFFFF' },
  LINK: { bg: '#2A5ADA', fg: '#FFFFFF' },
  MATIC: { bg: '#8247E5', fg: '#FFFFFF' },
  POL: { bg: '#8247E5', fg: '#FFFFFF' },
  LTC: { bg: '#345D9D', fg: '#FFFFFF', glyph: 'Ł' },
  BCH: { bg: '#0AC18E', fg: '#FFFFFF' },
  SHIB: { bg: '#FFA409', fg: '#111827' },
  PEPE: { bg: '#3E9D3B', fg: '#FFFFFF' },
  SUI: { bg: '#4DA2FF', fg: '#FFFFFF' },
  APT: { bg: '#0F172A', fg: '#2DD4BF', border: '#2DD4BF' },
  NEAR: { bg: '#0F172A', fg: '#FFFFFF', border: '#64748B' },
  ATOM: { bg: '#2E3148', fg: '#FFFFFF', border: '#6F7390' },
  UNI: { bg: '#FF007A', fg: '#FFFFFF' },
  CAKE: { bg: '#1FC7D4', fg: '#111827' },
  AAVE: { bg: '#2EBAC6', fg: '#FFFFFF' },
  XLM: { bg: '#0F172A', fg: '#FFFFFF', border: '#94A3B8' },
  USDT: { bg: '#26A17B', fg: '#FFFFFF', glyph: '₮' },
  USDC: { bg: '#2775CA', fg: '#FFFFFF', glyph: '$' },
  DAI: { bg: '#F5AC37', fg: '#111827', glyph: '◈' },
  ARB: { bg: '#28A0F0', fg: '#FFFFFF' },
  OP: { bg: '#FF0420', fg: '#FFFFFF' },
  KAS: { bg: '#49EACB', fg: '#0B0F17' },
  RENDER: { bg: '#0F172A', fg: '#FFFFFF', border: '#EF4444' },
  RNDR: { bg: '#0F172A', fg: '#FFFFFF', border: '#EF4444' },
  HBAR: { bg: '#111827', fg: '#FFFFFF', border: '#94A3B8', glyph: 'ℏ' },
  VET: { bg: '#15BDFF', fg: '#FFFFFF' },
  FIL: { bg: '#0090FF', fg: '#FFFFFF' },
  ICP: { bg: '#29ABE2', fg: '#FFFFFF' },
  ALGO: { bg: '#0F172A', fg: '#FFFFFF', border: '#64748B' },
  XMR: { bg: '#FF6600', fg: '#FFFFFF' },
  ETC: { bg: '#328332', fg: '#FFFFFF' },
  INJ: { bg: '#00F2FE', fg: '#0B0F17' },
  TIA: { bg: '#7B2BF9', fg: '#FFFFFF' },
  SEI: { bg: '#9E1F19', fg: '#FFFFFF' },
  TAO: { bg: '#0F172A', fg: '#FFFFFF', border: '#E2E8F0', glyph: 'τ' },
  JUP: { bg: '#141B29', fg: '#C7F284', border: '#22C55E' },
  ONDO: { bg: '#0F172A', fg: '#FFFFFF', border: '#38BDF8' },
  ENA: { bg: '#111827', fg: '#FFFFFF', border: '#94A3B8' },
  WIF: { bg: '#A16207', fg: '#FFFFFF' },
  BONK: { bg: '#F97316', fg: '#FFFFFF' },
  FLOKI: { bg: '#D97706', fg: '#FFFFFF' },
};

// Direct CoinPaprika slug overrides for newer tokens missing from legacy icon packs
const PAPRIKA_SLUGS: Record<string, string> = {
  SUI: 'sui-sui',
  CAKE: 'cake-pancakeswap',
  PEPE: 'pepe-pepe',
  APT: 'apt-aptos',
  ARB: 'arb-arbitrum',
  OP: 'op-optimism',
  KAS: 'kas-kaspa',
  INJ: 'inj-injective-protocol',
  TIA: 'tia-celestia',
  SEI: 'sei-sei',
  SHIB: 'shib-shiba-inu',
  NEAR: 'near-near-protocol',
  TON: 'ton-toncoin',
  HBAR: 'hbar-hedera-hashgraph',
  ICP: 'icp-internet-computer',
  BONK: 'bonk-bonk',
  WIF: 'wif-dogwifhat',
  FLOKI: 'floki-floki-inu',
  ONDO: 'ondo-ondo',
  ENA: 'ena-ethena',
  JUP: 'jup-jupiter',
  PYTH: 'pyth-pyth-network',
  WLD: 'wld-worldcoin',
  STX: 'stx-stacks',
  FET: 'fet-fetch-ai',
  IMX: 'imx-immutable-x',
  POL: 'pol-polygon-ecosystem-token',
};

const PALETTE = [
  { bg: '#0284C7', fg: '#FFFFFF' },
  { bg: '#059669', fg: '#FFFFFF' },
  { bg: '#7C3AED', fg: '#FFFFFF' },
  { bg: '#D97706', fg: '#FFFFFF' },
  { bg: '#DC2626', fg: '#FFFFFF' },
  { bg: '#0D9488', fg: '#FFFFFF' },
  { bg: '#4F46E5', fg: '#FFFFFF' },
];

function getDeterministicPalette(symbol: string): BrandStyle {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

function buildLogoCandidates(symbol: string, coinId?: string): string[] {
  const sym = symbol.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const upper = symbol.trim().toUpperCase();
  if (!sym) return [];

  const urls: string[] = [];

  if (PAPRIKA_SLUGS[upper]) {
    urls.push(`https://static.coinpaprika.com/coin/${PAPRIKA_SLUGS[upper]}/logo.png`);
  }

  // CoinCap covers most spot coins cleanly with @2x transparent PNGs
  urls.push(`https://assets.coincap.io/assets/icons/${sym === 'pol' ? 'matic' : sym}@2x.png`);

  // jsDelivr spothq/cryptocurrency-icons vector SVG covers 450+ classic coins
  urls.push(
    `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${
      sym === 'pol' ? 'matic' : sym
    }.svg`
  );

  // CoinPaprika fallback pattern using coinId when available
  if (coinId && /^[a-z0-9-]+$/.test(coinId)) {
    urls.push(`https://static.coinpaprika.com/coin/${sym}-${coinId}/logo.png`);
  }

  return Array.from(new Set(urls));
}

function renderCustomVectorEmblem(upper: string, style: BrandStyle) {
  switch (upper) {
    case 'BTC':
      return (
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <circle cx="16" cy="16" r="16" fill={style.bg} />
          <text
            x="16"
            y="21.5"
            textAnchor="middle"
            fill="#FFFFFF"
            fontSize="17"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            ₿
          </text>
        </svg>
      );
    case 'ETH':
      return (
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <circle cx="16" cy="16" r="16" fill="#627EEA" />
          <polygon points="16,5 9.5,16.2 16,20 22.5,16.2" fill="#FFFFFF" fillOpacity="0.95" />
          <polygon points="16,21.5 9.5,17.7 16,27 22.5,17.7" fill="#FFFFFF" fillOpacity="0.78" />
        </svg>
      );
    case 'SOL':
      return (
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <defs>
            <linearGradient id="solGrad" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#9945FF" />
              <stop offset="100%" stopColor="#14F195" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r="16" fill="#0F172A" />
          <path d="M9 10.5h12l2 2.5H11z" fill="url(#solGrad)" />
          <path d="M11 14.8h12l-2 2.4H9z" fill="url(#solGrad)" />
          <path d="M9 19h12l2 2.5H11z" fill="url(#solGrad)" />
        </svg>
      );
    case 'BNB':
      return (
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <circle cx="16" cy="16" r="16" fill="#F3BA2F" />
          <polygon points="16,7.5 19.5,11 16,14.5 12.5,11" fill="#FFFFFF" />
          <polygon points="10.5,13 13.5,16 10.5,19 7.5,16" fill="#FFFFFF" />
          <polygon points="21.5,13 24.5,16 21.5,19 18.5,16" fill="#FFFFFF" />
          <polygon points="16,17.5 19.5,21 16,24.5 12.5,21" fill="#FFFFFF" />
          <polygon points="16,13.5 18.5,16 16,18.5 13.5,16" fill="#FFFFFF" />
        </svg>
      );
    case 'XRP':
      return (
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <circle cx="16" cy="16" r="16" fill="#0F172A" />
          <path
            d="M8.5 9.5l5 5a3.5 3.5 0 005 0l5-5M8.5 22.5l5-5a3.5 3.5 0 015 0l5 5"
            fill="none"
            stroke="#38BDF8"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'TRX':
      return (
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <circle cx="16" cy="16" r="16" fill="#EF0027" />
          <polygon
            points="9,9 23.5,13.5 15,24.5"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <line x1="9" y1="9" x2="17" y2="16.5" stroke="#FFFFFF" strokeWidth="1.6" />
        </svg>
      );
    case 'TON':
      return (
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <circle cx="16" cy="16" r="16" fill="#0098EA" />
          <path
            d="M10.5 11.5h11c.8 0 1.3.9.9 1.6L16 24.5 9.6 13.1c-.4-.7.1-1.6.9-1.6z"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2.1"
            strokeLinejoin="round"
          />
          <line x1="16" y1="11.5" x2="16" y2="24" stroke="#FFFFFF" strokeWidth="1.8" />
        </svg>
      );
    case 'SUI':
      return (
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <circle cx="16" cy="16" r="16" fill="#4DA2FF" />
          <path
            d="M16 7.5c3.5 4.6 5.5 7.4 5.5 10.3a5.5 5.5 0 11-11 0c0-2.9 2-5.7 5.5-10.3z"
            fill="#FFFFFF"
          />
        </svg>
      );
    case 'AVAX':
      return (
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <circle cx="16" cy="16" r="16" fill="#E84142" />
          <polygon points="15.5,8.5 8.5,22 13,22 17.5,13.5" fill="#FFFFFF" />
          <polygon points="19.5,15.5 16,22 23.5,22" fill="#FFFFFF" />
        </svg>
      );
    default: {
      const label = style.glyph || upper.slice(0, upper.length <= 3 ? 3 : 2);
      const fontSize = label.length >= 3 ? '9.5' : label.length === 2 ? '11.5' : '15';
      return (
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <circle
            cx="16"
            cy="16"
            r="15.2"
            fill={style.bg}
            stroke={style.border ?? 'rgba(255,255,255,0.16)'}
            strokeWidth="1.5"
          />
          <text
            x="16"
            y="16.5"
            textAnchor="middle"
            dominantBaseline="central"
            fill={style.fg}
            fontSize={fontSize}
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            {label}
          </text>
        </svg>
      );
    }
  }
}

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'w-[18px] h-[18px]',
  sm: 'w-6 h-6',
  md: 'w-7 h-7',
  lg: 'w-9 h-9',
};

export function CryptoLogo({
  symbol,
  coinId,
  name,
  size = 'sm',
  className = '',
}: CryptoLogoProps) {
  const upper = symbol.trim().toUpperCase();
  const candidates = useMemo(() => buildLogoCandidates(upper, coinId), [upper, coinId]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    setCandidateIndex(0);
    setImgLoaded(false);
  }, [upper, coinId]);

  const brand = BRAND_STYLES[upper] ?? getDeterministicPalette(upper || 'CRYPTO');
  const activeUrl =
    candidateIndex < candidates.length ? candidates[candidateIndex] : null;

  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 select-none ring-1 ring-slate-900/10 dark:ring-white/10 ${SIZE_CLASSES[size]} ${className}`}
      title={name ? `${name} (${upper})` : upper}
    >
      {/* Crisp vector emblem shown immediately & whenever external CDN fails or is offline */}
      {(!activeUrl || !imgLoaded) && (
        <span className="w-full h-full flex items-center justify-center">
          {renderCustomVectorEmblem(upper, brand)}
        </span>
      )}

      {activeUrl && (
        <img
          src={activeUrl}
          alt={name ? `${name} (${upper})` : upper}
          loading="lazy"
          decoding="async"
          onLoad={() => setImgLoaded(true)}
          onError={() => {
            setImgLoaded(false);
            setCandidateIndex((prev) => prev + 1);
          }}
          className={`w-full h-full object-cover rounded-full ${
            imgLoaded ? 'opacity-100' : 'opacity-0 absolute inset-0'
          }`}
        />
      )}
    </span>
  );
}
