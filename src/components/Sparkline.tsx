interface SparklineProps {
  data: number[];
  positive: boolean;
}

export function Sparkline({ data, positive }: SparklineProps) {
  if (!data || data.length < 2) {
    return <div className="w-20 h-7 bg-slate-900/40 rounded" />;
  }

  const w = 84;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || min * 0.01 || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - 3 - ((v - min) / span) * (h - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="overflow-visible shrink-0"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={positive ? '#10B981' : '#EF4444'}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
