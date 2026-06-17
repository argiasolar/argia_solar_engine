# ARGIA v4.36.0 — T2.1: returns-basis knob + finish safe SLIDE repoints

Builds on **4.35.0 (T2)** — apply that first if you haven't. Extract over repo root, then run the
deploy block at the bottom.

## What this closes

1. **Returns-basis knob.** `CLIENT_FIN_DEFAULTS.returnsBasis` = `'COST'` (default) | `'OFFER_PRICE'`.
   The return metrics (payback / NPV / IRR / ROI) are computed on cost by default — at margin 0 that
   equals the sell price, so the dual-basis design already covers both regimes (your observation).
   At margin > 0, flip to `'OFFER_PRICE'` for the customer-correct basis (they pay sell, not cost).
   Default COST keeps the CULLIGAN goldens byte-identical. `API_OUTPUT` records which basis was used.
2. **Finished the safe SLIDE repoints** — and fixed a latent bug.

## Files in this package

| Path | Change |
|------|--------|
| `31a_RunClientFinancials.js` | `returnsBasis` default + `_cfinResolveReturnsCapex` + `_cfinReadOfferPriceMxn`; feeds the basis-driven capex into the returns calc |
| `writers_v2/WriteApiOutputV2.js` | `returns_basis` field; **fixed `system_kwp` guard**; +3 safe repoints (capex_total, annual_savings, co2_tons) |
| `tests_unit/calc/ClientFinWiringTests.gs` | **+** `UNIT_CLIENT_FIN_RETURNS_BASIS` |
| `tests_unit/writers_v2/ApiOutputV2Tests.gs` | key set 26 → 27 (adds `returns_basis`) |
| `tests_regression/v2/ApiOutputConsistencyTests.gs` | `returns_basis` default + the 3 new repoints |
| `00a_Version.js` | 4.35.0 → **4.36.0** |
| `CHANGELOG.md` | 4.36.0 entry |

## SLIDE_DATA repoints (read from the real live formulas)

| SLIDE key | was | now → API | effect |
|---|---|---|---|
| system_kwp | `=MDC!C14` (#REF!) | system_kwp_dc | **fixes broken link** → 864 |
| capex_total | `=FINANCE!C3` | offer_price_mxn | no change (sell = sell) |
| annual_savings | `=FINANCE!C37` | pv_only_savings_year1_mxn | no change (PV-only) |
| co2_tons | `=SUM(FINANCE!D22:O22)` | co2_tons_year1 | **fix 6,153 → 587 t/yr** |

Two things the real formulas revealed: (a) `system_kwp` pointed at the **renamed** `MDC` sheet, so
T2's `#REF!`-in-formula guard would have silently skipped it — fixed; (b) SLIDE_DATA is fed from the
**FINANCE/PPA model**, so `roi_years`/`irr_10yr`/`savings_10yr` are PPA-product returns (a different
commercial product) and are correctly **left alone**. `annual_savings` stays PV-only — no silent
restatement; switching to full-system savings is still a one-key flip you control.

## Verification done before handover

- All 5 SLIDE repoint guards confirmed to **match the real live formulas** (`=MDC!C14`, `=FINANCE!C3`,
  `=FINANCE!C37`, `=SUM(FINANCE!D22:O22)`, `=BESS_SIMULATION!D12`) → all 5 fire live.
- `node scripts/full_selftest.js`: **ALL GREEN**, Unit FAILs 0, Unit ERRORs 0, 44 workbook-dependent.
- `UNIT_CLIENT_FIN_RETURNS_BASIS`, `UNIT_API_OUTPUT_KEYSET`, `UNIT_CALC_CLIENT_FIN_WIRING` confirmed RAN + PASS; `REG_API_OUTPUT` RAN + workbook-error (expected).
- Returns-basis default COST → CULLIGAN goldens unchanged (identical capex into the calc).
- `node --check` clean; `^--` grep clean (code files); fresh-clone round-trip applies over repo root and stays green.

## Post-deploy

Run **ARGIA ▸ Setup ▸ Run ALL Tests** (or the CULLIGAN E2E). `system_kwp` will resolve to 864 (not
`#REF!`), `co2_tons` to 587, and `REG_API_OUTPUT` stays green. To try the sell-price basis, set
`CLIENT_FIN_DEFAULTS.returnsBasis = 'OFFER_PRICE'` (one line) and re-run — payback/NPV/IRR will move
to what the customer actually pays.

---

## Deploy (GitHub + clasp)

```bash
git pull
unzip -o ~/Downloads/argia_v4.36.0_T2_1.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'T2.1: returns-basis knob (cost/sell) and finish safe SLIDE repoints; fix system_kwp guard and co2'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

> A version MISMATCH right after push is the Apps Script CDN cache — wait ~5 min and re-run the
> verify line. Both targets (`git push`, `clasp push`) are independent; verify confirms both.
