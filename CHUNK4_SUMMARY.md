# Chunk 4 — BOM_v2 Summary

**Engine version:** 3.1.0 → **3.2.0**
**Active chunk tag:** `chunk4`
**Date:** 2026-05-25

---

## What shipped

| Layer | File | LOC | What it does |
|---|---|---:|---|
| DB helpers | `writers_v2/helpers/BomDbHelpers.js` | ~450 | Namespaced `_bomV2_*` port of every legacy BOM DB helper. Stateless, no shared writer code with legacy. |
| Template | `templates/setupBomTemplate.js` | ~210 | Idempotent BOM_v2 sheet builder — banner, headers, 8 pre-styled section bands, 8 subtotal rows, grand total. |
| Writer | `writers_v2/WriteBomV2.js` | ~720 | Data writer mirroring legacy `08_WriteBOM.js` section-by-section. Hidden `_testOpts` injection seam. |
| Engine | `00_Main.js` (modified) | +12 | Step 11-v2 wired after Step 11. Try/catch so v2 bug never breaks legacy. |
| Version | `00a_Version.js` (modified) | +9 | ENGINE_VERSION 3.1.0 → 3.2.0 with release note. |
| Active chunk | `templates/ActiveChunk.js` (modified) | 1 line | `chunk3` → `chunk4` |
| Tests | `tests_unit/writers_v2/BomDbHelpersTests.gs` | ~360 | 8 unit tests for DB helpers |
| Tests | `tests_unit/templates/BomTemplateTests.gs` | ~280 | 6 unit tests for template |
| Tests | `tests_unit/writers_v2/WriteBomV2Tests.gs` | ~870 | 12 unit tests for writer |

**Total tests added:** 26 (all tagged `chunk4`).
**Self-test result:** 26/26 PASS (verified locally with Node before zip).

---

## How to verify after pushing

### Step 1 — push and reload the spreadsheet

```bash
cd argia_solar_engine
clasp push
```

Refresh the spreadsheet to pick up the new files.

### Step 2 — run the chunk4 tests

In the spreadsheet menu:

▶ **Argia → Tests → Run Tests for Current Chunk**

Expected: **26 tests, 26 PASS, 0 FAIL** under module
`writers_v2/bomdb`, `templates/bom`, and `writers_v2/bom`.

If a test fails, copy the row from `_TEST_RESULTS_V2` and send it over.

### Step 3 — run the full unit suite

▶ **Argia → Tests → Run Unit Tests**

Expected: all previous chunks still green (140 tests from chunks 0-3)
+ 26 new chunk4 tests = ~166 total. The new tests should be
distinguishable by their `chunk4` tag in the results sheet.

### Step 4 — run the engine on CULLIGAN (PV-only)

▶ **Argia → Run Engine**

Then open both sheets side-by-side:
- `BOM` (legacy, source of truth)
- `BOM_v2` (new)

Visual check, top to bottom:
- Banner + project meta row 4 + headers row 5 + TC F6 = identical
- §1 PANELS: primary panel row matches qty/desc/price/total
- §2 INVERSORES: each bank row matches
- §3 ESTRUCTURA: primary structure resolved correctly, inverter
  mounting row present, subtotal matches
- §4 ELECTRICO DC: cable / EGC / MC4 / OCPD / conduit qty + price
  match. RSD row blank if not required.
- §5 ELECTRICO AC: main feeder + EGC + breaker + conduit + panelboard
  match; per-inverter blocks at rows 42-61
- §6 TRANSFORMADOR: matches inp.supplyTransformer (Argia-supplied
  vs customer-supplied)
- §7 MONITOREO: datalogger + meter + 4 services @ $1500 USD
- §8 BESS: single "pendiente" line at row 80 (PV-only case)
- **GRAND_TOTAL row 94:** USD value should match within rounding
  (1 cent tolerance) — this is the parity benchmark

### Step 5 — run the engine on a BESS project (Taigene / Autoplastek)

Same as Step 4 but check §8 specifically:
- Rows 80-91 populated with BESS-01..BESS-12 line items
- BESS_BATTERY_LINE shows battery price (MXN formula referencing TC)
- BESS_COMMISSIONING shows flat commissioning fee
- §8 subtotal at row 92 matches legacy
- Grand total at row 94 includes §8 subtotal in both sheets

### Pass criteria

1. 26/26 chunk4 tests green
2. All previous chunk tests still green
3. BOM_v2 grand total = legacy BOM grand total (USD, within 1 cent
   rounding tolerance) on both PV-only and BESS projects
4. No "BOM_v2 skipped" warning in engineLog

---

## Architectural decisions worth remembering

1. **DB helpers namespaced `_bomV2_*`.** Two parallel codebases per the
   migration plan §2; both helper sets coexist until cutover. After
   cutover the helpers move out of writers_v2/ into a shared db/ folder
   and lose the prefix.

2. **Verbatim port, no refactor.** Behavior is byte-identical to legacy
   for the same inputs. Two pre-existing legacy quirks (DC PV WIRE cable
   and AC main breaker dispatching BOS MXN prices as USD) are preserved
   in v2 — called out in test comments as "legacy parity quirk" so
   post-cutover cleanup is straightforward.

3. **§8 BESS reset block from legacy is gone in v2.** Legacy needed it
   because the template didn't own row heights / backgrounds / alignment
   on §8 rows. v2 template applies correct styles up front; no
   per-write cleanup needed.

4. **Test seam.** The writer's 10th param `_testOpts` exposes injection
   for `readInputFn`, `loadBosDbFn`, `loadStructureDbFn`,
   `lookupBatteryPriceFn`, `readElecTablesFn`, `selectConduitFn`,
   `conductorUnitFn`. Production callers omit it; tests use it so they
   don't need real sheets.

---

## Open / deferred

- **Cleanup of the two legacy parity quirks** (DC PV WIRE cable price
  dispatch + AC main breaker price dispatch). Both should branch on
  `isUsd` like the EGC / conduit / panelboard lines already do.
  Deferred to post-cutover cleanup.
- **REG_CULLIGAN_BASELINE_V2 BOM assertions.** Not added in this chunk;
  the regression baseline will get BOM-section assertions in a future
  pass once we have a locked CULLIGAN BESS-enabled run to compare
  against.
- **Cutover** is Chunk 11 in the plan. Not for this chunk.
