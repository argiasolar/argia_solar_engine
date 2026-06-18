# ARGIA Engine — v4.48.0 (T11b: provenance notes on CFE_OUTPUT headline figures)

Second slice of **T11 — MDC traceability for all outputs**. Applies the provenance helper to the
CFE_OUTPUT_v2 headline recibo tiles. Notes only — **no values move.**

---

## Finding first: MDC is already traced

Before adding anything, two of the plan's named surfaces turned out to already carry provenance:

- **MDC_v2** stamps a **FORMULA + CITATION column** on every figure via its `row()` helper — native
  per-figure traceability. Adding hover-notes would duplicate it, so MDC is intentionally left as-is.
- **CFE_OUTPUT_v2** already has a summary provenance line + the `CFE_OUT_SRC_V2` source map.

So the non-redundant gap was *per-figure* provenance on CFE_OUTPUT's three client-facing money tiles
(they only had the one summary line). That's what T11b adds.

## What's new — `writers_v2/WriteCfeOutputV2.js`

Provenance notes on the three headline KPI tiles (row `KPI_HEADLINE`, cols 2 / 7 / 12):

| Tile | Source (per `CFE_OUT_SRC_V2`) |
|---|---|
| Recibo anual SIN PV | `BESS_SIMULATION!D12` |
| Recibo anual CON PV | `BESS_SIMULATION!D14` |
| Recibo anual CON PV + BESS | `BESS_SIMULATION!D18` |

Stamped via the guarded `stampProvenanceNote`.

## Tests

- `REG_PROVENANCE_CFE_OUTPUT_CULLIGAN` (live) — after a CULLIGAN run, the three recibo tiles carry the
  expected provenance notes (label + cited source cell + engine version).

Self-test: **ALL GREEN**, 0 Unit FAIL / 0 Unit ERROR. Workbook-dependent 54 → **55** (+1 live REG).

## T11 status

| Surface | State |
|---|---|
| CLIENT_FINANCIALS headline | shipped (4.47.0) |
| CFE_OUTPUT headline | **shipped (this)** |
| MDC_v2 | already traced (formula/citation columns) |
| BOM_v2 / FINANCE | already traced (NOM refs + traces / 4.32 notes) |
| SLIDE_DATA | **blocked** — SLIDE_DATA rebuild (stale tab, parked) |

---

## Files

```
00a_Version.js                                      4.47.0 -> 4.48.0
writers_v2/WriteCfeOutputV2.js                      + provenance notes on 3 headline tiles
tests_regression/v2/ProvenanceCulliganTests.gs      + REG_PROVENANCE_CFE_OUTPUT_CULLIGAN
CHANGELOG.md / README_4.48.0.md
```

## Deploy

```bash
git pull
unzip -o ~/Downloads/argia_v4.48.0_T11b.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T11b: provenance notes on CFE_OUTPUT headline recibo tiles'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then run the CULLIGAN E2E. Expected: **still all-green** plus the new CFE_OUTPUT provenance assertion.
No financial goldens move — these are cell notes.
