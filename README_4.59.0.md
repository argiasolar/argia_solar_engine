# ARGIA Engine — v4.59.0 (T12-c: lock synthetic structural goldens)

Decision **C**: lock the verified structural chain now; defer synthetic economics to chunk A /
CULLIGAN. The 4.58.0 capture proved sizes/counts/identity/interconnection are correct and distinct
across all three fixtures; the economics (bill/savings/CO2/LCOE/BESS cost) need a fuller input set.

## What's locked (per fixture `goldens`)
- **exact** (pricing-independent): system_kwp_dc, system_kwac, module_qty, inverter_qty,
  modules_per_string, project_name, interconnection_mode, mdc.system_kwp_C15. SYNTH_500 also locks
  `bom.bess_subtotal_F92 = 0` (BESS off).
- **positive** (DB-priced): bom.grand_total_G94, bom.structure_subtotal_F25 — sign/presence only, not
  the peso amount (your no-live-pricing rule). BESS-on fixtures do NOT lock their BESS subtotal.
- **monotonic**: 500 < 600 < 650 for size + DB-priced totals, checked when all three are captured.

## SYNTH_650 correction (a real finding from the capture)
Omitting the `structure` key does NOT yield SIN COTIZAR — roofType prices the structure (RT37 →
19.2/module), so SYNTH_650 is emittable. It's now a third emittable fixture. The
`structure_cost==0 → BLOCKED` rule stays covered by the isolated unit tests (StructureCost /
StatusRules / ProjectStatus). A true blocked-path E2E fixture is deferred.

## Tests
- Live: `REG_SYNTHETIC_GOLDENS` reads `_SYNTH_CAPTURE`, asserts each present column + monotonic.
  Read-only; skips with no workbook (no new ERROR).
- Unit: `UNIT_SYNTHETIC_GOLDENS_WELLFORMED`, `UNIT_SYNTHETIC_GOLDENS_COMPARE`; updated wellformed +
  E2E-helper tests for the 650 correction.
- Pure comparators proven in Node: verified all-3 → 0 failures; planted wrong-kWp → caught.

Self-test ALL GREEN (FAIL 0, unit ERROR 0; workbook-dependent ERRORs unchanged at 56).

## Files
```
00a_Version.js                                    4.58.0 -> 4.59.0
tests_regression/synthetic/SyntheticFixtures.gs   goldens (x3) + 650 correction + 2 pure comparators
tests_regression/synthetic/SyntheticGoldenTests.gs  NEW live reg REG_SYNTHETIC_GOLDENS
tests_unit/synthetic/SyntheticFixtureTests.gs     650 wellformed fix + 2 golden unit tests
tests_unit/synthetic/SyntheticE2EHelperTests.gs   650 helper-case correction
40_SyntheticE2E.js                                runner reports goldens PASS/FAIL
CHANGELOG.md / README_4.59.0.md
```

## Deploy
```bash
git pull
unzip -o ~/Downloads/argia_v4.59.0_T12c_goldens.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T12-c: lock synthetic structural goldens + correct SYNTH_650 + live regression'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

## Verify live
1. Synthetic Test Mode → Run SYNTH_500 / 600 / 650 individually. Each result alert now shows
   `✅ goldens PASS` (or the exact mismatch) right under the capture line.
2. Setup → Run ALL Tests → `REG_SYNTHETIC_GOLDENS` checks the accumulated `_SYNTH_CAPTURE` columns
   against the locked goldens, including the 500<600<650 monotonic check once all three are present.
