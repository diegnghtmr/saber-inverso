"""FastAPI application wiring the estimator service to HTTP endpoints."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .domain.areas import AREA_LABELS, AREAS
from .domain.repositories import ModelRepository
from .schemas import (
    AreaInfo,
    EstimateRequest,
    EstimateResponse,
    ForwardRequest,
    ForwardResponse,
    PopulationOut,
    ProgramOut,
)
from .service import (
    EstimatorService,
    PopulationNotFound,
    ProgramNotFound,
    population_label,
)

state: dict[str, object] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    repo = ModelRepository(config.MODEL_STATS_PATH, config.PROGRAM_WEIGHTS_PATH)
    state["repo"] = repo
    state["service"] = EstimatorService(repo)
    yield
    state.clear()


app = FastAPI(
    title="Saber Inverso — Estimador de puntajes Saber 11",
    description=(
        "Dado el puntaje de admisión (ponderado) de un programa de la Universidad "
        "del Quindío, estima las notas por área más probables del Saber 11, con "
        "alternativas ordenadas por probabilidad, usando la distribución conjunta "
        "nacional/regional de los datos abiertos del ICFES."
    ),
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _service() -> EstimatorService:
    return state["service"]  # type: ignore[return-value]


def _repo() -> ModelRepository:
    return state["repo"]  # type: ignore[return-value]


@app.get("/health")
def health() -> dict[str, object]:
    repo = _repo()
    return {
        "status": "ok",
        "dataset": repo.dataset,
        "license": repo.license,
        "periods": repo.periods,
        "populations": repo.population_names(),
        "programs": len(repo.programs()),
    }


@app.get("/api/areas", response_model=list[AreaInfo])
def list_areas() -> list[AreaInfo]:
    return [AreaInfo(key=a, label=AREA_LABELS[a]) for a in AREAS]


@app.get("/api/populations", response_model=list[PopulationOut])
def list_populations() -> list[PopulationOut]:
    repo = _repo()
    return [
        PopulationOut(name=n, label=population_label(n), n=repo.get_population(n).n)
        for n in repo.population_names()
    ]


@app.get("/api/programs", response_model=list[ProgramOut])
def list_programs() -> list[ProgramOut]:
    repo = _repo()
    return [
        ProgramOut(
            programa=p.programa,
            facultad=p.facultad,
            weights={a: float(p.weights[i]) for i, a in enumerate(AREAS)},
            weight_sum=p.weight_sum,
        )
        for p in sorted(repo.programs(), key=lambda x: x.programa)
    ]


@app.post("/api/estimate", response_model=EstimateResponse)
def estimate(req: EstimateRequest) -> EstimateResponse:
    try:
        return _service().estimate(req.programa, req.puntaje, req.poblacion, req.alternativas)
    except ProgramNotFound:
        raise HTTPException(status_code=404, detail=f"Programa no encontrado: {req.programa}")
    except PopulationNotFound:
        raise HTTPException(status_code=400, detail=f"Población inválida: {req.poblacion}")


@app.post("/api/forward", response_model=ForwardResponse)
def forward(req: ForwardRequest) -> ForwardResponse:
    missing = [a for a in AREAS if a not in req.scores]
    if missing:
        raise HTTPException(status_code=422, detail=f"Faltan áreas: {missing}")
    for area, value in req.scores.items():
        if not (0 <= value <= 100):
            raise HTTPException(status_code=422, detail=f"{area} fuera de rango [0,100]: {value}")
    try:
        return _service().forward(req.scores, req.programa)
    except ProgramNotFound:
        raise HTTPException(status_code=404, detail=f"Programa no encontrado: {req.programa}")
