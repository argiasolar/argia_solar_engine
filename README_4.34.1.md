# ARGIA v4.34.1 — T1 follow-up (banner cell fix from live E2E)

Patch on top of **4.34.0** (already deployed). The live CULLIGAN E2E returned **1 failure**;
this fixes it. Extract over the repo root, then run the deploy block at the bottom.

## What the E2E failure was

`REG_CFE_BASE_AND_SAVINGS ▸ "CFE_OUTPUT C10 banner == D12"` — expected 12,838,765.45, got **0**.
Cause: the "RECIBO ANUAL SIN PV" KPI tile is at **B10** (merged `B10:E10`); the test and one
CLIENT_FIN constant read **C10**, which is inside the merge and empty. **The engine was correct
live** — D12 = 12,838,765.45, `D12+D13 = D14 = O39`, `Σrow41 = D12−O39`, O40 = 0. Wrong cell,
not wrong math.

## Apply (from repo root `~/my-sheet-scripts`)

```bash
git pull
unzip -o ~/Downloads/argia_v4.34.1_T1fix.zip -d .
node scripts/full_selftest.js          # ALL GREEN, 0 unit FAIL/ERROR
```

## Files in this package

| Path | Change |
|------|--------|
| `00a_Version.js` | 4.34.0 → **4.34.1** |
| `31a_RunClientFinancials.js` | `CFE_BANNER_SIN_PV` `'C10'` → **`'B10'`** (latent fallback-cell fix) |
| `tests_regression/v2/CfeBaseAndSavingsConsistencyTests.gs` | banner assertion reads **B10** |
| `tests_unit/calc/ClientFinWiringTests.gs` | CASE 2 banner mock `C10` → `B10` |
| `CHANGELOG.md` | 4.34.1 entry |

## Verification done before handover

- Read the live workbook (your E2E output): banner value is at **B10** = `$12,838,765`; C10 is
  empty (inside the merge). Engine cells all correct: D12 = 12,838,765.45, D12+D13 = D14 = O39 =
  10,910,746, Σrow41 = 1,928,019.45 = D12−O39, O40 = 0.
- `_baasParseBanner` on the live B10 string → 12,838,765 (Δ 0.45 vs D12, well within 0.01%).
- `node scripts/full_selftest.js`: **ALL GREEN**, Unit FAILs 0, Unit ERRORs 0, 43 workbook-dependent.
- `UNIT_CALC_CLIENT_FIN_WIRING` confirmed RAN + PASS on the corrected B10 path.
- `node --check` clean; `^--` grep clean; fresh-clone round-trip applies over repo root and stays green.

## Post-deploy

Re-run **ARGIA ▸ Setup ▸ Run ALL Tests** (or the CULLIGAN E2E). `REG_CFE_BASE_AND_SAVINGS` should
now be fully green (115+1 → all pass).

---

## Deploy (GitHub + clasp)

```bash
# from repo root, after Apply + green self-test above
git add -A
git commit -m 'T1 fix: sin-PV banner cell C10 to B10 (merged tile top-left); engine math unchanged'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

> A version MISMATCH right after push is the Apps Script CDN cache — wait ~5 min and re-run the
> verify line. Both targets (`git push`, `clasp push`) are independent; verify confirms both.
