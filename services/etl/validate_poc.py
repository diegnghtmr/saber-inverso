"""
Proof-of-concept validation of the Gaussian conditional inverse, against:
  1) the real example student (registro AC202242401636), and
  2) a mass round-trip over the national microdata sample.

Run after etl.py. This is throwaway PoC validation; the production solver
lives in services/api/app/domain.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

AREAS = ["lectura_critica", "matematicas", "sociales_ciudadanas", "c_naturales", "ingles"]
DATA = Path(__file__).resolve().parents[2] / "data"

stats = json.load(open(DATA / "model_stats.json", encoding="utf-8"))
weights = json.load(open(DATA / "program_weights.json", encoding="utf-8"))
W = {p["programa"]: np.array([p["weights"][a] for a in AREAS]) for p in weights["programs"]}

pop = stats["populations"]["nacional"]
mu = np.array([pop["mean"][a] for a in AREAS])
Sigma = np.array(pop["cov"])


def invert(P, w, mu, Sigma):
    Sw = Sigma @ w
    denom = float(w @ Sw)
    s_star = mu + Sw * ((P - float(w @ mu)) / denom)
    cond_cov = Sigma - np.outer(Sw, Sw) / denom
    return s_star, cond_cov


def global_score(s):
    gw = np.array([3, 3, 3, 3, 1])
    return round(float((gw @ s) / 13 * 5))


# --- 1) Example student ------------------------------------------------------
true = np.array([77, 72, 65, 72, 61])  # LC, MAT, SOC, CN, ING  (from the PDF)
print("=" * 70)
print("EXAMPLE STUDENT  true =", dict(zip(AREAS, true)), " global =", global_score(true))
print("=" * 70)
for prog in ["Medicina", "Ingeniería de Sistemas y Computación", "Licenciatura en Matemáticas"]:
    w = W[prog]
    P = float(w @ true)
    s_star, cc = invert(P, w, mu, Sigma)
    pred = np.clip(np.round(s_star), 0, 100).astype(int)
    cond_sd = np.sqrt(np.diag(cc))
    err = pred - true
    print(f"\n{prog}  ->  ponderado P = {P:.3f}")
    print(f"  pred   : {dict(zip(AREAS, pred.tolist()))}")
    print(f"  err    : {dict(zip(AREAS, err.tolist()))}  (MAE {np.abs(err).mean():.1f})")
    print(f"  cond_sd: {dict(zip(AREAS, np.round(cond_sd,1).tolist()))}  (uncertainty per area)")
    print(f"  global : pred {global_score(pred)} vs true 353   |  recompute P from pred = {float(w@pred):.2f}")


# --- 2) Mass round-trip over national sample --------------------------------
df = pd.read_csv(DATA / "raw" / "nacional.csv.gz", dtype=str)
for a in AREAS:
    df[a] = pd.to_numeric(df[f"punt_{a}"], errors="coerce")
df = df.dropna(subset=AREAS)
X = df[AREAS].to_numpy(float)
X = X[((X >= 0) & (X <= 100)).all(axis=1)]
rng = np.random.default_rng(42)
X = X[rng.choice(len(X), size=20000, replace=False)]

print("\n" + "=" * 70)
print("MASS ROUND-TRIP (Medicina, n=20000 real students)")
print("=" * 70)
w = W["Medicina"]
P = X @ w
Sw = Sigma @ w
denom = float(w @ Sw)
# vectorized conditional mean: s*_k = mu + Sw * (P_k - w.mu)/denom
S_star = mu[None, :] + ((P - float(w @ mu)) / denom)[:, None] * Sw[None, :]
resid = S_star - X
cc = Sigma - np.outer(Sw, Sw) / denom
cond_sd = np.sqrt(np.diag(cc))
print(f"{'area':>20} {'mean_resid':>11} {'MAE':>7} {'RMSE':>7} {'cond_sd':>8}")
for i, a in enumerate(AREAS):
    print(f"{a:>20} {resid[:,i].mean():>11.2f} {np.abs(resid[:,i]).mean():>7.2f} "
          f"{np.sqrt((resid[:,i]**2).mean()):>7.2f} {cond_sd[i]:>8.2f}")
print("\nInterpretation: mean_resid≈0 => unbiased. RMSE≈cond_sd => the Gaussian")
print("conditional captures the real spread. cond_sd is the honest +/- per area.")
