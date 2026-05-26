# Changelog

All notable changes to ARGIA Engine.

Format: based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (MAJOR.MINOR.PATCH).

- **MAJOR** — breaking change; existing project workbooks will recalculate to different numbers
- **MINOR** — new feature; existing projects recalculate the same
- **PATCH** — bug fix; should not change numbers (document regression risk if it does)

---

## [3.5.0] — 2026-05-26

Chunk 7 of the output-v2 migration. Lands CFE_OUTPUT_v2 alongside the
legacy CFE_OUTPUT. **No legacy recalc** — legacy CFE_OUTPUT continues
rendering unchanged; v2 is parallel and additive.

### Added — Chunk 7 (CFE_OUTPUT_v2)

- New file `templates/setupCfeOutputTemplate.js`: strict template/writer
  split (matches chunks 4/5 pattern). Owns:
  - 16-column canvas + hidden gridlines
  - Banner: logo at (2, 1), title at (2, 3), subtitle at (3, 3) —
    matches the v2 banner convention from chunks 2-6
  - Header strip labels (rows 5-8, cols B and H)
  - KPI strip row height (row 10)
  - Section 1 (Con PV) header at row 12, month header at row 13,
    static col-B labels for rows 14-20
  - Section 2 (Con PV + BESS) header at row 22, month header at row 23,
    static col-B labels for rows 24-31
  - Annual footer header at row 33 + cascade label blocks at row 34
  - Frozen rows = 10 (banner + KPI strip stays visible on scroll)
  - **Image cleanup on refresh** — calls `sh.getImages().forEach(img.remove)`
    to prevent the stacked-logo issue observed with chunk 6 RFQs
- New file `writers_v2/WriteCfeOutputV2.js`: data writer. Entry points:
  - `writeCfeOutputV2(ss, hourlySim)` — engine entry, called from
    Step 13.5-v2. When `hourlySim` is provided AND not `.blocked`, the
    BDF-5 hourly addendum is appended (rows 45-64 by default): hourly
    engine summary (Sin PV / Con PV+BESS / Ahorro), bill components
    breakdown (11 line items: Capacidad through Facturación TOTAL),
    provenance line, and optional warnings line. R1 fallback (energy +
    demand split with a "rate data missing" note) renders when
    `hourlySim.annual.fullBill` is absent. Ported verbatim from legacy
    `_cfeOutWriteHourlySimAddendum` (lines 966-1057 of
    `06_WriteCfeOutput.js`) — same data sources, labels, colors.
  - `runUpdateCfeOutputV2()` — menu entry. Passes `null` for hourlySim,
    so menu-triggered refreshes skip the BDF-5 block.
- New file `writers_v2/helpers/CfeOutputSourceMap.js`:
  - `CFE_OUT_SRC_V2` — source cell map (verbatim copy of legacy
    `CFE_OUT_SRC`; v2 must not import legacy symbols)
  - `readCfeScalar(ss, key)` / `readCfeMonthly(ss, key)` — read helpers
  - `CFE_OUT_MONTHS_V2` — Ene..Dic labels
- 3 test files (34 tests, 292 assertions, all green via Node shim)

### Changed

- `00_Main.js`:
  - Added menu item "Update CFE_OUTPUT v2" right after legacy "Update
    CFE_OUTPUT"
  - Added menu item "Generate RFQs v2" right after legacy "Generate RFQs"
    (carry-forward from chunk 6, which was never landed in this branch)
  - Added engine **Step 13.5-v2** immediately after legacy Step 13.5:
    parallel v2 writer call, same try/catch isolation pattern
- `templates/ActiveChunk.js`: `ACTIVE_CHUNK_TAG` → `chunk7` (skips
  through `chunk6` which was never landed)
- `00a_Version.js`: `ENGINE_VERSION` `3.3.0` → `3.5.0` (jumps through
  3.4.0 which carries chunk-6 release notes inline)

### Architecture notes

- **Strict template/writer split** chosen over the pragmatic approach.
  Template = layout only; writer = data only. Matches chunks 4/5.
- **NO charts.** Legacy chart code was disabled in BDF-11 (the
  `_cfeOutBuildCharts` function still exists but the call site is
  commented out — see lines 320-329 of `06_WriteCfeOutput.js`). v2
  does not migrate the dead chart code.
- **BDF-5 hourly addendum and bill components block ARE migrated.**
  Initial chunk-7 design dropped these as designer-facing, but verifying
  side-by-side against legacy in the live workbook showed they're
  needed in v2 too. Ported verbatim from
  `_cfeOutWriteHourlySimAddendum`: same data sources
  (`hourlySim.annual`, `.baseline`, `.savingsMxn`, `.annual.fullBill`,
  `.provenance`, `.warnings`), same labels, same colors. Positioning
  uses `getLastRow()+3` (matches legacy) so the block lands right after
  whatever was last rendered — Y1SS at row 42 or the footer at row 35.
- **Engine-wired AND menu** — per user decision. Engine call runs every
  `runArgiaEngine()`; menu call lets designers update CFE_OUTPUT_v2 on
  demand without rerunning the full engine.
- **Sheet positioning** — CFE_OUTPUT_v2 is inserted immediately BEFORE
  MDC_v2 in the tab order if MDC_v2 exists. Falls back to append if
  MDC_v2 is missing (e.g. chunk 2 hasn't run on this workbook).
- v2 reads from `INPUT_CFE`, `CFE_SIMULATION`, `BESS_SIMULATION` — the
  same upstream sheets legacy reads from. These are not v2-renamed; they
  are owned by other modules.
- No legacy CFE_OUTPUT code is touched. `06_WriteCfeOutput.js`,
  `CFE_OUT_SRC`, `CFE_OUT_ROW`, `_cfeOutReadScalar`, `_cfeOutReadMonthly`,
  `_cfeOutWriteHeaderStrip`, `_cfeOutWriteKpiStrip`, `_cfeOutWriteSection1`,
  `_cfeOutWriteSection2`, `_cfeOutWriteFooter`, `_cfeOutWriteYear1SteadySection`,
  `setupCfeOutput` (menu entry) all remain untouched.

### Verification status

- ✅ All source files: `node --check` clean
- ✅ 34 unit tests / 292 assertions green via Node shim
- ⚠️ Visual verification on real spreadsheet: PENDING (run engine, then
  compare CFE_OUTPUT_v2 side-by-side with legacy CFE_OUTPUT)
- ⚠️ Y1SS section visual: PENDING (only renders if BESS steady-state
  setup tool has been run on the workbook)
- ⚠️ KPI tile 3 rich-text rendering: PENDING (rich text mocked in tests)

---

## [3.4.0] — 2026-05-26

Chunk 6 of the output-v2 migration. Lands RFQs_v2: six parallel v2 RFQ
sheets generated on demand via a new menu item. **No legacy recalc** —
legacy RFQs continue working via the existing "Generate RFQs" menu item.
**Note:** this version entry covers code that may not have been landed
in the main branch; the chunk 7 release picks up its files.

### Added — Chunk 6 (RFQs_v2)

- Six v2 RFQ sheets: `RFQ_PANELES_v2`, `RFQ_INVERSORES_v2`,
  `RFQ_ESTRUCTURA_v2`, `RFQ_ELECTRICO_v2` (includes BESS electrical BOS),
  `RFQ_MONITOREO_v2`, `RFQ_BESS_v2` (NEW — no legacy counterpart).
- Files: `templates/RfqRegistry.js`, `templates/setupRfqTemplate.js`,
  `writers_v2/WriteRfqV2.js`, `writers_v2/helpers/RfqBomReader.js`, plus
  4 test files (36 tests, 248 assertions, all green).
- Menu item "Generate RFQs v2" calls `runWriteAllRfqsV2`. Not wired into
  engine — menu-only.
- BESS row split: battery (row 80) + commissioning (row 91) → RFQ_BESS_v2;
  electrical BOS (rows 81-90) → RFQ_ELECTRICO_v2.

### Architecture notes

- v2 reads from BOM_v2 (not legacy BOM). RFQ year stamped from
  `_META!B6` (calculated_at).
- Banner convention: logo at (2, 1), title at (2, 3). Title-bar dark
  styling dropped; matches BOM_v2 / MDC_v2 / INSTALLATION_v2.
- Known limitation: floating-image cleanup not implemented in chunk 6.
  Re-running "Generate RFQs v2" without first deleting the v2 RFQ sheets
  stacks logos. Chunk 7 fixes this for CFE_OUTPUT_v2 via
  `_cfeOutV2_removeImages` and the same pattern should be retrofitted
  to other v2 templates in a follow-up chunk.

---

## [3.3.0] — 2026-05-25

Chunk 5 of the output-v2 migration. Lands INSTALLATION_v2 alongside the
legacy INSTALLATION, plus the v2 audit sheet 95_INSTALL_DRIVER_MAP_v2.
**No legacy recalc** — legacy INSTALLATION continues writing unchanged;
v2 is parallel and additive.

### Added — Chunk 5 (INSTALLATION_v2)

- New file `templates/setupInstallationTemplate.js`: **beefy template** that
  seeds all the structural content the writer doesn't generate.
  Specifically:
  - Banner rows 1-3: ARGIA logo at A2, "INSTALACIÓN · MXN" title at C2,
    Spanish subtitle at C3. Mirrors legacy `addInstallationBanner`.
  - Row 4 panel headers: "DRIVER / INPUT | VALUE | NOTES" in A4-C4 plus
    "SUMMARY | =G9" in F4-G4. G4 is a formula mirror of the grand total.
  - 30 driver-key labels in col A rows 5-34, in legacy order:
    PROJECT_DC_WP..WORK_HEIGHT_M (engine drivers, rows 5-23),
    INSTALLATION_TYPE..WEATHER_PROFILE (factor selections, rows 24-31),
    BLENDED_LABOR_RATE_MXN_MH (row 32),
    CONTINGENCY_PCT + INSURANCE_PCT_ON_LABOR_EQUIP (rows 33-34).
  - NOTES helper text in col C rows 5-34, verbatim from legacy screenshot
    ("Link from engine", "Estimator input", "Dropdown", "Reference only",
    "Override allowed", etc).
  - Data-validation dropdowns on rows 24-31 col B. Allowed-values lists
    sourced from `02c_InputMap.js` (single source of truth). Defaults
    pre-populated (ROOF, MEDIUM, STANDARD, NO, LOCAL, NO, MEDIUM, DRY).
  - Percent-format `0.00%` + defaults (0.05 / 0.03) on rows 33-34.
  - Currency `"$"#,##0` formatting on summary block + section grid.
  - Cream/grey palette mirroring legacy `restyleInstallationTopZone`.
  - Frozen rows = 3, hidden gridlines.
- New file `writers_v2/WriteInstallationV2.js`: data writer with two
  exports — `writeInstallationV2(ss, result, drivers, _testOpts)` for the
  main INSTALLATION_v2 sheet, and `writeInstallationDriverMapV2(ss, drivers,
  result, _testOpts)` for the audit sheet 95_INSTALL_DRIVER_MAP_v2. Mirrors
  the legacy `writeInstallCost` calculation outputs byte-for-byte. Writer
  does NOT touch col A or col C in the driver block (template's job).
  Writer populates col B values for all 30 driver rows including factor
  selections (sourced from `drivers.factorSelections`) and percent rows.
  Currency formatting applied to summary, section grid, MH breakdown, and
  line-item zone.
- `templates/TemplateRegistry.js`: added `V2_SHEETS.INSTALL_DRIVER_MAP
  = '95_INSTALL_DRIVER_MAP_v2'` so Reset Outputs (Chunk 12) can find the
  v2 audit sheet.
- `00_Main.js`: Step 12 captures `var installResult = runInstallCost(...)`
  return value. Step 12-v2 added after Step 12, wrapped in `try/catch`.
  Wires `setupInstallationTemplate(ss)` + `writeInstallationV2(...)` +
  `writeInstallationDriverMapV2(...)`.
- `13_CalcInstallCost.js`: tiny additive edit to `runInstallCost` —
  attaches `result.drivers = drivers` before return. Lets Step 12-v2
  reuse both without re-running calc layers. Backward-compatible.

### Why "beefy template" instead of "thin shell"

Original chunk 5 plan answered Q4 "writer does ALL formatting" and used a
thin template that only ensured the sheet existed. First user run revealed
visual gaps: no banner, no NOTES column, no dropdowns, no currency
formatting, only 24 of 30 driver-block rows populated. Root cause: the
legacy INSTALLATION sheet's structure comes from THREE sources —
`addInstallationBanner` (banner), `restyleInstallationTopZone` (palette +
formatting), and **manual hand-entry** (col A labels, col C NOTES,
dropdowns — none of which any code generates). The writer was a verbatim
port of `writeInstallCost`, which faithfully populates values onto an
already-existing hand-built structure. v2 has no hand-built structure;
the template now generates everything legacy assumed pre-existed.

### Parity quirks preserved

- Dropdowns on INSTALLATION_v2 rows 24-31 are display-only mirrors. Engine
  reads selections from INPUT_INSTALL, not from this sheet. Editing the
  dropdowns has no effect on the next engine run. Same behavior as legacy.
- 95_INSTALL_DRIVER_MAP_v2 graceful no-op when sheet missing — matches
  legacy `if (!sh) return`. Sheet structure not seeded by v2; comes from
  IMPORTRANGE or manual setup, same as legacy.
- G4 mirrors G9 via formula `=G9` (auto-updating grand-total banner). The
  legacy sheet's screenshot showed a stale "$242,159" manual entry there —
  v2 replaces it with a live formula. If strict-legacy behavior (leave G4
  blank) is wanted, raise it.

### BESS color forward-compatible addition

- Legacy `SEC_HDR_BG`/`SEC_ITEM_BG`/`SEC_SUB_BG` palettes don't list a
  BESS entry, so BESS lines render with grey fallback.
- v2 explicitly adds BESS palette entries with deep purple
  (`#311B92` / `#EDE7F6` / `#D1C4E9`) for visual distinction from INDIRECT.
- Flag for visual review before cutover (Chunk 11).

### Tests — Chunk 5

- 12 template tests: sheet creation + idempotency, custom-sheet override,
  banner content, A4-C4 panel headers, F4-G4 SUMMARY + =G9 formula,
  30 driver-key labels in col A, NOTES helper text in col C, 8 dropdowns
  on rows 24-31 with allowed-values from InputMap, dropdown defaults
  pre-populated, percent rows format + defaults, frozen rows = 3,
  setHiddenGridlines.
- 16 writer tests: throws-on-missing-sheet, driver values rows 5-23,
  factor selections rows 24-31, BLENDED_LABOR_RATE row 32, percent rows
  33-34 (decimal), summary block, section grid, MH breakdown, line-item
  zone, zero-cost row styling, grand total, legend, driver-map no-op,
  driver-map updates, null result handling, writer does NOT write col A
  labels in driver block.
- All 28 unit tests pass via `node scripts/chunk5_selftest.js`.

---

## [3.2.0] — 2026-05-25

Chunk 4 of the output-v2 migration. Lands BOM_v2 alongside the legacy
BOM. **No legacy recalc** — legacy BOM continues writing unchanged; v2
is parallel and additive.

### Added — Chunk 4 (BOM_v2)

- New file `writers_v2/helpers/BomDbHelpers.js`: namespaced `_bomV2_*`
  port of every DB-lookup helper from legacy `08_WriteBOM.js`
  (`loadBosDb`, `loadStructureDb`, `resolveStructure`, `bosPriceObj`,
  `conductorPriceObj`, `groundPriceObj`, `conduitPriceObj`,
  `breakerILinePriceObj`, `breakerPriceWithFallback`,
  `panelboardPriceObj`, `transformerPriceObj`, `mc4PriceObj`,
  `monitoringPriceObj`, `meterPriceObj`, `ladderTrayPriceObj`, and their
  `*PriceMxn` thin wrappers). Verbatim port — every function returns
  byte-identical values to the legacy helper for the same inputs. No
  shared writer code with legacy per the plan §2.
- New file `templates/setupBomTemplate.js`: idempotent template that
  builds the BOM_v2 sheet with banner, project meta row, column header
  row, exchange-rate row, 8 pre-styled section header bands, 8 pre-styled
  subtotal rows, and the grand total band. Owns all formatting (column
  widths, row heights, number formats, alignment, fonts, borders, freeze).
  Pure setup — never touches data.
- New file `writers_v2/WriteBomV2.js`: data writer that fills BOM_v2 at
  the fixed rows defined in `BOM_ROW`. Mirrors legacy `08_WriteBOM.js`
  section-by-section across all 8 sections (panels / inverters /
  structure / DC / AC / transformer / monitoring / BESS) plus grand
  total. Same wp() / ws() helper signatures, same formula shapes, same
  cell-note text.
- New §8 BESS handling in BOM_v2 (preserves legacy parity):
  - PV-only or BoS-blocked → single "Sistema BESS — pendiente"
    explanatory line at BESS_BATTERY_LINE.
  - BESS-enabled → maps BESS-01..BESS-12 codes to fixed rows
    (BESS_BATTERY_LINE through BESS_COMMISSIONING). Price resolution
    dispatches by productCategory: BESS_BATTERY → `lookupBatteryUnitPrice`
    (shared infra), COMMISSIONING → `productSpec.flatPriceMxn`,
    CONDUCTORS/CONDUIT/DISTRIBUTION → `_bomV2_resolveBessBosPrice` in the
    same file (verbatim port of legacy `_resolveBessBosPrice`).
- Step 11-v2 wired into `runArgiaEngine` after Step 11. Calls
  `setupBomTemplate(ss)` then `writeBomV2(...)`, wrapped in its own
  try/catch matching Step 10-v2 (MDC) and Step 13-v2 (PC) pattern. A v2
  bug never breaks the legacy pipeline.

### Removed in v2

- The §8 BESS row reset block from legacy `08_WriteBOM.js`
  (lines 936–991, ~55 lines of layout cleanup). In legacy it was
  necessary because the template didn't own row heights / backgrounds /
  alignment on §8 rows, so the writer had to normalize them every run.
  v2 template applies the right styles from the start, so the reset
  block isn't needed.

### Tests

- `tests_unit/writers_v2/BomDbHelpersTests.gs` — 8 unit tests for the
  `_bomV2_*` helpers covering BOS lookup, conductor cascade
  (THHW → PV WIRE), conduit size→label mapping + DE-pattern matching,
  breaker fallback (exact → next-size cascade → null+note),
  panelboard smallest-fit selection, structure resolver's 3 paths
  (STR_ID tail / brand+model / model-only), and BOS_CURRENCY=USD flag.
- `tests_unit/templates/BomTemplateTests.gs` — 6 unit tests for the
  template covering sheet creation, 8 column header values at row 5,
  column widths, section/subtotal/grand-total row heights, idempotency
  (clear() count 0→1 across two calls), and `opts.sheetName` override.
- `tests_unit/writers_v2/WriteBomV2Tests.gs` — 12 unit tests for the
  writer covering all 8 sections, the "throw when sheet missing" path,
  trayM>0 swap to ladder-tray rows, customer-supplied vs Argia-supplied
  transformer variant, PV-only vs BESS-enabled §8 behavior, and the
  GRAND_TOTAL formula referencing all 8 subtotals.
- ACTIVE_CHUNK_TAG bumped to `chunk4` so the "Run Tests for Current
  Chunk" menu item picks up exactly the 26 new tests.

### Parity quirks (called out for cleanup post-cutover)

Two legacy code paths dispatch BOS prices as USD without checking
`isUsd` — DC PV WIRE cable (line 693 in legacy) and AC main breaker
(line 790 in legacy). Both happen to work in practice because the BOS
DB MXN prices are passed-through as numbers and the line totals are
computed with `=C*E` and `=F*$F$EXCHANGE_RATE`, so the math reconciles.
v2 mirrors this verbatim for parity. Marked as "legacy parity quirk" in
the new writer tests so post-cutover cleanup is straightforward.

---

## [3.1.0] — 2026-05-25

Chunk 3 of the output-v2 migration. Lands PROJECT_CARD_v2 alongside the
legacy PROJECT_CARD. **No legacy recalc** — legacy PC continues writing
unchanged; v2 is parallel and additive.

### Added — Chunk 3 (PROJECT_CARD_v2)

- New file `templates/setupProjectCardTemplate.js`: idempotent template
  that builds the PROJECT_CARD_v2 sheet with section bands, fixed-row
  labels, and the 10-column cost-comparison layout. Pure setup — never
  touches data.
- New file `writers_v2/WriteProjectCardV2.js`: data writer that fills
  PROJECT_CARD_v2 at the fixed rows defined in `PC_ROW`. Reads from legacy
  BOM and INSTALLATION sheets (BOM_v2 / INSTALLATION_v2 ship later) so
  numeric parity with legacy PC is preserved.
- New BESS visibility in PC_v2 (three additions over legacy PC):
  - **Cost Comparison gains a 9th row** "Almacenamiento (BESS)" pulling
    USD/MXN from `BOM!SUBTOTAL_BESS` (row 92). PV-only projects render
    em-dash in the BESS row; the row remains in layout for visual consistency.
  - **Scope of Work gains a battery line** when bessEnabled, formatted as
    `<batteryId> — <stackQty> stack(s) (<kWh> kWh nominal)`. Falls back to
    "Battery storage system" when `batteryId === 'CUSTOM_MANUAL'`.
  - **Additional Information gains "Storage"** row showing nominal kWh
    capacity. Shows em-dash when bessEnabled is false.
- New PC_ROW + PC_COL constants in `00_Main.js` lock the PC_v2 layout so
  template and writer share row addresses (the architectural change that
  makes v2 cleanly testable).
- New `costRangeBessMin` / `costRangeBessMax` entries in `_MAP_PROJECT`
  (row 61 of INPUT_PROJECT, cols D/E). Unit is **USD/kWh nominal** —
  defaults **$350–$650**, calibrated from four real BAAS proposals in
  `/mnt/project`:
  - Autoplastek Puebla: 645 kWh / $5.42M MXN → $461/kWh USD
  - Draxlmaier: 10,000 kWh / $69.36M MXN → $381/kWh USD
  - Taigene León: 1,505 kWh / $10.54M MXN → $385/kWh USD
  - Culligan: 1,075 kWh / $11.33M MXN → $579/kWh USD
  Observed range $381–$579; envelope widened ~10% each side.
- Engine integration as new **Step 13-v2** in `runArgiaEngine()`,
  wrapped in try/catch matching Step 10-v2 (MDC_v2) — a v2 bug never
  breaks the legacy pipeline.
- `ACTIVE_CHUNK_TAG` bumped to `'chunk3'`.

### Tests — Chunk 3

- New file `tests_unit/writers_v2/WriteProjectCardV2Tests.gs`: 10 unit
  tests covering value writes per row, BESS visibility logic, validation
  PASS/FAIL boundaries, scope-of-work formatting, and margin derivation.
- New file `tests_unit/templates/ProjectCardTemplateTests.gs`: 5 tests
  for template invariants (sheet exists, idempotency, section headers
  at correct rows, all 9 cost-row labels present including BESS).

### Notes

- PC_v2 selling price `USD/Wp` denominator is **PV `dcKwp`** only, not
  PV-plus-BESS equivalent. $/Wp is an industry PV metric; the BESS
  portion shows separately in the cost table.
- Gross profit formula unchanged from legacy semantics — it operates on
  the TOTAL row, which now naturally includes BESS subtotal when
  bessEnabled.
- No menu entry yet — PC_v2 is generated only as part of the full engine
  run. A standalone "Generate PC v2" menu entry can land in Chunk 11
  (cutover) when v2 becomes source of truth.

---

## [3.0.0] — 2026-05-24

Catch-up release covering chunks BDF-7 through BDF-11.1. This is the first
GitHub commit since pre-BDF-7 work. Several months of engine development
are condensed into this single release. Going forward, each BDF chunk gets
its own commit.

**MAJOR bump** because BDF-11 corrected four CFE Capacidad math bugs.
Existing project workbooks WILL recalculate to different numbers after
running the included repair tools. For CULLIGAN-style projects, year-1
BESS Capacidad savings drop from ~$1.49M to ~$498K, and steady-state
savings rise to ~$3.71M. See "Migration" section below.

### Added — BDF-11.1 (Year-1 vs Steady-State visualization)

- New file `02i_SetupBessSimulationSteady.js`: idempotent setup tool that
  extends BESS_SIMULATION with rows 43-48 computing steady-state Capacidad
  savings (year 2+ after CFE's 12-month rolling demand window decays).
- `06_WriteCfeOutput.js`: CFE_OUTPUT now renders both Año 1 and Año 2+
  numbers in the headline KPI tile (when steady-state data exists), plus a
  new comparison section at rows 37-42 with green/red diff coloring and an
  explanatory note.
- Menu entry: ARGIA → Setup → "Setup BESS Steady-state (BDF-11.1)".
- New cell map entries `bsim_ahorroCapSteadyAnnual` and `bsim_reciboFinalSteady`.

### Added — BDF-11 (CFE Capacidad math bug fixes)

- New file `02h_RepairCfeSimulationCapacidad.js`: idempotent, label-asserted
  repair tool that fixes CFE_SIMULATION rows 18 and 23, plus BESS_SIMULATION
  row 30, in existing project workbooks. Safe regex-based substitution
  handles both plain and ARRAYFORMULA-wrapped formula shapes. Skips with
  diagnostic if formula doesn't match expected pattern.
- New file `tests_unit/calc/CalcBdf11Tests.gs`: 5 unit tests (41 assertions)
  validating all four bug fixes against 12 real CULLIGAN CFE bills.
- Menu entry: ARGIA → Setup → "Repair CFE_SIM Capacidad (BDF-11)".

### Fixed — BDF-11

Four CFE math bugs validated against 12 real CULLIGAN bills (GDMTH GOLFO
NORTE, May 2025 - Apr 2026):

1. **CFE_SIMULATION row 23 Capacidad formula** — was multiplying by C18
   (kWMaxAñoMovil) instead of C21 (Demanda Facturable). CFE charges Capacidad
   on `MAX(kW_punta, 0.7 × movil)`, not on movil itself. Fix: `C23 = C21 × rate`.
   Bills now match to the cent across all 12 months.

2. **CFE_SIMULATION row 18 kWMaxAñoMovil** — was synthesizing from
   `ROUNDUP(SUM(kWh)/24/loadFactor)` giving values 23-76% off reality. Fix:
   `=MAX(MAX(INPUT_CFE!C13:N15), MAX(INPUT_CFE!C16:N16))` — Option B (rolling
   max of all kW data) with safety net (period kWMax from bills) to handle
   partial-data scenarios. Same global value for every month (CFE's window
   is global, not per-month).

3. **Hourly synth (`20_CalcHourlySimulation.js`) ignored BESS effect on
   Capacidad** — `components.capacidad[bm]` used pre-BESS demanda facturable
   even after BESS shaved the punta peak. Fix: when battery is configured
   AND month had real discharge AND movil is supplied, compute Capacidad two
   ways:
   - **Year 1**: `MAX(post_BESS_punta, 0.7 × movil)` (rolling max still loaded)
   - **Steady**: `MAX(post_BESS_punta, 0.7 × post_BESS_punta)` (rolling decayed)
   - Post-BESS punta derived arithmetically from bill's kW_punta minus battery
     shave capability (mirrors `calcPeakShavingImpact` model). Critically does
     NOT use simulator's energy-averaged peak (which is structurally lower
     than measured bill peak even without BESS).
   - Exposes new output fields: `components.capacidadSteady[12]`,
     `components.facturacionSteady[12]`, `annualFacturacionSteadyMxn`,
     `kWMaxAnoMovilSource`.

4. **BESS_SIMULATION row 30 chain** — falls out of bugs #1 and #2. C30
   formula now uses `C23/C21` (correct rate) instead of `C23/C18` (which only
   worked when C23 was buggy). Updated by the repair tool above.

### Fixed — BDF-11.1 (visual polish)

- BOM rows 80-91 (§8 BESS line items): full per-column formatting
  normalization (alignment, font color, vertical alignment, font size, wrap)
  so all 12 line items render with consistent style. Previously rows 81-91
  inherited template formatting inconsistencies that made the section look
  uneven vs row 80.
- CFE_OUTPUT KPI tiles in row 10 use 15pt font (was inconsistent mix of
  22pt and 13pt). Three tiles now visually consistent.
- CFE_OUTPUT month columns C-N widened 50% (75 → 113px), column O totals
  90 → 135px. Resolves cascade row value truncation.
- CFE_OUTPUT charts removed (call to `_cfeOutBuildCharts()` commented out).
  Functions kept for backward compat but no longer rendered — data tables
  alone tell the story per designer feedback.

### Changed — BDF-11 (regression test fix)

- `tests_regression/sheet_formulas/BessSimulationFormulasTests.gs` test #6
  fixed to derive Capacidad rate from `C21` instead of `C18`. Previous test
  was a structural tautology — it derived the rate from the same buggy
  formula it was supposed to validate, so it passed even when the bug was
  present. Now correctly validates against true CFE rates.

### Added — Earlier chunks (BDF-7 through BDF-10)

Several months of BESS-related engine work landing in this catch-up:

- **BDF-7 / BDF-7.1**: BESS BoS line items in BOM §8, NOM compliance checks
  (`24_CalcBessNomChecks.js`), BoS quantity calculation
  (`22_CalcBessBosQuantities.js`), voltage drop (`23_CalcBessVoltageDrop.js`).
- **BDF-8**: BOM §8 visual normalization (row heights, description wrap,
  notes for engineering detail).
- **BDF-9**: Real price resolution for BESS BoS items via PV-side helpers;
  background/font reset on §8 rows.
- **BDF-10**: BESS battery price lookup with CAPEX fallback, dropped §8 row
  heights from 26 to 22px to match PV side.
- **BESS picker / recommendations**: New files `19_RunBessSuggestion.js`,
  `19b_WriteBessRecommendations.js`, `21_BessPickerWiring.js` for the BESS
  size-recommendation feature.
- **Hourly simulation v1**: `20_CalcHourlySimulation.js` + runner
  `20a_RunHourlySimulation.js` — 8760-hour engine producing comparison
  numbers in CFE_OUTPUT footer.
- **Test infrastructure**: New unit test files for BDF-7.1/8/9/10/11, BESS
  BoS quantities, hourly simulation. Tagged so the test runner can filter
  per chunk.

### In Progress — v2 architecture (not yet customer-facing)

The following are committed in this release but not yet wired into the
production engine pipeline. They represent ongoing work toward a v2
output architecture. Safe to ignore from a customer/designer standpoint;
running the standard engine does not exercise this code.

- `templates/` directory: template generation system
- `writers_v2/` directory: next-gen output writers
- `tests_unit/templates/`, `tests_unit/wiring/`, `tests_unit/writers_v2/`,
  `tests_integration/templates/`, `tests_integration/writers_v2/`,
  `tests_regression/v2/`: corresponding tests
- `OUTPUT_V2_MIGRATION_PLAN.md`: design doc (932-line expansion in this
  release documenting the v2 plan)

Future BDF chunks will wire these in incrementally. Until then, they sit
alongside the production code as parallel scaffolding.

### Migration — IMPORTANT

For each existing project workbook (pre-3.0.0):

1. Open the workbook.
2. ARGIA menu → Setup → **Repair CFE_SIM Capacidad (BDF-11)** → confirm
   dialog reports all 36 cells written (12 in row 18, 12 in row 23, 12 in
   BESS_SIM row 30). If any cells skip with "label mismatch" or "unparseable
   formula", do not proceed — file an issue.
3. ARGIA menu → Setup → **Setup BESS Steady-state (BDF-11.1)** → confirm
   dialog reports rows 43-48 written. Skips safely if rows have non-empty,
   non-marker content.
4. Re-run the engine (regenerate proposal). CFE_OUTPUT will show new numbers.
5. **Commercial review required**: headline savings on CULLIGAN-style projects
   shift by $1M+. Re-quote any active client whose proposal cited BESS
   Capacidad savings before re-issuing.

Both repair tools are idempotent — safe to re-run.

### Commercial impact reference (CULLIGAN, full year)

| Number | Before (buggy) | Year-1 (correct) | Steady (correct) |
|---|---:|---:|---:|
| Recibo CFE final con PV + BESS | $8,679,205 | $9,958,158 (+$1.28M) | $6,700,921 (-$1.98M) |
| BESS Capacidad savings (annual) | $1,488,320 | $498,618 | $3,708,058 |
| Total annual savings vs Sin PV | $4,734,176 | $3,744,475 | $7,001,712 |

These are pre-BDF-11 vs post-BDF-11 numbers for one specific project; magnitude
will vary by project but direction (year-1 down, steady-state up) is universal.

### Known limitations

- Template setup function is NOT updated by BDF-11. New projects created
  after this release will still have the buggy formulas until the repair
  tool is run on them. Updating the template is deferred to a future chunk.
- Distribución and Variable savings: BDF-11 did not analyze whether these
  have year-1 vs steady-state differences. Steady-state row 48 in
  BESS_SIMULATION uses year-1 values for Distribución and Variable. Deferred.
- GDMTO tariff Capacidad formula not audited for parallel bugs (different
  structure based on demanda contratada). Out of BDF-11 scope.
- Blackout value feature deferred to future chunk.
- Time-shifting and hybrid BESS strategies deferred to future chunk.

---

## [pre-3.0.0] — prior to 2026-05-24

Pre-history before this changelog was created. Engine versions 2.0.0
through 2.3.5 shipped without per-version notes. The catch-up release at
3.0.0 above covers everything from BDF-7 onward.
