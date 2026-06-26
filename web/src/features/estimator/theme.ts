/**
 * Brand color per Saber 11 area — cycles the DESIGN.MD saturated palette
 * (pink → teal → lavender → peach → ochre). Used only by the estimator
 * feature, so it lives here (Scope Rule).
 */
export const AREA_COLORS: Record<string, string> = {
  lectura_critica: '#ff4d8b', // brand-pink
  matematicas: '#1a3a3a', // brand-teal
  sociales_ciudadanas: '#b8a4ed', // brand-lavender
  c_naturales: '#ffb084', // brand-peach
  ingles: '#e8b94a', // brand-ochre
};

export const DEFAULT_AREA_COLOR = '#1a3a3a';

export function areaColor(key: string): string {
  return AREA_COLORS[key] ?? DEFAULT_AREA_COLOR;
}
