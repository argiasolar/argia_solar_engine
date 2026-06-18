# ARGIA Engine — v4.58.0 (T12-b round 4: synthetic runner runs the full offer pipeline)

The first clean capture exposed a split: **BOM scaled correctly** per fixture (3.78M / 4.55M / 5.48M),
but **every `api.*` value was identical stale CULLIGAN** (864 kWp, project CULLIGAN, 12.84M bill).

Root cause: `runArgiaEngine` writes **MDC + BOM only**. The full offer — financials → **API_OUTPUT** +
SLIDE_DATA — comes from `runClientFinancials`, which `runGenerateAllDeliverables` calls *after* the
engine. The synthetic runner stopped at the engine, so API_OUTPUT kept CULLIGAN's last full run.

## Fix
After a successful engine run, the runner now calls `runClientFinancials(ss, {})` (the core function,
no UI) before capturing, so API_OUTPUT / SLIDE_DATA / financials reflect the current fixture. Capture
also reads MDC directly (`mdc.system_kwp_C15`, `mdc.project_name_C7`) as an independent cross-check.

Self-test ALL GREEN.

## Files
```
00a_Version.js          4.57.0 -> 4.58.0
40_SyntheticE2E.js      runClientFinancials after engine + MDC cross-check
CHANGELOG.md / README_4.58.0.md
```

## Deploy
```bash
git pull
unzip -o ~/Downloads/argia_v4.58.0_T12b_round4.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T12-b round 4: synthetic runner runs full offer pipeline (financials/API_OUTPUT)'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

## Re-capture (one at a time)
Synthetic Test Mode → **Run SYNTH_500**, **Run SYNTH_600**, **Run SYNTH_650** (individually). This
time the three `_SYNTH_CAPTURE` columns should DIFFER:
- `mdc.system_kwp_C15` / `api.system_kwp_dc` ~ 499 / 600 / 650
- `api.project_name` = SYNTH_500 / 600 / 650 (not CULLIGAN)
- fresh `api.cfe_bill_sin_pv_mxn`, capex, payback, NPV per fixture
- `bom.bess_subtotal_F92` = 0 for SYNTH_500; >0 expected for 600/650 (if still 0, the CUSTOM_MANUAL
  BESS spec needs more fields — we'll tackle that next)

Paste `_SYNTH_CAPTURE` back. If the columns differ sensibly, chunk c locks the goldens.
