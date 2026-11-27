export default function Sparkline({
  values = [],
  width = 220,
  height = 44,
  label = "GPU util",
}) {
  const pts = (values || []).filter((n) => Number.isFinite(n));
  if (pts.length < 2) {
    return (
      <div className="sparkline empty">
        <span className="sparkline-label">{label}</span>
        <span className="sparkline-empty">collecting samples…</span>
      </div>
    );
  }

  const min = 0;
  const max = 100;
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = pts.length === 1 ? 0 : innerW / (pts.length - 1);
  const coords = pts.map((v, i) => {
    const x = pad + i * step;
    const y = pad + innerH - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * innerH;
    return [x, y];
  });
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${pad},${pad + innerH} ${line} ${pad + innerW},${pad + innerH}`;
  const last = pts[pts.length - 1];

  return (
    <div className="sparkline" title={`${label}: last ${pts.length} samples`}>
      <div className="sparkline-head">
        <span className="sparkline-label">{label}</span>
        <span className="sparkline-now">{Math.round(last)}%</span>
      </div>
      <svg
        className="sparkline-svg"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(182, 242, 109, 0.45)" />
            <stop offset="100%" stopColor="rgba(182, 242, 109, 0)" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#sparkFill)" />
        <polyline
          points={line}
          fill="none"
          stroke="#b6f26d"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
