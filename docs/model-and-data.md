# Model and data preparation

## From a weighted target to subject scores

The five Saber 11 areas are Critical Reading (`LC`), Mathematics (`MAT`), Social and Citizenship (`SOC`), Natural Sciences (`CN`), and English (`ING`). ICFES Resolution 268/2020 gives the global-score formula on a 0–500 scale. The Universidad del Quindío weighted score is a different quantity on a 0–100 scale, with one normalized weight vector `w` per program.

One weighted score is one equation in five scores. The estimator models historical score vectors as a multivariate normal with mean `μ` and covariance `Σ`, then conditions on the requested weighted total `P`:

```text
s*  = μ + Σw (wᵀΣw)⁻¹ (P − wᵀμ)
Cov = Σ − Σw wᵀΣ / (wᵀΣw)
```

The conditional covariance has `w` in its null space. Continuous draws satisfy the weighted constraint before scores are converted into bounded integers. The solver ranks candidates near the target by Mahalanobis distance; integer rounding can leave a residual. The population model is an approximation and cannot recover an individual's actual result or tell them whether they will be admitted. Programs with no weight vector and applicants with an English exemption are not supported.

## Source and validation

The ETL reads the ICFES open-data dataset [`kgxf-xxbe`](https://www.datos.gov.co/Educaci-n/Resultados-nicos-Saber-11/kgxf-xxbe) (CC BY-SA 4.0) and the university's simulator workbook. The bundled statistics cover periods `20142`, `20152`, `20162`, `20172`, `20194`, and `20224`. The older project notes describe later years as available only in aggregate; the bundled artifacts do not include later individual records.

A documented Medicine example used area scores 77, 72, 65, 72, and 61. The actual global score was 353, and inversion estimated 351 (mean absolute area error about 4.6). The original project's Medicine round-trip experiment used 20,000 records and reported a near-zero average residual, with area RMSE near the corresponding conditional standard deviations (roughly 4–7 points of spread). These are historical validation results for that population and program, not accuracy guarantees. See [the validation script](../services/etl/validate_poc.py) for the computation.

## Refresh the model (optional)

The [Compose configuration](../docker-compose.yml) defines the one-shot ETL profile. Refreshing requires internet access for Socrata and a local copy of the university workbook at `source/Simulador Pruebas 2014-2 en adelante.xlsx`. The workbook is not checked in. The job replaces the two model JSON files under `data/`; review the changes before using them. The web and API builds alone do not refresh source data.

```sh
docker compose --profile etl run --rm etl
docker compose up -d --build api web
```

Outside Docker, from `services/etl/`, install with `python -m pip install -r requirements.txt`, run `python etl.py`, and optionally run `python validate_poc.py` against the source data. Use `ICFES_XLSX_PATH` and `ICFES_DATA_DIR` to choose non-default input and output paths.
