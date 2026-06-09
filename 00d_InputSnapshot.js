// =============================================================================
// ARGIA ENGINE -- 00d_InputSnapshot.gs   (Track A · chunk A1, rev 2)
// -----------------------------------------------------------------------------
// Formula-aware, all-six-tab snapshot/restore of the INPUT_* sheets, plus a
// DEFAULT-layout rebuild helper. Wired into TestRunner so a test run can NEVER
// leave the workbook's inputs wiped.
//
// WHY THIS APPROACH (not copyTo)
//   Generalises the PROVEN strategy already used by the Phase-4 regression
//   test (_p4r_snapshotInputs / _p4r_restoreInputs):
//       snapshot = getFormulas() + getValues() over each tab's used range
//       restore  = setValues() with FORMULA PRECEDENCE (write the formula
//                  string where one existed, else the literal value)
//   That strategy survives INPUT_CFE's per-cell array formulas, unlike the
//   copyTo + clearContents approach in test/TestSheetBackup.gs (retired in
//   chunk A2). Here it covers ALL SIX input tabs -- including INPUT_INSTALL
//   and INPUT_BAAS, which copyTo omitted.
//
// REV 2 -- RESILIENT RESTORE (fixes the rev-1 wipe)
//   Rev 1 used a single bulk setValues() per tab. On INPUT_INSTALL / INPUT_BAAS
//   that threw "Service error: Spreadsheets" (merge-heavy range), which made
//   the runner fall back to a DEFAULT rebuild and RESET the loaded project.
//   Rev 2: bulk setValues() is the fast path, but if a tab throws we write
//   that tab cell-by-cell (skipping empties / merge non-anchors, each guarded).
//   restoreInputSheets NEVER throws and NEVER triggers a DEFAULT wipe; it
//   returns a small report naming any tab that needed the fallback.
//
// SCOPE NOTE (interim until A2/A3)
//   Restore is layout-faithful WITHIN A SINGLE RUN (same session/layout). Keyed
//   restore + persisted cross-session recovery land in A2/A3. The snapshot is
//   held in memory only; a hard timeout mid-run would lose it.
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
 * Restore every snapshotted tab with formula precedence. RESILIENT: a tab whose
 * bulk setValues() throws is written cell-by-cell instead, so one fragile tab
 * (merged region, validation, transient service error) can never abort the
 * whole restore. NEVER throws on per-cell/per-tab trouble.
 *
 * @param {Spreadsheet} ss
 * @param {Object} snap  result of snapshotInputSheets()
 * @return {Object} report { restored:[names], fallback:[notes], failedCells:n }
 */
function restoreInputSheets(ss, snap) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!snap) throw new Error('restoreInputSheets: empty snapshot');

  var report = { restored: [], fallback: [], failedCells: 0 };

  Object.keys(snap).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var s = snap[name];

    // Build the formula-or-value grid once (used by both paths).
    var out = [];
    for (var r = 0; r < s.rows; r++) {
      var row = [];
      for (var c = 0; c < s.cols; c++) {
        var f = s.formulas[r][c];
        row.push(f !== '' ? f : s.values[r][c]);
      }
      out.push(row);
    }

    try {
      // FAST PATH: one setValues for the whole tab.
      sh.getRange(1, 1, s.rows, s.cols).setValues(out);
      report.restored.push(name);
    } catch (e) {
      // RESILIENT FALLBACK: write each non-empty cell on its own. Empties
      // (incl. merge non-anchors, which return '' from both getValues and
      // getFormulas) are skipped so we never "change part of a merged cell".
      var skipped = _restoreInputsCellByCell_(sh, s);
      report.failedCells += skipped;
      report.fallback.push(name + ' (' + String(e.message || e).slice(0, 48)
                           + '; ' + skipped + ' cell(s) skipped)');
    }
  });

  return report;
}


/**
 * Per-cell restore fallback for a single tab. Writes only non-empty cells
 * (formula if one existed, else value), each guarded. Returns the count of
 * cells that still could not be written (logged by the caller).
 * @private
 */
function _restoreInputsCellByCell_(sh, s) {
  var skipped = 0;
  for (var r = 0; r < s.rows; r++) {
    for (var c = 0; c < s.cols; c++) {
      var f = s.formulas[r][c];
      var v = s.values[r][c];
      if (f === '' && (v === '' || v === null)) continue;   // skip empties
      try {
        var cell = sh.getRange(r + 1, c + 1);
        if (f !== '') cell.setFormula(f);
        else          cell.setValue(v);
      } catch (e) {
        skipped++;                                          // fragile cell -> skip
      }
    }
  }
  return skipped;
}


/**
 * Manual DEFAULT rebuild: rebuild every INPUT_* tab to its DEFAULT layout from
 * INPUT_MAP + the existing setup functions. Best-effort and guarded.
 *
 * NOTE (rev 2): this is NO LONGER called automatically by a test run -- auto-
 * wiping to default destroyed loaded inputs in rev 1. It stays here for the
 * A3 admin panel's explicit "Reset inputs to DEFAULT" action only.
 *
 * VERIFY-POINT: confirm this BESS setup order matches your setupInputBess*
 * functions before relying on it.
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
 * Snapshot inputs, run fn, then ALWAYS restore (resilient). Available to any
 * future destructive operation (A3 admin clean / load / reset). Does NOT auto-
 * rebuild DEFAULT -- restore is resilient; if it somehow raises, we log and
 * leave inputs as-is rather than wiping them.
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
        var rep = restoreInputSheets(ss, snap);
        if (rep && rep.fallback.length && typeof Logger !== 'undefined' && Logger.log) {
          Logger.log('withInputsProtected("' + (label || '') + '"): restored with '
                     + 'fallback on ' + rep.fallback.join(' | '));
        }
      } catch (e2) {
        if (typeof Logger !== 'undefined' && Logger.log) {
          Logger.log('withInputsProtected("' + (label || '') + '"): restore raised '
                     + 'unexpectedly (inputs left as-is): ' + e2.message);
        }
      }
    }
  }
}
