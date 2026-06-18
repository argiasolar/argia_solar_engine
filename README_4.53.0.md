# ARGIA Engine — v4.53.0 (T12 · chunk b: live synthetic E2E runner + capture)

The live half of the synthetic launch evidence. `runSyntheticE2E` mirrors the proven `runCulliganE2E`
pattern but proves the engine from a **clean, explicit-input** state, and **captures** the actual
outputs so they can be reviewed before being locked as goldens (chunk c).

## Per fixture
1. snapshot your inputs (restored at the end, even on failure)
2. **DEFAULT rebuild** (`startNewProjectCore`) → blank template, no residue
3. **prefill tripwire** — every engine-consumed numeric input must be blank/default after the rebuild;
   any leftover project value is reported as a leak
4. write the fixture inputs via `writeInput()` only (the INPUT_MAP path)
5. run the engine silently (`runArgiaEngine`)
6. **capture** outputs (API_OUTPUT wholesale + BOM grand/structure/BESS subtotals) into `_SYNTH_CAPTURE`
   and compare to the fixture's declared structural spec (emittable / BESS-off / SIN COTIZAR)
7. restore your inputs (layout invariant verified; auto-repair on drift)

## Menu
**Administrator Panel → Test → Synthetic Test Mode**: Run SYNTH_500 / 600 / 650 / **Run ALL**.

## Tests
`UNIT_SYNTHETIC_E2E_HELPERS` covers the pure decision logic (flatten, blank/default leak test,
structural compare). The runner itself is live-only (like `runCulliganE2E`). Self-test **ALL GREEN**.

## Files
```
00a_Version.js                                    4.52.0 -> 4.53.0
40_SyntheticE2E.js                                NEW  (runner + capture + tripwire)
00_Main.js                                        Synthetic Test Mode submenu
tests_unit/synthetic/SyntheticE2EHelperTests.gs   NEW
CHANGELOG.md / README_4.53.0.md
```

## Deploy
```bash
git pull
unzip -o ~/Downloads/argia_v4.53.0_T12b.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T12-b: live synthetic E2E runner + capture + Synthetic Test Mode menu'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

## After deploy — capture run
Run **Administrator Panel → Test → Synthetic Test Mode → Run ALL Synthetic**. It takes a few minutes
(three full engine runs). When done, open the **`_SYNTH_CAPTURE`** sheet and paste its contents back
here. Watch the alert for:
- **prefill LEAK** lines — would mean Start-New-Project leaves residue (a real finding).
- **structural** notes — would mean a fixture didn't behave as designed (e.g. SYNTH_650 didn't BLOCK,
  or a synthetic input the engine rejected). This is the expected place for input gaps to surface.

I'll review the captured numbers with you, then chunk c locks the sane ones as goldens.
