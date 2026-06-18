# ARGIA Engine — v4.52.0 (Hide the retired INPUT_CFE band, rows 30-37)

Small follow-up to 4.51.0. `retireCfeBillReconstruction(ss)` now also **hides** rows 30-37 after
clearing them, so the empty band disappears between the bill components (row 29) and PV
INTERCONNECTION (row 39).

**Safe:** hiding does not move cells — CFE_SIMULATION's 181 INPUT_CFE-bound formulas and the
INPUT_MAP coords for rows 39+ are untouched — and the layout fingerprint tracks only merges / frozen
panes / title, so the CULLIGAN E2E stays green. Idempotent (re-run still hides). Self-test ALL GREEN.

## Files
```
00a_Version.js                         4.51.0 -> 4.52.0
39_RetireCfeBillReconstruction.js      hide rows 30-37 + rowsHidden in report
CHANGELOG.md / README_4.52.0.md
```

## Deploy
```bash
git pull
unzip -o ~/Downloads/argia_v4.52.0_hide_cfe_band.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'Hide retired INPUT_CFE bill-reconstruction band rows 30-37'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

After deploy, run **Administrator Panel → Repairs → Retire CFE Bill Reconstruction** once more to hide
the band on your live sheet.
