# ARGIA Engine — v4.54.0 (Start New Project: true clean-slate numeric reset)

A real reset bug the synthetic prefill tripwire caught: "Start New Project" rebuilt the INPUT tab
structure but did NOT clear data-cell values, so a new project inherited the previous project's CFE
consumption and BESS sizing (`cfeKwhBase`, `bessCapacityKwh=2169`, `bessPowerKw=972` survived).
`setupInputCFE` is a styling-only stub; the BESS setup seeds some cells but leaves others.

## Fix
`startNewProjectCore` now calls `clearEngineNumericInputs(ss)` after `rebuildInputsToDefault`. It
resets every engine-consumed numeric input to its canonical fresh value via INPUT_MAP
(`seed → default → blank`), so no cell is missed. Seeded cells keep their seed (the intended fresh
value, e.g. `bessMinAnnualSavingMxn` = 2000000).

`UNIT_ENGINE_NUMERIC_RESET` covers the value resolution + key set. Self-test ALL GREEN.

## Files
```
00a_Version.js                                       4.53.0 -> 4.54.0
00d_InputSnapshot.js                                 clearEngineNumericInputs + pure helpers
00_Main.js                                           startNewProjectCore step 2b
tests_unit/lifecycle/EngineNumericResetTests.gs      NEW
CHANGELOG.md / README_4.54.0.md
```
