// =============================================================================
// ARGIA ENGINE v3.0.0 -- File: 00a_Version.gs
// Version stamping. Loaded right after 00_Main.gs.
//
// PURPOSE:
//   Every project file stamps its engine + DB version on every calculation
//   run. This lets us reopen old projects and know exactly which code
//   produced their numbers.
//
// USAGE:
//   stampMeta(ss, {fixture: 'TESTPROJ-SYNTH-001'}) // call once per engine run
//
// SEE ALSO:
//   CHANGELOG.md — versioning policy and release history
// =============================================================================

// ---------------------------------------------------------------------------
// VERSION CONSTANTS — bump on every release
// ---------------------------------------------------------------------------
//
//   ENGINE_VERSION uses semver: MAJOR.MINOR.PATCH
//     MAJOR — breaking change, old projects WILL recalc differently
//     MINOR — new feature, old projects recalc the same
//     PATCH — bug fix; document regression risk in CHANGELOG
//
//   DB_VERSION uses YYYY.MM
//     Bump when any *_DB or master table changes.
//
// 3.7.4 — PATCH bump (2026-05-27). Three pre-existing test-debt failures
// (surfaced after Tier 3.x cleared the bigger issues, none Tier 3-caused):
//
//   1. UNIT_INPUTS_BESS_VOLTAGE_RESOLVER. Test asserted DB-wins; product
//      code is BDF-7.1 manual-wins (documented at 01a_ReadInputsBess.js
//      lines 51-61, with rationale: "INPUT_* overrides MASTER_DB" matches
//      the rest of the engine). Test was stale -- updated to assert the
//      manual-wins contract. Also replaced the now-redundant "negative DB
//      falls back to manual" assertion with "negative manual falls back
//      to DB" which exercises the same screen from the other side.
//
//   2/3. UNIT_CFE_TPL_IMAGE_CLEANUP_ON_REFRESH (two assertions). The
//      _insertArgiaLogo v3 (CellImage approach, 3.7.3) inherited a
//      floating-image dedup block from v1. That dedup ran on every call
//      and the CFE template's own _cfeOutV2_removeImages was doubling up,
//      breaking the test's image-removed-count assertion. Removed the
//      dedup block from _insertArgiaLogo. v3 never creates floating
//      images, so the only reason for that dedup was cleaning up
//      workbooks upgrading from v1 -- and now CFE handles it for the
//      CFE_OUTPUT sheet (the only place where stacked logos were an
//      observed bug). Other templates that don't have their own image
//      cleanup may leave stranded floating images visible on workbooks
//      upgrading from v1; remedy is a one-time manual delete via
//      Insert -> Image, or wait for a future "Clean Floating Images"
//      utility if anyone reports the issue.
//
// Tests touched:
//   - tests_unit/inputs/BessVoltageResolverTests.gs    (contract fix)
//   - 02e_InputSetup.js                                  (drop dedup)
//
// No engine / writer / template behavior change beyond the dedup drop.
//
// 3.7.3 — PATCH bump (2026-05-27). Logo rewrite #2: switched from
// =IMAGE() formula to SpreadsheetApp.newCellImage() with a base64
// data URI built from the file's blob.
//
// Why: the v2 approach (=IMAGE with a Drive thumbnail URL) didn't work.
// Google's thumbnail endpoint changed in fall 2025 and now serves
// nothing useful to IMAGE() callers -- the cell appeared blank in both
// Sheets and PDFs (confirmed by user observation; corroborated by
// recent reports in Adobe forum and others). Earlier "uc?id=" pattern
// has also been unreliable across the same period.
//
// New approach uses Apps Script's CellImage API:
//   1. DriveApp reads the logo file blob
//   2. Utilities.base64Encode() converts the bytes
//   3. SpreadsheetApp.newCellImage().setSourceUrl("data:image/png;base64,...")
//      embeds the bytes directly in the cell value
//   4. CacheService (script cache) caches the encoded blob for 6 hours
//      so repeat template-setup calls don't re-read Drive
//
// Advantages:
//   - No dependency on public URLs, Drive sharing settings, or external
//     thumbnail servers. The image bytes live inside the cell value.
//   - In-cell render = part of cell content = PDF-export reliable.
//   - When Google next changes a Drive URL pattern, this code is
//     unaffected.
//
// Disadvantage:
//   - Cache is bounded by CacheService's 100 KB value cap. If the logo
//     is larger than ~70 KB original (i.e. ~95 KB base64), it won't be
//     cached and Drive is hit once per template-setup call. The current
//     argia_logo_dark.png is well under this, so it's a non-issue.
//
// Signature of _insertArgiaLogo unchanged. All 13 call sites work as-is.
// refreshArgiaLogoCache now wipes both the v3 CacheService keys and the
// stale v2 PropertiesService keys (cleans up workbooks upgrading from
// 3.7.1).
//
// 3.7.2 — PATCH bump (2026-05-27). PC orientation flipped from landscape
// to portrait per user preference. scale=2 (Fit to Width) preserved -- the
// 69-row content paginates naturally into 2 pages: main content through
// Gross Profit on p1, docs/risks/comments/signatures + footnotes on p2.
// One-line config change in PDF_EXPORTS.PROJECT_CARD + matching test
// assertions. No other changes.
//
// 3.7.1 — PATCH bump (2026-05-27). Tier 3.1 fix-up after visual review of
// the first PDF batch:
//   1. Trailing-row trim: Google sometimes drops the last row when it
//      lands near a page boundary. BOM grand total (row 94) and
//      INSTALLATION TOTAL row (row 34) were missing from PDFs.
//   2. Trailing-col trim: same quirk on the rightmost column.
//      INSTALLATION col J "TOTAL" and RFQ col M "Notes" were clipped.
//   3. PC overflowed to 4 pages with signatures and footnotes on
//      near-empty trailing pages.
//   4. PC at scale=4 (Fit to Page) rendered correctly on one landscape
//      A4 page but used only ~50% of the width -- looked like portrait.
//      Changed to scale=2 (Fit to Width) which fills the landscape page;
//      footnotes overflow to page 2 (user's preferred layout: main on
//      p1, footnotes on p2).
//   5. Logo rendered as a solid black rectangle on every PDF. Root cause:
//      Google's PDF-export endpoint has a long-standing bug where
//      floating images (sh.insertImage) render as black rectangles.
//      Fix: replaced floating-image insertion in _insertArgiaLogo
//      (02e_InputSetup.js) with an in-cell =IMAGE() formula. In-cell
//      images are part of the spreadsheet's cell content and render
//      reliably in PDF exports. The logo file is auto-shared as "Anyone
//      with the link can view" on first resolve so IMAGE() can fetch
//      it; resolved URL cached on PropertiesService keyed by folder ID.
//      New menu item ARGIA -> Setup -> Refresh Logo Cache (function
//      refreshArgiaLogoCache) clears the cache if the logo file is
//      replaced in Drive. Signature of _insertArgiaLogo unchanged; all
//      13 call sites continue to work without edit.
// Changes:
//   - 12_ExportPDF.js: PDF_EXPORTS extended with buffer rows/cols;
//     `scale` option added; _buildPdfUrl honors scale (drops fitw/fith
//     when set). PROJECT_CARD scale=2 (Fit to Width). All 6 RFQs
//     scale=4 (Fit to Page).
//   - 02e_InputSetup.js: _insertArgiaLogo rewritten for in-cell IMAGE()
//     formula; new helper _resolveArgiaLogoUrl_ + refreshArgiaLogoCache.
//   - 00_Main.js: Setup submenu gains "Refresh Logo Cache" item.
//   - tests_unit/PdfExport*Tests.gs: assertions updated; 139 green.
//
// 3.7.0 — MINOR bump (2026-05-27). Tier 3 PDF exporter cutover. 12_ExportPDF.js
// now points at v2 sheets with verified ranges:
//   MDC_v2           B1:G115  portrait   (was MDC B1:F99; +16 BESS rows, +col G)
//   BOM_v2           A1:H94   portrait   (was BOM A1:H77; +14 BESS rows)
//   INSTALLATION_v2  A1:J34   landscape  (unchanged customer-facing region;
//                                         line-item zone at row 40+ stays internal)
//   PROJECT_CARD_v2  A1:J69   landscape  (NEW: PC export was removed in Tier 2)
//   RFQ_*_v2 (x6)    A1:M<L>  landscape  (NEW: 5 categories + RFQ_BESS, end row
//                                         resolved at export time via getLastRow)
// New menu structure under ARGIA -> Exports:
//   Export MDC / BOM / Installation / Project Card
//   Export RFQ submenu (Paneles, Inversores, Estructura, Electrico, Monitoreo,
//   BESS, Export All RFQs)
//   Export All (MDC+BOM+Install+PC)
// New public functions: exportProjectCard, exportRfq{Paneles,Inversores,
// Estructura,Electrico,Monitoreo,Bess}, exportAllRfqs. RFQs that don't exist
// for a given project (e.g. RFQ_BESS_v2 on a PV-only run) are soft-skipped
// with a warning in exportAllRfqs rather than failing the batch. No engine /
// writer / template changes -- export-layer only.
//
// 3.6.0 — MINOR bump (2026-05-26). Tier 1 + Tier 2 cutover. Engine now writes
// ONLY v2 sheets (MDC_v2, BOM_v2, INSTALLATION_v2, PROJECT_CARD_v2,
// CFE_OUTPUT_v2, RFQ_*_v2). Legacy writer files DELETED:
//   06_WriteCfeOutput.js, 07_WriteMDC.js, 08_WriteBOM.js,
//   14_WriteProjectCard.js, 15_WriteRFQ.js, 16_WriteOverview.js (orphan).
// Legacy writeInstallCost + writeInstallDriverMap deleted from
// 13_CalcInstallCost.js (~370 lines); calc layer (readInstallDrivers,
// calcInstallCost, applyKwpBenchmarks, runInstallCost) preserved unchanged.
// 13_CalcInstallCost.js switched to _bomV2_loadStructureDb / _bomV2_resolveStructure
// in writers_v2/helpers/BomDbHelpers.js (legacy resolveStructure was in
// 08_WriteBOM, now deleted). Output validator (09b_OutputValidate.js) reads
// v2 sheet names instead of legacy. Five legacy test files deleted:
//   tests_integration/writers/MdcBessSec7Tests.gs
//   tests_integration/writers/CfeOutputWriterTests.gs
//   tests_integration/writers/CfeOutputCellMapTests.gs
//   tests_integration/e2e/Testproj001PipelineTests.gs
//   tests_unit/writers/MdcRowConstantsTests.gs
//   tests_unit/writers/ResolveStructureTests.gs
// Also removed: 30_ArgiaKicker.js (1397 lines, slide-deck generator no
// longer in use) and its four menu items (Setup SLIDE_DATA, Data Validation,
// Create Offer EN, Create Offer ES). Sheet names UNCHANGED -- *_v2 suffixes
// stay in place (no customer workbook migration required). Why MINOR not
// MAJOR: customer-facing recalc behavior is unchanged; v2 outputs were
// already being produced side-by-side since 3.5.0. Tier 3 (PDF exporter
// sheet+range updates) is a follow-up MINOR bump.
//
// 3.3.0 — MINOR bump (2026-05-25). Chunk 5 lands INSTALLATION_v2: a parallel
// v2 sheet (INSTALLATION_v2) is now written alongside the legacy INSTALLATION,
// plus the audit sheet 95_INSTALL_DRIVER_MAP_v2. The v2 writer mirrors legacy
// writeInstallCost section-by-section across all 9 IC_SECTIONS (AC, DC,
// RACKING SYSTEM, CONNECTION, SAFETY, GENERAL SITE, EQUIPMENT, BESS, INDIRECT).
// Calc layers (loadInstallLib, readInstallDrivers, calcInstallCost,
// applyKwpBenchmarks) are reused unchanged from 13_CalcInstallCost.js — per
// chunk plan, calc is upstream from writers and not in v2 scope. Tiny
// additive edit to runInstallCost: attaches .drivers to the returned result
// so Step 12-v2 can reuse it without re-running the calc. Strict superset of
// legacy: v2 writer also writes the driver-block key column (col A rows 4-35)
// that legacy assumes pre-existing. Legacy INSTALLATION remains source of
// truth until cutover. No legacy recalc.
//
// 3.2.0 — MINOR bump (2026-05-25). Chunk 4 lands BOM_v2: a parallel v2 sheet
// (BOM_v2) is now written alongside the legacy BOM. All 8 sections render
// (panels / inverters / structure / DC / AC / transformer / monitoring / BESS),
// using namespaced _bomV2_* DB helpers in writers_v2/helpers/BomDbHelpers.js
// (verbatim port of legacy helpers — no behavioral change). The §8 BESS row
// reset block from legacy (cosmetic cleanup of layout drift) is gone in v2:
// template owns all formatting from the start. Legacy BOM remains source of
// truth until cutover. No legacy recalc.
//
// 3.1.0 — MINOR bump (2026-05-25). Chunk 3 lands PROJECT_CARD_v2: a parallel
// v2 sheet (PROJECT_CARD_v2) is now written alongside the legacy PROJECT_CARD.
// PV-only runs are visually identical (one new "Almacenamiento (BESS)" row
// renders an em-dash). BESS runs gain: a 9th cost row, a scope-of-work
// battery line, a "Storage" info-row showing nominal kWh, and PASS/FAIL
// validation against a new $/kWh USD envelope (defaults $350-$650, read
// from costRangeBessMin / costRangeBessMax on INPUT_PROJECT row 61).
// Legacy PROJECT_CARD is the source of truth until cutover; PC_v2 is a
// side-by-side verification target. No legacy recalc.
//
// 3.0.0 — MAJOR bump (2026-05-24). BDF-11 fixed four CFE Capacidad math
// bugs validated against 12 real CULLIGAN bills. Existing projects WILL
// recalculate to different numbers (year-1 Capacidad savings typically
// DROP, steady-state savings typically RISE). See CHANGELOG.md for details
// and run "Repair CFE_SIM Capacidad (BDF-11)" + "Setup BESS Steady-state
// (BDF-11.1)" on each project workbook to migrate.
//
// 3.4.0 — MINOR bump (2026-05-26). Chunk 6 lands RFQs_v2: six parallel v2
// RFQ sheets (RFQ_PANELES_v2, RFQ_INVERSORES_v2, RFQ_ESTRUCTURA_v2,
// RFQ_ELECTRICO_v2, RFQ_MONITOREO_v2, and the new RFQ_BESS_v2). All six are
// generated by a single parameterized template (setupRfqTemplate) and a
// single parameterized writer (writeRfqV2), driven by RFQ_REGISTRY. Reads
// items from BOM_v2 (NOT legacy BOM) so v2 keeps working when 15_WriteRFQ.js
// is deleted at cutover. New menu item "Generate RFQs v2" calls
// runWriteAllRfqsV2; legacy "Generate RFQs" is untouched. NOT wired into
// runArgiaEngine — RFQs are generated on demand. RFQ year stamp comes from
// _META!B6 (calculated_at). BESS row split: battery (row 80) + commissioning
// (row 91) go to RFQ_BESS_v2; BESS electrical BOS (rows 81-90) goes to
// RFQ_ELECTRICO_v2.
//
// 3.5.0 — MINOR bump (2026-05-26). Chunk 7 lands CFE_OUTPUT_v2: a parallel
// v2 sheet (CFE_OUTPUT_v2) is now written alongside the legacy CFE_OUTPUT.
// Strict template/writer split: setupCfeOutputTemplate owns layout (banner,
// 16-col canvas, section headers, static row labels for sections 1 & 2,
// footer label row, image cleanup on refresh), writeCfeOutputV2 owns data
// (header strip, KPI tiles incl. steady-state variant, monthly bands,
// annual cascade, Y1SS conditional section, BDF-5 hourly addendum incl.
// bill components breakdown + provenance + warnings).
// Reads from INPUT_CFE / CFE_SIMULATION / BESS_SIMULATION via the new
// CFE_OUT_SRC_V2 map (verbatim copy of legacy CFE_OUT_SRC for v2 isolation).
// Engine integration: Step 13.5-v2 runs immediately after legacy Step 13.5,
// wrapped in try/catch (matches Step 9.5 / 12-v2 pattern). New menu item
// "Update CFE_OUTPUT v2" calls runUpdateCfeOutputV2. Legacy 06_WriteCfeOutput
// unchanged. NO charts in v2 (matches the current legacy state — charts
// were removed in BDF-11).
//
var ENGINE_VERSION = '3.7.4';
var DB_VERSION     = '2026.05';

// Internal: name of the metadata sheet. Hidden from designers by default
// (use ss.getSheetByName(SH_META).hideSheet() after first creation if desired).
var SH_META = '_META';

// ---------------------------------------------------------------------------
// stampMeta(ss, opts)
// Writes/updates the _META sheet. Creates it if missing.
//
// opts = {
//   fixture: 'TESTPROJ-SYNTH-001'  // optional, name of fixture if test run
//   scenario: 'NET_METERING'       // optional, regulatory scenario
//   runType: 'engine' | 'test'     // defaults to 'engine'
// }
// ---------------------------------------------------------------------------
function stampMeta(ss, opts) {
  opts = opts || {};
  var sheet = ss.getSheetByName(SH_META);
  if (!sheet) {
    sheet = ss.insertSheet(SH_META);
    // Initial header layout. Static — never overwritten after first creation.
    var header = [
      ['ARGIA ENGINE — Project Metadata', '', ''],
      ['', '', ''],
      ['Field', 'Value', 'Notes'],
      ['engine_version',  '', 'Apps Script version that wrote this file'],
      ['db_version',      '', 'Master DB version at time of run'],
      ['calculated_at',   '', 'ISO timestamp of last engine run'],
      ['calculated_by',   '', 'Designer email (Apps Script user)'],
      ['fixture_used',    '', 'Name of fixture if test run, blank otherwise'],
      ['regulatory_scen', '', 'Interconnection scenario (NM/EX/ZE) — Phase 1+'],
      ['run_type',        '', 'engine | test'],
      ['', '', ''],
      ['First-run history (append-only):', '', ''],
      ['First version', '', ''],
      ['First run at',  '', ''],
      ['First run by',  '', ''],
    ];
    sheet.getRange(1, 1, header.length, 3).setValues(header);
    sheet.getRange('A1').setFontWeight('bold').setFontSize(12);
    sheet.getRange('A3:C3').setFontWeight('bold');
    sheet.setColumnWidths(1, 1, 180);
    sheet.setColumnWidths(2, 1, 280);
    sheet.setColumnWidths(3, 1, 320);

    // Stamp first-run fields ONCE — these never change.
    sheet.getRange('B13').setValue(ENGINE_VERSION);
    sheet.getRange('B14').setValue(new Date().toISOString());
    sheet.getRange('B15').setValue(_getUserEmail());
  }

  // Update mutable fields on every run.
  sheet.getRange('B4').setValue(ENGINE_VERSION);
  sheet.getRange('B5').setValue(DB_VERSION);
  sheet.getRange('B6').setValue(new Date().toISOString());
  sheet.getRange('B7').setValue(_getUserEmail());
  sheet.getRange('B8').setValue(opts.fixture  || '');
  sheet.getRange('B9').setValue(opts.scenario || '');
  sheet.getRange('B10').setValue(opts.runType || 'engine');
}

// ---------------------------------------------------------------------------
// readMeta(ss) — returns {engineVersion, dbVersion, calculatedAt, ...}
// Used by tests to assert that stamping happened and matches current constants.
// Returns null if _META does not yet exist (first run case).
// ---------------------------------------------------------------------------
function readMeta(ss) {
  var sheet = ss.getSheetByName(SH_META);
  if (!sheet) return null;
  return {
    engineVersion:    sheet.getRange('B4').getValue(),
    dbVersion:        sheet.getRange('B5').getValue(),
    calculatedAt:     sheet.getRange('B6').getValue(),
    calculatedBy:     sheet.getRange('B7').getValue(),
    fixtureUsed:      sheet.getRange('B8').getValue(),
    regulatoryScen:   sheet.getRange('B9').getValue(),
    runType:          sheet.getRange('B10').getValue(),
    firstVersion:     sheet.getRange('B13').getValue(),
    firstRunAt:       sheet.getRange('B14').getValue(),
    firstRunBy:       sheet.getRange('B15').getValue(),
  };
}

// ---------------------------------------------------------------------------
// Internal: best-effort user email.
// Session.getActiveUser().getEmail() returns '' if the script lacks scope
// or the user is anonymous. Never throws.
// ---------------------------------------------------------------------------
function _getUserEmail() {
  try {
    var email = Session.getActiveUser().getEmail();
    return email || '(unknown)';
  } catch (e) {
    return '(unknown)';
  }
}