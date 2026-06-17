# ARGIA Engine 4.33.0 — FINANCE metrics block: professional styling + DSCR window fix

Makes the **MARKET-STANDARD METRICS** block read like the financial section above (number
formats, header band, bold grey labels) instead of raw decimals, and fixes the misleading
**Min DSCR = 0**.

## Files

| Path | Edit | What |
|------|------|------|
| `02l_FinanceMarketMetrics.js` | edit | `_fmmStyleBlock()` — header band + bold grey label column + number formats (currency / percent / DSCR `0.00"x"`) + outer border, applied idempotently. DSCR-by-year now requires `revenue > 0` (excludes the pre-operation Y00 that pinned Min DSCR to 0). |
| `tests_unit/repairs/FinanceMarketMetricsTests.gs` | edit | Mock records number formats + accepts styling setters; updated DSCR formula assertions; +8 number-format assertions. |
| `tests_unit/repairs/FinanceFinalizeTests.gs` | edit | Mock accepts the new (chainable) styling setters so the orchestrator runs. |
| `00a_Version.js` | edit | 4.32.0 → **4.33.0** + note. |
| `CHANGELOG.md` | edit | 4.33.0 entry. |

## What changes on screen

- DSCR cells: `0.3814195456` → **`0.38x`**; rates show `0.00%`; money shows `$#,##0`.
- Row header gets a grey band; the label column goes bold + light grey.
- **Min DSCR** stops reading `0.00` (the pre-operation year is no longer counted).

Grey tones are constants (`_FMM_HEADER_BG` `#b7b7b7`, `_FMM_LABEL_BG` `#d9d9d9`) — tweak them
in `02l` to exact-match your template palette if you want a pixel match rather than "close +
professional".

## Heads-up (not a code issue)

The block now clearly shows the modeled PPA is **underwater**: NPV ≈ −$24M, IRR ≈ −1%,
DSCR ≈ 0.38x (revenue ~$3.3M/yr vs debt service ~$8.7M/yr). The metrics are correct — likely
levers are the loan being sized on the **sell-price CAPEX** (~$43.6M, margin included) vs cost
(~$37M), and only the **10-year PPA term** of revenue counted against a 20–25-year system.
Parked pending your direction.

## Apply

```
cd ~/my-sheet-scripts && git pull
unzip -o ~/Downloads/argia_4.33.0_finance_metrics_styling.zip -d .
node scripts/full_selftest.js            # expect: ALL GREEN, 535 tests, 0 FAIL
git add -A
git commit -m 'FINANCE metrics: professional styling + DSCR pre-op year fix (4.33.0)'
git push
clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then **ARGIA → Administrator Panel → Repair FINANCE (all + notes)** (or **Start New Project**)
to restyle the block in place on CULLIGAN and your master template.
