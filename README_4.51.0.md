# ARGIA Engine — v4.51.0 (Retire legacy INPUT_CFE bill reconstruction)

INPUT_CFE rows 30–37 (Energía Total → … → TOTAL) were a legacy in-sheet bill reconstruction that
summed your pasted bill components (rows 21–29) to rebuild the monthly invoice. **Nothing in the
engine reads it:**

- the bill is computed in code (`04a_CalcCFEBill`); these cells are never read,
- the sin-PV bill is `BESS_SIMULATION!D12`,
- FINANCE / SLIDE_DATA / CFE_OUTPUT were repointed *off* `INPUT_CFE!C37` (the "dead stub") in T1/T2.

It was also fragile — on partial/blank monthly data the FP division and summation chain throw
`#DIV/0!` / `#VALUE!`, which is exactly what you were seeing.

## What this does

- **`39_RetireCfeBillReconstruction.js`** — `retireCfeBillReconstruction(ss)` clears `INPUT_CFE!B30:N37`
  (labels + formulas), idempotent. It does **not** touch the pasted components (rows 21–29, which the
  engine *does* consume), the consumption inputs (10–20), or the PV interconnection block (rows 39+).
  It does **not** delete rows — deleting would shift row 39+ and break INPUT_MAP coordinates
  (`cfeInterconnMode` lives at row 41). Exposed as **Administrator Panel → Repairs → Retire CFE Bill
  Reconstruction (rows 30-37)**.
- Removed the two dead source-map keys `input_facturacion` (row 35) and `input_total` (row 37).

**Why a single clear sticks:** `setupInputCFE()` only *styles* (and only when the optional
`INPUT_CFE_RAW` tab exists — it doesn't in your workbook), so these rows are persistent content that
nothing regenerates. Clear once, retired for good.

## Tests

- `UNIT_CFE_BILL_RECON_RANGE` — clear range is exactly B30:N37, never reaching components or PV block.
- `UNIT_CFE_OUT_SRC_NO_DEAD_KEYS` — dead keys removed, live `input_demandaFact` kept.
- Repointed the existing source-map monthly-read tests off `input_total` → `input_demandaFact`.

Self-test **ALL GREEN**, 0 Unit FAIL / 0 Unit ERROR. Workbook-dependent count unchanged (**56**).
CULLIGAN E2E untouched.

## Files

```
00a_Version.js                                       4.50.0 -> 4.51.0
39_RetireCfeBillReconstruction.js                    NEW
00_Main.js                                           Repairs menu item
writers_v2/helpers/CfeOutputSourceMap.js             removed 2 dead keys
tests_unit/cfe/RetireCfeBillReconTests.gs            NEW (2 tests)
tests_unit/writers_v2/CfeOutputSourceMapTests.gs     repointed off input_total
CHANGELOG.md / README_4.51.0.md
```

## Deploy

```bash
git pull
unzip -o ~/Downloads/argia_v4.51.0_retire_cfe_recon.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'Retire legacy INPUT_CFE bill reconstruction rows 30-37 + dead source-map keys'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

**After deploy:** run **Administrator Panel → Repairs → Retire CFE Bill Reconstruction** once on your
live sheet to clear the current broken rows 30–37. It reports how many cells it cleared (idempotent —
safe to re-run). Then re-run the CULLIGAN E2E to confirm still all-green.
