"""Unit tests for the pure statistical core (no FastAPI, no data files)."""
from __future__ import annotations

import numpy as np
import pytest

from app.domain import solver

# A small but realistic model: means ~50, positive correlations.
MU = np.array([52.0, 51.0, 50.0, 50.0, 51.0])
STD = np.array([10.0, 12.0, 11.0, 10.0, 12.0])
CORR = np.array(
    [
        [1.00, 0.72, 0.77, 0.73, 0.65],
        [0.72, 1.00, 0.72, 0.78, 0.65],
        [0.77, 0.72, 1.00, 0.78, 0.65],
        [0.73, 0.78, 0.78, 1.00, 0.67],
        [0.65, 0.65, 0.65, 0.67, 1.00],
    ]
)
SIGMA = CORR * np.outer(STD, STD)
MEDICINA = np.array([0.20, 0.15, 0.20, 0.30, 0.15])


def test_global_score_matches_official_example():
    # Real example student from the ICFES results PDF -> global 353.
    assert solver.global_score(np.array([77, 72, 65, 72, 61])) == 353


def test_global_score_english_weight_is_one():
    # Perfect everywhere except English=0: (3*4*100)/13*5 = 461.5 -> 462.
    assert solver.global_score(np.array([100, 100, 100, 100, 0])) == 462


def test_ponderado_weighted_sum():
    scores = np.array([77, 72, 65, 72, 61])
    assert solver.ponderado(scores, MEDICINA) == pytest.approx(69.95, abs=1e-9)


def test_inversion_mean_satisfies_constraint():
    target = 70.0
    inv = solver.invert(target, MEDICINA, MU, SIGMA)
    assert float(MEDICINA @ inv.mean) == pytest.approx(target, abs=1e-9)


def test_conditional_covariance_is_degenerate_along_weights():
    inv = solver.invert(70.0, MEDICINA, MU, SIGMA)
    # w is in the null space of the conditional covariance -> samples preserve wᵀs.
    assert np.allclose(inv.cond_cov @ MEDICINA, 0.0, atol=1e-8)


def test_conditional_std_is_positive_and_below_marginal():
    inv = solver.invert(70.0, MEDICINA, MU, SIGMA)
    assert np.all(inv.cond_std >= 0)
    assert np.all(inv.cond_std <= STD + 1e-9)  # conditioning never increases variance


def test_rank_candidates_are_consistent_and_ordered():
    target = 72.0
    inv = solver.invert(target, MEDICINA, MU, SIGMA)
    cands = solver.rank_candidates(inv, MEDICINA, target, count=6)
    assert 1 <= len(cands) <= 6
    # Every candidate reproduces the target within the rounding tolerance.
    for c in cands:
        assert abs(c.recomputed_ponderado - target) <= 0.75
        assert c.scores.min() >= 0 and c.scores.max() <= 100
    # Relative probabilities are sorted descending and the top is 1.0.
    rels = [c.relative_probability for c in cands]
    assert rels[0] == pytest.approx(1.0)
    assert rels == sorted(rels, reverse=True)


def test_rank_candidates_extreme_target_falls_back_gracefully():
    # Target 0 is unreachable by integer vectors given the conditional structure;
    # the solver must still return ranked closest-achievable candidates, never crash.
    inv = solver.invert(0.0, MEDICINA, MU, SIGMA)
    cands = solver.rank_candidates(inv, MEDICINA, 0.0, count=5)
    assert len(cands) >= 1
    rels = [c.relative_probability for c in cands]
    assert rels[0] == pytest.approx(1.0)
    assert rels == sorted(rels, reverse=True)
    # The top candidate is the closest achievable to the (unreachable) target.
    best_dev = min(abs(c.recomputed_ponderado - 0.0) for c in cands)
    assert abs(cands[0].recomputed_ponderado - 0.0) == pytest.approx(best_dev, abs=0.5)


def test_rank_candidates_in_range_respects_tolerance():
    # For realistic admission scores the top candidate must honour the tolerance.
    for target in (45.0, 60.0, 72.0):
        inv = solver.invert(target, MEDICINA, MU, SIGMA)
        top = solver.rank_candidates(inv, MEDICINA, target, count=1)[0]
        assert abs(top.recomputed_ponderado - target) <= 0.75


def test_rank_candidates_is_deterministic():
    inv = solver.invert(68.0, MEDICINA, MU, SIGMA)
    a = solver.rank_candidates(inv, MEDICINA, 68.0, count=5)
    b = solver.rank_candidates(inv, MEDICINA, 68.0, count=5)
    assert [c.scores.tolist() for c in a] == [c.scores.tolist() for c in b]


def test_percentile_known_points():
    assert solver.percentile(50, 50, 10) == 50
    assert solver.percentile(60, 50, 10) == 84  # ~+1 std
    assert solver.percentile(40, 50, 10) == 16  # ~-1 std
    assert solver.percentile(70, 50, 0) == 50  # std=0 guard


def test_global_distribution_matches_linear_functional():
    mean, std = solver.global_distribution(MU, SIGMA)
    coeffs = np.array([3, 3, 3, 3, 1]) / 13 * 5
    assert mean == pytest.approx(float(coeffs @ MU), abs=1e-6)
    assert std == pytest.approx(float(np.sqrt(coeffs @ SIGMA @ coeffs)), abs=1e-6)
    assert 0 < mean < 500
