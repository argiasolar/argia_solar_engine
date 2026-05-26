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
var ENGINE_VERSION = '3.3.0';
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