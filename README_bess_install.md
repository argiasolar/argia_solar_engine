# bess_install chunk — file package

Chunk `bess_install`. Adds BESS support to the installation cost layer:
plumbs `bessResult` into `runInstallCost()`, computes 12 BESS install
drivers, adds 4 INPUT_INSTALL knobs under section "07 BESS / ALMACENAMIENTO",
adds `BESS` to `IC_SECTIONS`, and ships 11 tests (10 unit + 1 regression
guard).

## How to apply

1. Make sure your local clasp folder is clean (no in-flight edits you
   haven't pushed yet — these files will overwrite the originals).
2. Unzip this package at the **root** of your clasp folder. The relative
   paths inside the zip match the repo layout exactly, so the files
   overwrite the right places and the two new test files land in their
   correct folders:

   ```
   00_Main.js
   02c_InputMap.js
   13_CalcInstallCost.js
   templates/ActiveChunk.js
   tests_unit/calc/CalcBessInstallTests.gs                  (new file)
   tests_regression/baseline/CulliganBessInstallGuardTests.gs   (new file)
   ```

3. From the clasp folder root:

   ```
   clasp push
   ```

4. In the Apps Script project, run from the spreadsheet menu:
   - **▶ Run Tests for Current Chunk** — expect ~10 tests pass,
     ~100 assertions, all `bess_install`-tagged.
   - If green, run the full regression. The critical assert to watch
     is `INSTALL.G9 = 516,805.26` (CULLIGAN PV-only grand total
     unchanged).

5. Re-run `setupInputInstall(true)` from the menu **once** to paint the
   new section "07 BESS / ALMACENAMIENTO" rows on the INPUT_INSTALL tab.
   This is a one-time cosmetic refresh — the engine already reads the
   new keys whether the tab is painted or not (defaults kick in).

## Prerequisite

Before clasp push: confirm `INSTALL_DB_4.xlsx` is uploaded and the
mirrors (`90M_INSTALL_LIB`, `93M_INSTALL_EQUIP_RATES`) have refreshed via
IMPORTRANGE. If the BESS rows aren't in the mirror yet, the engine still
runs cleanly but the BESS install section will be empty (the regression
guard test reports this as `info`, not `fail`).

## What changed

| File                                                       | Type     | Lines    |
|------------------------------------------------------------|----------|----------|
| `00_Main.js`                                               | modified | +1 / -1  |
| `02c_InputMap.js`                                          | modified | +71 / -1 |
| `13_CalcInstallCost.js`                                    | modified | +153 / -7|
| `templates/ActiveChunk.js`                                 | modified | +1 / -1  |
| `tests_unit/calc/CalcBessInstallTests.gs`                  | NEW      | 463      |
| `tests_regression/baseline/CulliganBessInstallGuardTests.gs` | NEW    | 99       |

## Verification status

- 79/79 pure unit-test assertions pass in Node sandbox
- Real `readInstallDrivers()` math verified end-to-end in Node
- Apps Script side untested until clasp push (Tests 8-10 + regression
  need the live engine)
