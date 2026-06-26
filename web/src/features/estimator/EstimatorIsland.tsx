import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import type { FunctionComponent } from 'preact';
import {
  fetchAreas,
  fetchPopulations,
  fetchPrograms,
  postEstimate,
  type Area,
  type Population,
  type Program,
  type EstimateResult,
} from './api';
import ScoreBar from './components/ScoreBar';
import WarningNotice from './components/WarningNotice';
import Combobox, { type ComboboxOption } from './components/Combobox';
import GlobalGauge from './components/GlobalGauge';
import WeightsDonut from './components/WeightsDonut';
import AreaDistribution from './components/AreaDistribution';
import { areaColor } from './theme';
import { clamp, normalCdf } from './stats';
import { betterThan, formatCorrelation, scoreRange } from './format';

const LS_PROGRAMA = 'saberinverso:programa';
const LS_POBLACION = 'saberinverso:poblacion';

const DISCLAIMER = 'Estimación estadística — no es un puntaje mínimo de admisión.';

const POBLACION_LABEL: Record<string, string> = {
  quindio: 'Quindío',
  nacional: 'Nacional',
};

// Favicon motif: 5 ascending bars in the brand colors (one per Saber 11 area).
const EMPTY_BARS = [
  { x: 0, h: 16, color: 'var(--brand-pink)' },
  { x: 18, h: 26, color: 'var(--brand-teal)' },
  { x: 36, h: 34, color: 'var(--brand-lavender)' },
  { x: 54, h: 44, color: 'var(--brand-peach)' },
  { x: 72, h: 54, color: 'var(--brand-ochre)' },
];

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* localStorage unavailable (private mode) — non-fatal */
  }
}

const EstimatorIsland: FunctionComponent = () => {
  const [areas, setAreas] = useState<Area[]>([]);
  const [populations, setPopulations] = useState<Population[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedProgram, setSelectedProgram] = useState('');
  const [puntaje, setPuntaje] = useState<string>('');
  const [puntajeError, setPuntajeError] = useState<string | null>(null);
  const [puntajeTouched, setPuntajeTouched] = useState(false);
  const [poblacion, setPoblacion] = useState<'nacional' | 'quindio'>('quindio');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<EstimateResult | null>(null);
  // Bumped on each successful estimate so the results section remounts and
  // replays its entrance animation — without ever collapsing in between.
  const [runId, setRunId] = useState(0);

  const storedProgram = useRef<string | null>(null);

  useEffect(() => {
    storedProgram.current = readStored(LS_PROGRAMA);
    const storedPob = readStored(LS_POBLACION);
    if (storedPob === 'nacional' || storedPob === 'quindio') setPoblacion(storedPob);

    Promise.all([fetchAreas(), fetchPopulations(), fetchPrograms()])
      .then(([a, p, pr]) => {
        setAreas(a);
        setPopulations(p);
        setPrograms(pr);
        const restore = storedProgram.current;
        if (restore && pr.some((x) => x.programa === restore)) {
          setSelectedProgram(restore);
        } else if (pr.length > 0) {
          setSelectedProgram(pr[0].programa);
        }
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  // Sort by (faculty, program) so every faculty forms a single contiguous run.
  // The combobox starts a new group header whenever the faculty changes from the
  // previous row, so an alphabetical-by-program order (the API default) would
  // split a faculty into several headers (e.g. "Ingeniería de Alimentos" from
  // Ciencias Agroindustriales falling between two Ingeniería programs).
  const programOptions = useMemo<ComboboxOption[]>(
    () =>
      programs
        .map((p) => ({ value: p.programa, group: p.facultad }))
        .sort(
          (a, b) => a.group.localeCompare(b.group, 'es') || a.value.localeCompare(b.value, 'es'),
        ),
    [programs],
  );

  const getAreaLabel = (key: string) => areas.find((a) => a.key === key)?.label ?? key;

  function validatePuntaje(raw: string): string | null {
    const normalized = raw.trim().replace(',', '.');
    if (normalized === '') return 'El ponderado debe estar entre 0 y 100';
    const num = Number(normalized);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      return 'El ponderado debe estar entre 0 y 100';
    }
    return null;
  }

  function onPuntajeInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    setPuntaje(raw);
    // Recover from an error as soon as the value becomes valid.
    if (puntajeTouched && puntajeError) {
      setPuntajeError(validatePuntaje(raw));
    }
  }

  function onPuntajeBlur() {
    setPuntajeTouched(true);
    setPuntajeError(validatePuntaje(puntaje));
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const err = validatePuntaje(puntaje);
    setPuntajeTouched(true);
    setPuntajeError(err);
    if (err) return;

    const puntajeNum = Number(puntaje.trim().replace(',', '.'));
    setSubmitting(true);
    setSubmitError(null);
    // Keep any previous result mounted while computing so the layout never
    // collapses to the spinner and snaps back — that was the visible "jump".
    try {
      const res = await postEstimate({
        programa: selectedProgram,
        puntaje: puntajeNum,
        poblacion,
        alternativas: 6,
      });
      setResult(res);
      setRunId((n) => n + 1);
      writeStored(LS_PROGRAMA, selectedProgram);
      writeStored(LS_POBLACION, poblacion);
    } catch (err2: unknown) {
      const message =
        err2 instanceof Error ? err2.message : 'Error al estimar. Intente nuevamente.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div class="estimator-error" role="alert">
        <p>No se pudo conectar con el servidor: {loadError}</p>
      </div>
    );
  }

  const poblacionLabel = result ? (POBLACION_LABEL[result.poblacion] ?? result.poblacion) : '';

  return (
    <div class="estimator">
      <form class="estimator-form" onSubmit={handleSubmit} noValidate>
        {/* Población first */}
        <fieldset class="form-group population-group">
          <legend>Población de referencia</legend>
          <div class="population-options">
            {populations.map((pop) => (
              <label key={pop.name} class="radio-label">
                <input
                  type="radio"
                  name="poblacion"
                  value={pop.name}
                  checked={poblacion === pop.name}
                  onChange={() => setPoblacion(pop.name as 'nacional' | 'quindio')}
                />
                <span>{pop.label}</span>
                <span class="population-n"> (n = {pop.n.toLocaleString('es-CO')})</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Programa */}
        <div class="form-group">
          <Combobox
            label="Programa académico"
            options={programOptions}
            value={selectedProgram}
            onChange={setSelectedProgram}
            placeholder="Selecciona o escribe el programa"
            disabled={programs.length === 0}
          />
        </div>

        {/* Puntaje */}
        <div class="form-group">
          <label for="puntaje-input">Puntaje ponderado objetivo (0–100)</label>
          <input
            id="puntaje-input"
            type="text"
            inputMode="decimal"
            value={puntaje}
            onInput={onPuntajeInput}
            onBlur={onPuntajeBlur}
            placeholder="Ej. 72.50"
            aria-invalid={puntajeError ? 'true' : 'false'}
            aria-describedby={puntajeError ? 'puntaje-error puntaje-hint' : 'puntaje-hint'}
          />
          <small id="puntaje-hint">
            Ingresa el puntaje de admisión del programa entre 0 y 100.
          </small>
          {puntajeError && (
            <small id="puntaje-error" class="field-error" role="alert">
              {puntajeError}
            </small>
          )}
        </div>

        {submitError && (
          <div class="form-error" role="alert">
            {submitError}
          </div>
        )}

        <button type="submit" class="btn-primary" disabled={submitting || programs.length === 0}>
          {submitting ? 'Estimando...' : 'Estimar'}
        </button>
      </form>

      {/* Big spinner only on the first run; on re-estimates the previous
          result stays put (gently dimmed) so nothing collapses. */}
      {submitting && !result && (
        <div class="loading" aria-live="polite">
          <div class="spinner" aria-hidden="true" />
          <p>Calculando estimación...</p>
        </div>
      )}

      {!result && !submitting && !submitError && (
        <div class="empty-state">
          <svg
            class="empty-state-art"
            viewBox="0 0 96 56"
            width="96"
            height="56"
            aria-hidden="true"
          >
            {EMPTY_BARS.map((b) => (
              <rect
                key={b.color}
                x={b.x}
                y={56 - b.h}
                width="14"
                height={b.h}
                rx="3"
                fill={b.color}
              />
            ))}
          </svg>
          <h2 class="empty-state-title">Tu estimación aparecerá aquí</h2>
          <p class="empty-state-text">
            Elige un programa y un puntaje, luego presiona Estimar.
          </p>
        </div>
      )}

      {result && (
        <section
          key={runId}
          class={`results${submitting ? ' results--recomputing' : ''}`}
          aria-busy={submitting ? 'true' : 'false'}
          aria-label="Resultados de la estimación"
        >
          <WarningNotice warnings={result.advertencias} />

          {/* 2. Program info */}
          <div class="result-program-info">
            <h2>{result.programa}</h2>
            <p class="result-facultad">{result.facultad}</p>
            <p class="result-meta">
              Muestra: {result.muestra_n.toLocaleString('es-CO')} registros
            </p>
          </div>

          {/* 3. Main result card */}
          <div class="result-card main-result">
            {/* a. Permanent disclaimer */}
            <p class="permanent-disclaimer" role="note">
              {DISCLAIMER}
            </p>

            <h3 class="main-result-title">Resultado más probable</h3>

            {/* b. Global block */}
            <div class="global-block">
              <div class="global-focal">
                <div
                  class="global-score"
                  aria-label={`Puntaje global estimado: ${result.mas_probable.global_estimado} de 500`}
                >
                  <span class="global-score-value">{result.mas_probable.global_estimado}</span>
                  <span class="global-score-label">puntaje global estimado (0–500)</span>
                </div>

                <span class="global-percentile-pill">
                  {betterThan(result.global_stats.percentil)} ({poblacionLabel})
                </span>
              </div>

              <GlobalGauge
                value={result.mas_probable.global_estimado}
                mean={result.global_stats.mean}
              />

              <div class="gauge-legend" aria-hidden="true">
                <span class="gauge-legend-item">
                  <span class="gauge-legend-dot" /> Tú
                </span>
                <span class="gauge-legend-item">
                  <span class="gauge-legend-tick" /> Promedio {poblacionLabel}
                </span>
              </div>

              <p class="ponderado-recalc">
                Ponderado recalculado:{' '}
                <strong>{result.mas_probable.ponderado_recalculado.toFixed(2)}</strong>
              </p>
            </div>

            {/* c. Weights donut */}
            <div class="weights-block result-section">
              <p class="section-overline">Ponderación del programa</p>
              <WeightsDonut pesos={result.pesos} getAreaLabel={getAreaLabel} />
            </div>

            {/* d. Section label + legend */}
            <div class="ranges-heading result-section">
              <p class="section-overline">Rango más probable por área</p>
              <span class="range-legend">
                <span class="range-legend-swatch" aria-hidden="true" />± rango probable
              </span>
            </div>

            {/* e. Five area rows */}
            <div class="score-bars">
              {areas.map((area) => {
                const v = result.mas_probable.areas[area.key] ?? 0;
                const u = result.mas_probable.incertidumbre[area.key];
                const stat = result.poblacion_stats[area.key];
                return (
                  <ScoreBar
                    key={area.key}
                    areaLabel={area.label}
                    value={v}
                    uncertainty={u}
                    accentColor={areaColor(area.key)}
                    populationMean={stat?.mean}
                    percentil={stat?.percentil}
                    poblacionLabel={poblacionLabel}
                  />
                );
              })}
            </div>

            {/* f. Per-area distribution detail */}
            <details class="distribution-details result-section">
              <summary>Ver distribución por área</summary>
              <div class="distribution-grid">
                {areas.map((area) => {
                  const v = result.mas_probable.areas[area.key] ?? 0;
                  const u = result.mas_probable.incertidumbre[area.key] ?? 0;
                  const stat = result.poblacion_stats[area.key];
                  const color = areaColor(area.key);
                  const condStd = u > 0 ? u : 1;
                  const range = scoreRange(v, condStd);
                  const k =
                    range.high > range.low
                      ? Math.max(
                          1,
                          Math.round(
                            20 *
                              (normalCdf(range.high, v, condStd) - normalCdf(range.low, v, condStd)),
                          ),
                        )
                      : 20;
                  return (
                    <div key={area.key} class="dist-area">
                      <div class="dist-area-head">
                        <span class="dist-area-label">{area.label}</span>
                        <span class="dist-area-score" style={{ color }}>
                          Tú {Math.round(v)}
                          <span class="dist-area-score-max">/100</span>
                        </span>
                      </div>
                      <p class="dist-area-rank">
                        Mejor que el <strong>{stat?.percentil ?? 0}%</strong> de los estudiantes
                      </p>

                      <AreaDistribution
                        estimate={v}
                        estimateStd={u}
                        populationMean={stat?.mean ?? v}
                        populationStd={stat?.std ?? 1}
                        color={color}
                      />

                      <p class="dist-legend">
                        <span class="dist-legend-item">
                          <span class="dist-legend-band" aria-hidden="true" />
                          La población
                        </span>
                        <span class="dist-legend-item">
                          <span class="dist-legend-dots" aria-hidden="true" style={{ color }}>
                            <span />
                            <span />
                            <span />
                          </span>
                          Tu puntaje
                        </span>
                      </p>
                      <p class="dist-area-caption">
                        {range.high > range.low
                          ? `Cada punto = 1 de 20 resultados igual de probables. Unos ${k} de 20 caen entre ${range.low} y ${range.high}.`
                          : `Los 20 resultados se concentran cerca de ${Math.round(v)}.`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </details>

            {/* g. Correlation insight */}
            {result.correlaciones.length > 0 && (
              <p class="correlation-insight result-section">
                {getAreaLabel(result.correlaciones[0].area_a)} y{' '}
                {getAreaLabel(result.correlaciones[0].area_b)} suelen ir juntas (correlación{' '}
                {formatCorrelation(result.correlaciones[0].r)}).
              </p>
            )}

            {/* h. Range explainer */}
            <details class="range-explainer">
              <summary>¿Qué significa el rango?</summary>
              <p>
                El rango muestra dónde es más probable que caiga cada puntaje, dado tu ponderado
                objetivo. Un rango más amplio indica mayor incertidumbre: el área puede variar más
                sin cambiar el ponderado final.
              </p>
            </details>
          </div>

          {/* 4. Alternatives */}
          {result.alternativas.length > 0 && (
            <div class="alternatives-section">
              <h3 class="section-overline">
                Otras combinaciones probables ({result.alternativas.length})
              </h3>
              <p class="alternatives-intro">
                {result.alternativas.length} combinaciones equivalentes — mismo ponderado, distinta
                distribución de áreas.
              </p>
              <div class="alternatives-list">
                {result.alternativas.map((alt, i) => (
                  <details key={i} class="alternative-item">
                    <summary class="alternative-summary">
                      <span class="alt-rank">#{i + 1}</span>
                      <span class="alt-global">Global {alt.global_estimado}</span>
                      <span class="alt-ponderado">
                        Ponderado {alt.ponderado_recalculado.toFixed(2)}
                      </span>
                      <span class="alt-prob-wrap">
                        <span class="alt-prob-bar" aria-hidden="true">
                          <span
                            class="alt-prob-fill"
                            style={{ width: `${clamp(alt.probabilidad_relativa * 100, 0, 100)}%` }}
                          />
                        </span>
                        <span class="alt-prob-value">
                          {(alt.probabilidad_relativa * 100).toFixed(0)}%
                        </span>
                      </span>
                    </summary>
                    <div class="alternative-detail">
                      {areas.map((area) => {
                        const v = alt.areas[area.key] ?? 0;
                        return (
                          <div key={area.key} class="alt-mini-row">
                            <span class="alt-mini-label">{area.label}</span>
                            <span class="alt-mini-track">
                              <span
                                class="alt-mini-fill"
                                style={{
                                  width: `${clamp(v, 0, 100)}%`,
                                  backgroundColor: areaColor(area.key),
                                }}
                              />
                            </span>
                            <span class="alt-mini-value">{Math.round(v)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default EstimatorIsland;
