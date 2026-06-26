"""Runtime configuration, resolved from environment variables."""
from __future__ import annotations

import os
from pathlib import Path

# In Docker the data volume is mounted at /data (see docker-compose.yml) and
# ICFES_DATA_DIR is set explicitly. Locally we fall back to the repo's data
# directory produced by the ETL. The fallback is computed lazily so it never
# breaks in a shallow container path where parents[3] would not exist.
_env_data_dir = os.environ.get("ICFES_DATA_DIR")
DATA_DIR = Path(_env_data_dir) if _env_data_dir else Path(__file__).resolve().parents[3] / "data"
MODEL_STATS_PATH = DATA_DIR / "model_stats.json"
PROGRAM_WEIGHTS_PATH = DATA_DIR / "program_weights.json"

DEFAULT_POPULATION = os.environ.get("ICFES_DEFAULT_POPULATION", "quindio")
DEFAULT_ALTERNATIVES = int(os.environ.get("ICFES_DEFAULT_ALTERNATIVES", "6"))

# Comma-separated list of allowed CORS origins for the Astro frontend.
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get("ICFES_CORS_ORIGINS", "http://localhost:4321,http://localhost:3000").split(",")
    if o.strip()
]
