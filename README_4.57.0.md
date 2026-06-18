# ARGIA Engine — v4.57.0 (T12-b round 3: fixture input completeness)

Third capture run found two more input gaps. Both fixed in the fixtures (no engine changes).

1. **`[INP-06] No inverters defined`** blocked SYNTH_600/650. The fixtures set inverter qty/kw/strings
   but omitted the model, so validation saw no inverter. Added `inverterPrimaryModel:
   'SUN2000-100KTL-M1'` (CULLIGAN's 100 kW inverter) to all three.
2. **BESS on/off.** `bessStrategy` is a policy, not a switch — `'NONE'` is invalid (aborted SYNTH_500).
   BESS is gated by `installBattery = 'YES'` AND `bessCapacityKwh > 0`. So:
   - SYNTH_500 (off): `installBattery: 'NO'`, no strategy.
   - SYNTH_600 (on): `installBattery YES`, `CUSTOM_MANUAL`, 1000 kWh / 500 kW, PEAK_SHAVING.
   - SYNTH_650 (on): `installBattery YES`, `CUSTOM_MANUAL`, 1200 kWh / 600 kW, LOAD_SHIFTING.

`[HEL-02]` (Helioscope generation) and `[FX-01]` are non-blocking warnings; silent mode continues past
them. Self-test ALL GREEN.

## Files
```
00a_Version.js                                    4.56.0 -> 4.57.0
tests_regression/synthetic/SyntheticFixtures.gs   inverter model + BESS toggle/spec
tests_unit/synthetic/SyntheticFixtureTests.gs     SYNTH_500 BESS-off assertion
CHANGELOG.md / README_4.57.0.md
```

## Deploy
```bash
git pull
unzip -o ~/Downloads/argia_v4.57.0_T12b_round3.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T12-b round 3: fixture inverter model + BESS toggle/spec completeness'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

## Then capture, one fixture at a time
Synthetic Test Mode → **Run SYNTH_500**, then **Run SYNTH_600**, then **Run SYNTH_650** (individually;
each fits the 6-min cap and adds its column to `_SYNTH_CAPTURE`). All three should now reach the engine
and complete. Paste `_SYNTH_CAPTURE` back here — the three columns should differ (500/600/650 kWp,
SYNTH_500 BESS subtotal 0, SYNTH_650 BLOCKED/structure 0). I'll sanity-check and then lock goldens.
