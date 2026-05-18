// =============================================================================
// ARGIA ENGINE v7 -- File: 02a_DesignTokens.gs
// Single source of truth for colors, fonts, sizes, and row heights used by
// every writer and every input-template function in the engine.
//
// HOW IT WORKS
//   1. First call per script run: ensureDesignTokensSheet() creates the
//      _DESIGN_TOKENS sheet pre-populated with defaults if it doesn't exist.
//   2. loadDesignTokens(ss) reads the sheet and caches values in memory.
//   3. Writer code calls token(key) / tokenNum(key) to read values.
//
// USAGE (inside any writer or template function)
//   loadDesignTokens(ss);                            // call once at the top
//   range.setFontColor(token('TEXT_PRIMARY'));       // use freely after
//   sh.setRowHeight(r, tokenNum('ROW_H_BODY'));      // numeric cast helper
//
// TUNING
//   Open the _DESIGN_TOKENS sheet, edit the VALUE column, save. Output
//   writers pick up the new value on the next engine run. Input templates
//   pick up the new value after running setupAllInputSheets().
//
// ADDING A TOKEN
//   Append a row to DESIGN_TOKEN_DEFAULTS below AND to the sheet itself
//   (the sheet is the live source once it exists — defaults are only
//   used for first-time creation).
//
// DEPRECATING
//   Leave the row in the sheet, stop using the key in code. Safe.
//
// FAILS LOUD
//   token('TYPO_KEY') throws. No silent fallbacks. Bugs surface immediately.
// =============================================================================

var DESIGN_TOKENS_SHEET = '_DESIGN_TOKENS';

// Defaults used only for first-time sheet creation. After that the sheet
// is authoritative. Hex values are a starting read off the mockups — tune
// in-sheet once you see them rendered.
var DESIGN_TOKEN_DEFAULTS = [
  // [key,                    value,      category,  used_for]
  ['TEXT_PRIMARY',            '#111111',  'text',    'Body, titles, values'],
  ['TEXT_SECONDARY',          '#767676',  'text',    'Labels, section numbers, captions'],
  ['TEXT_MUTED',              '#B0B0B0',  'text',    'Footer, fine print, pendiente placeholders'],

  ['BG_PAGE',                 '#FAFAF7',  'bg',      'Main sheet background (warm off-white)'],
  ['BG_SUBTOTAL',             '#F5F3EE',  'bg',      'Subtotal rows, section-header bands'],
  ['BG_CALLOUT',              '#FFF8E1',  'bg',      'DES-FLAG / DATA-FLAG boxes'],
  ['BG_ACCENT_FILL',          '#111111',  'bg',      'Generar MDC button fill'],
  ['BG_INPUT_CELL',           '#FDFBF6',  'bg',      'Input value cell (col D on every input row)'],

  ['STATUS_PASS',             '#2E7D5C',  'status',  'Checkmarks, PASS labels'],
  ['STATUS_WARN',             '#B88728',  'status',  'Warnings, REVIEW labels, pendiente markers'],
  ['STATUS_FAIL',             '#B8404C',  'status',  'Errors, FAIL labels'],

  ['DIVIDER_LINE',            '#E5E3DC',  'line',    'Horizontal rules between rows, cell borders'],
  ['DIVIDER_STRONG',          '#111111',  'line',    'Total-row rules, accent dividers'],

  ['FONT_FAMILY',             'Inter',    'font',    'Single family across every sheet'],
  ['FONT_SIZE_TITLE',         '22',       'font',    'Document title row'],
  ['FONT_SIZE_SECTION',       '10',       'font',    'Section headers (uppercase, tracked)'],
  ['FONT_SIZE_BODY',          '10',       'font',    'Body text everywhere'],
  ['FONT_SIZE_SMALL',         '8',        'font',    'Footer, metadata, provenance tags'],
  ['FONT_SIZE_STAT',          '28',       'font',    'Big number blocks on Project Card'],
  ['FONT_WEIGHT_BODY',        'normal',   'font',    'Body text weight'],
  ['FONT_WEIGHT_EMPHASIS',    'bold',     'font',    'Titles, totals, emphasis'],

  ['ROW_H_TITLE',             '42',       'layout',  'Title row height (px)'],
  ['ROW_H_SECTION',           '28',       'layout',  'Section header row height'],
  ['ROW_H_BODY',              '22',       'layout',  'Body row height'],
  ['ROW_H_DIVIDER',           '6',        'layout',  'Thin spacer row height'],
];

// Module-level cache. Populated on first loadDesignTokens() call per run.
var _TOKEN_CACHE = null;

/**
 * Creates _DESIGN_TOKENS sheet with defaults if it doesn't exist.
 * Returns the sheet. Idempotent — safe to call multiple times.
 *
 * Can be called with no arguments from the IDE "Run" button — defaults
 * to the active spreadsheet. Engine code should pass ss explicitly.
 */
function ensureDesignTokensSheet(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(DESIGN_TOKENS_SHEET);
  if (sh) return sh;

  sh = ss.insertSheet(DESIGN_TOKENS_SHEET);
  sh.getRange(1, 1, 1, 4)
    .setValues([['TOKEN', 'VALUE', 'CATEGORY', 'USED_FOR']])
    .setFontWeight('bold')
    .setBackground('#F5F3EE');
  sh.getRange(2, 1, DESIGN_TOKEN_DEFAULTS.length, 4)
    .setValues(DESIGN_TOKEN_DEFAULTS);
  sh.setColumnWidth(1, 220);
  sh.setColumnWidth(2, 110);
  sh.setColumnWidth(3, 90);
  sh.setColumnWidth(4, 420);
  sh.setFrozenRows(1);
  return sh;
}

/**
 * Loads all tokens from _DESIGN_TOKENS into memory. Cached per script run.
 * Auto-creates the sheet with defaults on first call. Must be called once
 * before token() / tokenNum() can be used in a given script run.
 *
 * Can be called with no arguments from the IDE "Run" button — defaults
 * to the active spreadsheet. Engine code should pass ss explicitly.
 */
function loadDesignTokens(ss) {
  if (_TOKEN_CACHE) return _TOKEN_CACHE;
  ss = ss || SpreadsheetApp.getActive();
  var sh = ensureDesignTokensSheet(ss);
  var lastRow = sh.getLastRow();
  var map = {};
  if (lastRow >= 2) {
    var rows = sh.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      var k = String(rows[i][0] || '').trim();
      if (k) map[k] = rows[i][1];
    }
  }
  _TOKEN_CACHE = map;
  return map;
}

/**
 * Returns the raw value of a token. Throws if:
 *   - loadDesignTokens(ss) wasn't called first
 *   - the key doesn't exist in the sheet
 * Fails loud by design — never silently substitutes a default.
 */
function token(key) {
  if (!_TOKEN_CACHE) {
    throw new Error('Design tokens not loaded. Call loadDesignTokens(ss) at the top of your writer.');
  }
  if (!(key in _TOKEN_CACHE)) {
    throw new Error('Unknown design token: "' + key + '". Check spelling or add it to the _DESIGN_TOKENS sheet.');
  }
  return _TOKEN_CACHE[key];
}

/**
 * Returns a token parsed as a number. Used for row heights, font sizes.
 * Throws if the stored value can't be parsed as a number.
 */
function tokenNum(key) {
  var v = parseFloat(token(key));
  if (isNaN(v)) {
    throw new Error('Design token "' + key + '" is not numeric: "' + token(key) + '"');
  }
  return v;
}

/**
 * Clears the in-memory cache so the next loadDesignTokens() re-reads the
 * sheet. Call this after editing token values in the sheet, or at the top
 * of test suites to guarantee a clean slate.
 */
function resetDesignTokenCache_() {
  _TOKEN_CACHE = null;
}
