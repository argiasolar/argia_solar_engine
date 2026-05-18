// =============================================================================
// ARGIA ENGINE v7 -- File: 02f_RepairCostRanges.gs
// One-shot fix + polish for paired-column rows on INPUT_PROJECT (rows 52-60).
//
// WHY THIS EXISTS
//   The original `_renderInputRow` in 02e_InputSetup.gs had a bug: it always
//   wrote the value cell to column D, ignoring `mapEntry.col`. The 9 cost-
//   validation rows (Paneles min/max, Inversores min/max, ...) declare the
//   min in col D and the max in col E. During setup, the max iteration
//   overwrote col D with the max default and never wrote col E. Column E
//   ended up holding the unit text "USD/kWp" instead of the max value, with
//   small grey unit-style font.
//
// WHAT THIS DOES
//   For every INPUT_PROJECT row that has 2+ INPUT_MAP entries (the only such
//   rows are the 9 cost-range pairs):
//     1. Writes each entry's `default` to its declared column (D for min,
//        E for max).
//     2. Cleans up the label in col B (strips "— min" / "— max" suffixes).
//   Then polishes the layout:
//     3. Restyles col D and col E value cells uniformly (cream input-cell
//        background, body font, primary text color, right-aligned).
//     4. Writes "MIN" / "MAX" sub-headers in the row immediately above the
//        first paired row, styled like other section sub-headers.
//     5. Writes the unit (e.g. "USD/kWp") into col F of each paired row
//        with the same small/grey unit-cell styling used elsewhere on the
//        sheet (matches E41 "Precio venta USD/kWp" formatting).
//
// IDEMPOTENT
//   Safe to re-run. Re-writes the same defaults each time, so running it
//   twice has the same effect as running it once. If you've manually
//   customized a min/max value, this WILL overwrite it with the map default.
//
// PREREQUISITES
//   - 02e_InputSetup.gs must be the Phase A fixed version (with the
//     mapEntry.col bug fixed). Otherwise, future setupInputProject runs
//     will recreate the bug.
//   - 02a_DesignTokens.gs (provides `token()`, `tokenNum()`, `loadDesignTokens`).
//
// USAGE
//   Apps Script editor -> select repairCostRangeCells -> Run.
//   View -> Logs to see the repair report.
// =============================================================================

function repairCostRangeCells() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH.INPUT_PROJECT);
  if (!sh) {
    _rcrAlert('Repair', 'INPUT_PROJECT not found. Nothing to repair.');
    return;
  }

  // Load design tokens so token() / tokenNum() work in the polish step
  resetDesignTokenCache_();
  loadDesignTokens(ss);

  // ---- Find every INPUT_PROJECT row with multiple map entries -------------
  var byRow = {};
  Object.keys(INPUT_MAP).forEach(function(key) {
    var m = INPUT_MAP[key];
    if (m.sheet !== SH.INPUT_PROJECT) return;
    if (m.mode === 'range' || m.mode === 'skip') return;
    var rk = String(m.row);
    if (!byRow[rk]) byRow[rk] = [];
    byRow[rk].push({ key: key, m: m });
  });

  var fixed   = [];
  var skipped = [];
  var pairedRows = [];
  var primaryByRow = {};   // row -> primary entry (for unit lookup later)

  Object.keys(byRow).forEach(function(rowStr) {
    var row = parseInt(rowStr);
    var entries = byRow[rowStr];
    if (entries.length < 2) { return; }   // not paired -- not our problem

    // Sort by col ascending — primary (col 4) first, then col 5, etc.
    entries.sort(function(a, b) { return a.m.col - b.m.col; });

    var primary = entries[0];
    if (primary.m.col !== 4) {
      skipped.push('row ' + row + ': primary entry "' + primary.key +
                   '" not at col 4 (col=' + primary.m.col + '); skipping');
      return;
    }

    // Write each entry's default to its declared column
    entries.forEach(function(e) {
      var def = e.m.hasOwnProperty('default') ? e.m.default : '';
      sh.getRange(row, e.m.col).setValue(def === '' ? null : def);
    });

    // Clean the label in col B: strip "— min" / "— max" / " - min" / " - max"
    // suffix so the row reads as a single category header.
    var rawLabel = String(primary.m.label || '').trim();
    var cleanLabel = rawLabel.replace(/\s*[—\-–]\s*(min|max)\s*$/i, '');
    sh.getRange(row, 2, 1, 2).breakApart().merge().setValue(cleanLabel);

    fixed.push('row ' + row + ': "' + cleanLabel + '" -> ' +
      entries.map(function(e) {
        return 'col ' + _rcrColLetter(e.m.col) + '=' + e.m.default;
      }).join(', '));

    pairedRows.push(row);
    primaryByRow[String(row)] = primary;
  });

  // ---- Polish: uniform styling + sub-headers + unit cell -----------------
  var headerRow = null;
  var unitsWritten = 0;
  if (pairedRows.length > 0) {
    pairedRows.sort(function(a, b) { return a - b; });
    headerRow = pairedRows[0] - 1;

    // Restyle col D and col E to look identical (both editable input cells)
    pairedRows.forEach(function(row) {
      _rcrStyleInputCell(sh.getRange(row, 4));
      _rcrStyleInputCell(sh.getRange(row, 5));
    });

    // Sub-headers "MIN" / "MAX" at row above the first paired row
    _rcrStyleSubHeader(sh.getRange(headerRow, 4).setValue('MIN'));
    _rcrStyleSubHeader(sh.getRange(headerRow, 5).setValue('MAX'));

    // Unit cell at col F, per primary entry's `unit` field. Matches the
    // styling used by single-entry rows elsewhere on the sheet (E41 etc.)
    pairedRows.forEach(function(row) {
      var primary = primaryByRow[String(row)];
      var unit = primary && primary.m.unit ? primary.m.unit : '';
      if (unit) {
        _rcrStyleUnitCell(sh.getRange(row, 6).setValue(unit));
        unitsWritten++;
      }
    });
  }

  SpreadsheetApp.flush();

  var msg = 'FIXED   : ' + fixed.length + ' paired-column rows\n' +
            'SKIPPED : ' + skipped.length + '\n' +
            'STYLED  : col D + col E for ' + pairedRows.length + ' rows\n' +
            (headerRow !== null
              ? 'HEADERS : "MIN" / "MAX" written at D' + headerRow + ' / E' + headerRow + '\n'
              : '') +
            'UNITS   : "' + (pairedRows.length && primaryByRow[String(pairedRows[0])]
                              ? primaryByRow[String(pairedRows[0])].m.unit || ''
                              : '') + '" written to col F for ' + unitsWritten + ' rows\n' +
            '\n';
  if (fixed.length)   msg += '== FIXED ==\n'   + fixed.join('\n')   + '\n\n';
  if (skipped.length) msg += '== SKIPPED ==\n' + skipped.join('\n') + '\n\n';
  msg += 'Now run runTests. The "PC.validation Solar panels max > min" ' +
         'failure should be resolved (it was after the first repair too).';

  _rcrAlert('Cost-range repair', msg);
}

// ---------------------------------------------------------------------------
// Apply input-cell styling: cream background, body font, primary text color,
// right-aligned, normal weight (no italic, no bold). Numeric format. Mirrors
// what _renderInputRow's primary path applies to col D.
// ---------------------------------------------------------------------------
function _rcrStyleInputCell(range) {
  range
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setFontStyle('normal')
    .setFontWeight('normal')
    .setBackground(token('BG_INPUT_CELL'))
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle')
    .setNumberFormat('#,##0.####');
}

// ---------------------------------------------------------------------------
// Style a "MIN" / "MAX" sub-header cell. Small bold uppercase, secondary
// text color, no background, right-aligned to line up with the values.
// ---------------------------------------------------------------------------
function _rcrStyleSubHeader(range) {
  range
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setFontWeight('bold')
    .setFontStyle('normal')
    .setBackground(null)
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');
}

// ---------------------------------------------------------------------------
// Style a unit cell (col F here, col E elsewhere). Small secondary text,
// left-aligned, no background, normal weight + non-italic (since this is a
// real unit string, not a placeholder hint). Matches the existing single-
// entry unit cells like E41 "USD/kWp" so the look is consistent across the
// whole INPUT_PROJECT tab.
// ---------------------------------------------------------------------------
function _rcrStyleUnitCell(range) {
  range
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setFontStyle('normal')
    .setFontWeight('normal')
    .setBackground(null)
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');
}

// ---------------------------------------------------------------------------
// Always log to Logger. Try to also show a UI dialog -- swallow any error
// if the script is invoked headless (some IDE Run states, triggers).
// ---------------------------------------------------------------------------
function _rcrAlert(title, msg) {
  Logger.log('=== ' + title + ' ===\n' + msg);
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert(title, msg, ui.ButtonSet.OK);
  } catch (e) {
    // Headless context. Logger output is enough.
  }
}

function _rcrColLetter(col) {
  var s = '';
  while (col > 0) {
    var rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}
