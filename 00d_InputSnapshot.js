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
      values:   _snapshotSanitizeValues_(sh.getRange(1, 1, r, c).getValues())
    };
  }
  return snap;
}


/**
 * [4.15.0 test-hygiene] Sanitize a getValues() matrix IN PLACE: any rich
 * object (CellImage logo at B2, future rich types) becomes '' so bulk
 * setValues on restore can NEVER throw "Service error: Spreadsheets".
 * Dates are legitimate cell values and pass through untouched.
 *
 * WHY HERE (not only in the persist builder): the 4.14.3 filter cleaned the
 * PERSISTED backup, but the IN-MEMORY snapshot used by the E2E/test restore
 * still carried the CellImage -- every restore's bulk write threw, fell back
 * to the slow per-cell path (the chronic "Service error: Spreadsheets;
 * 1 cell(s) skipped" on every E2E in LOGS), and burned ~hundreds of
 * sequential setValue calls per run. Logos are template chrome, not input
 * data: they are re-asserted after every restore (argiaReassertInputLogos).
 */
function _snapshotSanitizeValues_(values) {
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var v = values[r][c];
      if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
        values[r][c] = '';
      }
    }
  }
  return values;
}


/**
 * [4.15.0 test-hygiene] Re-insert the ARGIA logo at B2 of every input tab.
 * Logos are CHROME re-derived from the template, never round-tripped through
 * snapshots. Called after every restoreInputSheets and by the layout repair.
 * Fail-soft per tab; returns the tab names where a re-insert was attempted.
 */
function argiaReassertInputLogos(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var done = [];
  if (typeof _insertArgiaLogo !== 'function') return done;
  for (var i = 0; i < INPUT_SNAPSHOT_TABS.length; i++) {
    var sh = ss.getSheetByName(INPUT_SNAPSHOT_TABS[i]);
    if (!sh) continue;
    try { _insertArgiaLogo(sh, 2, 2); done.push(INPUT_SNAPSHOT_TABS[i]); }
    catch (e) { /* logo is cosmetic; never block a restore */ }
  }
  return done;
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

  // [4.15.0 test-hygiene] Logos are chrome, not data: the snapshot
  // deliberately drops them (rich objects poison bulk setValues), so every
  // restore ends by re-asserting them. This is what guarantees "logo present
  // before tests => logo present after tests".
  report.logosReasserted = argiaReassertInputLogos(ss);

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
 * VERIFY-POINT RESOLVED (Batch 1, 2026-06-10). Ordering constraints checked
 * against the live setup functions:
 *   - setupInputBess() (base layout) runs BEFORE setupInputBessEconomicsRows /
 *     setupInputBessInstallRows / setupInputBessStyling (all extend §5/§6 of
 *     the base layout -- 02e_InputSetup.js).
 *   - setupInputBessResilienceSection runs AFTER setupInputBessInstallRows
 *     (the §6 rows it must not collide with -- see 27b_RepairResilienceCollision,
 *     which exists precisely because the reverse order once happened).
 *   - setupInputProjectPvSection runs AFTER setupInputProject (it extends the
 *     INPUT_PROJECT layout -- 01d_SetupInputProjectPv.js).
 *   - setupInputCFE last: independent tab, array formulas written in one pass.
 * Covered by INT_LIFECYCLE_START_NEW_PROJECT_CLEAN, which rebuilds and then
 * asserts the INPUT_BESS layout contract + zero residue.
 *
 * Public alias rebuildInputsToDefault() added in Batch 1 so the Start New
 * Project admin command (00_Main.js) can call it; the trailing-underscore
 * name is kept for the TestRunner fallback wiring.
 * @param {Spreadsheet} ss
 */
function rebuildInputsToDefault(ss) {
  return rebuildInputsToDefault_(ss);
}

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
  // [4.15.0 test-hygiene] Step failures were Logger-only (invisible). A
  // setup step that throws AFTER its in-place clear() leaves a bare,
  // unstyled tab -- exactly the silent INPUT_DESIGN format wipe of 4.14.3's
  // Start New Project storm. Failures are now collected, engineLog'd, and
  // RETURNED so every caller can surface them to the user.
  var failures = [];
  for (var i = 0; i < steps.length; i++) {
    try { steps[i](); }
    catch (e) {
      var note = 'rebuildInputsToDefault step ' + i + ' (' +
                 (steps[i].name || 'anon') + ') failed: ' + e.message;
      failures.push(note);
      if (typeof engineLog === 'function') {
        try { engineLog(ss, 'InputRebuild', 'ERROR', note); } catch (_) {}
      }
      if (typeof Logger !== 'undefined' && Logger.log) Logger.log(note);
    }
  }
  return failures;
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


// =============================================================================
// PERSISTENT INPUT BACKUP  (Batch 1 / B1.2 -- copyTo retirement)
// -----------------------------------------------------------------------------
// Persists a snapshotInputSheets() result to a hidden _INPUT_BACKUP sheet so
// it survives sessions/timeouts -- the gap the in-memory snapshot had ("a hard
// timeout mid-run would lose it", see SCOPE NOTE above; that note is now
// closed by this layer).
//
// WHY THIS REPLACES copyTo (test/TestSheetBackup.gs)
//   - copyTo omitted INPUT_BAAS entirely (restore silently skipped it).
//   - copyTo + clearContents corrupts INPUT_CFE's array formulas (the file's
//     own header warned about this while the map still included INPUT_CFE).
//   - The formula-precedence snapshot is the strategy already PROVEN by the
//     Phase-4 regression tests and the A1 TestRunner protection.
//
// STORAGE FORMAT (hidden sheet '_INPUT_BACKUP')
//   Row 1: ['ARGIA_INPUT_BACKUP', isoTimestamp, formatVersion]
//   Row 2+: [tabName, row(1-based), col(1-based), 'F'|'V', content]
//   One row per NON-EMPTY cell (formula precedence). ~1.1k rows on a typical
//   workbook -- one bulk setValues, fast. Content column is set to plain-text
//   number format so formula strings survive an xlsx round-trip.
// =============================================================================

var INPUT_BACKUP_SHEET = '_INPUT_BACKUP';

/**
 * Persist a snapshot to the hidden _INPUT_BACKUP sheet (replacing any
 * previous backup). Returns the number of cell rows written.
 * @param {Spreadsheet} ss
 * @param {Object} snap  result of snapshotInputSheets()
 * @return {number}
 */
/**
 * Build the row matrix for the _INPUT_BACKUP sheet from a snapshot.
 * PURE (Node-testable). EVERY row is exactly INPUT_BACKUP_COLS wide --
 * Sheets' setValues throws on ragged matrices, which is precisely the
 * v4.13.0 bug this extraction pins down (header was 3 wide, data 5 wide;
 * the Node rig's setValues stub doesn't validate widths, so only the
 * in-sheet run caught it). UNIT_BACKUP_ROWS_UNIFORM_WIDTH now locks it.
 *
 * Row 1: ['ARGIA_INPUT_BACKUP', isoTimestamp, formatVersion, '', '']
 * Row 2+: [tabName, row(1-based), col(1-based), 'F'|'V', content]
 *
 * @param {Object} snap  result of snapshotInputSheets()
 * @param {string} isoTimestamp
 * @return {Array<Array>} uniform-width row matrix
 */
var INPUT_BACKUP_COLS = 5;

function argiaBuildBackupRows(snap, isoTimestamp) {
  if (!snap) throw new Error('argiaBuildBackupRows: empty snapshot');
  // Header padded to the full width -- NEVER ship a ragged matrix.
  var rows = [['ARGIA_INPUT_BACKUP', isoTimestamp, 1, '', '']];
  Object.keys(snap).forEach(function (name) {
    var s = snap[name];
    for (var r = 0; r < s.rows; r++) {
      for (var c = 0; c < s.cols; c++) {
        var f = s.formulas[r][c];
        var v = s.values[r][c];
        if (f === '' && (v === '' || v === null)) continue;   // skip empties
        if (f !== '') rows.push([name, r + 1, c + 1, 'F', f]);
        else if (argiaIsBackupSafeValue(v)) {
          rows.push([name, r + 1, c + 1, 'V', v]);
        }
        // else: non-primitive cell value. The ARGIA logo is an IN-CELL image
        // at B2 of every input tab; getValues() returns it as a CellImage
        // object, and ONE such object in the matrix makes the whole bulk
        // setValues throw "Service error: Spreadsheets" (the 4.14.0-4.14.2
        // persist failures -- invisible to the offline replay because xlsx
        // export drops in-cell images). Images are not restorable input
        // data; the setup function reinserts the logo. SKIP.
      }
    }
  });
  return rows;
}

function persistInputSnapshot(ss, snap) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!snap) throw new Error('persistInputSnapshot: empty snapshot');

  var rows = argiaBuildBackupRows(snap, new Date().toISOString());

  var sh = ss.getSheetByName(INPUT_BACKUP_SHEET);
  if (sh) sh.clearContents();
  else    sh = ss.insertSheet(INPUT_BACKUP_SHEET);
  // [4.14.1] Guarantee grid capacity BEFORE touching ranges. A fresh sheet
  // has a 1000-row grid; the snapshot emits one row PER NON-EMPTY INPUT
  // CELL and a full project routinely exceeds that (CULLIGAN: ~1075 rows).
  // setValues beyond the grid throws the opaque "Service error:
  // Spreadsheets" (the 4.14.0 live-suite abort).
  if (sh.getMaxRows() < rows.length) {
    sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
  }
  if (sh.getMaxColumns() < INPUT_BACKUP_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), INPUT_BACKUP_COLS - sh.getMaxColumns());
  }
  // [4.14.2] Commit the structural changes BEFORE bulk-writing across the
  // freshly inserted rows. On 4.14.1 the SAME setValues call still threw
  // "Service error: Spreadsheets" with the grid correctly expanded and a
  // content-clean matrix (replayed offline from the live workbook: 1075x5,
  // no oversized strings / NaN / invalid UTF-16). Bulk writes spanning
  // unflushed insertRowsAfter rows are a known deterministic trigger.
  SpreadsheetApp.flush();
  // Plain-text format on the content column so '=FORMULA' strings are inert
  // and survive download round-trips (same belt-and-suspenders as 97_InputAudit).
  sh.getRange(1, 5, Math.max(rows.length, 1), 1).setNumberFormat('@');

  // [4.14.2] RESILIENT write -- same lesson restoreInputSheets already
  // encodes: if the bulk setValues throws, fall back to 200-row chunks, and
  // any chunk that still throws is written cell-by-cell with every failing
  // cell logged (backup row, tab, r, c). The backup then lands regardless,
  // and a genuinely poisoned cell names itself in the LOGS sheet instead of
  // aborting Start New Project behind an opaque service error.
  // [4.14.3] Fallback is now BOUNDED: bisect each failing chunk instead of
  // degrading to per-cell writes. 4.14.2's per-cell mode issued ~1000
  // setValue calls per failing 200-row chunk (~5000 total with the five
  // logo cells) -- the API storm that triggered the document-wide service
  // timeouts mid-suite. Bisection isolates a poisoned row in ~8 extra calls.
  var failedCells = 0;
  try {
    sh.getRange(1, 1, rows.length, INPUT_BACKUP_COLS).setValues(rows);
  } catch (bulkErr) {
    var failedRows = [];
    var chunks = argiaChunkRanges(rows.length, 200);
    for (var ci = 0; ci < chunks.length; ci++) {
      _argiaBisectWrite(sh, rows, chunks[ci][0], chunks[ci][1], failedRows);
    }
    failedCells = failedRows.length;
    if (typeof engineLog === 'function') {
      var detail = failedRows.slice(0, 10).map(function (fr) {
        var row = rows[fr];
        return 'backup row ' + (fr + 1) + ' [' + row[0] + ' r' + row[1]
             + ' c' + row[2] + ' ' + row[3] + ' type='
             + (row[4] instanceof Date ? 'Date' : typeof row[4]) + ']';
      }).join('; ');
      engineLog(ss, 'persistInputSnapshot', 'WARN',
        'bulk setValues failed (' + bulkErr + '); bisect fallback'
        + (failedCells ? ' -- UNWRITABLE ROWS: ' + failedCells + ' -> ' + detail
                       : ' -- all rows landed'));
    }
  }
  try { sh.hideSheet(); } catch (e) { /* already hidden / single-sheet edge */ }
  return rows.length - 1;
}


/**
 * Load the persisted backup back into snapshot shape (compatible with
 * restoreInputSheets). Returns null when no backup exists.
 * @param {Spreadsheet} ss
 * @return {Object|null} snap keyed by sheet name
 */
function loadPersistedInputSnapshot(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(INPUT_BACKUP_SHEET);
  if (!sh) return null;
  var last = sh.getLastRow();
  if (last < 2) return null;
  var header = sh.getRange(1, 1, 1, 3).getValues()[0];
  if (String(header[0]) !== 'ARGIA_INPUT_BACKUP') return null;

  var data = sh.getRange(2, 1, last - 1, 5).getValues();

  // Pass 1: dimensions per tab.
  var dims = {};
  data.forEach(function (row) {
    var name = String(row[0]);
    if (!name) return;
    var r = Number(row[1]), c = Number(row[2]);
    if (!dims[name]) dims[name] = { rows: 0, cols: 0 };
    if (r > dims[name].rows) dims[name].rows = r;
    if (c > dims[name].cols) dims[name].cols = c;
  });

  // Pass 2: build empty grids, then place cells.
  var snap = {};
  Object.keys(dims).forEach(function (name) {
    var d = dims[name];
    var formulas = [], values = [];
    for (var r = 0; r < d.rows; r++) {
      var fr = [], vr = [];
      for (var c = 0; c < d.cols; c++) { fr.push(''); vr.push(''); }
      formulas.push(fr); values.push(vr);
    }
    snap[name] = { rows: d.rows, cols: d.cols, formulas: formulas, values: values };
  });
  data.forEach(function (row) {
    var name = String(row[0]);
    if (!name || !snap[name]) return;
    var r = Number(row[1]) - 1, c = Number(row[2]) - 1;
    if (String(row[3]) === 'F') snap[name].formulas[r][c] = row[4];
    else                        snap[name].values[r][c]   = row[4];
  });
  return snap;
}


/** @return {boolean} whether a persisted backup exists. */
function hasPersistedInputBackup(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(INPUT_BACKUP_SHEET);
  if (!sh || sh.getLastRow() < 2) return false;
  return String(sh.getRange(1, 1).getValue()) === 'ARGIA_INPUT_BACKUP';
}


/** Delete the persisted backup sheet (after a successful restore). */
function clearPersistedInputBackup(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(INPUT_BACKUP_SHEET);
  if (sh) ss.deleteSheet(sh);
}


// ---------------------------------------------------------------------------
// [4.14.2] PURE chunk planner for the resilient backup write. Unit-locked
// (UNIT_BACKUP_CHUNK_RANGES_COVER): chunks tile [0, total) exactly once --
// no gap, no overlap -- so the fallback can never silently drop or
// duplicate backup rows.
// ---------------------------------------------------------------------------
// [4.14.3] A backup row's content cell may only carry what Sheets can
// serialize back: string / number / boolean / Date. Everything else
// (CellImage logos, future rich objects) is excluded by the builder.
function argiaIsBackupSafeValue(v) {
  return typeof v === 'string' || typeof v === 'number' ||
         typeof v === 'boolean' || (v instanceof Date);
}

function argiaChunkRanges(total, chunkSize) {
  var out = [];
  var n = Math.max(0, total | 0);
  var size = Math.max(1, chunkSize | 0);
  for (var start = 0; start < n; start += size) {
    out.push([start, Math.min(size, n - start)]);
  }
  return out;
}


// ---------------------------------------------------------------------------
// [4.14.3] Bounded bisect writer for the persist fallback. A failing range
// is split in half recursively; a single unwritable ROW is recorded (index
// into the rows matrix) and skipped. Cost per poisoned row is O(log chunk)
// extra setValues calls -- never the per-cell storm.
// ---------------------------------------------------------------------------
function _argiaBisectWrite(sh, rows, start, count, failedRows) {
  if (count <= 0) return;
  var slice = rows.slice(start, start + count);
  try {
    sh.getRange(start + 1, 1, count, slice[0].length).setValues(slice);
  } catch (e) {
    if (count === 1) { failedRows.push(start); return; }
    var half = Math.floor(count / 2);
    _argiaBisectWrite(sh, rows, start, half, failedRows);
    _argiaBisectWrite(sh, rows, start + half, count - half, failedRows);
  }
}


// =============================================================================
// INPUT LAYOUT INVARIANT  (4.15.0 test-hygiene)
// -----------------------------------------------------------------------------
// Contract: ANY operation that snapshots + restores the input tabs (E2E,
// fixture load, Start New Project) must leave the LAYOUT exactly as it found
// it -- merges, frozen panes, title styling, logos. Values are guaranteed by
// the snapshot; this layer guarantees the presentation, and PROVES it with a
// cheap before/after fingerprint instead of assuming it.
//
//   argiaInputLayoutFingerprint(ss)        -> {tab: {merges,frozenR,frozenC,
//                                                    titleWeight}}
//   argiaDiffLayoutFingerprints(a, b)      -> [human-readable drift strings]
//   repairInputLayouts(ss)                 -> snapshot values -> styled
//                                             DEFAULT rebuild -> restore
//                                             values -> logos -> report
//   runRepairInputLayouts()                -> menu wrapper (confirm+summary)
// =============================================================================

/**
 * Cheap structural fingerprint of every input tab's layout. 4 reads per tab:
 * merged-range count (the observed failure mode was 25 -> 0), frozen rows,
 * frozen cols, and the D2 title font weight as a styling sentinel.
 * @param {Spreadsheet} ss
 * @return {Object} keyed by tab name
 */
function argiaInputLayoutFingerprint(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var fp = {};
  for (var i = 0; i < INPUT_SNAPSHOT_TABS.length; i++) {
    var name = INPUT_SNAPSHOT_TABS[i];
    var sh = ss.getSheetByName(name);
    if (!sh) continue;
    var entry = { merges: -1, frozenR: -1, frozenC: -1, titleWeight: '?' };
    try {
      entry.merges = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns())
                       .getMergedRanges().length;
    } catch (e) {}
    try { entry.frozenR = sh.getFrozenRows(); } catch (e) {}
    try { entry.frozenC = sh.getFrozenColumns(); } catch (e) {}
    try { entry.titleWeight = String(sh.getRange('D2').getFontWeight()); } catch (e) {}
    fp[name] = entry;
  }
  return fp;
}


/**
 * PURE diff of two layout fingerprints. Returns [] when identical, else one
 * human-readable line per drifted field. Tabs present in `before` but absent
 * in `after` (or vice versa) are reported too.
 * @param {Object} before  argiaInputLayoutFingerprint result
 * @param {Object} after   argiaInputLayoutFingerprint result
 * @return {string[]}
 */
function argiaDiffLayoutFingerprints(before, after) {
  var drift = [];
  before = before || {}; after = after || {};
  var names = {};
  Object.keys(before).forEach(function (n) { names[n] = true; });
  Object.keys(after).forEach(function (n) { names[n] = true; });
  Object.keys(names).forEach(function (n) {
    var b = before[n], a = after[n];
    if (!b) { drift.push(n + ': tab appeared after the operation'); return; }
    if (!a) { drift.push(n + ': tab missing after the operation');  return; }
    ['merges', 'frozenR', 'frozenC', 'titleWeight'].forEach(function (f) {
      if (String(b[f]) !== String(a[f])) {
        drift.push(n + '.' + f + ': ' + b[f] + ' -> ' + a[f]);
      }
    });
  });
  return drift;
}


/**
 * ONE repair for input presentation: rebuild the styled DEFAULT layout on
 * all six tabs while keeping every user value. Sequence (each step loud):
 *   1. snapshot values+formulas (in-memory) AND persist to _INPUT_BACKUP
 *   2. rebuildInputsToDefault  (styled templates; failures returned)
 *   3. restoreInputSheets      (user values back; logos re-asserted)
 *   4. fingerprint the result for the report
 * NEVER proceeds past step 1 if the snapshot/persist failed.
 * @param {Spreadsheet} ss
 * @return {Object} report
 */
function repairInputLayouts(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var report = { ok: false, persistedCells: 0, rebuildFailures: [],
                 restore: null, fingerprint: null, error: null };

  var snap;
  try {
    snap = snapshotInputSheets(ss);
    report.persistedCells = persistInputSnapshot(ss, snap);
  } catch (e) {
    report.error = 'snapshot/persist failed -- repair ABORTED before any ' +
                   'destructive step: ' + e.message;
    if (typeof engineLog === 'function') {
      try { engineLog(ss, 'LayoutRepair', 'ERROR', report.error); } catch (_) {}
    }
    return report;
  }

  report.rebuildFailures = rebuildInputsToDefault(ss) || [];
  SpreadsheetApp.flush();
  report.restore = restoreInputSheets(ss, snap);
  SpreadsheetApp.flush();
  report.fingerprint = argiaInputLayoutFingerprint(ss);
  report.ok = report.rebuildFailures.length === 0;

  if (typeof engineLog === 'function') {
    try {
      engineLog(ss, 'LayoutRepair', report.ok ? 'INFO' : 'WARNING',
        'repairInputLayouts: rebuildFailures=' + report.rebuildFailures.length
        + ', restore fallback=' + (report.restore.fallback || []).length
        + ', logos=' + (report.restore.logosReasserted || []).length);
    } catch (_) {}
  }
  return report;
}


/**
 * Menu wrapper: confirm -> repairInputLayouts -> summary alert.
 */
function runRepairInputLayouts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var resp = ui.alert(
    'Repair Input Layout',
    'Rebuilds the styled layout (merges, headers, logos) of ALL SIX input '
    + 'tabs while KEEPING every value you have entered.\n\n'
    + 'Your values are backed up to the persistent _INPUT_BACKUP sheet '
    + 'first; the repair aborts before touching anything if that backup '
    + 'fails.\n\nContinue?',
    ui.ButtonSet.OK_CANCEL);
  if (resp !== ui.Button.OK) return;

  var rep = repairInputLayouts(ss);

  if (rep.error) {
    ui.alert('Repair Input Layout \u2014 ABORTED', rep.error, ui.ButtonSet.OK);
    return;
  }
  var lines = [];
  lines.push((rep.ok ? '\u2705' : '\u26a0') + ' Styled rebuild: '
             + (rep.rebuildFailures.length === 0
                ? 'all 6 tabs OK'
                : rep.rebuildFailures.length + ' step(s) FAILED (see LOGS)'));
  lines.push('\u2705 Values restored'
             + ((rep.restore.fallback || []).length
                ? ' (fallback on: ' + rep.restore.fallback.join(', ') + ')'
                : ''));
  lines.push('\u2705 Logos re-asserted on '
             + (rep.restore.logosReasserted || []).length + ' tab(s)');
  if (rep.fingerprint) {
    var m = Object.keys(rep.fingerprint).map(function (n) {
      return n.replace('INPUT_', '') + ':' + rep.fingerprint[n].merges;
    }).join('  ');
    lines.push('Merges now \u2014 ' + m);
  }
  lines.push('\nBackup of your values: ' + rep.persistedCells
             + ' cells in _INPUT_BACKUP.');
  ui.alert('Repair Input Layout \u2014 done', lines.join('\n'), ui.ButtonSet.OK);
}
