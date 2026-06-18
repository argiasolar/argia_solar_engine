# ARGIA v4.42.0 — T8: install labor burden factor

Builds on **4.41.0 (T7)** — apply that first. Extract over repo root, then run the deploy block.

## What this does

Adds a configurable **labor burden factor (default 1.65×)** on MH-based install labor, correcting the
understatement of real subcontracted labor cost. **This intentionally moves CULLIGAN's goldens** —
install, CAPEX, and return metrics — all refreshed and validated in this package.

## Files

| Path | Change |
|------|--------|
| `13_CalcInstallCost.js` | `LABOR_BURDEN_DEFAULT=1.65`, `applyLaborBurden()`, `_icResolveLaborBurden()`, wired into `runInstallCost` |
| `tests_unit/calc/InstallLaborBurdenTests.gs` | **NEW** `UNIT_INSTALL_LABOR_BURDEN` (pure) |
| `tests_regression/v2/CulliganBaselineV2Tests.gs` | install G5/G7/G9/G10 + CAPEX D40 refreshed |
| `tests_regression/v2/ClientFinancialsCulliganTests.gs` | CAPEX + payback/ROI/NPV/IRR/LCOE refreshed |
| `00a_Version.js` | 4.41.0 → **4.42.0** |
| `CHANGELOG.md` | 4.42.0 entry (before→after table) |

## Golden refresh (burden 1.65) — validated

LABOR 97,733.27 → **161,259.90**; OTHER 483,378.43 → **488,460.56**; GRAND 747,991.70 →
**816,600.46**; MXN/kWp 866 → **945.14**; CAPEX 37,051,893.49 → **37,120,502.25**; payback 11.0617 →
**11.0780**; NPV −14,170,417.83 → **−14,239,026.56**; IRR 0.04792 → **0.047671**; LCOE 4.2202 →
**4.2280**. EQUIP, savings, and bills unchanged.

Validation: the analytical model reproduces the live insurance/contingency lines exactly (7,938.40 /
35,240.63), and the financial recompute reproduces the **old** payback/NPV/IRR/ROI before applying the
new CAPEX — so the new numbers are exact, not estimates. Self-test ALL GREEN.

## Turning burden off / tuning it

`LABOR_BURDEN_DEFAULT` in `13_CalcInstallCost.js` (1.0 = off). Per-project: set an optional
`laborBurden` cell on `INPUT_INSTALL` (falls back to the constant if absent).

## ⚠ DATA → LATER — your INSTALL_DB edits (NOT in this package)

Both move goldens again; coordinate a second refresh when you apply them.

1. **HD_CRANE re-quote** — `93M_INSTALL_EQUIP_RATES`, `HD_CRANE` row, `MXN_PER_DAY` is **100,000**
   (high; typical 25–50k). Suggested placeholder **37,500**. CULLIGAN's BESS crane (`BESS-I-04`) uses
   it, so G6/EQUIP moves. One-cell edit.
2. **94M benchmark table** — `94M_INSTALL_BENCHMARKS` is a project-log layout today, not a
   min/typical/high `$/kWp` table. T10 needs that table; we should agree its structure + seed values
   first. Parked for your call.

## After deploy — expected E2E

CULLIGAN E2E should be **green at the new goldens** (install, CAPEX, financials all pre-refreshed). If
any number is off, send me `_TEST_RESULTS_V2` and I'll reconcile — but the math is validated, so it
should land clean.

---

## Deploy (GitHub + clasp)

```bash
git pull
unzip -o ~/Downloads/argia_v4.42.0_T8.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T8: labor burden factor x1.65 on MH-based install labor; CULLIGAN goldens refreshed + validated'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

> A version MISMATCH right after push is the Apps Script CDN cache — wait ~5 min and re-run verify.
