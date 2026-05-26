// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/WriteRfqV2Tests.gs
// -----------------------------------------------------------------------------
// CHUNK 6 \u2014 Unit tests for writeRfqV2 (the generic RFQ data writer).
//
// COVERAGE
//   - Item rows land starting at ROW_ITEMS_START (row 11)
//   - Item count matches input items
//   - Subtotal row appears AFTER items, with the category title in col B
//   - Subtotal row absent when items array is empty
//   - Metadata cells get populated from ctx (project name, client, location,
//     RFQ number, issue date, response date)
//   - RFQ number format: "RFQ-<code>-<projTag>-<year>"
//   - Default currency populates col H on every item row
//   - Tech requirement from certReqs['*'] applies to all items
//   - Tech requirement from certReqs[itemNum] overrides '*'
//   - Throws when called before setupRfqTemplate (sheet missing)
//   - Throws when entry has unknown sheetKey
//
// MOCK STRATEGY
//   _makeRfqWriterMockSs records cell writes. The writer is given a fake
//   "already-set-up" sheet (i.e. getSheetByName returns truthy). Items are
//   injected via _testOpts.items so the test doesn't need BOM_v2 to exist.
//
// CHUNK TAG: 'chunk6'
// =============================================================================


function _makeRfqWriterMockSs(sheetName) {
  var writes = [];
  var rowHeights = {};
  var bgByCell = {};

  function makeRange(row, col, numRows, numCols) {
    var nR = numRows || 1, nC = numCols || 1;
    var proxy = {
      _row: row, _col: col,
      setValue: function (v) {
        writes.push({ type: 'value', row: row, col: col, value: v });
        return proxy;
      },
      setValues: function (vs) {
        if (vs && vs.length) {
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
      setBackground: function (color) {
        bgByCell['R' + row + 'C' + col] = color;
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

  var sheetMock = {
    _writes: writes,
    _rowHeights: rowHeights,
    _bgByCell: bgByCell,
    getRange: function (r, c, nR, nC) { return makeRange(r, c, nR, nC); },
    setRowHeight: function (r, h) { rowHeights[r] = h; }
  };

  return {
    _sheet: sheetMock,
    getSheetByName: function (name) {
      if (name === sheetName) return sheetMock;
      return null;
    },
    getSpreadsheetTimeZone: function () { return 'America/Monterrey'; }
  };
}


function _findValuesAtRfq(writes, row, col) {
  var out = [];
  for (var i = 0; i < writes.length; i++) {
    var w = writes[i];
    if (w.type === 'value' && w.row === row && w.col === col) out.push(w.value);
  }
  return out;
}


function _lastValueAtRfq(writes, row, col) {
  var arr = _findValuesAtRfq(writes, row, col);
  return arr.length ? arr[arr.length - 1] : null;
}


function _makeRfqTestEntry(overrides) {
  var base = {
    key       : 'TEST',
    sheetKey  : 'RFQ_PANELES',         // resolves via V2_SHEETS
    title     : 'Test Category',
    code      : 'TST',
    bomRanges : [{ from: 8, to: 10 }],
    defaultCcy: 'USD',
    certReqs  : { '*': 'Test cert text' },
    techNotes : 'Test technical notes here'
  };
  if (overrides) {
    for (var k in overrides) if (overrides.hasOwnProperty(k)) base[k] = overrides[k];
  }
  return base;
}


function _makeRfqTestCtx(overrides) {
  var base = {
    inp: {
      projectManager: 'Eduardo Fraga',
      bizManager:    'Eduardo Fraga',
      projectName:   'TESTPROJ-001',
      clientName:    'Test Customer S.A.',
      street:        'Av. Pruebas 100',
      city:          'Mexico City',
      state:         'CDMX',
      businessType:  'PPA_ROOF',
      panelQty:      720
    },
    issueDate:    new Date(2026, 4, 25),  // 2026-05-25
    responseDate: new Date(2026, 5, 8),   // 2026-06-08
    issueYear:    2026,
    timezone:     'America/Monterrey'
  };
  if (overrides) {
    for (var k in overrides) if (overrides.hasOwnProperty(k)) base[k] = overrides[k];
  }
  return base;
}


// =============================================================================
// TEST 1 \u2014 Items land at row 11+, one row per item
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_ITEMS_LANDING',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: items written starting at row 11');

    var sheetName = V2_SHEETS.RFQ_PANELES;
    var ss = _makeRfqWriterMockSs(sheetName);
    var entry = _makeRfqTestEntry();
    var ctx   = _makeRfqTestCtx();
    var items = [
      { num: 1, desc: 'Panel 585W', qty: 720, unit: 'pcs',
        priceUsd: 173, totalUsd: 124560, ref: 'PANEL_018' },
      { num: 2, desc: 'Panel 600W', qty: 100, unit: 'pcs',
        priceUsd: 200, totalUsd: 20000, ref: 'PANEL_019' }
    ];

    var result = writeRfqV2(ss, entry, ctx, { items: items });

    t.assert('itemCount returned', 2, result.itemCount);

    // Row 10 should have item 1
    t.assert('row 11 col 1 = item 1 num',  1,            _lastValueAtRfq(ss._sheet._writes, 11, 1));
    t.assert('row 11 col 2 = item 1 desc', 'Panel 585W', _lastValueAtRfq(ss._sheet._writes, 11, 2));
    t.assert('row 11 col 3 = item 1 ref',  'PANEL_018',  _lastValueAtRfq(ss._sheet._writes, 11, 3));
    t.assert('row 11 col 4 = item 1 qty',  720,          _lastValueAtRfq(ss._sheet._writes, 11, 4));
    t.assert('row 11 col 5 = item 1 unit', 'pcs',        _lastValueAtRfq(ss._sheet._writes, 11, 5));

    // Row 11 should have item 2
    t.assert('row 12 col 1 = item 2 num',  2,            _lastValueAtRfq(ss._sheet._writes, 12, 1));
    t.assert('row 12 col 2 = item 2 desc', 'Panel 600W', _lastValueAtRfq(ss._sheet._writes, 12, 2));
  }
});


// =============================================================================
// TEST 2 \u2014 RFQ Number format: RFQ-<code>-<projTag>-<year>
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_RFQ_NUMBER_FORMAT',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: RFQ number assembled correctly');

    var sheetName = V2_SHEETS.RFQ_PANELES;
    var ss = _makeRfqWriterMockSs(sheetName);
    writeRfqV2(ss, _makeRfqTestEntry(), _makeRfqTestCtx(), { items: [] });

    // RFQ Number lands at row 4, col 8 (template merges 8-13, value at col 8)
    // projTag = "TESTPROJ-001" stripped of non-alphanum, truncated to 10 -> TESTPROJ00
    // year = 2026
    // code = TST
    // Expected: "RFQ-TST-TESTPROJ00-2026"
    var rfqNum = _lastValueAtRfq(ss._sheet._writes, 4, 8);
    t.assert('RFQ Number formatted correctly', 'RFQ-TST-TESTPROJ00-2026', rfqNum);
  }
});


// =============================================================================
// TEST 3 \u2014 Metadata: project name, client, location written into rows 5-6
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_METADATA_VALUES',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: metadata values populated');

    var sheetName = V2_SHEETS.RFQ_PANELES;
    var ss = _makeRfqWriterMockSs(sheetName);
    writeRfqV2(ss, _makeRfqTestEntry(), _makeRfqTestCtx(), { items: [] });

    // Row 5 col 3: "TESTPROJ-001  |  Test Customer S.A."
    var projVal = _lastValueAtRfq(ss._sheet._writes, 5, 3);
    t.assertContains('project metadata contains project name', projVal, 'TESTPROJ-001');
    t.assertContains('project metadata contains client name',  projVal, 'Test Customer');

    // Row 6 col 3: location concatenation
    var locVal = _lastValueAtRfq(ss._sheet._writes, 6, 3);
    t.assertContains('location contains street', locVal, 'Av. Pruebas 100');
    t.assertContains('location contains city',   locVal, 'Mexico City');

    // Row 4 col 3: FROM contains projectManager
    var fromVal = _lastValueAtRfq(ss._sheet._writes, 4, 3);
    t.assertContains('FROM contains project manager', fromVal, 'Eduardo Fraga');
  }
});


// =============================================================================
// TEST 4 \u2014 Subtotal row appears after items, references category title
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_SUBTOTAL_ROW',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: subtotal row with category title');

    var sheetName = V2_SHEETS.RFQ_PANELES;
    var ss = _makeRfqWriterMockSs(sheetName);
    var items = [
      { num: 1, desc: 'A', qty: 1, unit: 'pcs', priceUsd: 0, totalUsd: 0, ref: '' },
      { num: 2, desc: 'B', qty: 1, unit: 'pcs', priceUsd: 0, totalUsd: 0, ref: '' }
    ];
    writeRfqV2(ss, _makeRfqTestEntry(), _makeRfqTestCtx(), { items: items });

    // Items at rows 11, 12 -> subtotal at row 13 col 2
    var subVal = _lastValueAtRfq(ss._sheet._writes, 13, 2);
    t.assertContains('subtotal row contains "SUBTOTAL"', subVal, 'SUBTOTAL');
    t.assertContains('subtotal row contains category title',
                     subVal, 'TEST CATEGORY');  // uppercase
  }
});


// =============================================================================
// TEST 5 \u2014 No subtotal row when items is empty
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_NO_SUBTOTAL_WHEN_EMPTY',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: empty items -> no subtotal row');

    var sheetName = V2_SHEETS.RFQ_PANELES;
    var ss = _makeRfqWriterMockSs(sheetName);
    writeRfqV2(ss, _makeRfqTestEntry(), _makeRfqTestCtx(), { items: [] });

    // With zero items, nothing should be at row 11 col 1, AND no
    // "SUBTOTAL ..." string should appear in col 2 across rows 10-12.
    t.assertTrue(
      'no item written at row 11 col 1',
      _lastValueAtRfq(ss._sheet._writes, 11, 1) === null
    );

    var foundSubtotal = false;
    for (var r = 11; r <= 16; r++) {
      var v = _lastValueAtRfq(ss._sheet._writes, r, 2);
      if (v && String(v).indexOf('SUBTOTAL') === 0) { foundSubtotal = true; break; }
    }
    t.assertFalse('no SUBTOTAL row when items empty', foundSubtotal);
  }
});


// =============================================================================
// TEST 6 \u2014 Default currency lands in col H on every item row
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_DEFAULT_CCY',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: defaultCcy populated for every item');

    var sheetName = V2_SHEETS.RFQ_PANELES;
    var ss = _makeRfqWriterMockSs(sheetName);
    var entry = _makeRfqTestEntry({ defaultCcy: 'MXN' });
    var items = [
      { num: 1, desc: 'A', qty: 1, unit: 'pcs', priceUsd: 0, totalUsd: 0, ref: '' },
      { num: 2, desc: 'B', qty: 1, unit: 'pcs', priceUsd: 0, totalUsd: 0, ref: '' }
    ];
    writeRfqV2(ss, entry, _makeRfqTestCtx(), { items: items });

    t.assert('row 11 col 8 = MXN', 'MXN', _lastValueAtRfq(ss._sheet._writes, 11, 8));
    t.assert('row 12 col 8 = MXN', 'MXN', _lastValueAtRfq(ss._sheet._writes, 12, 8));
  }
});


// =============================================================================
// TEST 7 \u2014 certReqs['*'] applies to all items
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_CERTS_STAR_FALLBACK',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: certReqs[*] used when no per-item cert');

    var sheetName = V2_SHEETS.RFQ_PANELES;
    var ss = _makeRfqWriterMockSs(sheetName);
    var entry = _makeRfqTestEntry({
      certReqs: { '*': 'GLOBAL_CERT_TEXT' }
    });
    var items = [
      { num: 1, desc: 'A', qty: 1, unit: 'pcs', priceUsd: 0, totalUsd: 0, ref: '' }
    ];
    writeRfqV2(ss, entry, _makeRfqTestCtx(), { items: items });

    t.assert('row 11 col 6 = global cert text',
             'GLOBAL_CERT_TEXT', _lastValueAtRfq(ss._sheet._writes, 11, 6));
  }
});


// =============================================================================
// TEST 8 \u2014 certReqs[itemNum] overrides certReqs[*]
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_CERTS_ITEM_OVERRIDE',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: certReqs[itemNum] overrides [*]');

    var sheetName = V2_SHEETS.RFQ_PANELES;
    var ss = _makeRfqWriterMockSs(sheetName);
    var entry = _makeRfqTestEntry({
      certReqs: { '*': 'GLOBAL_CERT', '2': 'ITEM_2_CERT' }
    });
    var items = [
      { num: 1, desc: 'A', qty: 1, unit: 'pcs', priceUsd: 0, totalUsd: 0, ref: '' },
      { num: 2, desc: 'B', qty: 1, unit: 'pcs', priceUsd: 0, totalUsd: 0, ref: '' }
    ];
    writeRfqV2(ss, entry, _makeRfqTestCtx(), { items: items });

    t.assert('item 1 gets global cert',
             'GLOBAL_CERT', _lastValueAtRfq(ss._sheet._writes, 11, 6));
    t.assert('item 2 gets per-item cert',
             'ITEM_2_CERT', _lastValueAtRfq(ss._sheet._writes, 12, 6));
  }
});


// =============================================================================
// TEST 9 \u2014 Throws when sheet missing (template not run first)
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_THROWS_NO_SHEET',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: throws when target sheet does not exist');

    // ss returns null for any getSheetByName (the sheet was never created)
    var ss = {
      getSheetByName: function () { return null; },
      getSpreadsheetTimeZone: function () { return 'America/Monterrey'; }
    };

    t.assertThrows(
      'missing sheet -> throw',
      function () {
        writeRfqV2(ss, _makeRfqTestEntry(), _makeRfqTestCtx(), { items: [] });
      },
      'not found'
    );
  }
});


// =============================================================================
// TEST 10 \u2014 Throws when entry.sheetKey doesn't resolve via V2_SHEETS
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_THROWS_BAD_SHEETKEY',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: throws when sheetKey unknown');

    var ss = {
      getSheetByName: function () { return {}; },  // doesn't matter
      getSpreadsheetTimeZone: function () { return 'America/Monterrey'; }
    };
    var entry = _makeRfqTestEntry({ sheetKey: 'TOTALLY_BOGUS_KEY' });

    t.assertThrows(
      'unknown sheetKey -> throw',
      function () { writeRfqV2(ss, entry, _makeRfqTestCtx(), { items: [] }); },
      'V2_SHEETS'
    );
  }
});


// =============================================================================
// TEST 11 \u2014 _testOpts.sheetName override for direct sheet targeting
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_TESTOPTS_SHEET_NAME',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: _testOpts.sheetName overrides registry resolution');

    var ss = _makeRfqWriterMockSs('SCRATCH_RFQ_v2');
    var entry = _makeRfqTestEntry({ sheetKey: 'TOTALLY_BOGUS_KEY' });
    // Without sheetName override, entry.sheetKey would not resolve. With
    // override, the writer skips V2_SHEETS lookup and uses our scratch name.
    var result = writeRfqV2(
      ss, entry, _makeRfqTestCtx(),
      { items: [], sheetName: 'SCRATCH_RFQ_v2' }
    );
    t.assert('writer returned scratch sheet name',
             'SCRATCH_RFQ_v2', result.sheet);
  }
});


// =============================================================================
// TEST 12 \u2014 Item 0 (zero items) doesn't crash on missing optional fields
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_RFQ_V2_ITEMS_WITH_DEFAULTS',
  group   : 'unit',
  module  : 'writers_v2/rfq',
  scenarios: [],
  tags    : ['writers_v2', 'rfq', 'v2', 'chunk6'],
  source  : 'tests_unit/writers_v2/WriteRfqV2Tests.gs',
  fn: function (t) {
    t.suite('writeRfqV2: items with empty/missing fields render OK');

    var sheetName = V2_SHEETS.RFQ_PANELES;
    var ss = _makeRfqWriterMockSs(sheetName);
    var items = [
      // Bare item: only num + desc populated
      { num: 1, desc: 'Bare item', qty: '', unit: '',
        priceUsd: 0, totalUsd: 0, ref: '' }
    ];
    writeRfqV2(ss, _makeRfqTestEntry(), _makeRfqTestCtx(), { items: items });

    t.assert('item written at row 11 col 1', 1,           _lastValueAtRfq(ss._sheet._writes, 11, 1));
    t.assert('item desc written',            'Bare item', _lastValueAtRfq(ss._sheet._writes, 11, 2));
    // ref is '' which means setValue('') is called \u2014 mock records it
    t.assert('blank ref handled',            '',          _lastValueAtRfq(ss._sheet._writes, 11, 3));
  }
});
