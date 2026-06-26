"""Integration tests for the HTTP API. Requires the ETL artifacts in data/."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import MODEL_STATS_PATH, PROGRAM_WEIGHTS_PATH
from app.main import app

pytestmark = pytest.mark.skipif(
    not (MODEL_STATS_PATH.exists() and PROGRAM_WEIGHTS_PATH.exists()),
    reason="ETL artifacts not found; run services/etl/etl.py first.",
)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["programs"] >= 1


def test_list_programs_includes_medicina(client):
    r = client.get("/api/programs")
    assert r.status_code == 200
    names = [p["programa"] for p in r.json()]
    assert "Medicina" in names


def test_estimate_roundtrip(client):
    r = client.post(
        "/api/estimate",
        json={"programa": "Medicina", "puntaje": 70.0, "poblacion": "nacional", "alternativas": 5},
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body["mas_probable"]["areas"]) == {
        "lectura_critica", "matematicas", "sociales_ciudadanas", "c_naturales", "ingles",
    }
    # The most-probable vector reproduces the target ponderado within rounding.
    assert abs(body["mas_probable"]["ponderado_recalculado"] - 70.0) <= 1.0
    assert 0 <= body["mas_probable"]["global_estimado"] <= 500
    assert len(body["alternativas"]) >= 1
    # Population reference data for charts/percentiles.
    assert set(body["poblacion_stats"]) == {
        "lectura_critica", "matematicas", "sociales_ciudadanas", "c_naturales", "ingles",
    }
    lc = body["poblacion_stats"]["lectura_critica"]
    assert lc["std"] > 0 and 0 <= lc["percentil"] <= 100
    gs = body["global_stats"]
    assert 0 < gs["mean"] < 500 and gs["std"] > 0 and 0 <= gs["percentil"] <= 100
    assert len(body["correlaciones"]) >= 1
    assert -1.0 <= body["correlaciones"][0]["r"] <= 1.0


def test_estimate_unknown_program_404(client):
    r = client.post("/api/estimate", json={"programa": "Nigromancia", "puntaje": 60})
    assert r.status_code == 404


def test_estimate_score_out_of_range_422(client):
    r = client.post("/api/estimate", json={"programa": "Medicina", "puntaje": 130})
    assert r.status_code == 422


def test_forward_example_student(client):
    r = client.post(
        "/api/forward",
        json={
            "scores": {
                "lectura_critica": 77, "matematicas": 72, "sociales_ciudadanas": 65,
                "c_naturales": 72, "ingles": 61,
            },
            "programa": "Medicina",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["global_score"] == 353
    assert body["ponderado"] == pytest.approx(69.95, abs=1e-6)
