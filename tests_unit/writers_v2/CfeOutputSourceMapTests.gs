// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/CfeOutputSourceMapTests.gs
// -----------------------------------------------------------------------------
// CHUNK 7 \u2014 Unit tests for readCfeScalar, readCfeMonthly, CFE_OUT_SRC_V2.
//
// COVERAGE
//   - readCfeScalar returns the cell value at the mapped location
//   - readCfeScalar returns '' when the source sheet is missing
//   - readCfeScalar throws on unknown srcKey
//   - readCfeMonthly returns 12-element array of mapped row's cols C..N
//   - readCfeMonthly returns 12 zeros when source sheet missing
//   - readCfeMonthly throws on unknown srcKey
//   - CFE_OUT_SRC_V2 has all expected keys
//   - All entries have valid shape (sheet, row, col?)
//   - _testOpts.srcMap override works (isolation seam)
//
// CHUNK TAG: 'chunk7'
// =============================================================================


function _makeCfeMockSs(rowsByName) {
  return {
    getSheetByName: function (name) {
      var rows = rowsByName[name];
      if (!rows) return null;
      return {
        getRange: function (startRow, startCol, numRows, numCols) {
          var nR = numRows || 1, nC = numCols || 1;
          return {
            getValue: function () {
              var rr = rows[startRow - 1];
              if (!rr) return '';
              return rr[startCol - 1];
            },
            getValues: function () {
              var out = [];
              for (var r = 0; r < nR; r++) {
                var srcRow = rows[startRow - 1 + r] || [];
                var rowOut = [];
                for (var c = 0; c < nC; c++) {
                  rowOut.push(srcRow[startCol - 1 + c]);
                }
                out.push(rowOut);
              }
              return out;
            }
          };
        }
      };
    }
  };
}


// =============================================================================
// TEST 1 \u2014 readCfeScalar returns mapped cell value
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_SRC_SCALAR_READ',
  group   : 'unit',
  module  : 'writers_v2/cfe/sourceMap',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'sourceMap', 'chunk7'],
  source  : 'tests_unit/writers_v2/CfeOutputSourceMapTests.gs',
  fn: function (t) {
    t.suite('readCfeScalar: reads mapped cell');

    // INPUT_CFE!F4 in real map; build row[3] (index 3 = row 4) with value at col 6 (index 5)
    var rows = [];
    while (rows.length < 5) rows.push([]);
    rows[3] = [null, null, null, null, null, 'OASIS LATINOAMERICA'];

    var ss = _makeCfeMockSs({ 'INPUT_CFE': rows });
    var val = readCfeScalar(ss, 'input_serviceName');
    t.assert('reads F4', 'OASIS LATINOAMERICA', val);
  }
});


// =============================================================================
// TEST 2 \u2014 readCfeScalar returns '' when sheet missing
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_SRC_SCALAR_MISSING_SHEET',
  group   : 'unit',
  module  : 'writers_v2/cfe/sourceMap',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'sourceMap', 'chunk7'],
  source  : 'tests_unit/writers_v2/CfeOutputSourceMapTests.gs',
  fn: function (t) {
    t.suite('readCfeScalar: empty string when sheet missing');

    var ss = _makeCfeMockSs({});  // no sheets
    var val = readCfeScalar(ss, 'input_serviceName');
    t.assert('returns empty string', '', val);
  }
});


// =============================================================================
// TEST 3 \u2014 readCfeScalar throws on unknown key
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_SRC_SCALAR_UNKNOWN_KEY',
  group   : 'unit',
  module  : 'writers_v2/cfe/sourceMap',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'sourceMap', 'chunk7'],
  source  : 'tests_unit/writers_v2/CfeOutputSourceMapTests.gs',
  fn: function (t) {
    t.suite('readCfeScalar: throws on unknown srcKey');
    var ss = _makeCfeMockSs({});
    t.assertThrows(
      'unknown key -> throw',
      function () { readCfeScalar(ss, 'TOTALLY_UNKNOWN'); },
      'TOTALLY_UNKNOWN'
    );
  }
});


// =============================================================================
// TEST 4 \u2014 readCfeMonthly returns 12-element array
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_SRC_MONTHLY_READ',
  group   : 'unit',
  module  : 'writers_v2/cfe/sourceMap',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'sourceMap', 'chunk7'],
  source  : 'tests_unit/writers_v2/CfeOutputSourceMapTests.gs',
  fn: function (t) {
    t.suite('readCfeMonthly: reads cols C..N of mapped row');

    // input_total is INPUT_CFE row 37 \u2014 build row[36] with 12 values starting col 3 (index 2)
    var rows = [];
    while (rows.length < 38) rows.push([]);
    rows[36] = [null, null, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200];

    var ss = _makeCfeMockSs({ 'INPUT_CFE': rows });
    var arr = readCfeMonthly(ss, 'input_total');

    t.assert('array length 12', 12, arr.length);
    t.assert('first month',     100, arr[0]);
    t.assert('last month',      1200, arr[11]);
  }
});


// =============================================================================
// TEST 5 \u2014 readCfeMonthly returns 12 zeros when sheet missing
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_SRC_MONTHLY_MISSING_SHEET',
  group   : 'unit',
  module  : 'writers_v2/cfe/sourceMap',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'sourceMap', 'chunk7'],
  source  : 'tests_unit/writers_v2/CfeOutputSourceMapTests.gs',
  fn: function (t) {
    t.suite('readCfeMonthly: returns 12 zeros when sheet missing');

    var ss = _makeCfeMockSs({});
    var arr = readCfeMonthly(ss, 'input_total');
    t.assert('length 12', 12, arr.length);
    for (var i = 0; i < 12; i++) t.assert('zero at ' + i, 0, arr[i]);
  }
});


// =============================================================================
// TEST 6 \u2014 readCfeMonthly throws on unknown key
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_SRC_MONTHLY_UNKNOWN_KEY',
  group   : 'unit',
  module  : 'writers_v2/cfe/sourceMap',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'sourceMap', 'chunk7'],
  source  : 'tests_unit/writers_v2/CfeOutputSourceMapTests.gs',
  fn: function (t) {
    t.suite('readCfeMonthly: throws on unknown srcKey');
    var ss = _makeCfeMockSs({});
    t.assertThrows(
      'unknown key -> throw',
      function () { readCfeMonthly(ss, 'ALSO_BOGUS'); },
      'ALSO_BOGUS'
    );
  }
});


// =============================================================================
// TEST 7 \u2014 CFE_OUT_SRC_V2 contains all expected critical keys
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_SRC_HAS_CRITICAL_KEYS',
  group   : 'unit',
  module  : 'writers_v2/cfe/sourceMap',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'sourceMap', 'chunk7'],
  source  : 'tests_unit/writers_v2/CfeOutputSourceMapTests.gs',
  fn: function (t) {
    t.suite('CFE_OUT_SRC_V2: critical keys present');

    var required = [
      'input_tariffCode', 'input_serviceName', 'input_serviceNumber',
      'input_contractedKw', 'input_interconnMode', 'input_total',
      'csim_total', 'csim_solarKwh', 'csim_pvExportado',
      'bsim_reciboBase', 'bsim_reciboTrasPv', 'bsim_reciboFinal',
      'bsim_ahorroMesCap', 'bsim_ahorroMesDist', 'bsim_ahorroMesVar',
      'bsim_dmaxSinBess', 'bsim_dmaxConBess',
      'bsim_reciboFinalSteady', 'bsim_ahorroCapSteadyAnnual'
    ];
    for (var i = 0; i < required.length; i++) {
      t.assertTrue(
        'key "' + required[i] + '" present',
        CFE_OUT_SRC_V2.hasOwnProperty(required[i])
      );
    }
  }
});


// =============================================================================
// TEST 8 \u2014 Every entry has a valid shape
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_SRC_SHAPE_VALIDITY',
  group   : 'unit',
  module  : 'writers_v2/cfe/sourceMap',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'sourceMap', 'chunk7'],
  source  : 'tests_unit/writers_v2/CfeOutputSourceMapTests.gs',
  fn: function (t) {
    t.suite('CFE_OUT_SRC_V2: every entry has valid shape');

    var validSheets = { 'INPUT_CFE': 1, 'CFE_SIMULATION': 1, 'BESS_SIMULATION': 1 };
    for (var key in CFE_OUT_SRC_V2) {
      if (!CFE_OUT_SRC_V2.hasOwnProperty(key)) continue;
      var e = CFE_OUT_SRC_V2[key];
      t.assertTrue(key + ': has sheet field',         typeof e.sheet === 'string');
      t.assertTrue(key + ': sheet is recognized one', !!validSheets[e.sheet]);
      t.assertTrue(key + ': row is positive int',     Number.isInteger(e.row) && e.row > 0);
      if (e.col !== undefined) {
        t.assertTrue(key + ': col is positive int', Number.isInteger(e.col) && e.col > 0);
      }
    }
  }
});


// =============================================================================
// TEST 9 \u2014 _testOpts.srcMap override works (isolation seam)
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_SRC_TESTOPTS_OVERRIDE',
  group   : 'unit',
  module  : 'writers_v2/cfe/sourceMap',
  scenarios: [],
  tags    : ['writers_v2', 'cfe', 'sourceMap', 'chunk7'],
  source  : 'tests_unit/writers_v2/CfeOutputSourceMapTests.gs',
  fn: function (t) {
    t.suite('readCfeScalar: _testOpts.srcMap override');

    var rows = [];
    while (rows.length < 3) rows.push([]);
    rows[2] = ['x', 'y', 'z'];  // row 3 cols A/B/C

    var ss = _makeCfeMockSs({ 'CUSTOM_SHEET': rows });
    var customMap = {
      myCustomKey: { sheet: 'CUSTOM_SHEET', row: 3, col: 3 }
    };
    var val = readCfeScalar(ss, 'myCustomKey', { srcMap: customMap });
    t.assert('reads via custom map', 'z', val);
  }
});
