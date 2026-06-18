# ARGIA Engine — v4.47.0 (T11a: output-provenance helper + CLIENT_FINANCIALS notes)

First slice of **T11 — MDC traceability for all outputs**. Generalizes the FINANCE 4.32 provenance
pattern into a reusable helper and applies it to the CLIENT_FINANCIALS headline metrics. Notes only —
**no values move.**

---

## What's new

**`37_CalcProvenance.js`** — reusable helper.

- `buildProvenanceNote(rec)` (pure): `{label, formula, sources, version, date}` → ASCII-safe Spanish
  note:
  ```
  TRAZABILIDAD: VPN
  Calculo: VPN(WACC; flujos netos) - CAPEX
  Fuente: INPUT_BAAS!D15 (WACC), flujos netos
  Motor v4.47.0 - 2026-06-18
  ```
  Empty fields are omitted; an empty record yields `''` (no bare version-only note); `version` falls
  back to `ENGINE_VERSION`.
- `stampProvenanceNote(rng, rec)` (live, guarded): `typeof rng.setNote === 'function'` guard so
  unit-test mock ranges never throw.

**`writers_v2/WriteClientFinancialsV2.js`** — stamps provenance notes on the 10 headline KPI value
cells (Ahorro Año 1, demanda, CAPEX, payback, descontada, ROI, VPN, TIR, LCOE, ahorro total).

## Tests

- `UNIT_PROVENANCE_NOTE` — exact note for a full record · string-vs-array sources · version fallback ·
  omitted lines · empty/null → `''` · stamp guard (mock w/o setNote → false; capturing mock → true +
  exact content).
- `REG_PROVENANCE_CULLIGAN` (live) — after a CULLIGAN run, payback / VPN / LCOE cells carry the
  expected provenance notes (label + derivation + sources + version).

Self-test: **ALL GREEN**, 0 Unit FAIL / 0 Unit ERROR. Workbook-dependent 53 → **54** (+1 live REG).

## T11 rollout (follow-up chunks)

| Surface | State |
|---|---|
| CLIENT_FINANCIALS headline | **shipped (this)** |
| MDC_v2 key figures | T11b |
| CFE_OUTPUT_v2 key figures | T11b |
| SLIDE_DATA key figures | T11c |

The helper is the reusable core; remaining surfaces are mechanical applications using the same
`stampProvenanceNote(range, record)` call.

---

## Files

```
00a_Version.js                                      4.46.0 -> 4.47.0
37_CalcProvenance.js                                NEW  (buildProvenanceNote + stampProvenanceNote)
writers_v2/WriteClientFinancialsV2.js               + provenance notes on 10 KPI cells
tests_unit/calc/ProvenanceTests.gs                  NEW
tests_regression/v2/ProvenanceCulliganTests.gs      NEW
CHANGELOG.md / README_4.47.0.md
```

## Deploy

```bash
git pull
unzip -o ~/Downloads/argia_v4.47.0_T11a.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T11a: reusable output-provenance helper + CLIENT_FINANCIALS headline notes'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then run the CULLIGAN E2E. Expected: **still all-green** plus the new provenance assertions (helper
unit + notes land on the financials cells). No financial goldens move — these are cell notes.
