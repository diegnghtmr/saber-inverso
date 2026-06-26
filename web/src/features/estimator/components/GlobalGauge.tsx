import type { FunctionComponent } from 'preact';
import { clamp } from '../stats';

interface GlobalGaugeProps {
  /** Estimated global score on the 0–500 Saber 11 scale. */
  value: number;
  /** Population mean global score (subtler reference marker). */
  mean: number;
}

const W = 320;
const H = 56;
const PAD_X = 10;
const TRACK_Y = 30;
const TRACK_H = 10;
const MAX = 500;

/** Map a 0–500 score to an x coordinate inside the padded track. */
function scaleX(score: number): number {
  const t = clamp(score, 0, MAX) / MAX;
  return PAD_X + t * (W - PAD_X * 2);
}

/**
 * Horizontal 0–500 gauge: a rounded track, a prominent marker at the estimated
 * global score, and a subtler tick + label at the population mean. Decorative —
 * the numeric value lives in real text next to it for screen readers.
 */
const GlobalGauge: FunctionComponent<GlobalGaugeProps> = ({ value, mean }) => {
  const valueX = scaleX(value);
  const meanX = scaleX(mean);

  return (
    <svg
      class="global-gauge"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {/* Track */}
      <rect
        x={PAD_X}
        y={TRACK_Y}
        width={W - PAD_X * 2}
        height={TRACK_H}
        rx={TRACK_H / 2}
        fill="var(--surface-strong)"
      />
      {/* Filled portion up to the estimate */}
      <rect
        x={PAD_X}
        y={TRACK_Y}
        width={Math.max(0, valueX - PAD_X)}
        height={TRACK_H}
        rx={TRACK_H / 2}
        fill="var(--brand-teal)"
      />

      {/* Population mean — subtle dashed muted tick + value below */}
      <line
        x1={meanX}
        x2={meanX}
        y1={TRACK_Y - 4}
        y2={TRACK_Y + TRACK_H + 4}
        stroke="var(--muted)"
        stroke-width="1.5"
        stroke-dasharray="2 2"
      />
      <text
        x={clamp(meanX, 12, W - 12)}
        y={H - 3}
        text-anchor="middle"
        fill="var(--muted)"
        font-size="9"
        font-family="var(--font-sans)"
      >
        {Math.round(mean)}
      </text>

      {/* Estimate — solid ink dot (matches the "● Tú" legend glyph) + value */}
      <circle cx={valueX} cy={TRACK_Y + TRACK_H / 2} r="6" fill="var(--ink)" />
      <text
        x={clamp(valueX, 14, W - 14)}
        y={TRACK_Y - 8}
        text-anchor="middle"
        fill="var(--ink)"
        font-size="11"
        font-weight="600"
        font-family="var(--font-sans)"
      >
        {Math.round(value)}
      </text>

      {/* Scale endpoints */}
      <text x={PAD_X} y={H - 3} text-anchor="start" fill="var(--muted-soft)" font-size="9">
        0
      </text>
      <text x={W - PAD_X} y={H - 3} text-anchor="end" fill="var(--muted-soft)" font-size="9">
        500
      </text>
    </svg>
  );
};

export default GlobalGauge;
