import type { FunctionComponent } from 'preact';
import { areaColor } from '../theme';

interface WeightsDonutProps {
  /** Program weighting per area (values sum to ~1). */
  pesos: Record<string, number>;
  /** Resolve an area key to its human label. */
  getAreaLabel: (key: string) => string;
}

const SIZE = 132;
const STROKE = 20;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const CENTER = SIZE / 2;

/**
 * Donut chart of program weights built from a single circle per slice using
 * stroke-dasharray offsets (no chart library). The SVG is decorative; a real
 * legend with the numeric percentages sits beside it for screen readers.
 */
const WeightsDonut: FunctionComponent<WeightsDonutProps> = ({ pesos, getAreaLabel }) => {
  const entries = Object.entries(pesos);
  const total = entries.reduce((sum, [, w]) => sum + w, 0) || 1;

  let offset = 0;
  const slices = entries.map(([key, w]) => {
    const fraction = w / total;
    const dash = fraction * CIRC;
    const slice = {
      key,
      color: areaColor(key),
      dash,
      gap: CIRC - dash,
      // Negative offset because SVG strokes start at 3 o'clock and run clockwise.
      dashOffset: -offset,
    };
    offset += dash;
    return slice;
  });

  return (
    <div class="weights-donut">
      <svg
        class="weights-donut-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        aria-hidden="true"
      >
        {/* Rotate so slices begin at 12 o'clock. */}
        <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          <circle
            cx={CENTER}
            cy={CENTER}
            r={R}
            fill="none"
            stroke="var(--surface-strong)"
            stroke-width={STROKE}
          />
          {slices.map((s) => (
            <circle
              key={s.key}
              cx={CENTER}
              cy={CENTER}
              r={R}
              fill="none"
              stroke={s.color}
              stroke-width={STROKE}
              stroke-dasharray={`${s.dash} ${s.gap}`}
              stroke-dashoffset={s.dashOffset}
            />
          ))}
        </g>
      </svg>

      <ul class="weights-legend">
        {entries.map(([key, w]) => (
          <li key={key} class="weights-legend-item">
            <span
              class="weights-legend-swatch"
              style={{ backgroundColor: areaColor(key) }}
              aria-hidden="true"
            />
            <span class="weights-legend-label">{getAreaLabel(key)}</span>
            <span class="weights-legend-value">{(w * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default WeightsDonut;
