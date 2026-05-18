// =============================================================================
// ARGIA ENGINE v7 -- File: 97_InputAudit.gs
// One-shot read-only scanner. Dumps every non-empty cell on the input tabs
// PLUS every non-empty cell on the calculated-output tabs (BOM, INSTALLATION,
// FINANCE) to a single _AUDIT_INPUTS sheet so we can verify nothing gets
// dropped during migrations or template changes, and trace where every
// number lives.
//
// USAGE
//   Open the workbook → Apps Script editor → select auditInputs → Run.
//   Or from the engine menu if wired up. Takes a few seconds.
//
//   Result: a refreshed _AUDIT_INPUTS sheet with one row per populated cell.
//   Columns: CATEGORY | SHEET | ROW | COL | A1 | VALUE | FORMULA | LEFT_HINT |
//            ABOVE_HINT | NOTE
//
// CATEGORIES (Tier A, 2026-04-28)
//   INPUT             — cell on an input tab. User-entered or template-written.
//   OUTPUT-FORMULA    — cell on a result tab that contains a sheet formula
//                       (= prefix). Formula text shown in FORMULA column.
//                       Most FINANCE cells fall here.
//   OUTPUT-LITERAL    — cell on a result tab that contains a static value
//                       written by the engine (no formula). Provenance
//                       requires reading the writer code; not auto-traced.
//                       Most BOM and INSTALLATION cells fall here.
//
// IDEMPOTENT
//   Safe to re-run. Clears the existing _AUDIT_INPUTS sheet each time.
//
// SCOPE
//   - Input tabs: INPUT_PROJECT, INPUT_DESIGN, INPUT_INSTALL, INPUT_CFE
//   - Output tabs: BOM, INSTALLATION, FINANCE
//   MDC and PROJECT_CARD are intentionally NOT included.
//
// WHAT IT DOES NOT DO
//   - Does not change anything.
//   - Does not infer field types.
//   - Does not trace which engine variable wrote a literal cell. For that
//     you need to read the writer code (08_WriteBOM.gs, 13_CalcInstallCost.gs).
// =============================================================================

var AUDIT_INPUT_SHEETS  = ['INPUT_PROJECT', 'INPUT_DESIGN', 'INPUT_INSTALL', 'INPUT_CFE'];
var AUDIT_OUTPUT_SHEETS = ['BOM', 'INSTALLATION', 'FINANCE'];
var AUDIT_OUTPUT_SHEET  = '_AUDIT_INPUTS';
var AUDIT_MAX_VALUE_LEN = 120;
var AUDIT_MAX_LABEL_LEN = 80;

/**
 * Entry point — runs the audit and writes the results to _AUDIT_INPUTS.
 * Safe to invoke from the IDE Run button.
 */
function auditInputs() {
  var ss = SpreadsheetApp.getActive();
  var out = ss.getSheetByName(AUDIT_OUTPUT_SHEET);
  if (out) out.clear();
  else out = ss.insertSheet(AUDIT_OUTPUT_SHEET);

  // Header row
  var headers = [
    'CATEGORY', 'SHEET', 'ROW', 'COL', 'A1',
    'VALUE', 'FORMULA',
    'LEFT_HINT', 'ABOVE_HINT',
    'NOTE'
  ];
  out.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#F5F3EE');

  var rows = [];
  var sheetsScanned  = 0;
  var sheetsMissing  = [];
  var inputCells     = 0;
  var formulaCells   = 0;
  var literalCells   = 0;

  // ---- Input tabs first --------------------------------------------------
  AUDIT_INPUT_SHEETS.forEach(function(sheetName) {
    var info = _scanSheet(ss, sheetName, 'INPUT');
    if (!info) { sheetsMissing.push(sheetName); return; }
    sheetsScanned++;
    rows = rows.concat(info.rows);
    inputCells   += info.input;
    formulaCells += info.formula;
    literalCells += info.literal;
  });

  // ---- Output tabs second (BOM, INSTALLATION, FINANCE) -------------------
  AUDIT_OUTPUT_SHEETS.forEach(function(sheetName) {
    var info = _scanSheet(ss, sheetName, 'OUTPUT');
    if (!info) { sheetsMissing.push(sheetName); return; }
    sheetsScanned++;
    rows = rows.concat(info.rows);
    inputCells   += info.input;
    formulaCells += info.formula;
    literalCells += info.literal;
  });

  if (rows.length > 0) {
    out.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // Column widths for readability
  out.setColumnWidth( 1, 130);  // CATEGORY
  out.setColumnWidth( 2, 140);  // SHEET
  out.setColumnWidth( 3, 50);   // ROW
  out.setColumnWidth( 4, 50);   // COL
  out.setColumnWidth( 5, 60);   // A1
  out.setColumnWidth( 6, 240);  // VALUE
  out.setColumnWidth( 7, 280);  // FORMULA
  out.setColumnWidth( 8, 200);  // LEFT_HINT
  out.setColumnWidth( 9, 200);  // ABOVE_HINT
  out.setColumnWidth(10, 200);  // NOTE
  out.setFrozenRows(1);
  out.setFrozenColumns(5);

  var summary = 'Audit complete.\n\n' +
    'Sheets scanned: ' + sheetsScanned + ' (' +
      AUDIT_INPUT_SHEETS.length + ' input + ' +
      AUDIT_OUTPUT_SHEETS.length + ' output)\n' +
    'Input cells: ' + inputCells + '\n' +
    'Output cells with formulas: ' + formulaCells + '\n' +
    'Output cells with literals (engine-written): ' + literalCells + '\n' +
    'Total cells dumped: ' + rows.length + '\n' +
    (sheetsMissing.length ? 'Sheets not found: ' + sheetsMissing.join(', ') + '\n' : '') +
    '\nResults in the _AUDIT_INPUTS tab. Sort/filter to drill in.';

  Logger.log(summary);
  try {
    SpreadsheetApp.getUi().alert('Input Audit', summary, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Running headless (no UI context) — the log above is enough.
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
 * triggers. The apostrophe is invisible in the displayed cell and stripped on
 * CSV export, so output stays clean.
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
