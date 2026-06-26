"""Canonical Saber 11 areas.

The order of ``AREAS`` is load-bearing: every vector and matrix in the system
(weights, mu, Sigma) is indexed in this exact order. Do not reorder.
"""
from __future__ import annotations

AREAS: tuple[str, ...] = (
    "lectura_critica",
    "matematicas",
    "sociales_ciudadanas",
    "c_naturales",
    "ingles",
)

# Human-facing Spanish labels for the UI.
AREA_LABELS: dict[str, str] = {
    "lectura_critica": "Lectura Crítica",
    "matematicas": "Matemáticas",
    "sociales_ciudadanas": "Sociales y Ciudadanas",
    "c_naturales": "Ciencias Naturales",
    "ingles": "Inglés",
}

# National global-score weights (Resolución ICFES 268/2020): LC,MAT,SOC,CN weigh
# 3, English weighs 1; sum/13, then ×5 to land on the 0–500 scale.
GLOBAL_WEIGHTS: tuple[int, ...] = (3, 3, 3, 3, 1)
GLOBAL_DENOMINATOR = 13
GLOBAL_SCALE = 5
