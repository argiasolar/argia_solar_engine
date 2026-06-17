# ARGIA Engine 4.32.0 — FINANCE finalize: ship-correct-by-default + provenance notes

Two things: new workbooks ship with the FINANCE fixes by default, and every FINANCE number
now carries a plain-language note explaining how it was derived and which cells feed it.
The notes are **internal** — not shown to the customer — so the team can explain and defend
the numbers when selling.

## Files

| Path | New/Edit | What |
|------|----------|------|
| `02m_FinanceFinalize.js` | NEW | `repairFinanceAll(ss)`: runs the three FINANCE repairs (4.29/4.30/4.31) then writes provenance notes on every key figure. Idempotent; captures per-step failures. |
| `tests_unit/repairs/FinanceFinalizeTests.gs` | NEW | 18 assertions: orchestration, sub-repair effect, notes land with correct source refs, idempotency, abort. |
| `00_Main.js` | edit | Wires `repairFinanceAll` into `startNewProjectCore` (step 6) + menu item **"Repair FINANCE (all + notes)"**. |
| `00a_Version.js` | edit | 4.31.0 → **4.32.0** + note. |
| `CHANGELOG.md` | edit | 4.32.0 entry. |

## What the notes cover (hover the cell to read them)

`C3` CAPEX · `D16`/`D17` CFE tariff & payment · `D19`/`D20` ARGIA tariff & payment · `C4`
legacy nominal NPV · `I5`/`I7` loan principal & payment · and the whole metrics block
(WACC, discounted NPV, IRR, IRR-vs-target, debt service, DSCR). Each note states the formula
in plain language and the exact source cells — e.g. CAPEX cites `BOM_v2!G94 + INSTALLATION_v2!G9`,
the CFE tariff cites `BESS_SIMULATION!D12`, the discounted NPV cites the WACC `INPUT_BAAS!D15`.

ASCII-safe Spanish, matching the engine's existing note style.

## Ship-correct-by-default

`repairFinanceAll` is wired into `startNewProjectCore`, so **Start New Project** now applies
all FINANCE repairs + notes automatically. Run it once on your master template and every
future clone inherits corrected + documented FINANCE. (First time engine setup writes to
FINANCE — deliberate, idempotent.)

## Apply

```
cd ~/my-sheet-scripts && git pull
unzip -o ~/Downloads/argia_4.32.0_finance_finalize.zip -d .
node scripts/full_selftest.js            # expect: ALL GREEN, 535 tests, 0 FAIL
git add -A
git commit -m 'FINANCE finalize: orchestrate repairs + provenance notes (4.32.0)'
git push
clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then run **ARGIA → Administrator Panel → Repair FINANCE (all + notes)** once per workbook
(and once on the master). Hover the FINANCE figures to read the derivation notes.
