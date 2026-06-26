"""
ICFES Saber 11 — ETL for the inverse-score estimator.

Produces two artifacts consumed by the API:
  - model_stats.json    : mean vector (mu), covariance (Sigma), correlation and
                          std per area, for each population (nacional, quindio).
  - program_weights.json: Universidad del Quindio per-program weight vectors,
                          parsed from the official "Simulador" workbook.

Data source (verified): datos.gov.co Socrata dataset "Resultados unicos Saber 11"
(kgxf-xxbe), CC BY-SA 4.0. All punt_* fields are stored as TEXT and must be cast.
Server-side aggregates time out over the full set, so we sample and aggregate
locally with pandas.
"""
from __future__ import annotations

import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import openpyxl
import pandas as pd

# --- Configuration -----------------------------------------------------------

DATASET_ID = "kgxf-xxbe"
RESOURCE_URL = f"https://www.datos.gov.co/resource/{DATASET_ID}.json"

# Canonical area order — MUST stay consistent across the whole system.
AREAS = ["lectura_critica", "matematicas", "sociales_ciudadanas", "c_naturales", "ingles"]
SOCRATA_FIELD = {a: f"punt_{a}" for a in AREAS}

# New-format (2014-2 onward) large administrations, recent first.
PERIODS = ["20224", "20194", "20172", "20162", "20152", "20142"]
NATIONAL_CAP_PER_PERIOD = int(os.environ.get("ICFES_NATIONAL_CAP", "25000"))

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("ICFES_DATA_DIR", PROJECT_ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
DEFAULT_XLSX = PROJECT_ROOT.parent / "Simulador Pruebas 2014-2 en adelante.xlsx"
XLSX_PATH = Path(os.environ.get("ICFES_XLSX_PATH", DEFAULT_XLSX))

_SSL = ssl.create_default_context()


# --- Socrata fetch -----------------------------------------------------------

def soql(params: dict, tries: int = 6, timeout: int = 120) -> list[dict]:
    """Run a SoQL query with retries/backoff. Returns the JSON rows."""
    qs = urllib.parse.urlencode(params)
    url = f"{RESOURCE_URL}?{qs}"
    last: Exception | None = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "icfes-etl/1.0"})
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:  # 4xx/5xx — don't retry blindly
            body = exc.read().decode("utf-8", "replace")
            raise RuntimeError(f"Socrata HTTP {exc.code}: {body[:300]}") from exc
        except Exception as exc:  # transient (DNS, timeout) — back off and retry
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Socrata request failed after {tries} tries: {last}")


def fetch_population(name: str, where_extra: str, cap_per_period: int | None) -> pd.DataFrame:
    """Fetch the 5 area scores + global for a population, cached to disk."""
    cache = RAW_DIR / f"{name}.csv.gz"
    if cache.exists():
        print(f"  [{name}] using cache {cache}")
        return pd.read_csv(cache, dtype=str)

    select = ",".join(list(SOCRATA_FIELD.values()) + ["punt_global", "periodo"])
    frames: list[pd.DataFrame] = []
    for period in PERIODS:
        where = f"periodo='{period}'"
        if where_extra:
            where += f" AND {where_extra}"
        params = {"$select": select, "$where": where}
        if cap_per_period:
            params["$limit"] = str(cap_per_period)
        else:
            params["$limit"] = "50000"
        rows = soql(params)
        print(f"  [{name}] periodo {period}: {len(rows)} rows")
        if rows:
            frames.append(pd.DataFrame(rows))
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(cache, index=False, compression="gzip")
    return df


# --- Cleaning + stats --------------------------------------------------------

def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Cast text -> numeric, drop invalid rows, keep scores in [0, 100]."""
    cols = list(SOCRATA_FIELD.values())
    out = df.copy()
    for col in cols:
        out[col] = pd.to_numeric(out[col], errors="coerce")
    out = out.dropna(subset=cols)
    mask = np.ones(len(out), dtype=bool)
    for col in cols:
        mask &= out[col].between(0, 100)
    out = out[mask]
    # Rename to canonical area keys for downstream clarity.
    return out.rename(columns={SOCRATA_FIELD[a]: a for a in AREAS})[AREAS]


def compute_stats(df: pd.DataFrame) -> dict:
    matrix = df[AREAS].to_numpy(dtype=float)
    mean = matrix.mean(axis=0)
    cov = np.cov(matrix, rowvar=False)  # 5x5, sample covariance
    std = matrix.std(axis=0, ddof=1)
    corr = np.corrcoef(matrix, rowvar=False)
    return {
        "n": int(len(df)),
        "areas": AREAS,
        "mean": {a: round(float(mean[i]), 4) for i, a in enumerate(AREAS)},
        "std": {a: round(float(std[i]), 4) for i, a in enumerate(AREAS)},
        "cov": [[round(float(cov[i, j]), 6) for j in range(5)] for i in range(5)],
        "corr": [[round(float(corr[i, j]), 6) for j in range(5)] for i in range(5)],
    }


# --- Excel weights -----------------------------------------------------------

def parse_weights(xlsx_path: Path) -> dict:
    """Read the per-program weight vectors from the 'Ponderados' sheet."""
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb["Ponderados"]
    # Columns: B=facultad C=programa D=LC E=MAT F=SOC G=CN H=ING ; data rows 16..46
    programs = []
    for row in range(16, ws.max_row + 1):
        programa = ws.cell(row=row, column=3).value
        if not programa:
            continue
        weights = {
            "lectura_critica": ws.cell(row=row, column=4).value,
            "matematicas": ws.cell(row=row, column=5).value,
            "sociales_ciudadanas": ws.cell(row=row, column=6).value,
            "c_naturales": ws.cell(row=row, column=7).value,
            "ingles": ws.cell(row=row, column=8).value,
        }
        if any(v is None for v in weights.values()):
            continue
        weights = {k: round(float(v), 6) for k, v in weights.items()}
        total = round(sum(weights.values()), 6)
        programs.append({
            "facultad": ws.cell(row=row, column=2).value,
            "programa": str(programa).strip(),
            "weights": weights,
            "weight_sum": total,
        })
    return {"areas": AREAS, "programs": programs}


# --- Main --------------------------------------------------------------------

def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Data dir: {DATA_DIR}")

    print("Fetching national sample...")
    nac_raw = fetch_population("nacional", "", NATIONAL_CAP_PER_PERIOD)
    print("Fetching Quindio...")
    qui_raw = fetch_population("quindio", "cole_depto_ubicacion='QUINDIO'", None)

    nac = clean(nac_raw)
    qui = clean(qui_raw)
    print(f"Clean rows -> nacional={len(nac)}  quindio={len(qui)}")

    stats = {
        "dataset": DATASET_ID,
        "license": "CC BY-SA 4.0",
        "periods": PERIODS,
        "areas": AREAS,
        "populations": {
            "nacional": compute_stats(nac),
            "quindio": compute_stats(qui),
        },
        "global_formula": {
            "weights": {"lectura_critica": 3, "matematicas": 3, "sociales_ciudadanas": 3,
                        "c_naturales": 3, "ingles": 1},
            "denominator": 13,
            "scale": 5,
            "note": "Global = round(((3*LC+3*MAT+3*SOC+3*CN+1*ING)/13)*5). Res. ICFES 268/2020.",
        },
    }
    (DATA_DIR / "model_stats.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote model_stats.json (nacional n={stats['populations']['nacional']['n']}, "
          f"quindio n={stats['populations']['quindio']['n']})")

    weights = parse_weights(XLSX_PATH)
    (DATA_DIR / "program_weights.json").write_text(json.dumps(weights, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote program_weights.json ({len(weights['programs'])} programs)")


if __name__ == "__main__":
    main()
