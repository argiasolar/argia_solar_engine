// =============================================================================
// ARGIA ENGINE v7 -- File: 97_InputAudit.gs
// One-shot read-only scanner. Dumps every non-empty cell on the configured
// input/output tabs to a single _AUDIT_INPUTS sheet so we can verify nothing
// gets dropped during migrations or template changes, and trace where every
// number lives.
//
// USAGE
//   Open the workbook → Apps Script editor → select auditInputs → Run.
//   Or from the engine menu if wired up. Takes a few seconds.
//
//   Result: a refreshed _AUDIT_INPUTS sheet with one row per populated cell.
//   Header rows:
//     Row 1: run metadata (timestamp, spreadsheet, totals)
//     Row 3: per-sheet row counts
//     Row 5: column headers
//     Row 6+: data
//
//   Columns: CATEGORY | SHEET | ROW | COL | A1 | VALUE | FORMULA |
//            LEFT_HINT | ABOVE_HINT | NOTE
//
// CATEGORIES
//   INPUT             — cell on an input tab. User-entered or template-written.
//   OUTPUT-FORMULA    — cell on a result tab that contains a sheet formula
//                       (= prefix). Formula text shown in FORMULA column.
//   OUTPUT-LITERAL    — cell on a result tab that contains a static value
//                       written by the engine (no formula). Provenance
//                       requires reading the writer code; not auto-traced.
//
// WHICH SHEETS GET AUDITED — three layers, in priority order:
//   1. _AUDIT_CONFIG sheet (if present and has rows): controls everything.
//      User toggles INCLUDE=TRUE/FALSE per row. Add custom sheets as needed.
//   2. Constants below (AUDIT_INPUT_SHEETS / AUDIT_OUTPUT_SHEETS): the
//      backstop. Used when _AUDIT_CONFIG is absent.
//   3. Auto-discovery seed: when _AUDIT_CONFIG is created for the first time
//      (auditConfigSetup or auto-create on first audit run), it seeds itself
//      by scanning the workbook for known patterns.
//
// FORMULA TEXT SAFETY
//   Formula strings in column G are escaped with a leading apostrophe AND
//   the column is set to plain-text number format. This is belt-and-suspenders
//   so the text survives an xlsx round-trip: the apostrophe protects the live
//   sheet, the text format protects the downloaded artifact.
//
// IDEMPOTENT
//   Safe to re-run. Clears the existing _AUDIT_INPUTS sheet each time.
//   _AUDIT_CONFIG is never overwritten — once created, the user owns it.
// =============================================================================

// ----- Default sheet lists (used when _AUDIT_CONFIG is absent) ---------------
// NOTE: INPUT_BAAS added 2026-05-30 -- the BaaS module (live since 2026-05-29)
// is a first-class input tab and MUST be audited. Without it the audit silently
// drops all 14 lease-economics inputs.
var AUDIT_INPUT_SHEETS  = ['INPUT_PROJECT', 'INPUT_DESIGN', 'INPUT_INSTALL', 'INPUT_CFE',
                           'INPUT_BESS', 'INPUT_BAAS'];
// Output tabs. The legacy v1 sheets (BOM, INSTALLATION, MDC, PROJECT_CARD,
// CFE_OUTPUT) were removed when the codebase went v2-only (v3.7.5); they were
// only generating "missing" noise, so they are dropped here. BAAS_PROJECTION_v2
// added so the BaaS deliverable is covered.
var AUDIT_OUTPUT_SHEETS = ['FINANCE',
                           'BOM_v2', 'INSTALLATION_v2', 'MDC_v2', 'PROJECT_CARD_v2', 'CFE_OUTPUT_v2',
                           'BAAS_PROJECTION_v2',
                           'RFQ_PANELES_v2', 'RFQ_INVERSORES_v2', 'RFQ_ELECTRICO_v2',
                           'RFQ_ESTRUCTURA_v2', 'RFQ_BESS_v2', 'RFQ_MONITOREO_v2'];

// When true, the audit auto-refreshes at the end of a successful engine run
// (see _refreshInputAudit_ below, called from runArgiaEngine). Flip to false
// to silence the auto-refresh (e.g. while profiling) without unwiring it.
var AUDIT_AUTORUN = true;

var AUDIT_OUTPUT_SHEET  = '_AUDIT_INPUTS';
var AUDIT_CONFIG_SHEET  = '_AUDIT_CONFIG';
var AUDIT_MAX_VALUE_LEN = 120;
var AUDIT_MAX_LABEL_LEN = 80;

// Rows reserved at the top of _AUDIT_INPUTS for the metadata block.
// Layout: row 1 = run metadata, row 3 = per-sheet counts, row 5 = column headers, row 6+ = data.
var AUDIT_HEADER_ROW       = 5;
var AUDIT_DATA_START_ROW   = 6;

// =============================================================================
// PUBLIC ENTRY POINTS
// =============================================================================

/**
 * Entry point — runs the audit and writes results to _AUDIT_INPUTS.
 * Safe to invoke from the IDE Run button or a menu.
 */
function auditInputs(opts) {
  // opts.silent === true suppresses the completion alert (used by the
  // auto-refresh hook so it doesn't stack a dialog on top of the engine's).
  var silent = !!(opts && opts.silent);
  var ss = SpreadsheetApp.getActive();
  var startMs = Date.now();

  // Resolve which sheets to scan
  var plan = _auditResolveSheets(ss);

  // Prepare output sheet
  var out = ss.getSheetByName(AUDIT_OUTPUT_SHEET);
  if (out) out.clear();
  else out = ss.insertSheet(AUDIT_OUTPUT_SHEET);

  // Scan everything
  var rows = [];
  var perSheet = [];           // [{name, category, count}]
  var sheetsScanned  = 0;
  var sheetsMissing  = [];
  var inputCells     = 0;
  var formulaCells   = 0;
  var literalCells   = 0;

  plan.forEach(function(item) {
    var info = _scanSheet(ss, item.name, item.category);
    if (!info) { sheetsMissing.push(item.name); return; }
    sheetsScanned++;
    rows = rows.concat(info.rows);
    inputCells   += info.input;
    formulaCells += info.formula;
    literalCells += info.literal;
    perSheet.push({ name: item.name, category: item.category, count: info.rows.length });
  });

  // ---- Header block (rows 1–4) ------------------------------------------
  _writeMetadataBlock(out, ss, sheetsScanned, sheetsMissing.length,
                       inputCells, formulaCells, literalCells, rows.length,
                       perSheet, Date.now() - startMs);

  // ---- Column header row (row 5) ----------------------------------------
  var headers = [
    'CATEGORY', 'SHEET', 'ROW', 'COL', 'A1',
    'VALUE', 'FORMULA',
    'LEFT_HINT', 'ABOVE_HINT',
    'NOTE'
  ];
  out.getRange(AUDIT_HEADER_ROW, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#F5F3EE');

  // ---- Data rows (row 6+) -----------------------------------------------
  if (rows.length > 0) {
    out.getRange(AUDIT_DATA_START_ROW, 1, rows.length, headers.length).setValues(rows);
  }

  // ---- Force the FORMULA column to plain-text format --------------------
  // This is the round-trip protection. Even if the leading apostrophe is
  // stripped by xlsx export/import, the column-level @ format keeps the
  // cell as text in Sheets.
  var formulaColRange = out.getRange(AUDIT_DATA_START_ROW, 7, Math.max(1, rows.length), 1);
  formulaColRange.setNumberFormat('@');

  // Column widths for readability
  out.setColumnWidth( 1, 130);  // CATEGORY
  out.setColumnWidth( 2, 140);  // SHEET
  out.setColumnWidth( 3, 50);   // ROW
  out.setColumnWidth( 4, 50);   // COL
  out.setColumnWidth( 5, 60);   // A1
  out.setColumnWidth( 6, 240);  // VALUE
  out.setColumnWidth( 7, 320);  // FORMULA
  out.setColumnWidth( 8, 200);  // LEFT_HINT
  out.setColumnWidth( 9, 200);  // ABOVE_HINT
  out.setColumnWidth(10, 200);  // NOTE
  out.setFrozenRows(AUDIT_HEADER_ROW);
  out.setFrozenColumns(5);

  var summary = 'Audit complete in ' + ((Date.now() - startMs) / 1000).toFixed(1) + 's.\n\n' +
    'Sheets scanned: ' + sheetsScanned + '\n' +
    'Input cells: ' + inputCells + '\n' +
    'Output cells with formulas: ' + formulaCells + '\n' +
    'Output cells with literals (engine-written): ' + literalCells + '\n' +
    'Total cells dumped: ' + rows.length + '\n' +
    (sheetsMissing.length ? 'Sheets configured but not found: ' + sheetsMissing.join(', ') + '\n' : '') +
    '\nResults in the _AUDIT_INPUTS tab. Sort/filter to drill in.\n' +
    'Config in the _AUDIT_CONFIG tab (toggle INCLUDE TRUE/FALSE to change scope).';

  Logger.log(summary);
  if (!silent) {
    try {
      SpreadsheetApp.getUi().alert('Input Audit', summary, SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) {
      // Running headless (no UI context) — the log above is enough.
    }
  }
}

/**
 * Safe auto-refresh hook. Called at the end of a successful engine run so the
 * _AUDIT_INPUTS tab never goes stale relative to the workbook. NEVER throws:
 * an audit problem must not break the engine or hide its completion dialog.
 * Toggle with the AUDIT_AUTORUN constant.
 *
 * @return {boolean} true if the audit ran, false if skipped/failed.
 */
function _refreshInputAudit_() {
  if (!AUDIT_AUTORUN) return false;
  try {
    auditInputs({ silent: true });
    return true;
  } catch (e) {
    try {
      var ss = SpreadsheetApp.getActive();
      engineLog(ss, 'InputAudit', 'WARN', 'Auto-refresh failed (non-fatal): ' + e.message);
    } catch (_) {}
    return false;
  }
}

/**
 * Create or rebuild the _AUDIT_CONFIG sheet by auto-discovering all
 * candidate sheets in the workbook. Safe to run manually whenever you've
 * added new sheets and want them picked up.
 *
 * Existing rows are preserved when their SHEET_NAME matches an existing
 * row — only INCLUDE values you've set are kept. New sheets are appended
 * with sensible defaults.
 */
function auditConfigSetup() {
  var ss = SpreadsheetApp.getActive();
  var discovered = _auditDiscoverSheets(ss);
  var cfg = ss.getSheetByName(AUDIT_CONFIG_SHEET);

  // Read existing config if any, so user toggles are preserved
  var existing = {};   // name → { category, include, notes }
  if (cfg) {
    var lastRow = cfg.getLastRow();
    if (lastRow >= 2) {
      var rng = cfg.getRange(2, 1, lastRow - 1, 4).getValues();
      rng.forEach(function(r) {
        if (r[0]) {
          existing[String(r[0])] = {
            category: String(r[1] || ''),
            include: (r[2] === true || String(r[2]).toUpperCase() === 'TRUE'),
            notes: String(r[3] || '')
          };
        }
      });
    }
  } else {
    cfg = ss.insertSheet(AUDIT_CONFIG_SHEET);
  }
  cfg.clear();

  // Merge discovered + existing. Discovered drives ordering and default category;
  // existing INCLUDE/notes are preserved for any name match.
  var rows = [];
  var seen = {};
  discovered.forEach(function(d) {
    var prev = existing[d.name];
    rows.push([
      d.name,
      d.category,
      prev ? prev.include : d.includeByDefault,
      prev ? prev.notes : d.note
    ]);
    seen[d.name] = true;
  });
  // Preserve user-added custom rows that aren't in the discovered set
  Object.keys(existing).forEach(function(name) {
    if (!seen[name]) {
      var prev = existing[name];
      rows.push([name, prev.category, prev.include, prev.notes || '(custom — not auto-discovered)']);
    }
  });

  // Write header + data
  var headers = ['SHEET_NAME', 'CATEGORY', 'INCLUDE', 'NOTES'];
  cfg.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#F5F3EE');
  if (rows.length > 0) {
    cfg.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // Validation on CATEGORY column (B): INPUT, OUTPUT, SKIP
  var categoryRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['INPUT', 'OUTPUT', 'SKIP'], true)
    .setAllowInvalid(false)
    .build();
  cfg.getRange(2, 2, Math.max(1, rows.length), 1).setDataValidation(categoryRule);

  // Validation on INCLUDE column (C): checkbox
  cfg.getRange(2, 3, Math.max(1, rows.length), 1).insertCheckboxes();

  cfg.setColumnWidth(1, 200);
  cfg.setColumnWidth(2, 100);
  cfg.setColumnWidth(3, 80);
  cfg.setColumnWidth(4, 320);
  cfg.setFrozenRows(1);

  var msg = 'Audit config refreshed.\n\n' +
    'Discovered sheets: ' + discovered.length + '\n' +
    'Custom rows preserved: ' + (rows.length - discovered.length) + '\n\n' +
    'Toggle INCLUDE checkboxes to control which sheets get audited, ' +
    'then run auditInputs.';
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert('Audit Config', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // headless
  }
}

// =============================================================================
// INTERNALS
// =============================================================================

/**
 * Resolve which sheets to scan, in order. Priority:
 *   1. _AUDIT_CONFIG (if present and has at least one INCLUDE=TRUE row)
 *   2. Constants AUDIT_INPUT_SHEETS / AUDIT_OUTPUT_SHEETS
 * Returns: [{ name, category }] where category is 'INPUT' or 'OUTPUT'.
 */
function _auditResolveSheets(ss) {
  var cfg = ss.getSheetByName(AUDIT_CONFIG_SHEET);
  if (cfg && cfg.getLastRow() >= 2) {
    var rng = cfg.getRange(2, 1, cfg.getLastRow() - 1, 3).getValues();
    var fromCfg = [];
    rng.forEach(function(r) {
      var name = String(r[0] || '').trim();
      var category = String(r[1] || '').trim().toUpperCase();
      var include = (r[2] === true || String(r[2]).toUpperCase() === 'TRUE');
      if (name && include && (category === 'INPUT' || category === 'OUTPUT')) {
        fromCfg.push({ name: name, category: category });
      }
    });
    if (fromCfg.length > 0) return fromCfg;
  }

  // Fallback: constants
  var plan = [];
  AUDIT_INPUT_SHEETS.forEach(function(n)  { plan.push({ name: n, category: 'INPUT'  }); });
  AUDIT_OUTPUT_SHEETS.forEach(function(n) { plan.push({ name: n, category: 'OUTPUT' }); });
  return plan;
}

/**
 * Auto-discover candidate sheets in the workbook and propose categories.
 * Returns: [{ name, category, includeByDefault, note }]
 *
 * Rules:
 *   - INPUT_*                              → INPUT,  default TRUE
 *   - *_v2 (output writers)                → OUTPUT, default TRUE
 *   - Known legacy output names            → OUTPUT, default TRUE (only if sheet exists)
 *   - RFQ_*                                → OUTPUT, default TRUE
 *   - CFE_SIMULATION / BESS_SIMULATION /
 *     BESS_RECOMMENDATIONS                 → OUTPUT, default FALSE (computed sheets, opt-in)
 *   - _* (system), digit-prefix masters,
 *     LOGS, SLIDE_DATA, _TEST_BACKUP_*     → SKIP
 *   - Anything else                        → SKIP, with note
 */
function _auditDiscoverSheets(ss) {
  var legacyOutputs = ['BOM', 'INSTALLATION', 'FINANCE', 'MDC', 'PROJECT_CARD', 'CFE_OUTPUT'];
  var computedOutputs = ['CFE_SIMULATION', 'BESS_SIMULATION', 'BESS_RECOMMENDATIONS'];

  var result = [];
  ss.getSheets().forEach(function(sh) {
    var name = sh.getName();
    if (name === AUDIT_OUTPUT_SHEET || name === AUDIT_CONFIG_SHEET) return;

    // System sheets — skip silently
    if (name.charAt(0) === '_') {
      result.push({ name: name, category: 'SKIP', includeByDefault: false,
                    note: 'system sheet' });
      return;
    }
    // Master / digit-prefix sheets
    if (/^\d+[A-Z]?_/.test(name) || /^\d+M_/.test(name)) {
      result.push({ name: name, category: 'SKIP', includeByDefault: false,
                    note: 'master data sheet' });
      return;
    }
    // Known skips
    if (name === 'LOGS' || name === 'SLIDE_DATA') {
      result.push({ name: name, category: 'SKIP', includeByDefault: false,
                    note: 'not customer-facing output' });
      return;
    }

    // Inputs
    if (name.indexOf('INPUT_') === 0) {
      result.push({ name: name, category: 'INPUT', includeByDefault: true, note: '' });
      return;
    }

    // V2 outputs
    if (name.slice(-3) === '_v2') {
      result.push({ name: name, category: 'OUTPUT', includeByDefault: true, note: '' });
      return;
    }
    // RFQ outputs (covers both legacy and v2 naming)
    if (name.indexOf('RFQ_') === 0) {
      result.push({ name: name, category: 'OUTPUT', includeByDefault: true, note: '' });
      return;
    }
    // Legacy output names — only flag if sheet actually exists in this workbook
    if (legacyOutputs.indexOf(name) >= 0) {
      result.push({ name: name, category: 'OUTPUT', includeByDefault: true, note: '' });
      return;
    }
    // Computed/simulation sheets — opt-in
    if (computedOutputs.indexOf(name) >= 0) {
      result.push({ name: name, category: 'OUTPUT', includeByDefault: false,
                    note: 'formula-driven simulation sheet (opt-in)' });
      return;
    }
    // BESS_BATTERY_LIBRARY etc — skip by default but visible
    result.push({ name: name, category: 'SKIP', includeByDefault: false,
                  note: 'uncategorized — set CATEGORY + INCLUDE to scan' });
  });
  return result;
}

/**
 * Write the metadata header block (rows 1–4 above the column headers).
 */
function _writeMetadataBlock(out, ss, sheetsScanned, sheetsMissing,
                              inputCells, formulaCells, literalCells, totalCells,
                              perSheet, elapsedMs) {
  var tz = ss.getSpreadsheetTimeZone() || 'UTC';
  var now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');

  // Row 1: run metadata
  var row1 = [
    'Run: ' + now + ' (' + tz + ')',
    'Spreadsheet: ' + ss.getName(),
    'Sheets scanned: ' + sheetsScanned + (sheetsMissing ? ' (' + sheetsMissing + ' missing)' : ''),
    'Cells: ' + totalCells + ' (INPUT ' + inputCells +
      ' / OUTPUT-FORMULA ' + formulaCells +
      ' / OUTPUT-LITERAL ' + literalCells + ')',
    'Elapsed: ' + (elapsedMs / 1000).toFixed(1) + 's'
  ];
  out.getRange(1, 1, 1, row1.length)
    .setValues([row1])
    .setFontWeight('bold')
    .setBackground('#E8EEF2');

  // Row 3: per-sheet row counts.
  // No cell merging here — Sheets won't let a merge cross the frozen-column
  // boundary (we freeze at column 5). Instead, put the label in A3 and the
  // joined list in B3; the string overflows visually into empty neighbors,
  // which gives the same readable result without the merge.
  if (perSheet.length > 0) {
    var parts = perSheet.map(function(p) {
      return p.name + ' (' + p.category + ': ' + p.count + ')';
    });
    out.getRange(3, 1).setValue('Per sheet:').setFontWeight('bold');
    out.getRange(3, 2).setValue(parts.join(' • '))
      .setWrap(true)
      .setFontColor('#555555');
    // Make row 3 tall enough to wrap when many sheets are listed
    out.setRowHeight(3, Math.min(120, 21 + 18 * Math.ceil(perSheet.length / 4)));
  }
}

/**
 * Walk one sheet. Returns { rows, input, formula, literal } or null if the
 * sheet is missing.
 *
 * categoryHint:
 *   'INPUT'  — every cell becomes CATEGORY = "INPUT"
 *   'OUTPUT' — cell becomes "OUTPUT-FORMULA" (if formula present) or
 *              "OUTPUT-LITERAL" (if value but no formula)
 */
function _scanSheet(ss, sheetName, categoryHint) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return null;
  if (sh.getLastRow() === 0 || sh.getLastColumn() === 0) {
    return { rows: [], input: 0, formula: 0, literal: 0 };
  }

  var range    = sh.getDataRange();
  var values   = range.getValues();
  var formulas = range.getFormulas();
  var notes    = range.getNotes();
  var rows = [];
  var inputN = 0, formulaN = 0, literalN = 0;

  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var v = values[r][c];
      var f = formulas[r][c];
      var note = notes[r][c] || '';
      var isEmpty = (v === '' || v === null || v === undefined);
      if (isEmpty && !f && !note) continue;

      var leftHint  = (c > 0) ? values[r][c - 1] : '';
      var aboveHint = (r > 0) ? values[r - 1][c] : '';

      var category;
      if (categoryHint === 'INPUT') {
        category = 'INPUT';
        inputN++;
      } else {
        // OUTPUT — distinguish formula vs literal
        if (f && String(f).length > 0) {
          category = 'OUTPUT-FORMULA';
          formulaN++;
        } else {
          category = 'OUTPUT-LITERAL';
          literalN++;
        }
      }

      rows.push([
        category,
        sheetName,
        r + 1,
        c + 1,
        _auditColLetter(c + 1) + (r + 1),
        _auditTextSafe(_auditTruncate(v, AUDIT_MAX_VALUE_LEN)),
        _auditTextSafe(_auditTruncate(f, AUDIT_MAX_VALUE_LEN)),
        _auditTextSafe(_auditTruncate(leftHint,  AUDIT_MAX_LABEL_LEN)),
        _auditTextSafe(_auditTruncate(aboveHint, AUDIT_MAX_LABEL_LEN)),
        _auditTextSafe(_auditTruncate(note,      AUDIT_MAX_LABEL_LEN))
      ]);
    }
  }

  return { rows: rows, input: inputN, formula: formulaN, literal: literalN };
}

/**
 * Convert 1-based column number to A1-notation letters.
 * 1 → "A", 26 → "Z", 27 → "AA", 703 → "AAA".
 */
function _auditColLetter(col) {
  var s = '';
  while (col > 0) {
    var rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

/** Truncate a value to max characters with ellipsis. Returns '' for null/undefined. */
function _auditTruncate(v, max) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  if (s.length <= max) return s;
  return s.substring(0, max - 3) + '...';
}

/**
 * Prefix any string that Sheets would interpret as a formula with an apostrophe
 * so it stores as literal text. Without this, captured formula text written via
 * setValues() gets re-parsed against the audit tab's own coordinates and either
 * shows a wrong number or an error like #N/A / #VALUE! / #REF!.
 *
 * Sheets/Excel treat the leading characters '=', '+', '-', '@' as formula
 * triggers. The apostrophe is invisible in the displayed cell. We pair this
 * with setNumberFormat('@') on column G as a belt-and-suspenders defense
 * against xlsx round-trip loss of the apostrophe.
 *
 * Pure numbers (returned as JS numbers from getValue) pass through untouched —
 * we only escape strings.
 */
function _auditTextSafe(s) {
  if (s === null || s === undefined || s === '') return '';
  if (typeof s !== 'string') return s;
  var first = s.charAt(0);
  if (first === '=' || first === '+' || first === '-' || first === '@') {
    return "'" + s;
  }
  return s;
}
