import { useId } from "react";

const DEFAULT_SIZE = 148;
const STROKE_RATIO = 12 / 148;
const R_RATIO = 52 / 148;
const CY_OFFSET_RATIO = 6 / 148;
const START = -210; // degrees
const SWEEP = 240;

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
}

function clampPct(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

const THEMES = {
  lime: {
    from: "#7aa84a",
    to: "#d4ff8a",
    glow: "rgba(182, 242, 109, 0.45)",
    ink: "#b6f26d",
  },
  cyan: {
    from: "#2a8fad",
    to: "#9eecff",
    glow: "rgba(126, 200, 227, 0.45)",
    ink: "#7ec8e3",
  },
  amber: {
    from: "#c4891f",
    to: "#ffe08a",
    glow: "rgba(240, 195, 90, 0.42)",
    ink: "#f0c35a",
  },
  coral: {
    from: "#c45a4a",
    to: "#ffb0a0",
    glow: "rgba(224, 122, 106, 0.42)",
    ink: "#e07a6a",
  },
  violet: {
    from: "#6b5bd4",
    to: "#c8b8ff",
    glow: "rgba(160, 140, 255, 0.4)",
    ink: "#b5a6ff",
  },
  mint: {
    from: "#2f9e7a",
    to: "#8ff0c8",
    glow: "rgba(100, 220, 170, 0.4)",
    ink: "#7de0b8",
  },
};

export default function GaugeDial({
  label,
  value,
  suffix = "%",
  hint,
  theme = "lime",
  max = 100,
  title,
  size = DEFAULT_SIZE,
  onOpen,
}) {
  const reactId = useId().replace(/:/g, "");
  const sizeN = Number.isFinite(size) && size > 0 ? size : DEFAULT_SIZE;
  const cx = sizeN / 2;
  const cy = sizeN / 2 + sizeN * CY_OFFSET_RATIO;
  const r = sizeN * R_RATIO;
  const stroke = Math.max(8, sizeN * STROKE_RATIO);
  const hub = Math.max(4.5, sizeN * (5.5 / 148));

  const pct = clampPct(value == null ? null : (value / max) * 100);
  const colors = THEMES[theme] || THEMES.lime;
  const endDeg = START + (SWEEP * (pct ?? 0)) / 100;
  const tip = polar(cx, cy, r - 2, endDeg);
  const display =
    pct == null ? "—" : `${Math.round((pct / 100) * max * 10) / 10}${suffix}`;
  const uid = `g-${reactId}-${String(label).replace(/\W+/g, "").toLowerCase()}`;
  const interactive = typeof onOpen === "function";
  const Tag = interactive ? "button" : "div";

  return (
    <Tag
      type={interactive ? "button" : undefined}
      className={`gauge gauge-${theme}${interactive ? " gauge-interactive" : ""}`}
      style={{ "--gauge-glow": colors.glow, "--gauge-ink": colors.ink }}
      title={title || hint || undefined}
      onClick={interactive ? onOpen : undefined}
      aria-label={interactive ? `${label}: ${display}. Open details.` : undefined}
    >
      <svg
        className="gauge-svg"
        viewBox={`0 0 ${sizeN} ${sizeN}`}
        width={sizeN}
        height={sizeN}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${uid}-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colors.from} />
            <stop offset="100%" stopColor={colors.to} />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={sizeN > 180 ? 5 : 3.5} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* track */}
        <path
          d={arcPath(cx, cy, r, START, START + SWEEP)}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* ticks */}
        {Array.from({ length: 9 }, (_, i) => {
          const deg = START + (SWEEP * i) / 8;
          const a = polar(cx, cy, r + sizeN * (10 / 148), deg);
          const b = polar(cx, cy, r + sizeN * ((i % 2 === 0 ? 16 : 13) / 148), deg);
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="rgba(232,240,223,0.22)"
              strokeWidth={i % 2 === 0 ? 2 : 1.2}
              strokeLinecap="round"
            />
          );
        })}
        {/* value arc */}
        {pct != null && pct > 0.4 && (
          <path
            className="gauge-arc"
            d={arcPath(cx, cy, r, START, endDeg)}
            fill="none"
            stroke={`url(#${uid}-grad)`}
            strokeWidth={stroke}
            strokeLinecap="round"
            filter={`url(#${uid}-glow)`}
          />
        )}
        {/* needle hub + tip */}
        <circle
          cx={cx}
          cy={cy}
          r={hub}
          fill="#0e130c"
          stroke={colors.to}
          strokeWidth="1.5"
        />
        {pct != null && (
          <line
            className="gauge-needle"
            x1={cx}
            y1={cy}
            x2={tip.x}
            y2={tip.y}
            stroke={colors.to}
            strokeWidth={Math.max(2, sizeN * (2.4 / 148))}
            strokeLinecap="round"
            filter={`url(#${uid}-glow)`}
          />
        )}
      </svg>
      <div className="gauge-readout">
        <div className="gauge-value">{display}</div>
        <div className="gauge-label">{label}</div>
        {hint ? <div className="gauge-hint">{hint}</div> : null}
      </div>
    </Tag>
  );
}
