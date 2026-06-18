# ARGIA v4.40.0 — T6: install role man-hours reconciliation

Builds on **4.39.0 (T4)** — apply that first if you haven't. Extract over repo root, then run the
deploy block at the bottom.

## What this fixes

The INSTALLATION MAN-HOURS BREAKDOWN summed to **~2.9× the project total** — INSTALLER alone (1,594 MH)
exceeded the whole-project total (869 MH). The grand total was always correct; the breakdown was
stale. Now **Σ(role MH) == total MH**.

## Root cause

`applyKwpBenchmarks` runs after `calcInstallCost`, scales every line item's man-hours down to a
benchmark MH/kWp target, and recomputes the totals — but it never rebuilt `roleAgg`. So the breakdown
kept the **pre-benchmark** MH (2,417) while the line items + total held the **post-benchmark** MH
(869). One missing rebuild → the 2.9× inflation.

## Files in this package

| Path | Change |
|------|--------|
| `13_CalcInstallCost.js` | new pure `_icBuildRoleAgg(items)`; `calcInstallCost` uses it; **`applyKwpBenchmarks` rebuilds `roleAgg` from the scaled items** |
| `tests_unit/calc/InstallRoleMhTests.gs` | **NEW** `UNIT_INSTALL_ROLE_MH_RECONCILES` |
| `tests_regression/v2/InstallRoleMhCulliganTests.gs` | **NEW** `REG_INSTALL_ROLE_MH_RECONCILES` |
| `00a_Version.js` | 4.39.0 → **4.40.0** |
| `CHANGELOG.md` | 4.40.0 entry |

## What does NOT change

The grand total, labor total, section totals, and every line item are byte-identical. Only the role
breakdown values are corrected (they now match the line items they summarize).

## Verified before handover

- Live (CULLIGAN): the breakdown sums to **869 MH** (was 2,417), matching the total; INSTALLER 493.6 ≤ total.
- `_icBuildRoleAgg` reconciles Σ(role MH) == Σ(item MH) in isolation, incl. the 0-cost task-MH case
  (QAQC) and the stale-vs-rebuilt scenario.
- `node scripts/full_selftest.js`: **ALL GREEN**, Unit FAILs 0, Unit ERRORs 0, 48 workbook-dependent.
- New unit test RAN + PASS; `REG_INSTALL_ROLE_MH_RECONCILES` RAN + workbook-error (expected). Existing
  install writer test (passes a mock `roleAgg`) unaffected.
- `node --check` clean; `^--` grep clean (code files); fresh-clone round-trip green.

## Heads-up (flagged, not fixed here)

The role LABOR column sums ~0.3% under the TOTAL labor — that residual is indirect labour
(supervision / HSE officer / QAQC day-rate) that belongs in the grand total but isn't a task-MH role.
This task is the MH breakdown; that cost nuance is out of scope and noted.

## After deploy

Run **Generate Installation** (or the CULLIGAN E2E). The MAN-HOURS BREAKDOWN role rows will sum to the
TOTAL row, and no role will exceed it.

---

## Deploy (GitHub + clasp)

```bash
git pull
unzip -o ~/Downloads/argia_v4.40.0_T6.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T6: install role man-hours reconcile; rebuild roleAgg from scaled items after benchmarks'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

> A version MISMATCH right after push is the Apps Script CDN cache — wait ~5 min and re-run the
> verify line. Both targets (`git push`, `clasp push`) are independent; verify confirms both.
