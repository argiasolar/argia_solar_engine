# ARGIA v4.35.0 — T2: API_OUTPUT (single offer interface)

One flat tab holding every canonical offer figure, written as values from the owning module.
The offer/presentation reads `API_OUTPUT`; `API_OUTPUT` reads the owners. Extract over repo root,
then run the deploy block at the bottom.

## Apply (from repo root `~/my-sheet-scripts`)

```bash
git pull
unzip -o ~/Downloads/argia_v4.35.0_T2.zip -d .
node scripts/full_selftest.js          # ALL GREEN, 0 unit FAIL/ERROR
```

## Files in this package

| Path | Change |
|------|--------|
| `writers_v2/WriteApiOutputV2.js` | **NEW** field spec + pure `buildApiOutputRows` + `writeApiOutputV2` + safe SLIDE repoint |
| `31a_RunClientFinancials.js` | wires `writeApiOutputV2` + `repairSlideDataFromApiOutput` after the CLIENT_FIN render |
| `tests_unit/writers_v2/ApiOutputV2Tests.gs` | **NEW** 4 pure unit tests (key set, builder, dual-bases, offer coverage) |
| `tests_regression/v2/ApiOutputConsistencyTests.gs` | **NEW** `REG_API_OUTPUT` (workbook, CULLIGAN-guarded) |
| `00a_Version.js` | 4.34.1 → **4.35.0** |
| `CHANGELOG.md` | 4.35.0 entry |

## What it does

`API_OUTPUT` is a 4-column tab (`key | value | units | source`) with 26 canonical fields. Each
value is read from its owner: CFE three-way from `BESS_SIMULATION` D12/D14/D18 (T1), size from
`MDC_v2`, solar generation from `CFE_OUTPUT` row 15, mode from `INPUT_CFE!C41`, offer price from
`PROJECT_CARD_v2` sell TOTAL, and financials passed through from `runClientFinancials` (never
re-run). Written during the client-financials/offer flow.

**Two CAPEX bases on purpose:** `capex_cost_mxn` (37.05M, model) and `offer_price_mxn` (43.59M,
what the customer pays) are distinct keys — same for PV-only vs full-system savings.

## SLIDE_DATA repoint — 2 of 7 (safe subset)

Investigation found SLIDE_DATA disagrees with the engine on **6 customer-facing figures by basis**
(sell vs cost, PV-only vs full-system, CO2 ~10×, and `annual_mwh` is consumption not generation).
Repointing those would silently restate the offer, so only the two no-change keys were wired:
`annual_energy_cost` → `cfe_bill_sin_pv_mxn` and `system_kwp` → `system_kwp_dc` (was live `#REF!`).
**The 6 conflicted figures are deferred to a basis-decision task** — API_OUTPUT exposes both bases
so that decision has no rework cost. `project_status` is a `PENDING_T4` placeholder.

## Verification done before handover

- Builder produces all 26 rows from the live CULLIGAN owners; both bases distinct (37.05M ≠ 43.59M);
  `cfe_bill_sin_pv_mxn` = 12,838,765.45, `pv_only_savings` = 1,928,019.45, `full_system_savings` =
  2,728,149, solar generation = 1,321 MWh.
- `node scripts/full_selftest.js`: **ALL GREEN**, Unit FAILs 0, Unit ERRORs 0, 44 workbook-dependent (+1 = REG_API_OUTPUT).
- All 4 new unit tests confirmed RAN + PASS; `REG_API_OUTPUT` confirmed RAN + errors with the expected workbook signature.
- `node --check` clean; `^--` grep clean (code files); fresh-clone round-trip applies over repo root and stays green.

## Post-deploy

Run **ARGIA ▸ Setup ▸ Run ALL Tests** (or the CULLIGAN E2E). You'll get a new `API_OUTPUT` tab and
`REG_API_OUTPUT` green. Spot-check `API_OUTPUT` — every figure should match its source-column owner.

---

## Deploy (GitHub + clasp)

```bash
# from repo root, after Apply + green self-test above
git add -A
git commit -m 'T2: API_OUTPUT single offer interface; both CAPEX bases; safe SLIDE repoints'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

> A version MISMATCH right after push is the Apps Script CDN cache — wait ~5 min and re-run the
> verify line. Both targets (`git push`, `clasp push`) are independent; verify confirms both.
