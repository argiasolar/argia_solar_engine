// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/WriteCfeOutputV2Tests.gs
// -----------------------------------------------------------------------------
// CHUNK 7 \u2014 Unit tests for writeCfeOutputV2 (data writer).
//
// COVERAGE
//   - Throws when INPUT_CFE / CFE_SIMULATION / BESS_SIMULATION missing
//   - Header strip values land in correct cells (col C, col J on rows 5-8)
//   - KPI strip without steady -> 3 standard tiles
//   - KPI strip with steady    -> tile 3 is rich-text variant
//   - Section 1: kwhNeto = sum of csim_kwhBase + Inter + Punta
//   - Section 1: ahorroPv = input_total - csim_total per month
//   - Section 2: ahorroBessTotal = cap + dist + var per month
//   - Section 2: reciboFinalMonthly = csim_total - ahorroBessTotal
//   - Footer fills 5 cascade values
//   - Y1SS section returns true when steady data present, false otherwise
//   - Hourly addendum rendered only when hourlySim passed
//
// MOCK STRATEGY
//   _makeCfeWriterMockSs: returns a fake spreadsheet with INPUT_CFE,
//   CFE_SIMULATION, BESS_SIMULATION pre-loaded with row arrays + a writable
//   CFE_OUTPUT_v2 sheet that records writes. Tests inject data via the
//   constructor's `sourceData` argument.
//
// CHUNK TAG: 'chunk7'
// =============================================================================


function _makeCfeWriterMockSs(sourceData) {
  // sourceData: { INPUT_CFE: rows, CFE_SIMULATION: rows, BESS_SIMULATION: rows }
  sourceData = sourceData || {};
  var writes = [];
  var rowHeights = {};
  var colWidths = {};
  var clearCount = 0;
  var imagesRemovedCount = 0;

  function makeReadOnlyRange(rows, startRow, startCol, numRows, numCols) {
    var nR = numRows || 1, nC = numCols || 1;
    return {
      getValue: function () {
        var rr = rows[startRow - 1];
        return rr ? rr[startCol - 1] : '';
      },
      getValues: function () {
        var out = [];
        for (var r = 0; r < nR; r++) {
          var srcRow = rows[startRow - 1 + r] || [];
          var rowOut = [];
          for (var c = 0; c < nC; c++) rowOut.push(srcRow[startCol - 1 + c]);
          out.push(rowOut);
        }
        return out;
      }
    };
  }

  function makeWriteRange(row, col, nR, nC) {
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
              writes.push({ type: 'value', row: row + ri, col: col + ci,
                            value: vs[ri][ci] });
            }
          }
        }
        return proxy;
      },
      setBackground:          function () { return proxy; },
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
      setFormula:             function () { return proxy; },
      setRichTextValue:       function () { return proxy; }
    };
    return proxy;
  }

  var cfeSheet = {
    _writes: writes,
    _rowHeights: rowHeights,
    _colWidths: colWidths,
    _clearCount: function () { return clearCount; },
    getName: function () { return 'CFE_OUTPUT_v2'; },
    getRange: function (r, c, nR, nC) { return makeWriteRange(r, c, nR || 1, nC || 1); },
    setRowHeight:               function (r, h) { rowHeights[r] = h; },
    setColumnWidth:             function (c, w) { colWidths[c] = w; },
    setFrozenRows:              function () {},
    setHiddenGridlines:         function () {},
    clear:                      function () { clearCount++; },
    clearNotes:                 function () {},
    clearConditionalFormatRules:function () {},
    getImages:                  function () { return []; },
    getLastRow:                 function () {
      // Track the highest row touched so getLastRow()+3 positions the BDF-5
      // addendum below the rest of the rendered content, like real Sheets.
      var maxR = 0;
      for (var i = 0; i < writes.length; i++) {
        if (writes[i].type === 'value' && writes[i].row > maxR) maxR = writes[i].row;
      }
      return maxR;
    }
  };

  function makeReadOnlySheet(rows) {
    return {
      getRange: function (r, c, nR, nC) { return makeReadOnlyRange(rows, r, c, nR, nC); }
    };
  }

  // Benign _DESIGN_TOKENS stub. loadDesignTokens calls getRange(2,1,...)
  // when lastRow >= 2; we keep lastRow = 1 so it short-circuits and returns
  // an empty token map. Tokens used by the writer fall back to defaults
  // via the global `token`/`tokenNum` stubs.
  function _benignSheetStub(name) {
    return {
      _name: name,
      getName: function () { return name; },
      getLastRow: function () { return 1; },
      getRange: function () {
        return {
          getValue:           function () { return ''; },
          getValues:          function () { return [[]]; },
          setValue:           function () { return this; },
          setValues:          function () { return this; },
          setBackground:      function () { return this; },
          setBorder:          function () { return this; },
          setFontFamily:      function () { return this; },
          setFontSize:        function () { return this; },
          setFontWeight:      function () { return this; },
          setFontColor:       function () { return this; },
          setFontStyle:       function () { return this; },
          setHorizontalAlignment: function () { return this; },
          setVerticalAlignment:   function () { return this; },
          setNumberFormat:    function () { return this; },
          setNote:            function () { return this; },
          merge:              function () { return this; },
          breakApart:         function () { return this; },
          setWrap:            function () { return this; },
          setFormula:         function () { return this; },
          setRichTextValue:   function () { return this; }
        };
      },
      setRowHeight:               function () {},
      setColumnWidth:             function () {},
      setFrozenRows:              function () {},
      setFrozenColumns:           function () {},
      setHiddenGridlines:         function () {},
      clear:                      function () {},
      clearNotes:                 function () {},
      clearConditionalFormatRules:function () {},
      getImages:                  function () { return []; }
    };
  }
  var designTokensSheet = _benignSheetStub('_DESIGN_TOKENS');

  var cfeInserted = false;
  return {
    _cfeSheet: cfeSheet,
    getSheetByName: function (name) {
      if (name === 'INPUT_CFE')       return sourceData.INPUT_CFE       ? makeReadOnlySheet(sourceData.INPUT_CFE)       : null;
      if (name === 'CFE_SIMULATION')  return sourceData.CFE_SIMULATION  ? makeReadOnlySheet(sourceData.CFE_SIMULATION)  : null;
      if (name === 'BESS_SIMULATION') return sourceData.BESS_SIMULATION ? makeReadOnlySheet(sourceData.BESS_SIMULATION) : null;
      if (name === 'MDC_v2')          return null;
      if (name === '_DESIGN_TOKENS')  return designTokensSheet;
      if (name === 'CFE_OUTPUT_v2')   return cfeInserted ? cfeSheet : null;
      return null;
    },
    insertSheet: function (name) {
      // ONLY toggle CFE state for CFE_OUTPUT_v2. Any other insertSheet call
      // (e.g. _DESIGN_TOKENS from loadDesignTokens) gets a benign stub
      // without affecting CFE state.
      if (name === 'CFE_OUTPUT_v2') { cfeInserted = true; return cfeSheet; }
      return _benignSheetStub(name);
    },
    getSpreadsheetTimeZone: function () { return 'America/Monterrey'; }
  };
}


function _makeCfeRows(rowSpecs) {
  // rowSpecs: { 5: [col2, col3, ...], 10: [...] }
  // Returns sparse row array.
  var maxRow = 0;
  for (var k in rowSpecs) {
    if (rowSpecs.hasOwnProperty(k)) {
      var r = parseInt(k, 10);
      if (r > maxRow) maxRow = r;
    }
  }
  var rows = [];
  while (rows.length < maxRow) rows.push([]);
  for (var k2 in rowSpecs) {
    if (rowSpecs.hasOwnProperty(k2)) {
      rows[parseInt(k2, 10) - 1] = rowSpecs[k2];
    }
  }
  return rows;
}


function _findValueAtCfeWrite(writes, row, col) {
  for (var i = writes.length - 1; i >= 0; i--) {
    var w = writes[i];
    if (w.type === 'value' && w.row === row && w.col === col) return w.value;
  }
  return null;
}


function _allValuesAtRow(writes, row) {
  // Return latest value at each col in the given row
  var byCol = {};
  for (var i = 0; i < writes.length; i++) {
    var w = writes[i];
    if (w.type === 'value' && w.row === row) byCol[w.col] = w.value;
  }
  return byCol;
}


// =============================================================================
// TEST 1 \u2014 Throws when INPUT_CFE missing
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_THROWS_MISSING_INPUT_CFE',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: throws when INPUT_CFE missing');

    var ss = _makeCfeWriterMockSs({
      // INPUT_CFE intentionally absent
      CFE_SIMULATION: [],
      BESS_SIMULATION: []
    });
    t.assertThrows(
      'missing INPUT_CFE throws',
      function () { writeCfeOutputV2(ss, null); },
      'INPUT_CFE'
    );
  }
});


// =============================================================================
// TEST 2 \u2014 Throws when CFE_SIMULATION missing
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_THROWS_MISSING_CFE_SIM',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: throws when CFE_SIMULATION missing');

    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [],
      BESS_SIMULATION: []
    });
    t.assertThrows(
      'missing CFE_SIMULATION throws',
      function () { writeCfeOutputV2(ss, null); },
      'CFE_SIMULATION'
    );
  }
});


// =============================================================================
// TEST 3 \u2014 Header strip values land in correct cells
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_HEADER_STRIP_VALUES',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: header strip values');

    // Build INPUT_CFE rows 4-8 with tariff data
    // Row 4: col C = tariff code, col F = service name
    // Row 5: col F = service number
    // Row 6: col F = contracted kW
    // Row 7: col C = 2pctBT (we use col C here)
    // Row 40: col C = interconnection
    // Row 42: col C = autoconsumo
    var inputRows = _makeCfeRows({
      4:  [null, null, 'GDMTH', null, null, 'OASIS LATINOAMERICA'],
      5:  [null, null, null, null, null, '414240911417'],
      6:  [null, null, null, null, null, 1620],
      7:  [null, null, 'NO'],
      40: [null, null, 'NETO'],
      42: [null, null, 0.85]
    });
    var bessRows = _makeCfeRows({
      7: [null, null, null, 'PEAK_SHAVE'],
      37: [null, null, null, 2169],
      38: [null, null, null, 400]
    });

    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: inputRows,
      CFE_SIMULATION: [],
      BESS_SIMULATION: bessRows
    });
    writeCfeOutputV2(ss, null);

    var w = ss._cfeSheet._writes;
    t.assert('row 5 col 3 = tariff code',   'GDMTH',               _findValueAtCfeWrite(w, 5, 3));
    t.assert('row 5 col 10 = service name', 'OASIS LATINOAMERICA', _findValueAtCfeWrite(w, 5, 10));
    t.assert('row 6 col 3 = service num',   '414240911417',        _findValueAtCfeWrite(w, 6, 3));
    t.assert('row 6 col 10 = contracted',   1620,                  _findValueAtCfeWrite(w, 6, 10));
    t.assert('row 7 col 3 = interconn',     'NETO',                _findValueAtCfeWrite(w, 7, 3));
    t.assert('row 7 col 10 = autoconsumo',  0.85,                  _findValueAtCfeWrite(w, 7, 10));
    t.assert('row 8 col 3 = strategy',      'PEAK_SHAVE',          _findValueAtCfeWrite(w, 8, 3));
    t.assertContains('row 8 col 10 contains kWh',
                     _findValueAtCfeWrite(w, 8, 10), 'kWh usable');
  }
});


// =============================================================================
// TEST 4 \u2014 KPI strip without steady (only 3 standard tiles)
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_KPI_NO_STEADY',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: KPI tiles when no steady data');

    var bessRows = _makeCfeRows({
      12: [null, null, null, 5000000],   // reciboBase
      14: [null, null, null, 3000000],   // reciboTrasPv
      18: [null, null, null, 2000000],   // reciboFinal
      48: [null, null, null, '']         // no steady value -> ''
    });
    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: [],
      BESS_SIMULATION: bessRows
    });
    var result = writeCfeOutputV2(ss, null);
    t.assertFalse('hasSteady is false', result.hasSteady);

    var w = ss._cfeSheet._writes;
    // 3 tiles at cols 2, 7, 12 — tile 3 standard format (label + value)
    var tile3 = _findValueAtCfeWrite(w, 10, 12);
    t.assertContains('tile 3 contains "PV + BESS"', tile3, 'PV + BESS');
    t.assertContains('tile 3 contains 2,000,000',   tile3, '2,000,000');
  }
});


// =============================================================================
// TEST 5 \u2014 KPI strip with steady (rich-text tile 3 returns true)
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_KPI_WITH_STEADY',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: KPI with steady-state data');

    var bessRows = _makeCfeRows({
      12: [null, null, null, 5000000],
      14: [null, null, null, 3000000],
      18: [null, null, null, 2000000],
      48: [null, null, null, 1800000]    // steady value present
    });
    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: [],
      BESS_SIMULATION: bessRows
    });
    var result = writeCfeOutputV2(ss, null);
    t.assertTrue('hasSteady is true', result.hasSteady);
  }
});


// =============================================================================
// TEST 6 \u2014 Section 1: kwhNeto computed as sum of 3 source rows
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_SEC1_KWH_NETO_SUM',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: kwhNeto = base+inter+punta per month');

    // CFE_SIMULATION rows 5,6,7 = monthly kWh after PV (base/inter/punta)
    // Cols C..N = indices 2..13. Build with 12 month values.
    var csimRows = _makeCfeRows({
      5: [null, null, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      6: [null, null,  50,  50,  50,  50,  50,  50,  50,  50,  50,  50,  50,  50],
      7: [null, null,  25,  25,  25,  25,  25,  25,  25,  25,  25,  25,  25,  25]
    });
    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: csimRows, BESS_SIMULATION: []
    });
    writeCfeOutputV2(ss, null);

    // kwhNeto lands at row 14 cols 3-14, sum = 175 per month
    var w = ss._cfeSheet._writes;
    var row14 = _allValuesAtRow(w, 14);
    t.assert('col 3 = 175',  175, row14[3]);
    t.assert('col 8 = 175',  175, row14[8]);
    t.assert('col 14 = 175', 175, row14[14]);
  }
});


// =============================================================================
// TEST 7 \u2014 Section 1: ahorroPv = input_total - csim_total
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_SEC1_AHORRO_DIFF',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: ahorroPv = total sin - total con');

    var inputRows = _makeCfeRows({
      37: [null, null, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000]
    });
    var csimRows = _makeCfeRows({
      39: [null, null, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000]
    });
    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: inputRows, CFE_SIMULATION: csimRows, BESS_SIMULATION: []
    });
    writeCfeOutputV2(ss, null);

    // ahorroPv lands at row 20 cols 3-14, diff = 3000 per month
    var w = ss._cfeSheet._writes;
    var row20 = _allValuesAtRow(w, 20);
    t.assert('col 3 = 3000',  3000, row20[3]);
    t.assert('col 14 = 3000', 3000, row20[14]);
  }
});


// =============================================================================
// TEST 8 \u2014 Section 2: ahorroBessTotal = cap + dist + var
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_SEC2_AHORRO_TOTAL_SUM',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: ahorroBessTotal = cap+dist+var');

    var bessRows = _makeCfeRows({
      30: [null, null, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
      31: [null, null,  500,  500,  500,  500,  500,  500,  500,  500,  500,  500,  500,  500],
      32: [null, null,  200,  200,  200,  200,  200,  200,  200,  200,  200,  200,  200,  200]
    });
    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: [], BESS_SIMULATION: bessRows
    });
    writeCfeOutputV2(ss, null);

    // Row 30 = SEC2_AHORRO_TOTAL, sum = 1700 per month
    var w = ss._cfeSheet._writes;
    var row30 = _allValuesAtRow(w, 30);
    t.assert('col 3 = 1700',  1700, row30[3]);
    t.assert('col 14 = 1700', 1700, row30[14]);
  }
});


// =============================================================================
// TEST 9 \u2014 Section 2: reciboFinalMonthly = csim_total - bessTotal
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_SEC2_RECIBO_FINAL',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: reciboFinalMonthly = csim_total - ahorroBessTotal');

    var csimRows = _makeCfeRows({
      39: [null, null, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]
    });
    var bessRows = _makeCfeRows({
      30: [null, null, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
      31: [null, null,  500,  500,  500,  500,  500,  500,  500,  500,  500,  500,  500,  500],
      32: [null, null,  200,  200,  200,  200,  200,  200,  200,  200,  200,  200,  200,  200]
    });
    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: csimRows, BESS_SIMULATION: bessRows
    });
    writeCfeOutputV2(ss, null);

    // Row 31 = SEC2_RECIBO_FINAL; 5000 - 1700 = 3300 per month
    var w = ss._cfeSheet._writes;
    var row31 = _allValuesAtRow(w, 31);
    t.assert('col 3 = 3300',  3300, row31[3]);
    t.assert('col 14 = 3300', 3300, row31[14]);
  }
});


// =============================================================================
// TEST 10 \u2014 Footer fills 5 cascade values
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_FOOTER_CASCADE',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: footer 5 cascade values');

    var bessRows = _makeCfeRows({
      12: [null, null, null, 5000000],   // reciboBase
      13: [null, null, null, 1500000],   // ahorroPv
      14: [null, null, null, 3500000],   // reciboTrasPv
      15: [null, null, null, -500000],   // ahorroBessCap (negative in legacy)
      16: [null, null, null, -300000],   // ahorroBessDist
      17: [null, null, null, -200000],   // ahorroBessVar
      18: [null, null, null, 2500000]    // reciboFinal
    });
    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: [], BESS_SIMULATION: bessRows
    });
    writeCfeOutputV2(ss, null);

    var w = ss._cfeSheet._writes;
    // Row 35 cols 3, 5, 7, 9, 11 (merged blocks start)
    t.assertContains('col 3 has reciboBase',   _findValueAtCfeWrite(w, 35, 3),  '5,000,000');
    t.assertContains('col 5 has ahorroPv',     _findValueAtCfeWrite(w, 35, 5),  '1,500,000');
    t.assertContains('col 7 has reciboTrasPv', _findValueAtCfeWrite(w, 35, 7),  '3,500,000');
    // ahorroBess = cap+dist+var = -500K + -300K + -200K = -1,000,000
    t.assertContains('col 9 has ahorroBess sum', _findValueAtCfeWrite(w, 35, 9), '1,000,000');
    t.assertContains('col 11 has reciboFinal',   _findValueAtCfeWrite(w, 35, 11), '2,500,000');
  }
});


// =============================================================================
// TEST 11 \u2014 BDF-5 addendum: NOT rendered when hourlySim is null
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_BDF5_SKIPPED_WHEN_NULL',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: hourlySim null -> no BDF-5 addendum');

    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: [], BESS_SIMULATION: []
    });
    var result = writeCfeOutputV2(ss, null);
    t.assertFalse('hasHourly false', result.hasHourly);

    // No "Hourly Simulation" title text written anywhere
    var w = ss._cfeSheet._writes;
    var found = false;
    for (var i = 0; i < w.length; i++) {
      if (w[i].type === 'value' && typeof w[i].value === 'string' &&
          w[i].value.indexOf('Hourly Simulation') !== -1) { found = true; break; }
    }
    t.assertFalse('no "Hourly Simulation" title written', found);
  }
});


// =============================================================================
// TEST 12 \u2014 BDF-5 addendum: NOT rendered when hourlySim.blocked = true
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_BDF5_SKIPPED_WHEN_BLOCKED',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: hourlySim.blocked -> no addendum');

    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: [], BESS_SIMULATION: []
    });
    var result = writeCfeOutputV2(ss, { blocked: true });
    t.assertFalse('hasHourly false', result.hasHourly);
  }
});


// =============================================================================
// TEST 13 \u2014 BDF-5 addendum: hourly summary block (3 rows) rendered
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_BDF5_HOURLY_SUMMARY',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: BDF-5 hourly summary 3 rows');

    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: [], BESS_SIMULATION: []
    });
    var hourlySim = {
      blocked: false,
      annual: { totalCostMxn: 10702859, energyCostMxn: 0, demandChargeMxn: 0 },
      baseline: { totalCostMxn: 13186114 },
      savingsMxn: 2483255
    };
    var result = writeCfeOutputV2(ss, hourlySim);
    t.assertTrue('hasHourly true', result.hasHourly);

    var w = ss._cfeSheet._writes;
    // Find the "Hourly Simulation" header write to know the startRow
    var startRow = null;
    for (var i = 0; i < w.length; i++) {
      if (w[i].type === 'value' && typeof w[i].value === 'string' &&
          w[i].value.indexOf('Hourly Simulation (BDF-5') !== -1) {
        startRow = w[i].row; break;
      }
    }
    t.assertTrue('BDF-5 header found', startRow !== null);

    // startRow+1 col 4 = Sin PV hourly value (13,186,114)
    t.assert('Sin PV hourly value',     13186114, _findValueAtCfeWrite(w, startRow + 1, 4));
    t.assert('Con PV+BESS value',       10702859, _findValueAtCfeWrite(w, startRow + 2, 4));
    t.assert('Ahorro anual hourly',      2483255, _findValueAtCfeWrite(w, startRow + 3, 4));
    // Labels
    t.assert('Sin PV label',     'Sin PV (hourly):',         _findValueAtCfeWrite(w, startRow + 1, 2));
    t.assert('Con PV+BESS label','Con PV + BESS (hourly):',  _findValueAtCfeWrite(w, startRow + 2, 2));
    t.assert('Ahorro label',     'Ahorro anual (hourly):',   _findValueAtCfeWrite(w, startRow + 3, 2));
    // Comparison note at startRow+4
    t.assertContains('comparison note', _findValueAtCfeWrite(w, startRow + 4, 2),
                     'RECIBO ANUAL CON PV + BESS');
  }
});


// =============================================================================
// TEST 14 \u2014 BDF-5 addendum: bill components block (11 rows + provenance)
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_BDF5_BILL_COMPONENTS',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: BDF-5 bill components 11 rows');

    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: [], BESS_SIMULATION: []
    });
    // Use 12-month arrays summing to known totals
    var twelveOf = function (v) {
      var a = []; for (var i = 0; i < 12; i++) a.push(v); return a;
    };
    var hourlySim = {
      blocked: false,
      annual: {
        totalCostMxn: 10702859,
        fullBill: {
          provenance: 'BDF5_R2_FULL_BILL',
          components: {
            capacidad:   twelveOf(312988),   // sum = 3,755,855
            distribucion:twelveOf(41238),    // sum = 494,856
            transmision: twelveOf(47326),    // sum = 567,910
            cenace:      twelveOf(1750),     // sum = 21,000
            energiaB:    twelveOf(200000),
            energiaI:    twelveOf(100000),
            energiaP:    twelveOf(60542),    // (B+I+P) sum = 4,326,504 -> ~ 4,327,501
            scnmem:      twelveOf(200),
            suministro:  twelveOf(305),      // sum = 6,060 -> close to 6,460
            bajaTension: twelveOf(4585),     // sum = 55,020
            cargoFp:     twelveOf(0),        // sum = 0
            subtotal:    twelveOf(769033),   // sum = 9,228,396
            iva:         twelveOf(123091),   // sum = 1,477,092
            facturacion: twelveOf(892125)    // sum = 10,705,500
          }
        }
      },
      baseline: { totalCostMxn: 13186114 },
      savingsMxn: 2483255,
      provenance: { loadShape: 'PIECEWISE_FLAT_FROM_BILLS GDMTH', windows: 'HARDCODED_GOLFO_NORTE_EFFECTIVE_2026-01-01' }
    };
    var result = writeCfeOutputV2(ss, hourlySim);
    t.assertTrue('hasHourly true', result.hasHourly);

    var w = ss._cfeSheet._writes;
    // Find "Bill components" header row
    var bcRow = null;
    for (var i = 0; i < w.length; i++) {
      if (w[i].type === 'value' && typeof w[i].value === 'string' &&
          w[i].value.indexOf('Bill components') !== -1) {
        bcRow = w[i].row; break;
      }
    }
    t.assertTrue('bill components header found', bcRow !== null);

    // 11 line items at bcRow+1 through bcRow+11. Labels in col 2, values col 4.
    var expectedLabels = [
      'Capacidad',                // bcRow+1
      'Distribuci',               // truncated to handle unicode \u00f3
      'Transmisi',
      'CENACE',
      'Energ',                    // 'Energía B/I/P'
      'SCnMEM',
      '2% Baja Tension',
      'Cargo FP',
      'Subtotal',
      'IVA (16%)',
      'Facturaci'                 // 'Facturación TOTAL'
    ];
    for (var k = 0; k < expectedLabels.length; k++) {
      t.assertContains('row ' + (bcRow + 1 + k) + ' has label containing "' + expectedLabels[k] + '"',
                       _findValueAtCfeWrite(w, bcRow + 1 + k, 2),
                       expectedLabels[k]);
    }
    // Spot-check a couple of computed totals:
    t.assert('Capacidad total = 3,755,856', 3755856, _findValueAtCfeWrite(w, bcRow + 1, 4));
    t.assert('Subtotal total = 9,228,396',  9228396, _findValueAtCfeWrite(w, bcRow + 9, 4));

    // Provenance row at bcRow + 11 + 2 = bcRow + 13
    var provRow = bcRow + 13;
    t.assertContains('provenance row has Provenance prefix',
                     _findValueAtCfeWrite(w, provRow, 2), 'Provenance');
    t.assertContains('provenance contains loadShape',
                     _findValueAtCfeWrite(w, provRow, 2), 'PIECEWISE_FLAT');
    t.assertContains('provenance contains fullBill provenance',
                     _findValueAtCfeWrite(w, provRow, 2), 'BDF5_R2_FULL_BILL');
  }
});


// =============================================================================
// TEST 15 \u2014 BDF-5 addendum: warnings line rendered when present
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_BDF5_WARNINGS',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: BDF-5 warnings line when present');

    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: [], BESS_SIMULATION: []
    });
    var twelveOf = function (v) {
      var a = []; for (var i = 0; i < 12; i++) a.push(v); return a;
    };
    var hourlySim = {
      blocked: false,
      annual: {
        totalCostMxn: 1000,
        fullBill: {
          provenance: 'X',
          components: {
            capacidad: twelveOf(1),    distribucion: twelveOf(1),
            transmision: twelveOf(1),  cenace: twelveOf(1),
            energiaB: twelveOf(1),     energiaI: twelveOf(1), energiaP: twelveOf(1),
            scnmem: twelveOf(1),       suministro: twelveOf(1),
            bajaTension: twelveOf(1),  cargoFp: twelveOf(1),
            subtotal: twelveOf(1),     iva: twelveOf(1), facturacion: twelveOf(1)
          }
        }
      },
      warnings: ['CENACE rate missing', 'IVA fallback used']
    };
    writeCfeOutputV2(ss, hourlySim);

    var w = ss._cfeSheet._writes;
    var found = null;
    for (var i = 0; i < w.length; i++) {
      if (w[i].type === 'value' && typeof w[i].value === 'string' &&
          w[i].value.indexOf('Warnings:') === 0) {
        found = w[i].value; break;
      }
    }
    t.assertTrue('warnings row found', found !== null);
    t.assertContains('warnings contains first',  found, 'CENACE rate missing');
    t.assertContains('warnings contains second', found, 'IVA fallback used');
    t.assertContains('warnings uses pipe separator', found, ' | ');
  }
});


// =============================================================================
// TEST 16 \u2014 BDF-5 addendum: R1 fallback when no fullBill
// =============================================================================
registerTest({
  id      : 'UNIT_WRITE_CFE_V2_BDF5_R1_FALLBACK',
  group   : 'unit',
  module  : 'writers_v2/cfeOutput',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'v2', 'chunk7'],
  source  : 'tests_unit/writers_v2/WriteCfeOutputV2Tests.gs',
  fn: function (t) {
    t.suite('writeCfeOutputV2: BDF-5 R1 fallback when no fullBill');

    var ss = _makeCfeWriterMockSs({
      INPUT_CFE: [], CFE_SIMULATION: [], BESS_SIMULATION: []
    });
    var hourlySim = {
      blocked: false,
      annual: { totalCostMxn: 500000, energyCostMxn: 300000, demandChargeMxn: 200000 },
      baseline: { totalCostMxn: 800000 },
      savingsMxn: 300000
      // NO fullBill -> R1 fallback path
    };
    writeCfeOutputV2(ss, hourlySim);

    var w = ss._cfeSheet._writes;
    // R1 fallback writes "Energy cost (energy only):" and "Demand charges (kW peaks):"
    var energyLabelFound = false, demandLabelFound = false, noteFound = false;
    for (var i = 0; i < w.length; i++) {
      if (w[i].type !== 'value' || typeof w[i].value !== 'string') continue;
      if (w[i].value.indexOf('Energy cost') !== -1)    energyLabelFound = true;
      if (w[i].value.indexOf('Demand charges') !== -1) demandLabelFound = true;
      if (w[i].value.indexOf('full CFE bill components') !== -1) noteFound = true;
    }
    t.assertTrue('R1 fallback Energy cost label written',    energyLabelFound);
    t.assertTrue('R1 fallback Demand charges label written', demandLabelFound);
    t.assertTrue('R1 fallback NOTE written',                  noteFound);

    // Bill components header should NOT be present in R1 fallback
    var bcFound = false;
    for (var j = 0; j < w.length; j++) {
      if (w[j].type === 'value' && typeof w[j].value === 'string' &&
          w[j].value.indexOf('Bill components') !== -1) { bcFound = true; break; }
    }
    t.assertFalse('Bill components header NOT in R1 fallback', bcFound);
  }
});
