// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/RfqBomReaderTests.gs
// -----------------------------------------------------------------------------
// CHUNK 6 \u2014 Unit tests for readRfqBomItems.
//
// COVERAGE
//   - Empty ranges -> empty array
//   - Single range with all-populated rows -> all items returned
//   - Single range with mixed populated + blank rows -> blanks skipped
//   - Multiple ranges (ELECTRICO has 3 spans) -> all items concatenated
//   - Non-numeric col A treated as "not an item row"
//   - Missing BOM_v2 sheet throws a clear error
//   - Item shape: { num, desc, qty, unit, priceUsd, totalUsd, ref }
//
// MOCK STRATEGY
//   _makeBomReaderMockSs creates a fake spreadsheet where BOM_v2's rows are
//   provided as a 2D array (cols A..H). getRange(...).getValues() returns
//   the slice the reader requests. No real Sheet object touched.
//
// CHUNK TAG: 'chunk6'
// =============================================================================


function _makeBomReaderMockSs(rowsByName) {
  // rowsByName: { 'BOM_v2': [ [aVal, bVal, cVal, ...], ... ] }
  // Row indices are 1-based; index 0 of the array is row 1.
  return {
    getSheetByName: function (name) {
      var rows = rowsByName[name];
      if (!rows) return null;
      return {
        _rows: rows,
        getRange: function (startRow, startCol, numRows, numCols) {
          var captured = { _row: startRow, _col: startCol,
                           _numRows: numRows, _numCols: numCols };
          captured.getValues = function () {
            var out = [];
            for (var r = 0; r < numRows; r++) {
              var srcRow = rows[startRow - 1 + r] || [];
              var rowOut = [];
              for (var c = 0; c < numCols; c++) {
                rowOut.push(srcRow[startCol - 1 + c]);
              }
              out.push(rowOut);
            }
            return out;
          };
          return captured;
        }
      };
    }
  };
}


// =============================================================================
// TEST 1 \u2014 Empty ranges array returns empty result
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_BOM_READER_EMPTY_RANGES',
  group   : 'unit',
  module  : 'writers_v2/rfq/bomReader',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'reader', 'chunk6'],
  source  : 'tests_unit/writers_v2/RfqBomReaderTests.gs',
  fn: function (t) {
    t.suite('readRfqBomItems: empty ranges -> empty array');
    var ss = _makeBomReaderMockSs({ 'BOM_v2': [[]] });
    var items = readRfqBomItems(ss, []);
    t.assertTrue('returns array',  Array.isArray(items));
    t.assert     ('length is zero', 0, items.length);
  }
});


// =============================================================================
// TEST 2 \u2014 Single range reads correct rows; item shape matches contract
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_BOM_READER_SINGLE_RANGE',
  group   : 'unit',
  module  : 'writers_v2/rfq/bomReader',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'reader', 'chunk6'],
  source  : 'tests_unit/writers_v2/RfqBomReaderTests.gs',
  fn: function (t) {
    t.suite('readRfqBomItems: single range, 2 items');

    // Build a row array. Index 0=row1, so to put items at rows 8-9 we fill
    // up to index 8. Cols: A=#, B=desc, C=qty, D=unit, E=priceUsd, F=totalUsd,
    // G=mxn (skipped), H=ref.
    var rows = [];
    while (rows.length < 9) rows.push([]);
    rows[7] = [1, 'Panel 585W', 720, 'pcs', 173, 124560, 0, 'PANEL_018'];
    rows[8] = [2, 'Panel 600W', 100, 'pcs', 200, 20000,  0, 'PANEL_019'];

    var ss = _makeBomReaderMockSs({ 'BOM_v2': rows });
    var items = readRfqBomItems(ss, [{ from: 8, to: 9 }]);

    t.assert('two items returned', 2, items.length);

    t.assert('item 0 num',      1,            items[0].num);
    t.assert('item 0 desc',     'Panel 585W', items[0].desc);
    t.assert('item 0 qty',      720,          items[0].qty);
    t.assert('item 0 unit',     'pcs',        items[0].unit);
    t.assert('item 0 priceUsd', 173,          items[0].priceUsd);
    t.assert('item 0 totalUsd', 124560,       items[0].totalUsd);
    t.assert('item 0 ref',      'PANEL_018',  items[0].ref);

    t.assert('item 1 num',      2,            items[1].num);
    t.assert('item 1 desc',     'Panel 600W', items[1].desc);
  }
});


// =============================================================================
// TEST 3 \u2014 Blank rows in range are silently skipped
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_BOM_READER_BLANK_ROWS_SKIPPED',
  group   : 'unit',
  module  : 'writers_v2/rfq/bomReader',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'reader', 'chunk6'],
  source  : 'tests_unit/writers_v2/RfqBomReaderTests.gs',
  fn: function (t) {
    t.suite('readRfqBomItems: blank rows skipped');

    var rows = [];
    while (rows.length < 12) rows.push([]);
    rows[7]  = [1, 'Item A', 10, 'pcs', 100, 1000, 0, 'REF_A'];
    // row 9 deliberately left blank
    rows[9]  = ['', '', '', '', '', '', '', ''];
    // row 10 has data but no col-A number -> should be skipped
    rows[10] = ['', 'orphan description', 5, 'pcs', 0, 0, 0, ''];
    rows[11] = [2, 'Item B', 20, 'pcs', 200, 4000, 0, 'REF_B'];

    var ss = _makeBomReaderMockSs({ 'BOM_v2': rows });
    var items = readRfqBomItems(ss, [{ from: 8, to: 12 }]);

    t.assert('only two items kept', 2, items.length);
    t.assert('first item kept',  'Item A', items[0].desc);
    t.assert('second item kept', 'Item B', items[1].desc);
  }
});


// =============================================================================
// TEST 4 \u2014 Multiple ranges (the ELECTRICO use case) concatenate in order
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_BOM_READER_MULTIPLE_RANGES',
  group   : 'unit',
  module  : 'writers_v2/rfq/bomReader',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'reader', 'chunk6'],
  source  : 'tests_unit/writers_v2/RfqBomReaderTests.gs',
  fn: function (t) {
    t.suite('readRfqBomItems: multiple ranges concatenated');

    var rows = [];
    while (rows.length < 92) rows.push([]);
    // DC item at row 27
    rows[26] = [5, 'DC cable 10AWG', 6720, 'm', 0.5, 3360, 0, 'BOS_0013'];
    // AC item at row 37
    rows[36] = [11, 'AC main feeder', 234, 'm', 12, 2808, 0, 'BOS_0032'];
    // BESS-02 (DC cable) at row 81
    rows[80] = [32, 'BESS DC cable', 50, 'm', 49, 2450, 0, 'BESS-02'];

    var ss = _makeBomReaderMockSs({ 'BOM_v2': rows });
    var items = readRfqBomItems(ss, [
      { from: 27, to: 34 },
      { from: 37, to: 62 },
      { from: 81, to: 90 }
    ]);

    t.assert('three items found',         3,                items.length);
    t.assert('DC item first',             'DC cable 10AWG', items[0].desc);
    t.assert('AC item second',            'AC main feeder', items[1].desc);
    t.assert('BESS electrical item last', 'BESS DC cable',  items[2].desc);
  }
});


// =============================================================================
// TEST 5 \u2014 Non-numeric col A is skipped (e.g. section header rows)
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_BOM_READER_NON_NUMERIC_A_SKIPPED',
  group   : 'unit',
  module  : 'writers_v2/rfq/bomReader',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'reader', 'chunk6'],
  source  : 'tests_unit/writers_v2/RfqBomReaderTests.gs',
  fn: function (t) {
    t.suite('readRfqBomItems: non-numeric col-A rows skipped');

    var rows = [];
    while (rows.length < 14) rows.push([]);
    // Section header style row (e.g. "1. PANELES")
    rows[6]  = ['1. PANELES', '', '', '', '', '', '', ''];
    // Real item
    rows[7]  = [1, 'Panel 585W', 720, 'pcs', 173, 124560, 0, 'PANEL_018'];
    // Subtotal-style row with text in A
    rows[12] = ['SUBTOTAL', '', '', '', '', '', '', ''];

    var ss = _makeBomReaderMockSs({ 'BOM_v2': rows });
    var items = readRfqBomItems(ss, [{ from: 7, to: 13 }]);

    t.assert('only the numeric-A row is treated as an item', 1, items.length);
    t.assert('that item is the Panel', 'Panel 585W', items[0].desc);
  }
});


// =============================================================================
// TEST 6 \u2014 Missing BOM_v2 sheet throws a descriptive error
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_BOM_READER_MISSING_SHEET_THROWS',
  group   : 'unit',
  module  : 'writers_v2/rfq/bomReader',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'reader', 'chunk6'],
  source  : 'tests_unit/writers_v2/RfqBomReaderTests.gs',
  fn: function (t) {
    t.suite('readRfqBomItems: missing BOM_v2 sheet throws');

    var ss = _makeBomReaderMockSs({});  // no sheets at all
    t.assertThrows(
      'throws when BOM_v2 not present',
      function () { readRfqBomItems(ss, [{ from: 8, to: 12 }]); },
      'BOM_v2'  // error message must mention the sheet name
    );
  }
});


// =============================================================================
// TEST 7 \u2014 Item 0 numeric defaults: qty/unit/ref default cleanly when missing
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_BOM_READER_DEFAULTS',
  group   : 'unit',
  module  : 'writers_v2/rfq/bomReader',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'reader', 'chunk6'],
  source  : 'tests_unit/writers_v2/RfqBomReaderTests.gs',
  fn: function (t) {
    t.suite('readRfqBomItems: defaults for missing optional fields');

    var rows = [];
    while (rows.length < 9) rows.push([]);
    // Minimal: only A and B set, rest undefined
    rows[7] = [1, 'Bare item'];

    var ss = _makeBomReaderMockSs({ 'BOM_v2': rows });
    var items = readRfqBomItems(ss, [{ from: 8, to: 8 }]);

    t.assert('one item',       1,            items.length);
    t.assert('num',            1,            items[0].num);
    t.assert('desc',           'Bare item',  items[0].desc);
    t.assert('qty defaulted',  '',           items[0].qty);
    t.assert('unit defaulted', '',           items[0].unit);
    t.assert('price 0',        0,            items[0].priceUsd);
    t.assert('total 0',        0,            items[0].totalUsd);
    t.assert('ref blank',      '',           items[0].ref);
  }
});


// =============================================================================
// TEST 8 \u2014 Custom sheet name via _testOpts works (isolation seam)
// =============================================================================
registerTest({
  id      : 'UNIT_RFQ_BOM_READER_TESTOPTS_SHEET_NAME',
  group   : 'unit',
  module  : 'writers_v2/rfq/bomReader',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'reader', 'chunk6'],
  source  : 'tests_unit/writers_v2/RfqBomReaderTests.gs',
  fn: function (t) {
    t.suite('readRfqBomItems: _testOpts.sheetName overrides V2_SHEETS.BOM');

    var rows = [];
    while (rows.length < 9) rows.push([]);
    rows[7] = [1, 'Item from scratch sheet', 10, 'pcs', 50, 500, 0, 'REF'];

    var ss = _makeBomReaderMockSs({ 'BOM_v2_SCRATCH': rows });

    var items = readRfqBomItems(
      ss,
      [{ from: 8, to: 8 }],
      { sheetName: 'BOM_v2_SCRATCH' }
    );

    t.assert('one item read from scratch sheet', 1, items.length);
    t.assert('correct desc',
             'Item from scratch sheet', items[0].desc);
  }
});
