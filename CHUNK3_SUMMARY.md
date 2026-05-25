# Chunk 3 — PROJECT_CARD_v2

**Engine version:** 3.0.0 → **3.1.0** (MINOR, no legacy recalc)
**Active chunk tag:** `bess_install` → `chunk3`
**Status:** Built and self-tested in sandbox. Ready to push and verify on a real workbook.

---

## What landed

A parallel `PROJECT_CARD_v2` sheet is now written alongside the legacy `PROJECT_CARD` on every engine run. Legacy stays the source of truth until cutover (Chunk 11). PV-only projects render identical to legacy except for one new "Almacenamiento (BESS)" row showing an em-dash and one new "Storage" info-row also em-dash. BESS-enabled projects gain:

- **9th cost row** in COST COMPARISON: `Almacenamiento (BESS)`, value pulled from `BOM!SUBTOTAL_BESS` (row 92).
- **Scope-of-work line**: `<batteryId> — <stackQty> stack(s) (<kWh> kWh nominal)`, with singular/plural and `CUSTOM_MANUAL` → "Battery storage system" fallback.
- **Storage info row** in Additional Information: nominal kWh capacity only (no kW).
- **PASS/FAIL validation** against a new $/kWh USD envelope (defaults $350–$650).

## Files

### New
- `templates/setupProjectCardTemplate.js` — idempotent template, paints labels and section bands at fixed `PC_ROW` rows.
- `writers_v2/WriteProjectCardV2.js` — fills values + formulas at the fixed rows.
- `tests_unit/writers_v2/WriteProjectCardV2Tests.gs` — **12 unit tests** (66 assertions executed locally against a mock spreadsheet, all green).
- `tests_unit/templates/ProjectCardTemplateTests.gs` — **6 unit tests** (template invariants).

### Modified
- `02c_InputMap.js` — added `costRangeBessMin` (default 350) + `costRangeBessMax` (default 650) at INPUT_PROJECT row 61 cols D/E.
- `00_Main.js` — added `PC_ROW` + `PC_COL` constants, added Step 13-v2 in `runArgiaEngine()` wrapped in try/catch.
- `00a_Version.js` — `ENGINE_VERSION` bumped to `'3.1.0'` with release note.
- `templates/ActiveChunk.js` — `ACTIVE_CHUNK_TAG` bumped to `'chunk3'`.
- `CHANGELOG.md` — new `[3.1.0] — 2026-05-25` entry above `[3.0.0]`.

## Validation envelope: where the numbers came from

The $350–$650 USD/kWh range was calibrated against four real BAAS project files in `/mnt/project`. CAPEX from each design XLSX's `BESS!System cost` cell (row 16, col F), capacity from `BESS!` row 12, FX rate 18.20 MXN/USD (from BJX leasing proposal slide 15):

| Project | Capacity | CAPEX MXN | $/kWh USD |
|---|---|---|---|
| Autoplastek Puebla | 645 kWh | $5.42M | $461 |
| Draxlmaier | 10,000 kWh | $69.36M | $381 |
| Taigene León | 1,505 kWh | $10.54M | $385 |
| Culligan | 1,075 kWh | $11.33M | $579 |

Observed range $381–$579, envelope widened ~10% on each side to absorb vendor variation. Culligan at $579/kWh is meaningfully higher than the others — could be a small-system premium, different vendor mix, or quote-specific. Not investigating further; the envelope handles it.

## Architectural decisions

- **Template + writer split**: template owns row addresses (in `PC_ROW`), writer owns values. This is what makes PC_v2 cleanly testable with a mock sheet — assertions target known `(row, col)` addresses regardless of inverter count or BESS state. Legacy PC uses `row++` flow which couples layout to data and is much harder to test.
- **`PC_V2_PALETTE` defined in both template and writer** with `var X = (typeof X !== 'undefined' && X) ? X : {...}` guard, so neither file depends on the other being loaded first. Idiomatic for Apps Script V8.
- **`_testOpts.readInputFn` injection seam** on `writeProjectCardV2`. Apps Script V8 resolves bare-name function calls (`readInput(...)`) to lexical bindings, not globalThis properties, so swapping `globalThis.readInput` from a test doesn't work. The optional parameter is the cleanest seam — production callers omit it, tests pass `_makeReadInputFn(inputs)`.
- **PC_v2 reads from legacy BOM/INSTALLATION**, not BOM_v2/INSTALLATION_v2 — those sheets don't exist until Chunks 4/5. Means numeric parity with legacy PC is preserved by construction.
- **Selling-price USD/Wp denominator = PV `dcKwp` only** (industry standard; the BESS dollars show separately in the cost table). Gross profit formula unchanged from legacy semantics; it operates on the TOTAL row which now naturally includes BESS subtotal when enabled.

## Test results (sandbox)

Executed all 18 test fixtures against the actual writer + template code by loading the JS through Node with Apps Script global stubs.

- **Writer tests (12):** 31/31 assertions PASS
- **Template tests (6):** 35/35 assertions PASS
- **Combined: 66/66 PASS**

This is the strongest possible signal short of a real Apps Script run. Two real bugs caught during this self-test:

1. **`globalThis.readInput` mock strategy didn't work** — V8 resolves bare-name calls to lexical bindings. Fixed by adding optional `_testOpts.readInputFn` parameter.
2. **T5 idempotency test assertion was wrong** — `clear()` only fires when the sheet already exists; first call uses `insertSheet`. Updated assertions to reflect actual (correct) template behavior.

## Verification checklist for laptop after `clasp push` + `git commit`

1. **Run chunk-tagged tests** in the Apps Script editor:
   ```
   ARGIA → ▶ Run Tests for Current Chunk
   ```
   Expect: **18 chunk3 tests green** (12 writer + 6 template).

2. **Run full unit suite** to confirm no regressions:
   ```
   ARGIA → Run Unit Tests
   ```
   Expect: **~140 green** (122 existing + 18 new), zero failures.

3. **Run engine on a PV-only project** (e.g. CULLIGAN with BESS disabled):
   - PC_v2 sheet appears.
   - All 8 PV cost categories populate identically to legacy PC.
   - 9th row "Almacenamiento (BESS)" shows em-dash in cost cells.
   - Additional Info "Storage" row shows em-dash.
   - TOTAL row USD = legacy TOTAL USD (sanity).
   - Selling Price USD/Wp formula evaluates to the same value as legacy.

4. **Run engine on a BESS project** (Taigene or Autoplastek-style):
   - PC_v2 BESS row shows USD + MXN populated from BOM!SUBTOTAL_BESS.
   - Scope-of-work has a battery line with the right batteryId, stack count, kWh.
   - Storage info row shows nominal kWh.
   - BESS row's validation cell shows PASS (if $/kWh is in 350–650) or FAIL with a $/kWh annotation in the note.
   - TOTAL row USD = sum of 9 cost categories (PC_v2 includes BESS; legacy doesn't have a BESS row at all — that's the point of v2).
   - Gross profit USD > legacy gross profit USD by approximately the BESS sales-price contribution.

5. **Open a project that already ran on engine 3.0.0**: confirm legacy PROJECT_CARD numbers are unchanged. The new sheet is additive — no recalc.

## What's deliberately not in this chunk

- No menu entry for "Generate PC v2 standalone" — only generated as part of full engine run. A standalone entry lands in Chunk 11 (cutover).
- No deletion of legacy PROJECT_CARD — it remains the source of truth until cutover.
- No changes to BOM, INSTALLATION, MDC, or any other sheet.
- PC_v2 reads legacy BOM/INSTALLATION — switching to BOM_v2/INSTALLATION_v2 happens after those land in Chunks 4 + 5.
