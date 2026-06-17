# ARGIA Engine 4.29.0 — Repoint FINANCE/PPA + SLIDE_DATA CFE source

Fixes the FINANCE/PPA `$0 CFE tariff → DSCR 0% / %savings #DIV/0!` and the last
consistency_live red (`SLIDE_DATA[annual_energy_cost] = #VALUE!`). **One root
cause:** both sheets read the **dead INPUT_CFE sin-PV stub** (row 37, `O37 = 0`)
instead of the authoritative engine sin-PV **`BESS_SIMULATION!D12`** (= 12,838,765
on CULLIGAN). This repair repoints the three consuming formulas onto D12.

We can't push values into INPUT_CFE row 37 (array formulas — writing over them
strips evaluation context), so repointing the consumers is the only safe direction.

## Files

| Path | New/Edit | What |
|------|----------|------|
| `02h_RepairFinanceSlideCfeSource.js` | NEW | Surgical, label-matched, guarded, idempotent repair. Repoints 3 formulas to `BESS_SIMULATION!D12`. Aborts if source sheet missing; never overwrites an unexpected formula. |
| `tests_unit/repairs/RepairFinanceSlideCfeSourceTests.gs` | NEW | 21 assertions on a self-contained mock: happy / idempotent / missing-label / guard / abort. |
| `00_Main.js` | edit | Admin Panel menu item: **"Repoint CFE Source (FINANCE/SLIDE)"** → `runRepairFinanceSlideCfeSource`. |
| `00a_Version.js` | edit | `ENGINE_VERSION` 4.28.1 → **4.29.0** + version note. |
| `CHANGELOG.md` | edit | 4.29.0 entry. |

## The three repoints (label-matched, Y00 only — E:H chain inherits)

| Sheet / cell | Before | After |
|---|---|---|
| `SLIDE_DATA[annual_energy_cost]` (col B) | `=SUM(INPUT_CFE!C37:N37)` | `=BESS_SIMULATION!D12` |
| `FINANCE` "CFE Annual Payment" (D) | `=INPUT_CFE!O37` | `=BESS_SIMULATION!D12` |
| `FINANCE` "CFE Tariff" (D) | `=INPUT_CFE!O37/SUM(INPUT_CFE!C10:N12)` | `=BESS_SIMULATION!D12/SUM(INPUT_CFE!C10:N12)` |

## Apply

```
cd ~/my-sheet-scripts && git pull
unzip -o ~/Downloads/argia_4.29.0_finance_slide_cfe_repoint.zip -d .
node scripts/full_selftest.js            # expect: ALL GREEN, 532 tests, 0 FAIL
git add -A && git commit -m "4.29.0: repoint FINANCE/SLIDE_DATA CFE source to BESS_SIMULATION!D12"
git push
clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then in the workbook: **ARGIA → Administrator Panel → Repoint CFE Source (FINANCE/SLIDE)**
(run once per workbook). Verify FINANCE CFE Tariff/Payment/%savings/DSCR are non-zero
and `SLIDE_DATA[annual_energy_cost]` no longer shows `#VALUE!`.

## Not in scope (separate follow-up)
FINANCE CAPEX reads 34.76M (not the 37.05M CULLIGAN CAPEX) and Y00 production is −220
(first-year proration quirk). Independent of this repoint; unchanged by it.
