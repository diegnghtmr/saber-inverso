# Saber Inverso — Estimador de puntajes Saber 11

Dado el **puntaje de admisión (ponderado)** de un programa de la **Universidad del
Quindío**, este sistema estima las **notas por área del Saber 11 más probables**
que producen ese puntaje, junto con alternativas ordenadas por probabilidad y un
margen de incertidumbre honesto por área.

Es la **ingeniería inversa** del simulador oficial de ponderados de la UQ, apoyada
en la distribución conjunta real de los datos abiertos del ICFES.

---

## El problema y cómo se resuelve

Hay **dos puntajes distintos** y conviene no confundirlos:

| Puntaje | Escala | Fórmula |
|---|---|---|
| **Global ICFES** | 0–500 | `round( ((3·LC + 3·MAT + 3·SOC + 3·CN + 1·ING) / 13) · 5 )` (Res. ICFES 268/2020) |
| **Ponderado UQ** | 0–100 | `Σ wᵢ · áreaᵢ`, con pesos `wᵢ` propios de cada programa (suman 1) |

El ponderado es una **combinación lineal** de las 5 áreas. Recuperar las 5 áreas a
partir de un solo número es un **problema inverso indeterminado** (1 ecuación, 5
incógnitas): infinitas combinaciones dan el mismo ponderado.

Lo volvemos bien planteado modelando la población de puntajes como una **normal
multivariada** `s ~ N(μ, Σ)` estimada con microdatos reales del ICFES. Condicionar
una gaussiana a una combinación lineal tiene **forma cerrada**:

```
s*   = μ + Σw (wᵀΣw)⁻¹ (P − wᵀμ)        → combinación MÁS probable
Cov  = Σ − Σw wᵀΣ / (wᵀΣw)              → genera las alternativas e incertidumbre
```

La covarianza condicional es degenerada con `w` en su núcleo, así que toda muestra
respeta `wᵀs = P` exactamente (salvo redondeo a enteros). Las alternativas son los
puntos enteros más probables sobre ese hiperplano, ordenados por distancia de
Mahalanobis.

### Validación (sobre datos reales)

- **Estudiante de ejemplo** (LC 77, MAT 72, SOC 65, CN 72, ING 61 → global 353):
  invirtiendo el ponderado de Medicina, el global estimado es **351 vs 353 real**
  (error de 2 puntos); MAE por área ≈ 4.6.
- **Round-trip masivo** (20 000 estudiantes reales, Medicina): residuo medio ≈ **0.00**
  (estimador insesgado) y **RMSE ≈ desviación condicional** por área → el modelo
  captura la dispersión real. Incertidumbre típica: **±4 a ±7 puntos** por área.

---

## Arquitectura

```
┌─────────────┐     /api (proxy)     ┌──────────────┐     lee     ┌──────────┐
│  web (Astro)│ ───────────────────▶ │ api (FastAPI)│ ──────────▶ │  ./data  │
│  nginx:80   │                      │  numpy/scipy │             │  *.json  │
└─────────────┘                      └──────────────┘             └────▲─────┘
                                                                       │ escribe
                                                          ┌────────────┴───────┐
                                                          │  etl (one-shot)    │
                                                          │  Socrata + Excel   │
                                                          └────────────────────┘
```

- **`services/etl`** — descarga microdatos Saber 11 (Socrata `kgxf-xxbe`), castea,
  limpia y calcula `μ`/`Σ` por población (nacional y Quindío); parsea los pesos por
  programa desde el Excel oficial. Produce `data/model_stats.json` y
  `data/program_weights.json`.
- **`services/api`** — FastAPI. Capa de dominio pura (`app/domain`: solver + repos,
  solo numpy) separada de la capa HTTP. Resuelve la inversión y sirve el contrato.
- **`web`** — Astro 5 (estático) servido por nginx, que además hace de reverse proxy
  hacia la API (el navegador habla mismo-origen, sin CORS).

---

## Datos y licencia

Fuente: **ICFES — Saber 11**, dataset abierto *“Resultados únicos Saber 11”*
([`kgxf-xxbe`](https://www.datos.gov.co/Educaci-n/Resultados-nicos-Saber-11/kgxf-xxbe))
en datos.gov.co. Licencia **CC BY-SA 4.0**: se atribuye al ICFES y cualquier obra
derivada debe compartirse bajo la misma licencia.

Periodos usados (formato 2014-2 en adelante): `20142, 20152, 20162, 20172, 20194, 20224`.

---

## Cómo correrlo

Requisitos: Docker + Docker Compose.

```bash
cd saber-inverso
cp env.example .env          # opcional, ajusta WEB_PORT / población por defecto
docker compose up --build
```

Abrí **http://localhost:8080**. El repo ya incluye los artefactos calculados en
`data/`, así que funciona sin internet.

### Refrescar los datos (opcional, requiere internet)

```bash
docker compose --profile etl run --rm etl   # vuelve a bajar y recalcular μ/Σ
docker compose up -d --build api web
```

---

## Desarrollo local (sin Docker)

**API:**
```bash
cd services/api
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000      # docs: http://localhost:8000/docs
pytest                                          # corre los tests
```

**Web:**
```bash
cd web
npm install
PUBLIC_API_BASE=http://localhost:8000 npm run dev   # http://localhost:4321
```

**Recalcular artefactos:**
```bash
cd services/etl
pip install -r requirements.txt
python etl.py            # escribe en ../../data
python validate_poc.py   # round-trip de validación (opcional)
```

---

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET  | `/health` | Estado + metadatos del dataset |
| GET  | `/api/areas` | Áreas (clave + etiqueta) |
| GET  | `/api/populations` | Poblaciones disponibles y su `n` |
| GET  | `/api/programs` | Programas con sus pesos por área |
| POST | `/api/estimate` | Invierte un ponderado → más probable + alternativas |
| POST | `/api/forward` | Calcula ponderado y global desde 5 notas (utilidad/validación) |

Ejemplo:
```bash
curl -s localhost:8000/api/estimate -H 'content-type: application/json' \
  -d '{"programa":"Medicina","puntaje":70,"poblacion":"quindio","alternativas":6}'
```

---

## Estructura

```
saber-inverso/
├── docker-compose.yml
├── data/                      # artefactos (committeados); data/raw/ es caché (ignorado)
├── source/                    # Excel oficial de ponderados (entrada del ETL)
├── services/
│   ├── etl/                   # extract.py + validación PoC
│   └── api/                   # FastAPI: app/domain (solver puro) + app (HTTP) + tests
└── web/                       # Astro + nginx
```

---

## Limitaciones

- Los puntajes son enteros y la distribución no es perfectamente normal; la
  reconstrucción tiene un margen de **±1–2 puntos** además de la incertidumbre
  estadística por área. Es una **estimación, no el resultado real** del estudiante.
- Los microdatos públicos llegan hasta **2022**; 2023/2024 solo existen agregados.
- Programas a distancia o modalidades que no estén en el Excel de ponderados no se
  pueden invertir (no hay vector de pesos).
- Estudiantes con **exención de inglés** usan otra fórmula; fuera de alcance de v1.

> Herramienta ilustrativa, sin afiliación oficial con el ICFES ni con la
> Universidad del Quindío.
