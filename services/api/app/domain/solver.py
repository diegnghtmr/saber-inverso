"""The statistical core: forward scoring and the inverse (constrained MAP) solver.

Problem: the admission *ponderado* is a program-specific linear combination of the
5 area scores, ``P = wᵀs``. Recovering ``s`` from ``P`` is underdetermined (one
equation, five unknowns). We make it well-posed by modelling the population of
area scores as a multivariate Gaussian ``s ~ N(mu, Sigma)`` estimated from real
ICFES microdata, and returning the most-probable ``s`` consistent with ``P``.

Conditioning a Gaussian on a linear functional has a closed form:

    E[s | wᵀs = P] = mu + Σw (wᵀΣw)⁻¹ (P − wᵀmu)          → most-probable vector
    Cov[s | wᵀs = P] = Σ − Σw wᵀΣ / (wᵀΣw)                → drives the alternatives

The conditional covariance is rank-deficient with ``w`` in its null space, so any
sample drawn from it satisfies the constraint ``wᵀs = P`` exactly (up to integer
rounding). Validated on real data: the conditional mean is unbiased and its
per-area std matches the empirical round-trip RMSE.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .areas import GLOBAL_DENOMINATOR, GLOBAL_SCALE, GLOBAL_WEIGHTS

_GLOBAL_W = np.array(GLOBAL_WEIGHTS, dtype=float)
# Linear coefficients that turn a score vector into the global score (0–500).
_GLOBAL_COEFFS = _GLOBAL_W / GLOBAL_DENOMINATOR * GLOBAL_SCALE


def ponderado(scores: np.ndarray, weights: np.ndarray) -> float:
    """Program admission score: weighted sum of the 5 area scores (0–100)."""
    return float(np.asarray(weights, float) @ np.asarray(scores, float))


def global_score(scores: np.ndarray) -> int:
    """National ICFES global score (0–500), rounded to the nearest integer."""
    raw = float(_GLOBAL_W @ np.asarray(scores, float)) / GLOBAL_DENOMINATOR * GLOBAL_SCALE
    return int(round(raw))


def normal_cdf(x: float) -> float:
    """Standard-normal CDF via the error function (stdlib, exact enough)."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def percentile(value: float, mean: float, std: float) -> int:
    """Percentile (0–100) of ``value`` under N(mean, std): % of peers scoring below."""
    if std <= 0:
        return 50
    return int(round(normal_cdf((value - mean) / std) * 100))


def global_distribution(mu: np.ndarray, sigma: np.ndarray) -> tuple[float, float]:
    """Mean and std of the global score (0–500) as a linear functional of N(mu, Σ)."""
    a = _GLOBAL_COEFFS
    mean = float(a @ np.asarray(mu, float))
    var = float(a @ np.asarray(sigma, float) @ a)
    return mean, math.sqrt(max(var, 0.0))


def _round_clip(vector: np.ndarray) -> np.ndarray:
    """Round to integers and clamp to the valid [0, 100] score range."""
    return np.clip(np.round(vector), 0, 100).astype(int)


@dataclass(frozen=True)
class Inversion:
    """Result of inverting one ponderado against one population."""

    mean: np.ndarray        # continuous conditional mean s* (length 5)
    cond_cov: np.ndarray    # 5×5 conditional covariance (rank 4)
    cond_std: np.ndarray    # per-area conditional std (the honest ± uncertainty)


@dataclass(frozen=True)
class Candidate:
    """One integer score vector consistent with the target ponderado."""

    scores: np.ndarray          # integer area scores (length 5)
    recomputed_ponderado: float # wᵀscores after rounding
    relative_probability: float # likelihood relative to the most probable (1.0)


def invert(target: float, weights: np.ndarray, mu: np.ndarray, sigma: np.ndarray) -> Inversion:
    """Closed-form conditional mean and covariance for ``wᵀs = target``."""
    w = np.asarray(weights, float)
    mu = np.asarray(mu, float)
    sigma = np.asarray(sigma, float)

    sigma_w = sigma @ w
    denom = float(w @ sigma_w)
    if denom < 1e-9:
        raise ValueError("Degenerate problem: wᵀΣw is non-positive or near-zero.")

    s_star = mu + sigma_w * ((target - float(w @ mu)) / denom)
    cond_cov = sigma - np.outer(sigma_w, sigma_w) / denom
    cond_std = np.sqrt(np.clip(np.diag(cond_cov), 0.0, None))
    return Inversion(mean=s_star, cond_cov=cond_cov, cond_std=cond_std)


def rank_candidates(
    inversion: Inversion,
    weights: np.ndarray,
    target: float,
    *,
    count: int = 6,
    n_samples: int = 5000,
    tolerance: float = 0.75,
    seed: int = 7,
) -> list[Candidate]:
    """Return the ``count`` most-probable integer score vectors that reproduce ``target``.

    We sample the (degenerate) conditional Gaussian — every continuous sample sits
    on the constraint hyperplane — then round to integers, keep those whose
    recomputed ponderado stays within ``tolerance`` of the target, dedupe, and rank
    by Mahalanobis distance to the conditional mean (lower distance = more likely).
    Deterministic given ``seed``.
    """
    w = np.asarray(weights, float)
    s_star = inversion.mean
    cond_cov = inversion.cond_cov

    # Build a sampler over the non-degenerate subspace (eigenvectors ⟂ w).
    eigvals, eigvecs = np.linalg.eigh(cond_cov)
    keep = eigvals > 1e-9
    factor = eigvecs[:, keep] * np.sqrt(eigvals[keep])

    rng = np.random.default_rng(seed)
    z = rng.standard_normal((n_samples, factor.shape[1]))
    samples = s_star[None, :] + z @ factor.T

    # Pool: the rounded conditional mean plus the rounded samples.
    pool = np.vstack([_round_clip(s_star)[None, :], _round_clip(samples)])
    pool = np.unique(pool, axis=0)

    # Keep candidates whose recomputed ponderado matches the target within
    # tolerance — applied uniformly, including to the rounded conditional mean.
    # Near the 0/100 boundary the target can be unreachable by any integer
    # vector, so fall back to the closest-achievable candidates instead of
    # silently promoting one that violates the tolerance.
    deviation = np.abs(pool @ w - target)
    within = deviation <= tolerance
    pool = pool[within] if within.any() else pool[deviation <= deviation.min() + 1e-9]

    # Rank by Mahalanobis distance to the conditional mean. cond_cov is rank-4
    # with w in its null space, so pinv ignores the (rounding-induced) component
    # along w and ranks purely within the non-degenerate subspace.
    pinv = np.linalg.pinv(cond_cov)
    delta = pool - s_star
    dist2 = np.einsum("ij,jk,ik->i", delta, pinv, delta)
    order = np.argsort(dist2)[:count]

    best = pool[order]
    dist2 = dist2[order]
    rel = np.exp(-0.5 * (dist2 - dist2.min()))

    return [
        Candidate(
            scores=best[i],
            recomputed_ponderado=round(float(best[i] @ w), 3),
            relative_probability=round(float(rel[i]), 4),
        )
        for i in range(len(best))
    ]
