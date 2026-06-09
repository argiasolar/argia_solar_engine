// =============================================================================
// ARGIA ENGINE -- 00d_InputSnapshot.gs   (Track A · chunk A1)
// -----------------------------------------------------------------------------
// Formula-aware, all-six-tab snapshot/restore of the INPUT_* sheets, plus a
// DEFAULT-layout rebuild fallback. Wired into TestRunner so a test run can
// NEVER leave the workbook's inputs wiped.
//
// WHY THIS APPROACH (not copyTo)
//   This generalises the PROVEN strategy already used by the Phase-4
//   regression test (_p4r_snapshotInputs / _p4r_restoreInputs in
//   tests_regression/sheet_formulas/BessSimulationFormulasTests.gs):
//       snapshot = getFormulas() + getValues() over each tab's used range
//       restore  = setValues() with FORMULA PRECEDENCE (write the formula
//                  string where one existed, else the literal value)
//   That is the strategy that survives INPUT_CFE's array formulas, unlike the
//   copyTo + clearContents approach in test/TestSheetBackup.gs (retired in
//   chunk A2). Here it is promoted to a shared helper covering ALL SIX input
//   tabs -- including INPUT_INSTALL and INPUT_BAAS, which copyTo omitted.
//
// SCOPE NOTE (interim until A2/A3)
//   Restore is layout-faithful WITHIN A SINGLE RUN (same session, same layout,
//   seconds apart) -- there is no layout drift to worry about. Keyed restore +
//   persisted cross-session recovery land in A2/A3. The snapshot is held in
//   memory only; a hard 6-minute Apps Script timeout mid-run would lose it
//   (a normal full run is well under that).
// =============================================================================


// All six input tabs (the old copyTo backup omitted INSTALL + BAAS).
var INPUT_SNAPSHOT_TABS = [
  'INPUT_PROJECT',
  'INPUT_DESIGN',
  'INPUT_INSTALL',
  'INPUT_CFE',
  'INPUT_BESS',
  'INPUT_BAAS'
];


/**
 * Snapshot every present INPUT_* tab's used range as formulas + values.
 * @param {Spreadsheet} ss
 * @return {Object} snap keyed by sheet name: { rows, cols, formulas, values }
 */
function snapshotInputSheets(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var snap = {};
  for (var i = 0; i < INPUT_SNAPSHOT_TABS.length; i++) {
    var name = INPUT_SNAPSHOT_TABS[i];
    var sh = ss.getSheetByName(name);
    if (!sh) continue;                      // tab absent on this workbook -> skip
    var r = Math.max(sh.getLastRow(), 1);
    var c = Math.max(sh.getLastColumn(), 1);
    snap[name] = {
      rows: r,
      cols: c,
      formulas: sh.getRange(1, 1, r, c).getFormulas(),
      values:   sh.getRange(1, 1, r, c).getValues()
    };
  }
  return snap;
}


/**
 * Restore every snapshotted tab with formula precedence: where a cell held a
 * formula at snapshot time, write the formula back; otherwise write the literal
 * value. One setValues() per tab. Throws if snap is empty.
 * @param {Spreadsheet} ss
 * @param {Object} snap  result of snapshotInputSheets()
 */
function restoreInputSheets(ss, snap) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!snap) throw new Error('restoreInputSheets: empty snapshot');
  Object.keys(snap).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var s = snap[name];
    var out = [];
    for (var r = 0; r < s.rows; r++) {
      var row = [];
      for (var c = 0; c < s.cols; c++) {
        var f = s.formulas[r][c];
        row.push(f !== '' ? f : s.values[r][c]);
      }
      out.push(row);
    }
    sh.getRange(1, 1, s.rows, s.cols).setValues(out);
  });
}


/**
 * Last-resort fallback: rebuild every INPUT_* tab to its DEFAULT layout from
 * INPUT_MAP + the existing setup functions. Best-effort and guarded -- one
 * tab failing must not abort the rest, because this only runs when a snapshot
 * restore has ALREADY failed and we are trying to leave the workbook usable.
 *
 * VERIFY-POINT: confirm this BESS setup order matches your setupInputBess*
 * functions before relying on it (flagged in the Track-A review).
 * @param {Spreadsheet} ss
 */
function rebuildInputsToDefault_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var steps = [
    function () { setupInputProject(true); },
    function () { setupInputDesign(true); },
    function () { setupInputInstall(true); },
    function () { setupInputBess(); },
    function () { setupInputBessEconomicsRows(); },
    function () { setupInputBessInstallRows(); },
    function () { setupInputBessStyling(); },
    function () { setupInputBaasSheet(true); },
    function () { setupInputProjectPvSection(ss); },
    function () { setupInputBessResilienceSection(ss); },
    function () { setupInputCFE(true); }
  ];
  for (var i = 0; i < steps.length; i++) {
    try { steps[i](); }
    catch (e) {
      if (typeof Logger !== 'undefined' && Logger.log) {
        Logger.log('rebuildInputsToDefault_ step ' + i + ' failed: ' + e.message);
      }
    }
  }
}


/**
 * Snapshot inputs, run fn, then ALWAYS restore -- or rebuild DEFAULT layout if
 * the restore itself fails. Used by TestRunner and available to any future
 * destructive operation (clean / load / reset in the A3 admin panel).
 * @param {function():*} fn
 * @param {string} label  short label for logs/toasts
 * @return {*} fn's return value
 */
function withInputsProtected(fn, label) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var snap = null;
  try {
    snap = snapshotInputSheets(ss);
  } catch (e) {
    if (typeof Logger !== 'undefined' && Logger.log) {
      Logger.log('withInputsProtected: snapshot failed (' + (label || '') + '): ' + e.message);
    }
  }
  try {
    return fn();
  } finally {
    if (snap) {
      try {
        restoreInputSheets(ss, snap);
      } catch (e2) {
        rebuildInputsToDefault_(ss);
        try {
          ss.toast('Inputs could not be restored after "' + (label || 'run') +
                   '"; rebuilt DEFAULT layout. (' + e2.message + ')', 'ARGIA', 10);
        } catch (ignore) {}
      }
    }
  }
}
