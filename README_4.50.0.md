# ARGIA Engine — v4.50.0 (T12 · chunk a: synthetic golden fixtures)

T12 is the **launch evidence**: prove the engine end-to-end from **explicit inputs only** (no
template prefill, no residue) at three market-typical sizes. Unlike the recent pure-module chunks,
T12 is fundamentally a **live, in-sheet E2E harness** — so it's staged honestly:

| Chunk | Scope | Verifiable in |
|---|---|---|
| **a (this)** | Declarative fixtures + INPUT_MAP routing validation + structural specs | **Node** |
| b | Live runner (`runSyntheticE2E`) + menu; **captures** actuals | In-sheet |
| c | **Lock** the captured numeric goldens (~25–35 each) | In-sheet |

**Why staged:** the numeric goldens (CFE bills, install totals, financials for 500/600/650 kWp) are
the engine's *output* for those inputs. They can only be obtained by running the engine — guessing
them would defeat the purpose. So chunk a builds and verifies everything that *is* knowable now.

## What chunk a delivers (all Node-tested, ALL GREEN)

**`tests_regression/synthetic/SyntheticFixtures.gs`**

- **SYNTH_500** — ~500 kWp, KR18, GDMTH, **BESS OFF** → BESS gates zero; emittable.
- **SYNTH_600** — ~600 kWp, KR18, GDMTH, **BESS ON (PEAK_SHAVING)**; emittable.
- **SYNTH_650** — ~650 kWp, concrete (RT37), GDMTH, **BESS ON (LOAD_SHIFTING / net-billing)**;
  `structure` **deliberately blank** → ESTRUCTURA NO SELECCIONADA / SIN COTIZAR → **BLOCKED / not
  emittable** (the negative-path proof).

Each fixture is `{ inputs: {mapKey → value}, structural: {…} }` — inputs written *only* via the
INPUT_MAP `writeInput` path. `validateSyntheticFixtureKeys()` proves every one of the 27 keys routes
through INPUT_MAP (the plan's completeness check); `syntheticPrefillKeys()` lists the engine-consumed
numeric keys the chunk-b tripwire will assert blank after a DEFAULT rebuild.

**Tests** — `UNIT_SYNTHETIC_FIXTURES_WELLFORMED`, `UNIT_SYNTHETIC_INPUT_MAP_COMPLETENESS`,
`UNIT_SYNTHETIC_PREFILL_KEYS`.

Self-test **ALL GREEN**, 0 Unit FAIL / 0 Unit ERROR. Workbook-dependent count unchanged (**56**) —
chunk a adds no live test. CULLIGAN E2E untouched.

## Files

```
00a_Version.js                                       4.49.0 -> 4.50.0
tests_regression/synthetic/SyntheticFixtures.gs      NEW  (registry + validators)
tests_unit/synthetic/SyntheticFixtureTests.gs        NEW  (3 unit tests)
CHANGELOG.md / README_4.50.0.md
```

## Deploy

```bash
git pull
unzip -o ~/Downloads/argia_v4.50.0_T12a.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T12-a: synthetic fixtures registry + INPUT_MAP routing validation, Node-tested'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Self-test green is the gate here; there's nothing new to run in-sheet yet (the live runner is chunk
b). Say **continue** for T12-b — the live `runSyntheticE2E` runner + Synthetic Test Mode menu — which
you'll run to capture the actual numbers we then lock as goldens.
