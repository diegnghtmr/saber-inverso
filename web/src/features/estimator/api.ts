const API_BASE = import.meta.env.PUBLIC_API_BASE ?? '';

export interface Area {
  key: string;
  label: string;
}

export interface Population {
  name: 'nacional' | 'quindio';
  label: string;
  n: number;
}

export interface Program {
  programa: string;
  facultad: string;
  weights: Record<string, number>;
  weight_sum: number;
}

export interface EstimateRequest {
  programa: string;
  puntaje: number;
  poblacion: 'nacional' | 'quindio';
  alternativas: number;
}

export interface ScoreSet {
  areas: Record<string, number>;
  ponderado_recalculado: number;
  global_estimado: number;
}

export interface MostProbableResult extends ScoreSet {
  incertidumbre: Record<string, number>;
}

export interface Alternative extends ScoreSet {
  probabilidad_relativa: number;
}

/** Population reference distribution for one area + the estimate's percentile. */
export interface AreaStat {
  mean: number;
  std: number;
  percentil: number;
}

export interface GlobalStat {
  mean: number;
  std: number;
  percentil: number;
}

export interface Correlacion {
  area_a: string;
  area_b: string;
  r: number;
}

export interface EstimateResult {
  programa: string;
  facultad: string;
  puntaje_objetivo: number;
  poblacion: string;
  pesos: Record<string, number>;
  mas_probable: MostProbableResult;
  alternativas: Alternative[];
  advertencias: string[];
  muestra_n: number;
  poblacion_stats: Record<string, AreaStat>;
  global_stats: GlobalStat;
  correlaciones: Correlacion[];
}

export async function fetchAreas(): Promise<Area[]> {
  const res = await fetch(`${API_BASE}/api/areas`);
  if (!res.ok) throw new Error('Error cargando áreas');
  return res.json();
}

export async function fetchPopulations(): Promise<Population[]> {
  const res = await fetch(`${API_BASE}/api/populations`);
  if (!res.ok) throw new Error('Error cargando poblaciones');
  return res.json();
}

export async function fetchPrograms(): Promise<Program[]> {
  const res = await fetch(`${API_BASE}/api/programs`);
  if (!res.ok) throw new Error('Error cargando programas');
  return res.json();
}

export async function postEstimate(body: EstimateRequest): Promise<EstimateResult> {
  const res = await fetch(`${API_BASE}/api/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 404) throw new Error('Programa no encontrado');
  if (res.status === 422) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail?.[0]?.msg ?? 'Datos de entrada inválidos');
  }
  if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
  return res.json();
}
