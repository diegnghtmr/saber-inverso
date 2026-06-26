"""API request/response contract (Pydantic v2). This is the frontend's source of truth."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ProgramOut(BaseModel):
    programa: str
    facultad: str
    weights: dict[str, float]
    weight_sum: float


class PopulationOut(BaseModel):
    name: str
    label: str
    n: int


class AreaInfo(BaseModel):
    key: str
    label: str


class EstimateRequest(BaseModel):
    programa: str = Field(..., description="Exact program name as returned by /api/programs")
    puntaje: float = Field(..., ge=0, le=100, description="Admission ponderado to invert (0–100)")
    poblacion: str = Field("quindio", description="Statistical population: 'nacional' or 'quindio'")
    alternativas: int = Field(6, ge=1, le=20, description="How many ranked candidates to return")


class ScoreVector(BaseModel):
    """A full set of 5 area scores plus the derived global score."""

    areas: dict[str, int]
    ponderado_recalculado: float = Field(..., description="wᵀscores after integer rounding")
    global_estimado: int = Field(..., description="Estimated ICFES global score (0–500)")


class MostProbable(ScoreVector):
    incertidumbre: dict[str, float] = Field(..., description="Per-area ± (conditional std)")


class Alternative(ScoreVector):
    probabilidad_relativa: float = Field(..., description="Likelihood relative to the most probable (1.0)")


class AreaStat(BaseModel):
    """Population reference distribution for one area + the estimate's percentile."""

    mean: float
    std: float
    percentil: int = Field(..., description="% of the population scoring below the estimate")


class GlobalStat(BaseModel):
    mean: float
    std: float
    percentil: int


class Correlacion(BaseModel):
    area_a: str
    area_b: str
    r: float


class EstimateResponse(BaseModel):
    programa: str
    facultad: str
    puntaje_objetivo: float
    poblacion: str
    pesos: dict[str, float]
    mas_probable: MostProbable
    alternativas: list[Alternative]
    advertencias: list[str] = []
    muestra_n: int
    # Population reference data (powers bell curves, percentile badges, correlation insight).
    poblacion_stats: dict[str, AreaStat]
    global_stats: GlobalStat
    correlaciones: list[Correlacion]


class ForwardRequest(BaseModel):
    scores: dict[str, int] = Field(..., description="The 5 area scores keyed by area slug")
    programa: str | None = Field(None, description="Optional program to also compute its ponderado")


class ForwardResponse(BaseModel):
    scores: dict[str, int]
    global_score: int
    ponderado: float | None = None
    programa: str | None = None
