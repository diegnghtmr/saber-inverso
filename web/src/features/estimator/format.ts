/**
 * Small presentation helpers shared by the estimator UI. Kept here (Scope Rule)
 * because only the estimator feature formats Saber 11 ranges and percentiles.
 */
import { clamp } from './stats';

/** A score range [lo, hi] derived from a central value and a std, clamped to [0,100]. */
export interface ScoreRange {
  low: number;
  high: number;
  center: number;
}

/** Build a rounded, clamped [center-std, center+std] range for display. */
export function scoreRange(center: number, std: number): ScoreRange {
  return {
    low: Math.round(clamp(center - std, 0, 100)),
    high: Math.round(clamp(center + std, 0, 100)),
    center: Math.round(center),
  };
}

/** Spanish percentile sentence fragment, e.g. "Mejor que 96%". */
export function betterThan(percentil: number): string {
  return `Mejor que ${percentil}%`;
}

/** Format a correlation coefficient with two decimals using a comma (es-CO). */
export function formatCorrelation(r: number): string {
  return r.toFixed(2).replace('.', ',');
}
