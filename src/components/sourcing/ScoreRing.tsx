import { BRAND } from "../../theme/brandColors";

/**
 * Circular AI score gauge for RFQ supplier cards.
 * Teal = rank #1, accent navy = #2, warn amber = #3+, gray = unscored.
 */

type ScoreRingTone = "teal" | "accent" | "warn" | "empty";

const STROKE: Record<ScoreRingTone, string> = {
  teal: "#0E7C6E",
  accent: BRAND.primary,
  warn: "#A66418",
  empty: "#E3E6EB",
};

export function scoreRingTone(rank: number | null | undefined): ScoreRingTone {
  if (rank == null || rank < 1) return "empty";
  if (rank === 1) return "teal";
  if (rank === 2) return "accent";
  return "warn";
}

export default function ScoreRing({
  score,
  rank,
  size = 44,
}: {
  score: number | null | undefined;
  rank?: number | null;
  size?: number;
}) {
  const tone = scoreRingTone(rank);
  const pct =
    score == null || !Number.isFinite(score)
      ? 0
      : Math.max(0, Math.min(100, score));
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#E3E6EB"
        strokeWidth={stroke}
      />
      {pct > 0 ? (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={STROKE[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ) : null}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fill={tone === "empty" ? "#98A2B3" : "#101828"}
        style={{
          fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
          fontSize: size * 0.28,
          fontWeight: 600,
        }}
      >
        {score == null ? "—" : Math.round(pct)}
      </text>
    </svg>
  );
}
