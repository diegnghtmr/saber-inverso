import type { FunctionComponent } from 'preact';
import { clamp } from '../stats';
import { scoreRange, betterThan } from '../format';

interface ScoreBarProps {
  areaLabel: string;
  /** Estimated central score. */
  value: number;
  accentColor: string;
  /** Conditional uncertainty (std). When present, render the range + band. */
  uncertainty?: number;
  /** Population mean for the thin reference tick. */
  populationMean?: number;
  /** Percentile of the estimate within the population (0–100). */
  percentil?: number;
  /** Population label for the percentile pill (e.g. "Quindío"). */
  poblacionLabel?: string;
}

// The uncertainty band is visually clamped so it never overflows the track,
// while the text always shows the true ± / range.
const MAX_VISUAL_STD = 12;

/**
 * Single area row. Primary value is the probable RANGE [low–high]; the central
 * value is secondary. The track shows a gradient uncertainty band (area color
 * fading from center out to ±1σ) and a thin population-mean tick.
 */
const ScoreBar: FunctionComponent<ScoreBarProps> = ({
  areaLabel,
  value,
  accentColor,
  uncertainty,
  populationMean,
  percentil,
  poblacionLabel,
}) => {
  const pct = clamp(value, 0, 100);
  const hasBand = uncertainty !== undefined;
  const range = hasBand ? scoreRange(value, uncertainty as number) : null;

  // Visual band half-width in percentage points, clamped so it stays on-track.
  const visualStd = hasBand ? Math.min(MAX_VISUAL_STD, uncertainty as number) : 0;
  const bandLeft = clamp(pct - visualStd, 0, 100);
  const bandRight = clamp(pct + visualStd, 0, 100);
  const bandWidth = bandRight - bandLeft;

  const meanPct = populationMean !== undefined ? clamp(populationMean, 0, 100) : null;

  const ariaLabel = range
    ? `${areaLabel}: rango probable ${range.low} a ${range.high}, valor central ${range.center}`
    : `${areaLabel}: ${Math.round(value)}`;

  return (
    <div class="score-bar-row">
      <div class="score-bar-header">
        <span class="score-bar-label">{areaLabel}</span>
        <span class="score-bar-values">
          {range ? (
            <>
              <span class="score-bar-range">
                {range.low}–{range.high}
              </span>
              <span class="score-bar-center"> · centro {range.center}</span>
            </>
          ) : (
            <span class="score-bar-range">{Math.round(value)}</span>
          )}
        </span>
      </div>

      {percentil !== undefined && (
        <span class="score-bar-percentile">
          {betterThan(percentil)}
          {poblacionLabel ? ` (${poblacionLabel})` : ''}
        </span>
      )}

      <div
        class="score-bar-track"
        style={{ '--bar-accent': accentColor } as Record<string, string>}
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
      >
        {hasBand && (
          <div
            class="score-bar-band"
            style={{
              left: `${bandLeft}%`,
              width: `${bandWidth}%`,
              // Gradient: accent ~45% opacity at the center, fading to transparent at the edges.
              background: `linear-gradient(to right, transparent, ${accentColor}73 50%, transparent)`,
            }}
          />
        )}
        {/* Central value marker */}
        <div class="score-bar-marker" style={{ left: `${pct}%` }} />
        {/* Population-mean tick */}
        {meanPct !== null && (
          <div class="score-bar-mean-tick" style={{ left: `${meanPct}%` }} aria-hidden="true" />
        )}
      </div>
    </div>
  );
};

export default ScoreBar;
