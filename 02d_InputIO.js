// =============================================================================
// ARGIA ENGINE v7 -- File: 02d_InputIO.gs
// Single choke point for reading and writing input values. All engine code
// goes through these helpers instead of `sh.getRange(row, col).getValue()`.
//
// WHY
//   Before: 108 references to INPUT_GENERAL/INPUT_DESIGN scattered across
//   12 files, each file hardcoding its own cell coordinates. Drift between
//   reader, writer, fixture, and setup was architecturally possible.
//
//   After: every coord lives in INPUT_MAP (02c_InputMap.gs). Engine code
//   calls readInput(ss, 'projectName') — knows nothing about coordinates.
//   Move a cell in the map → readers, fixture, setup, and error messages
//   all update automatically.
//
// BUG FIXES ABSORBED HERE
//   Bug #1: `parseFloat(v) || default` treats 0 as missing. Fixed by only
//           applying the default when the cell is empty (v === '' || null).
//           Explicit 0 now survives.
//   Bug #2: col M vs col N ambiguity on INPUT_DESIGN. Fixed by design —
//           INPUT_MAP is the single source of truth for every field's one
//           canonical coordinate.
//
// REQUIRES
//   02c_InputMap.gs loaded (INPUT_MAP global).
// =============================================================================


/**
 * Return the value of an input field by logical key.
 *
 * Empty-cell semantics: if the cell is blank, return the map's `default`
 * (if specified). Zero is NOT treated as empty — setting a cell to 0
 * returns 0, not the default. This fixes bug #1.
 *
 * Type coercion: for type 'number' or 'percent', runs parseFloat and falls
 * back to default if NaN. For 'text' / 'dropdown' / 'date' returns the raw
 * cell value.
 *
 * Throws if the key is not in INPUT_MAP or the target sheet doesn't exist.
 * Fails loud by design.
 *
 * @param {Spreadsheet} ss   optional — defaults to active spreadsheet
 * @param {string}      key  logical field name (e.g. 'projectName')
 */
function readInput(ss, key) {
  ss = ss || SpreadsheetApp.getActive();
  var m = INPUT_MAP[key];
  if (!m) {
    throw new Error('readInput: unknown key "' + key + '". Not in INPUT_MAP.');
  }
  var sh = ss.getSheetByName(m.sheet);
  if (!sh) {
    throw new Error('readInput: sheet "' + m.sheet + '" not found (for key "' + key + '")');
  }

  // Range mode: bulk tabular read. Returns a 2D array.
  if (m.mode === 'range') {
    if (!m.rangeA1) {
      throw new Error('readInput: range key "' + key + '" missing rangeA1');
    }
    return sh.getRange(m.rangeA1).getValues();
  }

  // Skip mode: documented-only, not a real cell. Return default or empty.
  if (m.mode === 'skip') {
    return m.hasOwnProperty('default') ? m.default : '';
  }

  // Scalar mode (default)
  var v = sh.getRange(m.row, m.col).getValue();

  // Empty cell → map default (if any)
  if (v === '' || v === null || v === undefined) {
    return m.hasOwnProperty('default') ? m.default : '';
  }

  // Numeric coercion
  if (m.type === 'number' || m.type === 'percent') {
    var n = parseFloat(v);
    if (isNaN(n)) {
      return m.hasOwnProperty('default') ? m.default : null;
    }
    return n;
  }

  return v;
}


/**
 * Write a value to an input cell by logical key.
 *
 * Null / undefined writes as empty string (clears the cell).
 *
 * @param {Spreadsheet} ss     optional — defaults to active spreadsheet
 * @param {string}      key    logical field name
 * @param {*}           value  the value to set
 */
function writeInput(ss, key, value) {
  ss = ss || SpreadsheetApp.getActive();
  var m = INPUT_MAP[key];
  if (!m) {
    throw new Error('writeInput: unknown key "' + key + '". Not in INPUT_MAP.');
  }
  var sh = ss.getSheetByName(m.sheet);
  if (!sh) {
    throw new Error('writeInput: sheet "' + m.sheet + '" not found (for key "' + key + '")');
  }

  // Range mode: bulk tabular write. Expects a 2D array matching rangeRows × rangeCols.
  if (m.mode === 'range') {
    if (!m.rangeA1) {
      throw new Error('writeInput: range key "' + key + '" missing rangeA1');
    }
    if (!Array.isArray(value) || !Array.isArray(value[0])) {
      throw new Error(
        'writeInput: range key "' + key + '" requires 2D array value, got ' +
        (value === null ? 'null' : typeof value)
      );
    }
    if (value.length !== m.rangeRows || value[0].length !== m.rangeCols) {
      throw new Error(
        'writeInput: range key "' + key + '" expects ' +
        m.rangeRows + 'x' + m.rangeCols + ' array, got ' +
        value.length + 'x' + (value[0] ? value[0].length : 0)
      );
    }
    sh.getRange(m.rangeA1).setValues(value);
    return;
  }

  // Skip mode: silently no-op. Entry exists for docs only.
  if (m.mode === 'skip') {
    return;
  }

  // Scalar mode (default)
  var v = (value === null || value === undefined) ? '' : value;
  var range = sh.getRange(m.row, m.col);

  range.setValue(v);

  // VERIFY-AND-RETRY: production Apps Script sometimes silently drops
  // setValue calls in long fixture loops (no exception, cell stays blank).
  // Track A Path C2 hit this on INPUT_DESIGN col D during fixture runs.
  // Read back; if the cell doesn't match what we wrote, flush + retry.
  // If the retry also fails, throw so the caller sees the failure rather
  // than silently carrying wrong state into the engine.
  var readBack = range.getValue();
  if (!_writeInputEquals(readBack, v)) {
    SpreadsheetApp.flush();
    range.setValue(v);
    SpreadsheetApp.flush();
    readBack = range.getValue();
    if (!_writeInputEquals(readBack, v)) {
      throw new Error(
        'writeInput verify failed for "' + key + '" at ' +
        m.sheet + '!' + _ioColLetter(m.col) + m.row +
        ': wrote ' + JSON.stringify(v) + ', read ' + JSON.stringify(readBack)
      );
    }
  }
}

/**
 * Compare written value against read-back value, tolerating the small
 * type coercions Google Sheets performs (e.g. empty string vs null,
 * integer vs float representation, dates stored as numbers).
 */
function _writeInputEquals(a, b) {
  // Both empty-ish
  var aEmpty = (a === '' || a === null || a === undefined);
  var bEmpty = (b === '' || b === null || b === undefined);
  if (aEmpty && bEmpty) return true;
  if (aEmpty !== bEmpty) return false;
  // Numbers — tolerate sheet-rounding floating point differences
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-9;
  }
  // Date vs number (sheet may format a number as a date)
  if (a instanceof Date && typeof b === 'number') return true;
  if (typeof a === 'number' && b instanceof Date) return true;
  // Default string comparison
  return String(a) === String(b);
}


/**
 * Return a human-readable A1 location for a key, for use in validator
 * error messages and MDC audit citations.
 *
 *   inputLocation('minTemp')           → 'INPUT_DESIGN!C9'
 *   inputLocation('helioscopeMonthly') → 'INPUT_DESIGN!B34:G45'
 *   inputLocation('unknown')           → '(unknown key)'
 */
function inputLocation(key) {
  var m = INPUT_MAP[key];
  if (!m) return '(unknown key: ' + key + ')';
  if (m.mode === 'range' && m.rangeA1) {
    return m.sheet + '!' + m.rangeA1;
  }
  return m.sheet + '!' + _ioColLetter(m.col) + m.row;
}


/**
 * True if the key exists in INPUT_MAP. Useful for optional fields.
 */
function hasInput(key) {
  return INPUT_MAP.hasOwnProperty(key);
}


/**
 * Return all logical keys defined in the map. Used by setup functions and
 * tests to iterate without hardcoding.
 */
function allInputKeys() {
  return Object.keys(INPUT_MAP);
}


/**
 * Return all keys whose target sheet is tabName. Used by setup functions
 * to lay out one tab at a time.
 *
 *   inputKeysForTab('1_PROJECT')  → ['projectName', 'clientName', ...]
 */
function inputKeysForTab(tabName) {
  return Object.keys(INPUT_MAP).filter(function(k) {
    return INPUT_MAP[k].sheet === tabName;
  });
}


/**
 * Return all keys matching a tab + section combination. Used for grouped
 * layout (e.g. render all fields in "01 IDENTIFICACIÓN" together).
 */
function inputKeysForSection(tabName, sectionLabel) {
  return Object.keys(INPUT_MAP).filter(function(k) {
    var m = INPUT_MAP[k];
    return m.sheet === tabName && m.section === sectionLabel;
  });
}


/**
 * Return the list of distinct section labels for a given tab, in the
 * order they first appear in the map. Used by setup functions to render
 * section headers in the right order.
 */
function inputSectionsForTab(tabName) {
  var seen = {};
  var result = [];
  Object.keys(INPUT_MAP).forEach(function(k) {
    var m = INPUT_MAP[k];
    if (m.sheet === tabName && m.section && !seen[m.section]) {
      seen[m.section] = true;
      result.push(m.section);
    }
  });
  return result;
}


// -----------------------------------------------------------------------------
// Internal helpers (leading underscore = private by GAS convention)
// -----------------------------------------------------------------------------

/**
 * Convert 1-based column number to A1-notation letters.
 * Shared with 97_InputAudit.gs via copy (GAS has no import system).
 * Kept private via the underscore to avoid naming collisions.
 */
function _ioColLetter(col) {
  var s = '';
  while (col > 0) {
    var rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}
