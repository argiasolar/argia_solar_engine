# ARGIA v4.37.0 — T3: registry-driven cross-tab consistency guard

Builds on **4.36.0 (T2.1)** — apply that first if you haven't. Extract over repo root, then run the
deploy block at the bottom.

## What this does

Encodes the "single source" rule as **data**: a registry of every shared figure → its canonical
owner → all the consumer cells that must agree. The guard reads them all and flips red the instant
any future change forks one. It runs at the end of every engine run (stamps `_META`) and in the test
suite. It is a **detector, not a fixer** — it changes no cell.

## Files in this package

| Path | Change |
|------|--------|
| `09d_ConsistencyGuard.js` | `SHARED_FIGURE_REGISTRY` (10 figures) + readers (`cell`/`api`/`slide`/`banner`/`rowsum`/`diff`) + `resolveRegistryReadings` + pure `partitionConsistencyViolations`; `assertCrossTabConsistency` now registry-driven; `_META` stamp names the offending figure |
| `00_Main.js` | new **Step 14.1** runs the guard at end-of-run (non-fatal) |
| `tests_unit/consistency/ConsistencyRegistryTests.gs` | **NEW** 4 pure tests incl. the deliberate-fork proof |
| `tests_regression/v2/CrossTabConsistencyTests.gs` | **NEW** `REG_CROSS_TAB_CONSISTENCY` (CULLIGAN) |
| `00a_Version.js` | 4.36.0 → **4.37.0** |
| `CHANGELOG.md` | 4.37.0 entry |

## The registry (canonical owner → consumers)

| Figure | owner | consumers cross-checked |
|---|---|---|
| cfe_bill_sin_pv | BESS_SIM!D12 | CFE_OUT B10 banner, SLIDE, API |
| cfe_bill_con_pv | BESS_SIM!D14 | CFE_SIM!O39, CFE_OUT row19, API |
| cfe_bill_con_bess | BESS_SIM!D18 | CFE_OUT row31, API |
| pv_energy_savings | D12−D14 | CFE_SIM!O41, CFE_OUT row20, SLIDE, API |
| bess_savings | D14−D18 | CFE_OUT row30 (Ahorro BESS TOTAL) |
| capex_cost | API capex_cost_mxn | CLIENT_FIN!D8, PROJECT_CARD!D40 |
| offer_price | API offer_price_mxn | PROJECT_CARD!I40, FINANCE!C3, SLIDE |
| system_size_kwp | MDC_v2!C15 | API, SLIDE, PROJECT_CARD!H14 |
| annual_pv_generation_mwh | API annual_generation_mwh | CFE_OUT row15 ÷ 1000 |
| interconnection_mode | INPUT_CFE!C41 | *(string; skips — pending T5)* |

CAPEX **cost** and **offer/sell** are deliberately **two** figures (the dual basis from T2) so the
guard never confuses 37.05M with 43.59M. Enforced figures flip the guard red on a fork; the mode
figure is `enforced:false` (reported as a known fork, not a failure) until T5 lands.

## Verified before handover

- **Green live** against your CULLIGAN workbook: **9 figures checked, 0 forks.** Every shared figure
  agrees across all consumers (sin-PV 4 sources, PV savings 5, CAPEX cost 3, offer 4, size 4, …);
  `interconnection_mode` skips (string, pending T5).
- **Deliberate-fork proof** (unit): a forked consumer flips an enforced figure red; the healthy
  version stays green.
- `node scripts/full_selftest.js`: **ALL GREEN**, Unit FAILs 0, Unit ERRORs 0, 45 workbook-dependent.
- 4 new unit tests confirmed RAN + PASS; `REG_CROSS_TAB_CONSISTENCY` RAN + workbook-error (expected).
- Existing guard tests (pure core, hardening, live integration) unaffected.
- `node --check` clean; `^--` grep clean (code files); fresh-clone round-trip green.

## After deploy

Run the CULLIGAN E2E. `_META` will show `CONSISTENCY_GUARD  PASS @ …`. The guard will legitimately
flag the interconnection-mode and install-man-hour forks once those figures gain a second source —
that's T5/T6, and it's the intended behavior.

---

## Deploy (GitHub + clasp)

```bash
git pull
unzip -o ~/Downloads/argia_v4.37.0_T3.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T3: registry-driven cross-tab consistency guard; green on CULLIGAN, mode skips pending T5'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

> A version MISMATCH right after push is the Apps Script CDN cache — wait ~5 min and re-run the
> verify line. Both targets (`git push`, `clasp push`) are independent; verify confirms both.
