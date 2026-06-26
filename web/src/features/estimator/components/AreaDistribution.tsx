import type { FunctionComponent } from 'preact';
import { gaussianPdf, normalPpf, clamp } from '../stats';

interface AreaDistributionProps {
  /** Most-probable estimated score for this area (0–100). */
  estimate: number;
  /** Conditional uncertainty (std) of the inverse estimate. */
  estimateStd: number;
  /** Population mean for this area. */
  populationMean: number;
  /** Population std for this area. */
  populationStd: number;
  /** Area accent color (hex) — reserved for the "tú" marker + dots. */
  color: string;
}

/*
 * ONE shared 0–100 score axis, drawn once. Everything maps through xPix(), so
 * the wide faint population band (above the axis) and the narrow 20-dot
 * conditional cluster (below it) line up score-for-score and a vertical line
 * from any dot lands under the matching point of the population shape.
 *
 * Design is research-grounded (Cleveland/McGill aligned-position, Tufte shared
 * scale, Kay/Hullman quantile dotplots, Padilla's deterministic-construal
 * error, Gigerenzer natural frequencies):
 *  - width contrast carries the two-uncertainties message (population spread =
 *    wide gray context; estimate precision = narrow accent dots);
 *  - the conditional uncertainty is dots, never a bare ±1σ error bar;
 *  - color is reserved for the single "tú" hero marker;
 *  - the SVG is aria-hidden — the card's real text carries the data.
 */
const W = 324;
const H = 152;
const AX_L = 24;
const AX_R = W - 24;
const AXIS_Y = 90; // baseline near the vertical middle
const BAND_TOP = 30; // highest the population curve may reach
const BAND_H = AXIS_Y - BAND_TOP;
const DOTS_TOP = AXIS_Y + 11;
const DOTS_BOTTOM = H - 20;
const DOT_R = 3.1;
const SAMPLES = 64;
const DOTS = 20;
const TICKS = [0, 50, 100];

/** Map a 0–100 score to an x pixel on the shared axis. */
function xPix(score: number): number {
  return AX_L + (clamp(score, 0, 100) / 100) * (AX_R - AX_L);
}

/** Pick ink or white text for a filled pill, by perceived luminance of the fill. */
function readableInk(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? 'var(--ink)' : '#ffffff';
}

const AreaDistribution: FunctionComponent<AreaDistributionProps> = ({
  estimate,
  estimateStd,
  populationMean,
  populationStd,
  color,
}) => {
  const popStd = populationStd > 0 ? populationStd : 1;
  const condStd = estimateStd > 0 ? estimateStd : 1;

  // --- Population band (context): N(mean, std) filled to the baseline. ---
  const peak = gaussianPdf(populationMean, populationMean, popStd) || 1;
  const curve: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const score = (i / SAMPLES) * 100;
    const d = gaussianPdf(score, populationMean, popStd) / peak;
    curve.push(`${xPix(score).toFixed(1)},${(AXIS_Y - d * BAND_H).toFixed(1)}`);
  }
  const bandPath = `M ${xPix(0).toFixed(1)},${AXIS_Y} L ${curve.join(' L ')} L ${xPix(100).toFixed(1)},${AXIS_Y} Z`;

  // ±1σ population region — a slightly stronger fill for "most students".
  const sigLow = clamp(populationMean - popStd, 0, 100);
  const sigHigh = clamp(populationMean + popStd, 0, 100);
  const sig: string[] = [`${xPix(sigLow).toFixed(1)},${AXIS_Y}`];
  for (let i = 0; i <= SAMPLES; i++) {
    const score = sigLow + (i / SAMPLES) * (sigHigh - sigLow);
    const d = gaussianPdf(score, populationMean, popStd) / peak;
    sig.push(`${xPix(score).toFixed(1)},${(AXIS_Y - d * BAND_H).toFixed(1)}`);
  }
  sig.push(`${xPix(sigHigh).toFixed(1)},${AXIS_Y}`);
  const sigPath = `M ${sig.join(' L ')} Z`;
  const meanX = xPix(populationMean);

  // --- Conditional cluster (precision): 20 quantile dots, Wilkinson-stacked. ---
  const dotXs = Array.from({ length: DOTS }, (_, i) => {
    const p = (i + 0.5) / DOTS;
    return clamp(estimate + condStd * normalPpf(p), 0, 100);
  })
    .map(xPix)
    .sort((a, b) => a - b);

  const minGap = 2 * DOT_R + 0.5;
  const rowLastX: number[] = [];
  const placed = dotXs.map((x) => {
    let row = 0;
    while (row < rowLastX.length && x - rowLastX[row] < minGap) row++;
    rowLastX[row] = x;
    return { x, row };
  });
  const rows = rowLastX.length || 1;
  const rowH = Math.min(2 * DOT_R + 1, (DOTS_BOTTOM - DOTS_TOP) / rows);
  const estX = xPix(estimate);
  const maxDist = Math.max(...placed.map((d) => Math.abs(d.x - estX)), 1);

  // --- "Tú" hero marker: pill + accent stem piercing the band into the cluster. ---
  const estRounded = Math.round(estimate);
  const pillText = `Tú ${estRounded}`;
  const pillW = pillText.length * 6.1 + 14;
  const pillH = 17;
  const pillCx = clamp(estX, AX_L + pillW / 2, AX_R - pillW / 2);
  const pillTop = 5;
  const pillInk = readableInk(color);

  return (
    <svg
      class="area-distribution"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {/* Population band — faint gray context shape. */}
      <path d={bandPath} fill="var(--surface-strong)" opacity="0.7" />
      <path d={sigPath} fill="var(--muted-soft)" opacity="0.28" />
      <polyline
        points={curve.join(' ')}
        fill="none"
        stroke="var(--muted-soft)"
        stroke-width="1.25"
      />

      {/* Population mean reference. */}
      <line
        x1={meanX}
        x2={meanX}
        y1={AXIS_Y}
        y2={BAND_TOP + 2}
        stroke="var(--muted)"
        stroke-width="1"
        stroke-dasharray="2 3"
      />
      <text
        x={clamp(meanX, AX_L + 2, AX_R - 2)}
        y={BAND_TOP - 1}
        text-anchor="middle"
        fill="var(--muted)"
        font-size="8.5"
        font-family="var(--font-sans)"
      >
        promedio {Math.round(populationMean)}
      </text>

      {/* Shared 0–100 axis with minimal ticks. */}
      <line x1={AX_L} x2={AX_R} y1={AXIS_Y} y2={AXIS_Y} stroke="var(--muted)" stroke-width="1" />
      {TICKS.map((t) => (
        <g key={t}>
          <line
            x1={xPix(t)}
            x2={xPix(t)}
            y1={AXIS_Y}
            y2={AXIS_Y + 3}
            stroke="var(--muted-soft)"
            stroke-width="1"
          />
          <text
            x={xPix(t)}
            y={H - 5}
            text-anchor={t === 0 ? 'start' : t === 100 ? 'end' : 'middle'}
            fill="var(--muted-soft)"
            font-size="8.5"
            font-family="var(--font-sans)"
          >
            {t}
          </text>
        </g>
      ))}

      {/* Conditional 20-dot cluster — narrow, accent-colored, opacity = feel only. */}
      {placed.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={DOTS_TOP + DOT_R + d.row * rowH}
          r={DOT_R}
          fill={color}
          opacity={(0.5 + (1 - Math.abs(d.x - estX) / maxDist) * 0.5).toFixed(2)}
        />
      ))}

      {/* "Tú" hero marker. */}
      <line
        x1={estX}
        x2={estX}
        y1={pillTop + pillH}
        y2={DOTS_TOP + rowH}
        stroke={color}
        stroke-width="2"
      />
      <circle cx={estX} cy={AXIS_Y} r="2.6" fill={color} />
      {Math.abs(pillCx - estX) > 1 && (
        <line
          x1={pillCx}
          x2={estX}
          y1={pillTop + pillH}
          y2={pillTop + pillH + 4}
          stroke={color}
          stroke-width="2"
        />
      )}
      <rect
        x={pillCx - pillW / 2}
        y={pillTop}
        width={pillW}
        height={pillH}
        rx={pillH / 2}
        fill={color}
      />
      <text
        x={pillCx}
        y={pillTop + pillH / 2 + 3.5}
        text-anchor="middle"
        fill={pillInk}
        font-size="10.5"
        font-weight="600"
        font-family="var(--font-sans)"
      >
        {pillText}
      </text>
    </svg>
  );
};

export default AreaDistribution;
