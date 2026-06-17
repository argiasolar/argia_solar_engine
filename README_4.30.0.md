# ARGIA Engine 4.30.0 — FINANCE model correctness

The FINANCE/PPA numbers were wrong, not just the CFE tariff. Three signature-matched,
idempotent fixes to the legacy FINANCE sheet, run on demand.

## Files

| Path | New/Edit | What |
|------|----------|------|
| `02k_RepairFinanceModel.js` | NEW | Three FINANCE fixes (CAPEX BOM ref, Y00 production floor, CO2 factor). Signature-matched, guarded, idempotent, array-formula safe, write-verified. Aborts if FINANCE missing. |
| `tests_unit/repairs/RepairFinanceModelTests.gs` | NEW | 17 assertions: happy / no-collateral-damage / idempotent / partial / abort. |
| `00_Main.js` | edit | Admin Panel item: **"Repair FINANCE Model (CAPEX/prod/CO2)"** → `runRepairFinanceModel`. |
| `00a_Version.js` | edit | `ENGINE_VERSION` 4.29.0 → **4.30.0** + note. |
| `CHANGELOG.md` | edit | 4.30.0 entry. |

## The three fixes

| # | Cell | Before | After | Why |
|---|------|--------|-------|-----|
| 1 | `C3` CAPEX | `…+BOM_v2!G80)/…` | `…+BOM_v2!G94)/…` | `G80` is the **BESS battery line item** (~$28.8M); `G94` is the BOM **grand total** (~$36.7M, the cell the engine itself uses). Propagates to NPV, cash ROI (`C34`), loan principal `I5=C3*F8`, and the `41M_FINANCE_CALCULATOR` schedule. |
| 2 | `D15` production | `(12-MONTH(TODAY())-C5)*…` | `(MAX(0,12-MONTH(TODAY())-C5))*…` | Y00 went negative when interconnection delay pushes go-live into next year. |
| 3 | CO2 rows | `=0.438*…` | `=0.444*…` | Verified FE-SEN 2024 factor; upholds the CO2 invariant. |

`INSTALLATION_v2!G9` is **correct** (it is the install grand total) and is left as-is.

## Apply

```
cd ~/my-sheet-scripts && git pull
unzip -o ~/Downloads/argia_4.30.0_finance_model_correctness.zip -d .
node scripts/full_selftest.js            # expect: ALL GREEN, 533 tests, 0 FAIL
git add -A
git commit -m 'FINANCE model correctness: CAPEX BOM ref, Y00 production floor, CO2 0.444 (4.30.0)'
git push
clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then **ARGIA → Administrator Panel → Repair FINANCE Model (CAPEX/prod/CO2)** once per
workbook (idempotent). Verify: FINANCE CAPEX reflects the full system, the
`41M_FINANCE_CALCULATOR` loan schedule updates, and Y00 production is >= 0.

## Known gap — next chunk (market-standard benchmark)
`C4` "NPV" is `Sum(payments) - CAPEX` (undiscounted) and there is no IRR / DSCR. True
benchmark = discounted NPV at the project cost of capital (100% debt-financed at
`F9 = 12.66%`, so WACC ~= the loan rate), IRR, and DSCR vs the 41M debt service. Structural
addition to the template — ships as its own confirmed chunk.
