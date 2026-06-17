# ARGIA v4.34.0 — T1: single canonical "CFE bill, sin PV" base

Extract this zip over the repo root. Then run the deploy block at the bottom.

## Apply (from repo root `~/my-sheet-scripts`)

```bash
git pull
unzip -o ~/Downloads/argia_v4.34.0_T1.zip -d .
node scripts/full_selftest.js          # gate: ALL GREEN, 0 unit FAIL/ERROR
```

## Files in this package

| Path | Change |
|------|--------|
| `00a_Version.js` | version bump 4.33.0 → **4.34.0** |
| `20b_WriteAuthoritativeCfeSavings.js` | **+** pure `surfaceCfeBaseline_`; writer now surfaces canonical base into `BESS_SIMULATION!D12` (value) + derived D13/D14 |
| `31a_RunClientFinancials.js` | `_cfinReadBills` reads canonical `D12` first (row19+row20 → C10 banner as fallbacks) |
| `tests_unit/calc/CfeBaselineSavingsTests.gs` | **NEW** 4 pure unit tests (base from first principles, savings identity, surface spec, export-credit safety) |
| `tests_unit/calc/ClientFinWiringTests.gs` | CASE 1 now supplies canonical D12 (0 warnings); **+** CASE 1b locks row19+row20 fallback |
| `tests_regression/v2/CfeBaseAndSavingsConsistencyTests.gs` | **NEW** `REG_CFE_BASE_AND_SAVINGS` (workbook-dependent, CULLIGAN-guarded): all consumers agree within 0.01% |
| `CHANGELOG.md` | 4.34.0 entry |

## What changed and why (one paragraph)

`BESS_SIMULATION!D12` was the workbook formula `O39 + O41 + O40` (con-PV + savings +
export-credit). The `+O40` term double-counted the FACTURACION_NETA export credit, so D12
overstated the sin-PV base on net-billing projects, and every D12 consumer inherited the
error while CLIENT_FINANCIALS reconstructed `O39+O41` and diverged. **Fix:** the GDMTH engine
base `Σ calcCfeBill(PV=0).total` is now written into D12 as a value (single source);
`D14 = O39` (audited con-PV), `D13 = D14-D12` (derived, reconciles in every mode). CLIENT_FIN
reads D12 directly. **CULLIGAN golden 12,838,765.45 is unchanged** (MEDICION_NETA → `O40 = 0`);
this is a structural single-source fix with a zero-delta golden.

## Verification done before handover

- Independent Node reproduction of the CULLIGAN no-PV base = **12,838,765.45** @ fpThreshold 0.90 (delta −0.00), matching the locked golden.
- `node scripts/full_selftest.js`: **ALL GREEN**, Unit FAILs 0, Unit ERRORs 0, 43 workbook-dependent ERRORs (expected/green; +1 vs prior = the new REG test).
- All 4 new unit tests confirmed RAN + PASS; `REG_CFE_BASE_AND_SAVINGS` confirmed RAN + ERROR with the expected workbook signature (runs live in the CULLIGAN E2E).
- `node --check` clean on every changed file; mandatory `^--` typo grep clean; `git status` shows 0 deletions.

## Post-deploy (run in the real spreadsheet)

Run **ARGIA menu ▸ Setup ▸ Run ALL Tests** (or the CULLIGAN E2E via Admin Panel) so the
workbook-dependent `REG_CFE_BASE_AND_SAVINGS` executes live and locks cross-consumer agreement.

---

## Deploy (GitHub + clasp)

```bash
# from repo root, after Apply + green self-test above
git add -A
git commit -m 'T1: single canonical CFE sin-PV base in D12, remove export-credit double-count'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

> If `verify_deploy.js` reports a version MISMATCH immediately after push, it is the Apps Script
> CDN cache — wait ~5 min and re-run the verify line. Both targets (`git push` and `clasp push`)
> are independent and can fail silently; verify confirms both.
