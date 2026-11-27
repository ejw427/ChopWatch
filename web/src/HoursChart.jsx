export default function HoursChart({ days = [] }) {
  const max = Math.max(0.5, ...days.map((d) => d.hours || 0));
  const w = 640;
  const h = 160;
  const pad = 28;
  const barGap = 4;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const barW = days.length ? (innerW - barGap * (days.length - 1)) / days.length : 0;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="hours-chart" role="img" aria-label="Chopping hours chart">
      <line
        x1={pad}
        y1={pad + innerH}
        x2={pad + innerW}
        y2={pad + innerH}
        stroke="currentColor"
        strokeOpacity="0.25"
      />
      {days.map((d, i) => {
        const bh = ((d.hours || 0) / max) * innerH;
        const x = pad + i * (barW + barGap);
        const y = pad + innerH - bh;
        return (
          <g key={d.day}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(bh, d.hours > 0 ? 2 : 0)}
              rx="3"
              fill="var(--accent)"
              opacity={d.hours > 0 ? 0.9 : 0.15}
            >
              <title>{`${d.day}: ${d.hours}h`}</title>
            </rect>
            {i % 2 === 0 && (
              <text
                x={x + barW / 2}
                y={h - 8}
                textAnchor="middle"
                fontSize="9"
                fill="currentColor"
                opacity="0.55"
              >
                {d.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
