# ARGIA Engine 4.31.0 — FINANCE market-standard metrics (NPV / IRR / DSCR)

Turns the FINANCE PPA model into a market-standard benchmark. It reported `C4` "NPV" =
`SUM(D30:X30) - C3` — nominal profit, **undiscounted** — with no IRR or DSCR. This adds the
standard metrics as **live formulas** that recompute with the model.

## Files

| Path | New/Edit | What |
|------|----------|------|
| `02l_FinanceMarketMetrics.js` | NEW | Appends/refreshes a metrics block on FINANCE: discounted NPV, project IRR, IRR-vs-target, loan-term-aware DSCR (min/avg). Header-anchored, idempotent, aborts if FINANCE/INPUT_BAAS missing. |
| `tests_unit/repairs/FinanceMarketMetricsTests.gs` | NEW | 22 assertions: placement, every formula string, cashflow row, idempotency, abort. |
| `00_Main.js` | edit | Admin Panel item **"FINANCE Market Metrics (NPV/IRR/DSCR)"** → `runFinanceMarketMetrics`. |
| `00a_Version.js` | edit | 4.30.0 → **4.31.0** + note. |
| `CHANGELOG.md` | edit | 4.31.0 entry. |

## The block (live formulas)

| Metric | Formula |
|---|---|
| Discount rate (WACC) | `=INPUT_BAAS!D15` |
| ARGIA target IRR | `=INPUT_BAAS!D14` |
| Project cashflow | `[-C3, =D30 … =X30]` (t0 = −CAPEX) |
| Discounted NPV (project) | `=-C3+NPV(INPUT_BAAS!D15,D30:X30)` |
| IRR (project) | `=IFERROR(IRR(cashflow),"n/a")` |
| IRR margin vs target | `=IRR − INPUT_BAAS!D14` |
| Annual debt service | `=I7*12` |
| DSCR by year (loan term) | `=IF(COLUMN()-COLUMN($D$row)<$F$7, revenue/debt, "")` |
| Min / Avg DSCR | `=MIN(…)` / `=AVERAGE(…)` |

**Design notes**
- **Single-source discount rate.** Reuses the existing ARGIA WACC (`INPUT_BAAS!D15` = 12%)
  and target IRR (`INPUT_BAAS!D14` = 15%) — no duplicate input, independent of the BanBajío
  loan rate `F9`.
- **Unlevered project basis** (revenue vs CAPEX, matching `C4`); levered/equity IRR is
  undefined at 100% debt (`F8 = 1.0`).
- **DSCR follows the loan term** dynamically via `F7` (no hardcoded window).

## Verification

Formula construction is unit-tested (22 assertions). Numeric results are native Sheets
functions, verified live. **Worked reference** (independently computed — verifies the
mechanics): CAPEX 1,000,000; revenue 200,000/yr × 10; WACC 10% → **NPV ≈ 228,913**,
**IRR ≈ 15.1%**; debt service 150,000/yr → **DSCR = 1.33**.

Directional checks on your live sheet:
- Discounted NPV should sit **below** the undiscounted `C4` (time value).
- IRR lands a few points around 12–15% if the PPA is sound.
- **Min DSCR > 1.0** means the PPA revenue covers debt service.

## Apply

```
cd ~/my-sheet-scripts && git pull
unzip -o ~/Downloads/argia_4.31.0_finance_market_metrics.zip -d .
node scripts/full_selftest.js            # expect: ALL GREEN, 534 tests, 0 FAIL
git add -A
git commit -m 'FINANCE market-standard metrics: discounted NPV, IRR, DSCR (4.31.0)'
git push
clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then **ARGIA → Administrator Panel → FINANCE Market Metrics (NPV/IRR/DSCR)** once per
workbook (idempotent — re-running rewrites the block in place). It appears below the
existing FINANCE content.
