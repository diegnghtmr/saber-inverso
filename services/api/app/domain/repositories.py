"""Load the precomputed statistical model and program weights from disk.

These artifacts are produced by ``services/etl/etl.py`` and are read once at
startup. Everything is returned as numpy arrays indexed in ``AREAS`` order.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .areas import AREAS


@dataclass(frozen=True)
class Population:
    name: str
    n: int
    mu: np.ndarray       # length 5
    sigma: np.ndarray    # 5×5
    std: np.ndarray      # length 5
    corr: np.ndarray     # 5×5


@dataclass(frozen=True)
class Program:
    programa: str
    facultad: str
    weights: np.ndarray  # length 5, sums to ~1.0
    weight_sum: float


class ModelRepository:
    """In-memory repository over the ETL artifacts."""

    def __init__(self, model_stats_path: Path, program_weights_path: Path) -> None:
        stats = json.loads(Path(model_stats_path).read_text(encoding="utf-8"))
        weights = json.loads(Path(program_weights_path).read_text(encoding="utf-8"))

        self.dataset: str = stats.get("dataset", "")
        self.license: str = stats.get("license", "")
        self.periods: list[str] = stats.get("periods", [])
        self.global_formula: dict = stats.get("global_formula", {})

        self._populations: dict[str, Population] = {}
        for name, payload in stats["populations"].items():
            self._populations[name] = Population(
                name=name,
                n=int(payload["n"]),
                mu=np.array([payload["mean"][a] for a in AREAS], dtype=float),
                sigma=np.array(payload["cov"], dtype=float),
                std=np.array([payload["std"][a] for a in AREAS], dtype=float),
                corr=np.array(payload["corr"], dtype=float),
            )

        self._programs: dict[str, Program] = {}
        for item in weights["programs"]:
            self._programs[item["programa"]] = Program(
                programa=item["programa"],
                facultad=item.get("facultad", ""),
                weights=np.array([item["weights"][a] for a in AREAS], dtype=float),
                weight_sum=float(item.get("weight_sum", sum(item["weights"].values()))),
            )

    # -- populations ----------------------------------------------------------
    def population_names(self) -> list[str]:
        return list(self._populations.keys())

    def get_population(self, name: str) -> Population:
        if name not in self._populations:
            raise KeyError(name)
        return self._populations[name]

    # -- programs -------------------------------------------------------------
    def programs(self) -> list[Program]:
        return list(self._programs.values())

    def get_program(self, programa: str) -> Program:
        if programa not in self._programs:
            raise KeyError(programa)
        return self._programs[programa]
