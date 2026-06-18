# ARGIA Engine — v4.55.0 (T12-b fixes from the first capture run)

The first **Run ALL Synthetic** capture exposed three things; this fixes all three.

1. **`businessType: 'COMPRA'` was invalid** — the dropdown only accepts
   PPA_ROOF / PPA_GROUND / CAPEX_ROOF / CAPEX_GROUND / CARPORT. This is what aborted every fixture at
   "write fixture inputs" before the engine ran. Set to `CAPEX_ROOF`.
2. **Prefill tripwire false positive** — it compared only to `default`, so seeded cells
   (`bessMinAnnualSavingMxn` seed 2000000) looked like leaks. Now accepts `seed` too. The genuine
   leaks (`bessCapacityKwh`, `bessPowerKw`, `cfeKwh*`) are fixed by the 4.54.0 reset.
3. **Progress popup didn't close** — the runner called a non-existent `_hideArgiaProgress`; now uses
   the same `_ARGIA_PROGRESS_EXTERNAL` + terminal `_setArgiaProgress` close as `runCulliganE2E`.

Self-test ALL GREEN.

## Files
```
00a_Version.js                                    4.54.0 -> 4.55.0
tests_regression/synthetic/SyntheticFixtures.gs   businessType -> CAPEX_ROOF
40_SyntheticE2E.js                                seed-aware tripwire + popup close
tests_unit/synthetic/SyntheticE2EHelperTests.gs   seed cases
CHANGELOG.md / README_4.55.0.md
```

## Deploy (both, 4.54.0 then 4.55.0)
```bash
git pull
unzip -o ~/Downloads/argia_v4.54.0_clean_reset.zip -d .
unzip -o ~/Downloads/argia_v4.55.0_T12b_fixes.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'Clean-slate numeric reset on Start New Project + T12-b capture-run fixes'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

## Then re-run the capture
**Administrator Panel → Test → Synthetic Test Mode → Run ALL Synthetic**. This time it should reach
the engine for all three fixtures and write real per-fixture numbers into `_SYNTH_CAPTURE`
(the three columns should now DIFFER — 500/600/650 kWp). The progress popup will close on its own.
Paste `_SYNTH_CAPTURE` back here and I'll review, then chunk c locks the goldens.
