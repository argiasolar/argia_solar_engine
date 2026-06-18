# ARGIA v4.41.0 — T7: structure cost engine + roof-type pricelist

Builds on **4.40.0 (T6)** — apply that first. Extract over repo root, then run the deploy block at the
bottom.

## What this does

Structure cost is now `system_kWp × roof_factor($/kWp)`, with the factor from a configurable pricelist
keyed on roof type — replacing the per-product (`USD/panel`) lookup as the cost source. A roof type
with no factor surfaces as **SIN COTIZAR** (feeds T9/T10). **CULLIGAN is unchanged**: the KR18 factor
is calibrated to the existing 24,300 USD baseline.

## Files

| Path | Change |
|------|--------|
| `34_CalcStructureCost.js` | **NEW** pure engine: `STRUCTURE_PRICELIST`, `canonicalRoofType`, `calcStructureCost` |
| `writers_v2/WriteBomV2.js` | §3 structure cost sourced from the pricelist (name still from the product resolver) |
| `tests_unit/calc/StructureCostTests.gs` | **NEW** `UNIT_STRUCTURE_COST_PRICELIST` |
| `tests_regression/v2/StructureCostCulliganTests.gs` | **NEW** `REG_STRUCTURE_COST_CULLIGAN` |
| `tests_unit/writers_v2/WriteBomV2Tests.gs` | updated 2 structure tests for the new source/trigger |
| `00a_Version.js` | 4.40.0 → **4.41.0** |
| `CHANGELOG.md` | 4.41.0 entry |

## Preserved on CULLIGAN

Engine `usdTotal` = 24,300 · per-panel = 18.0 · BOM `F25` = 24,300 · Project Card `C33` = 24,300.
CAPEX unmoved. Self-test ALL GREEN (Unit FAIL 0, ERROR 0, 49 workbook-dependent).

## ⚠ Two things I inferred — please confirm

1. **Roof taxonomy map** (`ROOF_TYPE_ALIASES` in `34_CalcStructureCost.js`):
   `Standing-Seam→KR18, Concrete→RT37, Ballasted→FLAT, Ground→OTHER`. This is a **guess** — I don't
   know which code is which physical system. Correct me and I'll update it.
2. **Placeholder $/kWp** for `TR36 / RT37 / FLAT`. KR18 is calibrated (not quoted). Replace these with
   real supplier quotes when you have them; replacing KR18 will move the CULLIGAN structure golden by
   design (acknowledge then).

The pricelist is a code constant (version-controlled, testable, with `Quote_Date`); it can be promoted
to an editable sheet later if you'd rather the team maintain it in the workbook.

## After deploy

Run **Generate MDC and BOM** (or the CULLIGAN E2E). Structure cost is identical; the BOM structure
note now cites the pricelist source. A project on an unpriced roof type shows SIN COTIZAR.

---

## Deploy (GitHub + clasp)

```bash
git pull
unzip -o ~/Downloads/argia_v4.41.0_T7.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T7: structure cost from roof-type kWp pricelist; SIN COTIZAR on unpriced roof; CULLIGAN preserved'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

> A version MISMATCH right after push is the Apps Script CDN cache — wait ~5 min and re-run verify.
