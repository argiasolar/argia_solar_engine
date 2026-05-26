// =============================================================================
// ARGIA TESTS -- tests_unit/templates/RfqTemplateTests.gs
// -----------------------------------------------------------------------------
// CHUNK 6 \u2014 Unit tests for setupRfqTemplate (the generic RFQ template).
//
// COVERAGE
//   - First call inserts the sheet
//   - Title text (row 2, col 3 \u2014 merged from col 3 to end of row) gets
//     "REQUEST FOR QUOTATION \u2014 <category>". Cols 1-2 reserved for logo.
//   - Title is derived from RFQ_REGISTRY when not provided in opts
//   - Title can be overridden via opts.categoryTitle
//   - 13 column widths set
//   - Column headers land on row 9 with 13 expected labels
//   - Supplier-fill columns (G\u2013M) marked with supplier-hint background
//   - Idempotency: second call clears the existing sheet
//   - Missing sheetName arg throws
//
// CHUNK TAG: 'chunk6'
// =============================================================================


function _makeRfqTplMockSs() {
  var writes = [];        // rfq-sheet writes only (tokens writes ignored)
  var rfqInserted = false;
  var tokensInserted = false;
  var clearCount = 0;
  var lastInsertedName = null;

  // Minimal design-token rows so loadDesignTokens doesn't blow up.
  var TOKEN_ROWS = [
    ['TEXT_PRIMARY',         '#111111'],
    ['BG_PAGE',              '#FAFAF7'],
    ['FONT_FAMILY',          'Inter'],
    ['FONT_SIZE_BODY',       '10'],
    ['FONT_WEIGHT_EMPHASIS', 'bold']
  ];

  function makeSheetMock(kind) {
    var columnWidths = {};
    var rowHeights = {};
    var bgByCell = {};

    function makeRange(row, col, numRows, numCols) {
      var nR = numRows || 1, nC = numCols || 1;
      var proxy = {
        _row: row, _col: col,
        setValue: function (v) {
          if (kind === 'rfq') {
            writes.push({ type: 'value', row: row, col: col, value: v });
          }
          return proxy;
        },
        setValues: function (vs) {
          if (kind === 'rfq' && vs && vs.length) {
            for (var ri = 0; ri < vs.length; ri++) {
              for (var ci = 0; ci < (vs[ri] || []).length; ci++) {
                writes.push({
                  type: 'value', row: row + ri, col: col + ci,
                  value: vs[ri][ci]
                });
              }
            }
          }
          return proxy;
        },
        getValues: function () {
          if (kind === 'tokens' && row === 2 && col === 1 && nC === 2) {
            return TOKEN_ROWS.slice(0, nR);
          }
          return [];
        },
        setBackground: function (color) {
          if (kind === 'rfq') {
            // Record top-left cell only for simple lookup
            bgByCell['R' + row + 'C' + col] = color;
          }
          return proxy;
        },
        setBorder:              function () { return proxy; },
        setFontFamily:          function () { return proxy; },
        setFontSize:            function () { return proxy; },
        setFontWeight:          function () { return proxy; },
        setFontColor:           function () { return proxy; },
        setFontStyle:           function () { return proxy; },
        setHorizontalAlignment: function () { return proxy; },
        setVerticalAlignment:   function () { return proxy; },
        setNumberFormat:        function () { return proxy; },
        setNote:                function () { return proxy; },
        merge:                  function () { return proxy; },
        breakApart:             function () { return proxy; },
        setWrap:                function () { return proxy; },
        setFormula:             function () { return proxy; }
      };
      return proxy;
    }

    return {
      _kind: kind,
      _writes: writes,
      _columnWidths: columnWidths,
      _rowHeights: rowHeights,
      _bgByCell: bgByCell,
      _clearCount: function () { return clearCount; },
      getRange: function (r, c, nR, nC) { return makeRange(r, c, nR, nC); },
      setRowHeight:               function (r, h) { rowHeights[r] = h; },
      setColumnWidth:             function (c, w) { columnWidths[c] = w; },
      setFrozenRows:              function () {},
      setFrozenColumns:           function () {},
      setHiddenGridlines:         function () {},
      clear:                      function () { if (kind === 'rfq') clearCount++; },
      clearNotes:                 function () {},
      clearConditionalFormatRules:function () {},
      setConditionalFormatRules:  function () {},
      getConditionalFormatRules:  function () { return []; },
      getLastRow: function () {
        return kind === 'tokens' ? TOKEN_ROWS.length + 1 : 0;
      }
    };
  }

  var rfqSheet    = makeSheetMock('rfq');
  var tokensSheet = makeSheetMock('tokens');

  return {
    _sheet: rfqSheet,
    _tokensSheet: tokensSheet,
    _sheetInserted: function () { return rfqInserted; },
    _lastInsertedName: function () { return lastInsertedName; },
    getSheetByName: function (name) {
      if (name === DESIGN_TOKENS_SHEET) {
        return tokensInserted ? tokensSheet : null;
      }
      return rfqInserted ? rfqSheet : null;
    },
    insertSheet: function (name) {
      lastInsertedName = name;
      if (name === DESIGN_TOKENS_SHEET) {
        tokensInserted = true;
        return tokensSheet;
      }
      rfqInserted = true;
      return rfqSheet;
    }
  };
}


function _writeAtRfq(writes, row, col) {
  for (var i = writes.length - 1; i >= 0; i--) {
    var w = writes[i];
    if (w.type === 'value' && w.row === row && w.col === col) return w.value;
  }
  return null;
}


// =============================================================================
// TEST 1 \u2014 First call inserts the sheet, second call clears it
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_TPL_CREATES_AND_REFRESHES',
  group   : 'unit',
  module  : 'templates/rfq',
  scenarios: [],
  tags    : ['templates', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqTemplateTests.gs',
  fn: function (t) {
    t.suite('setupRfqTemplate: creates on first call, clears on second');

    var ss = _makeRfqTplMockSs();
    t.assertFalse('sheet not present before setup', ss._sheetInserted());

    setupRfqTemplate(ss, 'RFQ_PANELES_v2');

    t.assertTrue ('sheet inserted after first call', ss._sheetInserted());
    t.assert     ('clear count is 0 after first call', 0, ss._sheet._clearCount());
    t.assertTrue ('at least one write happened',       ss._sheet._writes.length > 0);

    // Second call \u2014 idempotency
    setupRfqTemplate(ss, 'RFQ_PANELES_v2');
    t.assert('clear count is 1 after second call', 1, ss._sheet._clearCount());
  }
});


// =============================================================================
// TEST 2 \u2014 Title text on row 2 col 3 (derived from RFQ_REGISTRY)
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_TPL_TITLE_FROM_REGISTRY',
  group   : 'unit',
  module  : 'templates/rfq',
  scenarios: [],
  tags    : ['templates', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqTemplateTests.gs',
  fn: function (t) {
    t.suite('setupRfqTemplate: title derived from RFQ_REGISTRY');

    var ss = _makeRfqTplMockSs();
    setupRfqTemplate(ss, V2_SHEETS.RFQ_PANELES);

    var title = _writeAtRfq(ss._sheet._writes, 2, 3);
    t.assertContains('row 2 col 3 contains "REQUEST FOR QUOTATION"',
                     title, 'REQUEST FOR QUOTATION');
    t.assertContains('row 2 col 3 contains the PANELES title',
                     title, 'PANELES');
  }
});


// =============================================================================
// TEST 3 \u2014 opts.categoryTitle overrides the registry-derived title
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_TPL_TITLE_OVERRIDE',
  group   : 'unit',
  module  : 'templates/rfq',
  scenarios: [],
  tags    : ['templates', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqTemplateTests.gs',
  fn: function (t) {
    t.suite('setupRfqTemplate: opts.categoryTitle overrides registry title');

    var ss = _makeRfqTplMockSs();
    setupRfqTemplate(ss, 'SOME_SHEET_v2', { categoryTitle: 'Custom Title XYZ' });

    var title = _writeAtRfq(ss._sheet._writes, 2, 3);
    t.assertContains('title contains the override', title, 'CUSTOM TITLE XYZ');
  }
});


// =============================================================================
// TEST 4 \u2014 Missing sheetName argument throws
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_TPL_THROWS_NO_SHEET_NAME',
  group   : 'unit',
  module  : 'templates/rfq',
  scenarios: [],
  tags    : ['templates', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqTemplateTests.gs',
  fn: function (t) {
    t.suite('setupRfqTemplate: missing sheetName throws');

    var ss = _makeRfqTplMockSs();
    t.assertThrows(
      'no sheetName -> throw',
      function () { setupRfqTemplate(ss); },
      'sheetName'
    );
  }
});


// =============================================================================
// TEST 5 \u2014 Column widths set for all 13 columns
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_TPL_COLUMN_WIDTHS',
  group   : 'unit',
  module  : 'templates/rfq',
  scenarios: [],
  tags    : ['templates', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqTemplateTests.gs',
  fn: function (t) {
    t.suite('setupRfqTemplate: 13 column widths set');

    var ss = _makeRfqTplMockSs();
    setupRfqTemplate(ss, V2_SHEETS.RFQ_PANELES);

    var widths = ss._sheet._columnWidths;
    for (var c = 1; c <= 13; c++) {
      t.assertTrue(
        'column ' + c + ' has a width set',
        typeof widths[c] === 'number' && widths[c] > 0
      );
    }
    // Spot-check the first three widths against RFQV2_TPL.COL_WIDTHS
    t.assert('col 1 width = 30',  30,  widths[1]);
    t.assert('col 2 width = 240', 240, widths[2]);
    t.assert('col 3 width = 120', 120, widths[3]);
  }
});


// =============================================================================
// TEST 6 \u2014 Column headers (row 9) have all 13 expected labels
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_TPL_COLUMN_HEADERS',
  group   : 'unit',
  module  : 'templates/rfq',
  scenarios: [],
  tags    : ['templates', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqTemplateTests.gs',
  fn: function (t) {
    t.suite('setupRfqTemplate: row 9 has 13 column headers');

    var ss = _makeRfqTplMockSs();
    setupRfqTemplate(ss, V2_SHEETS.RFQ_PANELES);

    var w = ss._sheet._writes;
    var expected = ['#', 'Description', 'Model / Spec', 'Qty', 'Unit',
                    'Technical requirement', 'Unit price', 'CCY', 'Total',
                    'Lead wks', 'Warranty yrs', 'Incoterms', 'Notes'];
    for (var c = 1; c <= expected.length; c++) {
      var actual = _writeAtRfq(w, 9, c);
      t.assert('row 9 col ' + c + ' label', expected[c - 1], actual);
    }
  }
});


// =============================================================================
// TEST 7 \u2014 Metadata labels written (FROM/PROJECT/LOCATION/SYSTEM)
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_TPL_METADATA_LABELS',
  group   : 'unit',
  module  : 'templates/rfq',
  scenarios: [],
  tags    : ['templates', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqTemplateTests.gs',
  fn: function (t) {
    t.suite('setupRfqTemplate: metadata labels on rows 4-7');

    var ss = _makeRfqTplMockSs();
    setupRfqTemplate(ss, V2_SHEETS.RFQ_PANELES);

    var w = ss._sheet._writes;
    t.assert('row 4 col 2 = FROM:',     'FROM:',     _writeAtRfq(w, 4, 2));
    t.assert('row 5 col 2 = PROJECT:',  'PROJECT:',  _writeAtRfq(w, 5, 2));
    t.assert('row 6 col 2 = LOCATION:', 'LOCATION:', _writeAtRfq(w, 6, 2));
    t.assert('row 7 col 2 = SYSTEM:',   'SYSTEM:',   _writeAtRfq(w, 7, 2));

    t.assert('row 4 col 7 = RFQ Number:',   'RFQ Number:',   _writeAtRfq(w, 4, 7));
    t.assert('row 5 col 7 = Issue date:',   'Issue date:',   _writeAtRfq(w, 5, 7));
    t.assert('row 6 col 7 = Response by:',  'Response by:',  _writeAtRfq(w, 6, 7));
    t.assert('row 7 col 7 = Delivery req:', 'Delivery req:', _writeAtRfq(w, 7, 7));
  }
});


// =============================================================================
// TEST 8 \u2014 Title uses BESS title from registry when given the BESS sheet
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_TPL_BESS_TITLE',
  group   : 'unit',
  module  : 'templates/rfq',
  scenarios: [],
  tags    : ['templates', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/templates/RfqTemplateTests.gs',
  fn: function (t) {
    t.suite('setupRfqTemplate: BESS sheet gets the BESS title');

    var ss = _makeRfqTplMockSs();
    var bessSheet = V2_SHEETS.RFQ_BESS;
    t.assertTrue('V2_SHEETS.RFQ_BESS defined', !!bessSheet);

    setupRfqTemplate(ss, bessSheet);

    var title = _writeAtRfq(ss._sheet._writes, 2, 3);
    t.assertContains('title mentions BESS', title, 'BESS');
  }
});
