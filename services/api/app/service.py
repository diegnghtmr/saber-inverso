"""Application service: orchestrates repositories + solver into API responses."""
from __future__ import annotations

import numpy as np

from .domain import solver
from .domain.areas import AREAS, AREA_LABELS
from .domain.repositories import ModelRepository
from .schemas import (
    Alternative,
    AreaStat,
    Correlacion,
    EstimateResponse,
    ForwardResponse,
    GlobalStat,
    MostProbable,
)

POPULATION_LABELS = {"nacional": "Nacional", "quindio": "Quindío"}


class ProgramNotFound(Exception):
    pass


class PopulationNotFound(Exception):
    pass


class EstimatorService:
    def __init__(self, repo: ModelRepository) -> None:
        self.repo = repo

    def _areas_dict(self, vector: np.ndarray) -> dict[str, int]:
        return {area: int(vector[i]) for i, area in enumerate(AREAS)}

    def estimate(
        self, programa: str, puntaje: float, poblacion: str, alternativas: int
    ) -> EstimateResponse:
        try:
            program = self.repo.get_program(programa)
        except KeyError as exc:
            raise ProgramNotFound(programa) from exc
        try:
            pop = self.repo.get_population(poblacion)
        except KeyError as exc:
            raise PopulationNotFound(poblacion) from exc

        inversion = solver.invert(puntaje, program.weights, pop.mu, pop.sigma)
        candidates = solver.rank_candidates(
            inversion, program.weights, puntaje, count=alternativas
        )

        warnings: list[str] = []
        clipped = np.clip(np.round(inversion.mean), 0, 100)
        if not np.allclose(clipped, np.round(inversion.mean)):
            warnings.append(
                "El puntaje está cerca de un extremo (0 o 100); algunas áreas se recortaron al rango válido."
            )
        if abs(program.weight_sum - 1.0) > 1e-3:
            warnings.append(
                f"Los pesos del programa suman {program.weight_sum:.3f}, no 1.0; revisá la tabla de ponderados."
            )

        # The most-probable vector is the first ranked candidate (rounded conditional mean).
        top = candidates[0]
        most_probable = MostProbable(
            areas=self._areas_dict(top.scores),
            ponderado_recalculado=top.recomputed_ponderado,
            global_estimado=solver.global_score(top.scores),
            incertidumbre={
                area: round(float(inversion.cond_std[i]), 2) for i, area in enumerate(AREAS)
            },
        )
        alternatives = [
            Alternative(
                areas=self._areas_dict(c.scores),
                ponderado_recalculado=c.recomputed_ponderado,
                global_estimado=solver.global_score(c.scores),
                probabilidad_relativa=c.relative_probability,
            )
            for c in candidates[1:]
        ]

        # Population reference distribution: per-area mean/std + the estimate's percentile.
        poblacion_stats = {
            area: AreaStat(
                mean=round(float(pop.mu[i]), 1),
                std=round(float(pop.std[i]), 1),
                percentil=solver.percentile(int(top.scores[i]), float(pop.mu[i]), float(pop.std[i])),
            )
            for i, area in enumerate(AREAS)
        }
        g_mean, g_std = solver.global_distribution(pop.mu, pop.sigma)
        global_value = solver.global_score(top.scores)
        global_stats = GlobalStat(
            mean=round(g_mean, 1),
            std=round(g_std, 1),
            percentil=solver.percentile(global_value, g_mean, g_std),
        )

        # Strongest inter-area correlations (top pairs) for the "why" insight.
        pairs = [
            (abs(float(pop.corr[i][j])), AREAS[i], AREAS[j], round(float(pop.corr[i][j]), 2))
            for i in range(len(AREAS))
            for j in range(i + 1, len(AREAS))
        ]
        pairs.sort(reverse=True)
        correlaciones = [Correlacion(area_a=a, area_b=b, r=r) for _, a, b, r in pairs[:2]]

        return EstimateResponse(
            programa=program.programa,
            facultad=program.facultad,
            puntaje_objetivo=puntaje,
            poblacion=poblacion,
            pesos={area: float(program.weights[i]) for i, area in enumerate(AREAS)},
            mas_probable=most_probable,
            alternativas=alternatives,
            advertencias=warnings,
            muestra_n=pop.n,
            poblacion_stats=poblacion_stats,
            global_stats=global_stats,
            correlaciones=correlaciones,
        )

    def forward(self, scores: dict[str, int], programa: str | None) -> ForwardResponse:
        vector = np.array([scores[a] for a in AREAS], dtype=float)
        pond = None
        if programa is not None:
            try:
                program = self.repo.get_program(programa)
            except KeyError as exc:
                raise ProgramNotFound(programa) from exc
            pond = round(solver.ponderado(vector, program.weights), 3)
        return ForwardResponse(
            scores={a: int(scores[a]) for a in AREAS},
            global_score=solver.global_score(vector),
            ponderado=pond,
            programa=programa,
        )


def population_label(name: str) -> str:
    return POPULATION_LABELS.get(name, name.capitalize())


def area_label(key: str) -> str:
    return AREA_LABELS.get(key, key)
