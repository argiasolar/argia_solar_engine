# ARGIA Engine — v4.49.0 (SLIDE_DATA rebuild · chunk 1: API_OUTPUT projection)

The legacy SLIDE_DATA tab is the external presentation tool's contract (flat `key → value`, read by
key) but it was **broken** — many figures `#REF!` or stale (`annual_mwh` showed 4475 vs the real
~1321), with only 5 keys safe-repointed in T2. This rebuilds it as a clean **projection of
API_OUTPUT** (the canonical T2 offer interface).

---

## What changed

**`38_WriteSlideData.js`** (new) — `writeSlideDataV2(ss)` rebuilds the tab:

- **`api` keys** (13) → `=INDEX(API_OUTPUT!B:B, MATCH("<key>", API_OUTPUT!A:A, 0))`. Label-anchored,
  survives row drift; the offer numbers can never drift from API_OUTPUT again.
- **`config` keys** (10: salesperson_*, dates, location, observations, notes) and **`derived` figure
  gaps** (20: tariff_type, panel_w, inv_kw, area_m2, coverage, avg_price, prod_jan..dec) → **clean
  blank + a "pendiente" note** — never `#REF!`. Filled by the next chunks.

The four **ConsistencyGuard** keys (`annual_energy_cost`, `annual_savings`, `capex_total`,
`system_kwp`) keep their exact T2 API mappings, so no guarded value changes and the guard stays green.

**`31a_RunClientFinancials.js`** — the post-API_OUTPUT hook now calls `writeSlideDataV2` (full
projection) instead of the T2 5-key repair (kept as fallback).

## Tests

- `UNIT_SLIDE_DATA_PLAN` — 43-key contract, guard keys on exact mappings, api/config/derived split,
  formula shape.
- `REG_SLIDE_DATA_CULLIGAN` (live) — no `#REF!`; guarded figures hit CULLIGAN goldens (system_kwp 864,
  sin-PV 12.84M, offer 43.67M); `annual_mwh` ~1321 (was 4475 stale); config keys clean-blank.

Self-test **ALL GREEN**, 0 Unit FAIL / 0 Unit ERROR. Workbook-dependent 55 → **56** (+1 live REG).

## Architecture & remaining chunks

SLIDE_DATA = **projection of API_OUTPUT** + config + offer-type. Decisions baked in (per the parked
recommendations): the external contract = the existing key list; the canonical source = API_OUTPUT;
API keys belong in Script Properties (not sheet cells).

| Chunk | Scope |
|---|---|
| **1 (this)** | API_OUTPUT projection; fixes all figure `#REF!`/stale; config/derived → clean blanks |
| 2 | `99_SETUP` config tab (salesperson/dates/observations) + API_OUTPUT figure extensions (panel_w, inv_kw, area_m2, coverage, avg_price, prod_jan..dec) → fills the blanks |
| 3 | Offer-type variation (derived from `businessCase`) + IMAGES/Drive block |

---

## Files

```
00a_Version.js                                      4.48.0 -> 4.49.0
38_WriteSlideData.js                                NEW  (writeSlideDataV2 + plan)
31a_RunClientFinancials.js                          call writeSlideDataV2 (was 5-key repair)
tests_unit/writers_v2/SlideDataPlanTests.gs         NEW
tests_regression/v2/SlideDataCulliganTests.gs       NEW
CHANGELOG.md / README_4.49.0.md
```

## Deploy

```bash
git pull
unzip -o ~/Downloads/argia_v4.49.0_SLIDE_DATA_a.zip -d .
node scripts/full_selftest.js

git add -A
git commit -m 'SLIDE_DATA rebuild chunk 1: clean API_OUTPUT projection, fixes broken figure keys'
git push

clasp push --force 2>&1 | tee .clasp_last_push.log
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Then run the CULLIGAN E2E. Expected: **still all-green** plus the new SLIDE_DATA assertions (no
`#REF!`, guarded figures correct). The ConsistencyGuard stays green (guarded keys unchanged).
