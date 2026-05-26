# Chunk 5 Summary — INSTALLATION_v2

**Engine version:** 3.3.0
**Date:** 2026-05-25
**Status:** Code-complete + 28/28 unit tests passing. Pending visual verification against legacy INSTALLATION.

---

## What ships

| Layer | File | Role |
|---|---|---|
| Template | `templates/setupInstallationTemplate.js` | **Beefy** — seeds banner, panel headers, 30 driver-key labels (col A), NOTES column (col C), 8 dropdowns, percent formatting, cream palette, currency formats |
| Writer | `writers_v2/WriteInstallationV2.js` | Two exports: `writeInstallationV2(...)` for main sheet, `writeInstallationDriverMapV2(...)` for audit sheet. Populates VALUES only (col B + summary + section grid + MH + line items). |
| Registry | `templates/TemplateRegistry.js` | Added `V2_SHEETS.INSTALL_DRIVER_MAP = '95_INSTALL_DRIVER_MAP_v2'` |
| Wiring | `00_Main.js` | Step 12-v2 after Step 12, try/catch wrapped |
| Engine | `13_CalcInstallCost.js` | Tiny edit: `result.drivers = drivers` |
| Tests | `tests_unit/templates/InstallationTemplateTests.gs` | 12 tests |
| Tests | `tests_unit/writers_v2/WriteInstallationV2Tests.gs` | 16 tests |

---

## Why the rebuild

Original chunk 5 build used a thin template per Q4 ("writer does ALL formatting"). That decision turned out to be wrong: the legacy INSTALLATION sheet's structure comes from THREE sources, and only one of them (the writer) was inside chunk 5's scope as originally framed.

Sources of legacy INSTALLATION structure:
1. `addInstallationBanner` in `02e_InputSetup.js` — banner rows 1-3
2. `restyleInstallationTopZone` in `02e_InputSetup.js` — palette, borders, currency formatting
3. **Manual hand-entry** — col A labels, col C NOTES, dropdowns. No code generates these; they were typed once long ago and have been preserved on the live sheet ever since.

The first v2 build (thin template + verbatim writer port) faithfully implemented #3's writer assumption: "a structure already exists; just populate values." But the v2 sheet had no pre-existing structure to populate onto, so the visual result was barely usable.

**The rebuild moves all structure-creation responsibility into the template.** This is the right answer for v2 because there's no "hand-built sheet" to preserve. The template now generates everything legacy assumed pre-existed.

---

## Driver block layout (rows 4-34)

| Row | Col A label (template) | Col B value (writer) | Col C NOTES (template) |
|---|---|---|---|
| 4  | `DRIVER / INPUT` | `VALUE` | `NOTES` |
| 5  | `PROJECT_DC_WP` | `drivers.projectDcWp` | Link from engine |
| 6  | `PROJECT_DC_KWP` | `drivers.projectDcKwp` | Auto |
| 7  | `PROJECT_AC_KW` | `drivers.projectAcKw` | Link from engine |
| 8  | `MODULE_COUNT` | `drivers.moduleCount` | Link from engine/BOM |
| 9  | `INVERTER_COUNT` | `drivers.inverterCount` | Link from engine/BOM |
| 10 | `STRING_COUNT` | `drivers.stringCount` | Link from engine |
| 11 | `ARRAY_GROSS_AREA_M2` | `drivers.arrayGrossAreaM2` | Link from layout/helper |
| 12 | `ARRAY_NET_AREA_M2` | `drivers.arrayNetAreaM2` | Link from layout/helper |
| 13 | `ROOF_AREA_M2` | `drivers.roofAreaM2` | Input/helper |
| 14 | `DC_CABLE_M` | `drivers.dcCableM` | Link from BOM/helper |
| 15 | `AC_CABLE_M` | `drivers.acCableM` | Link from BOM/helper |
| 16 | `TRAY_M` | `drivers.trayM` | Link from BOM/helper |
| 17 | `CONDUIT_M` | `drivers.conduitM` | Link from BOM/helper |
| 18 | `GROUNDING_M` | `drivers.groundingM` | Link from BOM/helper |
| 19 | `INTERCONNECTION_POINTS` | `drivers.interconnectionPts` | Project specific |
| 20 | `ANCHOR_COUNT` | `drivers.anchorCount` | Project specific |
| 21 | `CREW_SIZE` | `drivers.crewSize` | Estimator input |
| 22 | `EST_PROJECT_DAYS` | `drivers.estProjectDays` | Estimator input |
| 23 | `WORK_HEIGHT_M` | `drivers.workHeightM` | Estimator input |
| 24 | `INSTALLATION_TYPE` | `drivers.installationType` (dropdown: ROOF/GROUND/CARPORT) | Dropdown |
| 25 | `ACCESS_DIFFICULTY` | `drivers.factorSelections.ACCESS_DIFFICULTY` (dropdown: EASY/MEDIUM/HARD/VERY_HARD) | Dropdown |
| 26 | `SITE_HSE_CLASS` | (dropdown: STANDARD/STRICT/HIGH_CONTROL) | Dropdown |
| 27 | `ENERGIZED_TIE_IN` | (dropdown: YES/NO) | Dropdown |
| 28 | `SITE_DISTANCE_CLASS` | (dropdown: LOCAL/REGIONAL/REMOTE) | Dropdown |
| 29 | `NIGHT_WORK_REQUIRED` | (dropdown: YES/NO) | Dropdown |
| 30 | `PROJECT_COMPLEXITY` | (dropdown: LOW/MEDIUM/HIGH) | Dropdown |
| 31 | `WEATHER_PROFILE` | (dropdown: DRY/RAIN_SEASON) | Dropdown |
| 32 | `BLENDED_LABOR_RATE_MXN_MH` | `totals.avgRateMxnMH` | Reference only |
| 33 | `CONTINGENCY_PCT` | `drivers.contingencyPct` (decimal, formatted as `0.00%`) | Override allowed |
| 34 | `INSURANCE_PCT_ON_LABOR_EQUIP` | `drivers.insurancePct` (decimal, formatted as `0.00%`) | Override allowed |

Row-by-row alignment verified: template col A labels and writer col B values land on the same row, every row. Cross-checked programmatically.

---

## Known parity quirks (deliberate)

| Item | v2 behavior | Legacy behavior | Notes |
|---|---|---|---|
| Dropdowns on rows 24-31 | Editable, display-only (no engine read) | Editable, display-only | Engine reads from `INPUT_INSTALL`. Editing these dropdowns has no effect on the next run, same as legacy. |
| G4 grand-total cell | Formula `=G9` (live mirror) | Stale manual entry "$242,159" | v2 auto-updates; legacy showed unreliable value. Flag if strict-legacy (blank G4) is wanted. |
| BESS section color | Deep purple `#311B92` / `#EDE7F6` / `#D1C4E9` | Grey fallback (no BESS entry in palette) | Visual addition; flag for cutover review. |
| Col A labels in driver block | Written by template | Written by hand long ago | Strict superset — v2 doesn't need anyone to type labels by hand. |

---

## Verification done

- ✅ `node --check` on template + writer — syntax clean
- ✅ 12 template tests pass (banner, panel headers, 30 labels, NOTES, dropdowns, defaults, percent formats, frozen rows, gridlines)
- ✅ 16 writer tests pass (driver values, factor selections, blended rate, percent rows, summary, section grid, MH breakdown, line items, zero-cost styling, grand total, legend, driver-map no-op, driver-map updates, null result, no col-A writes)
- ✅ Cross-check: template + writer agree on row-by-row driver order (30/30, 0 mismatches)
- ✅ Driver value map cross-check: 30 keys in `_INST_V2_DRIVER_ROW_KEYS`, 30 keys in `drvValueMap`, no gaps

## Verification still TODO

- ⚠️ Visual side-by-side compare INSTALLATION_v2 vs legacy INSTALLATION on a real Google Sheet (Apps Script run, not unit-test rig)
- ⚠️ Confirm Apps Script's `_insertArgiaLogo` resolves correctly when run live (template uses a try/catch so worst case = no logo, but title text still appears)
- ⚠️ Visual review of BESS purple palette before Chunk 11 cutover
