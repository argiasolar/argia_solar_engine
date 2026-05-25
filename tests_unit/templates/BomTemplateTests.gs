// =============================================================================
// ARGIA TESTS -- tests_unit/templates/BomTemplateTests.gs
// -----------------------------------------------------------------------------
// CHUNK 4 — setupBomTemplate unit tests.
//
// COVERAGE
//   - Calling setupBomTemplate creates the BOM_v2 sheet
//   - Column header values land in row 5 (HEADERS)
//   - The expected 8 column widths are set in order
//   - The 8 section header rows + 8 subtotal rows + grand total are touched
//     (we assert via clear() count + Sheet.setRowHeight call tracking)
//   - Idempotency: second call clears the existing sheet (clear count
//     increments from 0 to 1 across the two calls — same as PC_v2 pattern)
//   - opts.sheetName override redirects insertSheet to a scratch name
//
// MOCK STRATEGY
//   Same write-capture pattern as PC_v2's template tests. The mock returns
//   the sheet only after insertSheet has been called, so first setup call
//   inserts (no clear); second call finds the existing sheet (clear).
//
// CHUNK TAG
//   All tests tagged 'chunk4'.
// =============================================================================


function _makeBomTplMockSpreadsheet() {
  var writes = [];          // BOM_v2 writes only (tokens writes ignored)
  var bomInserted = false;
  var tokensInserted = false;
  var clearCount = 0;        // BOM_v2 clear() count only
  var lastInsertedName = null;
  var queriedNames = [];

  // Minimal token rows — enough for setupBomTemplate's token() / tokenNum() calls
  // to succeed when loadDesignTokens scans the _DESIGN_TOKENS sheet.
  var TOKEN_ROWS = [
    ['TEXT_PRIMARY',         '#111111'],
    ['TEXT_SECONDARY',       '#767676'],
    ['TEXT_MUTED',           '#B0B0B0'],
    ['BG_PAGE',              '#FAFAF7'],
    ['BG_INPUT_CELL',        '#FDFBF6'],
    ['DIVIDER_STRONG',       '#111111'],
    ['FONT_FAMILY',          'Inter'],
    ['FONT_SIZE_TITLE',      '22'],
    ['FONT_SIZE_BODY',       '10'],
    ['FONT_SIZE_SMALL',      '8'],
    ['FONT_WEIGHT_EMPHASIS', 'bold'],
    ['ROW_H_TITLE',          '42']
  ];

  // ---- Factory: build a sheet mock. `kind` is either 'bom' or 'tokens'.
  function makeSheetMock(kind) {
    var columnWidths = {};
    var rowHeights = {};
    function makeRange(row, col, numRows, numCols) {
      var isMulti = (numRows > 1) || (numCols > 1);
      var key = 'R' + row + 'C' + col +
                (isMulti ? ':R' + (row + numRows - 1) + 'C' + (col + numCols - 1) : '');
      var proxy = {
        _row: row, _col: col, _key: key,
        setValue: function(v) {
          // Only record BOM_v2 writes — design-token sheet writes are noise.
          if (kind === 'bom') {
            writes.push({ type:'value', row:row, col:col, range:key, value:v });
          }
          return proxy;
        },
        setValues: function(vs) {
          if (kind === 'bom' && vs && vs.length && vs[0] && vs[0].length) {
            for (var ri = 0; ri < vs.length; ri++) {
              for (var ci = 0; ci < vs[ri].length; ci++) {
                writes.push({
                  type:'value', row:row+ri, col:col+ci,
                  range:'R'+(row+ri)+'C'+(col+ci), value:vs[ri][ci]
                });
              }
            }
          }
          return proxy;
        },
        getValues: function() {
          // loadDesignTokens calls (2, 1, lastRow-1, 2).getValues() on the
          // tokens sheet. Return our fixture key/value pairs.
          if (kind === 'tokens' && row === 2 && col === 1 && numCols === 2) {
            return TOKEN_ROWS.slice(0, numRows);
          }
          return [];
        },
        setFormula: function(v) {
          if (kind === 'bom') {
            writes.push({ type:'formula', row:row, col:col, range:key, value:v });
          }
          return proxy;
        },
        setNote: function() { return proxy; },
        setBackground: function() { return proxy; },
        setFontFamily: function() { return proxy; },
        setFontSize:   function() { return proxy; },
        setFontWeight: function() { return proxy; },
        setFontColor:  function() { return proxy; },
        setFontStyle:  function() { return proxy; },
        setHorizontalAlignment: function() { return proxy; },
        setVerticalAlignment:   function() { return proxy; },
        setNumberFormat: function() { return proxy; },
        setBorder: function() { return proxy; },
        merge: function() { return proxy; },
        breakApart: function() { return proxy; },
        setWrap: function() { return proxy; }
      };
      return proxy;
    }
    return {
      _kind: kind,
      _columnWidths: columnWidths,
      _rowHeights: rowHeights,
      getRange: function(row, col, numRows, numCols) {
        return makeRange(row, col, numRows || 1, numCols || 1);
      },
      setRowHeight: function(r, h) { rowHeights[r] = h; },
      setColumnWidth: function(c, w) { columnWidths[c] = w; },
      setHiddenGridlines: function() {},
      setFrozenRows: function() {},
      setFrozenColumns: function() {},
      clear: function() {
        // Only count clears on the BOM_v2 sheet (the idempotency target).
        if (kind === 'bom') clearCount++;
      },
      clearConditionalFormatRules: function() {},
      setConditionalFormatRules: function() {},
      getConditionalFormatRules: function() { return []; },
      getLastRow: function() {
        return kind === 'tokens' ? TOKEN_ROWS.length + 1 : 0;
      }
    };
  }

  // Two persistent sheet mocks — created on first insert, reused thereafter.
  var bomSheet = makeSheetMock('bom');
  var tokensSheet = makeSheetMock('tokens');

  // Expose the BOM sheet's writes & row/col tracking on the returned object
  // so existing tests keep working with ss._sheet._writes, ._columnWidths, etc.
  bomSheet._writes = writes;
  bomSheet._clearCount = function() { return clearCount; };

  return {
    _sheet: bomSheet,              // legacy alias — points to the BOM sheet
    _tokensSheet: tokensSheet,
    _sheetInserted: function() { return bomInserted; },
    _lastInsertedName: function() { return lastInsertedName; },
    _queriedNames: function() { return queriedNames.slice(); },
    getSheetByName: function(name) {
      queriedNames.push(name);
      if (name === DESIGN_TOKENS_SHEET) {
        return tokensInserted ? tokensSheet : null;
      }
      // Any other name (BOM_v2 or override) maps to the BOM mock
      return bomInserted ? bomSheet : null;
    },
    insertSheet: function(name) {
      lastInsertedName = name;
      if (name === DESIGN_TOKENS_SHEET) {
        tokensInserted = true;
        return tokensSheet;
      }
      bomInserted = true;
      return bomSheet;
    }
  };
}


function _writeAtBomTpl(writes, row, col) {
  for (var i = writes.length - 1; i >= 0; i--) {
    var w = writes[i];
    if (w.type === 'value' && w.row === row && w.col === col) return w.value;
  }
  return null;
}


// =============================================================================
// TEST 1 — Template creates BOM_v2 sheet on first call
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_BOM_CREATES_SHEET',
  group   : 'unit',
  module  : 'templates/bom',
  scenarios: [],
  tags    : ['templates', 'bom', 'v2', 'chunk4'],
  source  : 'tests_unit/templates/BomTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/bom: creates BOM_v2 sheet on first call');

    var ss = _makeBomTplMockSpreadsheet();
    t.assertFalse('sheet does not exist before setup', ss._sheetInserted());

    setupBomTemplate(ss);

    t.assertTrue('sheet inserted after setup', ss._sheetInserted());
    t.assertTrue('at least one write happened', ss._sheet._writes.length > 0);
  }
});


// =============================================================================
// TEST 2 — Column header row (5) gets the 8 expected headers
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_BOM_HEADERS_ROW',
  group   : 'unit',
  module  : 'templates/bom',
  scenarios: [],
  tags    : ['templates', 'bom', 'v2', 'chunk4'],
  source  : 'tests_unit/templates/BomTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/bom: 8 column header values at row 5');

    var ss = _makeBomTplMockSpreadsheet();
    setupBomTemplate(ss);
    var w = ss._sheet._writes;

    var expected = ['#','DESCRIPCION','QTY','UNIDAD',
                    'PRECIO U (USD)','TOTAL (USD)','TOTAL (MXN)','REFERENCIA'];
    for (var ci = 0; ci < expected.length; ci++) {
      t.assert('row ' + BOM_ROW.HEADERS + ' col ' + (ci+1) + ' = "' + expected[ci] + '"',
        expected[ci], _writeAtBomTpl(w, BOM_ROW.HEADERS, ci + 1));
    }
  }
});


// =============================================================================
// TEST 3 — All 8 column widths set, content row heights respect the canvas
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_BOM_COLUMN_WIDTHS',
  group   : 'unit',
  module  : 'templates/bom',
  scenarios: [],
  tags    : ['templates', 'bom', 'v2', 'chunk4'],
  source  : 'tests_unit/templates/BomTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/bom: 8 column widths configured');

    var ss = _makeBomTplMockSpreadsheet();
    setupBomTemplate(ss);

    // Each of cols 1..8 should have a width set
    for (var c = 1; c <= 8; c++) {
      t.assertTrue('col ' + c + ' width set',
        ss._sheet._columnWidths.hasOwnProperty(c) && ss._sheet._columnWidths[c] > 0);
    }
    // Spot-check legacy-matching widths
    t.assert('Description col = 380px', 380, ss._sheet._columnWidths[BOM_COL.DESCRIPTION]);
    t.assert('Reference col = 220px',   220, ss._sheet._columnWidths[BOM_COL.REFERENCE]);
  }
});


// =============================================================================
// TEST 4 — Section/subtotal/grand-total row heights set
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_BOM_KEY_ROW_HEIGHTS',
  group   : 'unit',
  module  : 'templates/bom',
  scenarios: [],
  tags    : ['templates', 'bom', 'v2', 'chunk4'],
  source  : 'tests_unit/templates/BomTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/bom: section/subtotal/grand-total row heights');

    var ss = _makeBomTplMockSpreadsheet();
    setupBomTemplate(ss);
    var h = ss._sheet._rowHeights;

    // 8 section headers: 24px each
    var sectionRows = [
      BOM_ROW.SEC_PANELS, BOM_ROW.SEC_INVERTERS, BOM_ROW.SEC_STRUCTURE,
      BOM_ROW.SEC_DC, BOM_ROW.SEC_AC, BOM_ROW.SEC_TRANSFORMER,
      BOM_ROW.SEC_MONITORING, BOM_ROW.SEC_BESS
    ];
    sectionRows.forEach(function(r) {
      t.assert('section row ' + r + ' height = 24', 24, h[r]);
    });
    // 8 subtotal rows: 22px each
    var subtotalRows = [
      BOM_ROW.SUBTOTAL_PANELS, BOM_ROW.SUBTOTAL_INVERTERS, BOM_ROW.SUBTOTAL_STRUCTURE,
      BOM_ROW.SUBTOTAL_DC, BOM_ROW.SUBTOTAL_AC, BOM_ROW.SUBTOTAL_TRANSFORMER,
      BOM_ROW.SUBTOTAL_MONITORING, BOM_ROW.SUBTOTAL_BESS
    ];
    subtotalRows.forEach(function(r) {
      t.assert('subtotal row ' + r + ' height = 22', 22, h[r]);
    });
    // Grand total: 28px
    t.assert('grand total row height = 28', 28, h[BOM_ROW.GRAND_TOTAL]);
    // Header row: 28px (per legacy)
    t.assert('header row 5 height = 28', 28, h[BOM_ROW.HEADERS]);
  }
});


// =============================================================================
// TEST 5 — Idempotency: second call clears once
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_BOM_IDEMPOTENT',
  group   : 'unit',
  module  : 'templates/bom',
  scenarios: [],
  tags    : ['templates', 'bom', 'v2', 'chunk4'],
  source  : 'tests_unit/templates/BomTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/bom: idempotent — first call inserts, second clears');

    var ss = _makeBomTplMockSpreadsheet();
    setupBomTemplate(ss);
    var clears1 = ss._sheet._clearCount();
    var writes1 = ss._sheet._writes.length;

    setupBomTemplate(ss);
    var clears2 = ss._sheet._clearCount();
    var writes2 = ss._sheet._writes.length;

    // Same pattern as PC_v2: first call inserts (no clear), second call clears
    t.assert('clear() did NOT fire on first run', 0, clears1);
    t.assert('clear() fired once on second run',  1, clears2);
    t.assertTrue('second run produced additional writes', writes2 > writes1);

    // After re-render, headers row still correct
    t.assert('Description header still at col 2 after re-render',
      'DESCRIPCION',
      _writeAtBomTpl(ss._sheet._writes, BOM_ROW.HEADERS, BOM_COL.DESCRIPTION));
  }
});


// =============================================================================
// TEST 6 — opts.sheetName override redirects to scratch sheet
// =============================================================================
registerTest({
  id      : 'UNIT_TEMPLATES_BOM_CUSTOM_SHEET_NAME',
  group   : 'unit',
  module  : 'templates/bom',
  scenarios: [],
  tags    : ['templates', 'bom', 'v2', 'chunk4'],
  source  : 'tests_unit/templates/BomTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/bom: opts.sheetName redirects insertSheet');

    var customName = '_BOM_v2_TEST_xyz';
    var ss = _makeBomTplMockSpreadsheet();

    setupBomTemplate(ss, { sheetName: customName });

    // Confirm the custom name was used. _lastInsertedName captures the most
    // recent insertSheet call — setupBomTemplate may insert _DESIGN_TOKENS
    // first via loadDesignTokens, then insert the BOM sheet with custom name.
    var queried = ss._queriedNames();
    t.assertTrue('custom name was queried via getSheetByName',
      queried.indexOf(customName) !== -1);
    // Confirm the custom name was NOT V2_SHEETS.BOM
    t.assertFalse('default BOM_v2 name was NOT queried',
      queried.indexOf(V2_SHEETS.BOM) !== -1);
    // And that an insertSheet was called with the custom name
    t.assert('last sheet inserted was the custom name', customName,
      ss._lastInsertedName());
  }
});
