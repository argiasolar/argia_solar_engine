// =============================================================================
// ARGIA ENGINE v2 -- File: tests_unit/writers_v2/WriteInstallationV2Tests.gs
// -----------------------------------------------------------------------------
// CHUNK 5 — Unit tests for writers_v2/WriteInstallationV2.gs.
//
// After Chunk 5 v2 of the spec (match legacy 1:1), the template owns
// col A labels and col C notes. The writer ONLY populates col B values
// and the summary/section/MH/line-item zones.
//
// COVERAGE
//   T1  — Throws when INSTALLATION_v2 sheet missing
//   T2  — Driver-block VALUES in col B rows 5-34 (writer does NOT write col A)
//   T3  — Factor-selection rows 24-31 populated from drivers.factorSelections
//   T4  — BLENDED_LABOR_RATE row 32 = totals.avgRateMxnMH
//   T5  — Percent rows 33-34 = drivers.contingencyPct / .insurancePct (0.05/0.03 decimals)
//   T6  — Summary block at rows 5-12 cols F-G
//   T7  — Section grid header row 14 + 9 section rows
//   T8  — Man-hours breakdown header + role rows + TOTAL row
//   T9  — Line-item zone: section banner, items, subtotal, blank, then next section
//   T10 — Zero-cost line items get #F5F5F5 background
//   T11 — Grand total row populated after sections
//   T12 — Legend present
//   T13 — Driver-map graceful no-op when sheet missing
//   T14 — Driver-map updates values when sheet has headers
//   T15 — Null result handled gracefully (skip + log warning)
//   T16 — Writer does NOT write col A driver-key labels (template's job)
// =============================================================================


// -----------------------------------------------------------------------------
// Multi-sheet mock spreadsheet
// -----------------------------------------------------------------------------
function _makeInstallWriterMockSpreadsheet(opts) {
  opts = opts || {};
  var sheets = {};

  function makeSheet(name, sopts) {
    sopts = sopts || {};
    var writes = [];
    var clearCount = 0;
    var seededData = sopts.seededData || null;

    function makeRange(row, col, numRows, numCols) {
      numRows = numRows || 1;
      numCols = numCols || 1;
      var proxy = {
        _row: row, _col: col,
        setValue: function(v) {
          writes.push({ type:'value', row:row, col:col, value:v });
          return proxy;
        },
        setValues: function(vs) {
          if (vs && vs.length && vs[0] && vs[0].length) {
            for (var ri = 0; ri < vs.length; ri++) {
              for (var ci = 0; ci < vs[ri].length; ci++) {
                writes.push({ type:'value', row:row+ri, col:col+ci, value:vs[ri][ci] });
              }
            }
          }
          return proxy;
        },
        getValues: function() {
          if (seededData) {
            var out = [];
            for (var ri = 0; ri < numRows; ri++) {
              var rrow = [];
              for (var ci = 0; ci < numCols; ci++) {
                var sr = seededData[row + ri - 1];
                var v = (sr && sr[col + ci - 1] !== undefined) ? sr[col + ci - 1] : '';
                rrow.push(v);
              }
              out.push(rrow);
            }
            return out;
          }
          var blank = [];
          for (var rj = 0; rj < numRows; rj++) {
            var blankrow = [];
            for (var cj = 0; cj < numCols; cj++) blankrow.push('');
            blank.push(blankrow);
          }
          return blank;
        },
        setFormula: function(v) { writes.push({ type:'formula', row:row, col:col, value:v }); return proxy; },
        clearContent: function() { writes.push({ type:'clearContent', row:row, col:col }); return proxy; },
        clearFormat:  function() { writes.push({ type:'clearFormat',  row:row, col:col }); return proxy; },
        setBackground: function(v) { writes.push({ type:'bg', row:row, col:col, value:v }); return proxy; },
        setFontColor:  function(v) { writes.push({ type:'fc', row:row, col:col, value:v }); return proxy; },
        setFontFamily: function()  { return proxy; },
        setFontSize:   function(v) { writes.push({ type:'fs', row:row, col:col, value:v }); return proxy; },
        setFontWeight: function(v) { writes.push({ type:'fw', row:row, col:col, value:v }); return proxy; },
        setFontStyle:  function(v) { writes.push({ type:'fst', row:row, col:col, value:v }); return proxy; },
        setHorizontalAlignment: function() { return proxy; },
        setVerticalAlignment:   function() { return proxy; },
        setNumberFormat: function(v) { writes.push({ type:'numfmt', row:row, col:col, value:v }); return proxy; },
        setBorder: function() { return proxy; },
        setDataValidation: function() { return proxy; },
        merge: function() { return proxy; },
        breakApart: function() { return proxy; },
        setWrap: function() { return proxy; }
      };
      return proxy;
    }

    return {
      _name: name,
      _writes: writes,
      _clearCount: function() { return clearCount; },
      getRange: function(row, col, nRows, nCols) {
        return makeRange(row, col, nRows || 1, nCols || 1);
      },
      getDataRange: function() {
        if (!seededData) return { getValues: function() { return [[]]; } };
        return { getValues: function() { return seededData.map(function(r) { return r.slice(); }); } };
      },
      setRowHeight: function() {},
      setHiddenGridlines: function() {},
      setFrozenRows: function() {},
      setFrozenColumns: function() {},
      clear: function() { clearCount++; },
      clearConditionalFormatRules: function() {},
      setConditionalFormatRules: function() {},
      getConditionalFormatRules: function() { return []; },
      getLastRow: function() { return seededData ? seededData.length : 0; }
    };
  }

  if (opts.sheets) {
    Object.keys(opts.sheets).forEach(function(name) {
      sheets[name] = makeSheet(name, opts.sheets[name]);
    });
  }

  return {
    _sheets: sheets,
    getSheetByName: function(name) { return sheets[name] || null; },
    insertSheet: function(name) { sheets[name] = makeSheet(name, {}); return sheets[name]; }
  };
}


function _writeAtInstV2(sheet, row, col, type) {
  type = type || 'value';
  if (!sheet || !sheet._writes) return null;
  for (var i = sheet._writes.length - 1; i >= 0; i--) {
    var w = sheet._writes[i];
    if (w.type === type && w.row === row && w.col === col) return w.value;
  }
  return null;
}

function _countWritesInstV2(sheet, predicate) {
  if (!sheet || !sheet._writes) return 0;
  var c = 0;
  for (var i = 0; i < sheet._writes.length; i++) {
    if (predicate(sheet._writes[i])) c++;
  }
  return c;
}


// -----------------------------------------------------------------------------
// Fixtures — values match a small PV project. Percent fields are DECIMALS
// (0.05 = 5%) per InputMap convention.
// -----------------------------------------------------------------------------
function _makeStandardInstResult() {
  return {
    items: [
      { item: { section:'AC', subsection:'main feeder', id:'AC-01',
                description:'pull AC feeder', costType:'LABOR_PRODUCTIVITY',
                driverKey:'AC_CABLE_M', driverUom:'m', productivityRate:25,
                laborRole:'electrician', equipKey:'', appliesToInstType:'STD',
                minQty:0, active:true, notes:'' },
        factorResult: { values:[1, 1, null, null], combined:1 },
        driverQtyVal: 200, roleRateVal: 250, equipRateVal: 0,
        mhComputed: 8, laborMxn: 2000, equipDays: 0,
        equipMxn: 0, otherMxn: 0, totalMxn: 2000,
        formulaTrace: 'AC feeder' },
      { item: { section:'AC', subsection:'breaker', id:'AC-02',
                description:'install main breaker', costType:'LABOR_FIXED_MH',
                driverKey:'AC_TERMINATION_COUNT', driverUom:'pcs',
                productivityRate:0, laborRole:'electrician',
                equipKey:'', appliesToInstType:'STD', minQty:2,
                active:true, notes:'' },
        factorResult: { values:[1, null, null, null], combined:1 },
        driverQtyVal: 6, roleRateVal: 250, equipRateVal: 0,
        mhComputed: 4, laborMxn: 1000, equipDays: 0,
        equipMxn: 0, otherMxn: 0, totalMxn: 1000,
        formulaTrace: 'main breaker' },
      { item: { section:'DC', subsection:'cable', id:'DC-01',
                description:'pull DC cable', costType:'LABOR_PRODUCTIVITY',
                driverKey:'DC_CABLE_M', driverUom:'m', productivityRate:30,
                laborRole:'electrician', equipKey:'', appliesToInstType:'STD',
                minQty:0, active:true, notes:'no cable' },
        factorResult: { values:[null, null, null, null], combined:0 },
        driverQtyVal: 0, roleRateVal: 250, equipRateVal: 0,
        mhComputed: 0, laborMxn: 0, equipDays: 0,
        equipMxn: 0, otherMxn: 0, totalMxn: 0,
        formulaTrace: '' },
      { item: { section:'INDIRECT', subsection:'contingency', id:'IN-01',
                description:'project contingency', costType:'PERCENT_OF_LABOR_EQUIP',
                driverKey:'PROJECT_ONE', driverUom:'project',
                productivityRate:0, laborRole:'', baseOtherRate:0,
                equipKey:'', appliesToInstType:'STD', minQty:0,
                active:true, notes:'' },
        factorResult: { values:[null, null, null, null], combined:1 },
        driverQtyVal: 1, roleRateVal: 0, equipRateVal: 0,
        mhComputed: 0, laborMxn: 0, equipDays: 0,
        equipMxn: 0, otherMxn: 300, totalMxn: 300,
        formulaTrace: '' }
    ],
    sectionTotals: {
      'AC':       { labor: 3000, equip: 0, other: 0,   total: 3000 },
      'DC':       { labor: 0,    equip: 0, other: 0,   total: 0    },
      'INDIRECT': { labor: 0,    equip: 0, other: 300, total: 300  }
    },
    totals: {
      labor: 3000, equip: 0, other: 300, total: 3300,
      totalMH: 12, perKwp: 660, perWp: 0.66, perM2: 0,
      impliedDays: 1.5, avgRateMxnMH: 250
    },
    roleAgg: { 'electrician': { mh: 12, rate: 250, cost: 3000 } }
  };
}

function _makeStandardInstDrivers() {
  return {
    projectDcWp: 5000, projectDcKwp: 5, projectAcKw: 4.5,
    moduleCount: 10, inverterCount: 1, stringCount: 2,
    arrayGrossAreaM2: 25, arrayNetAreaM2: 22, roofAreaM2: 60,
    dcCableM: 0, acCableM: 200, trayM: 0, conduitM: 30,
    groundingM: 50, interconnectionPts: 1, anchorCount: 40,
    crewSize: 3, estProjectDays: 2, crewDays: 6,
    workHeightM: 6, acTerminationCount: 6, dcConnectorCount: 20,
    contingencyPct: 0.05,   // DECIMAL (5%)
    insurancePct:   0.03,   // DECIMAL (3%)
    installationType: 'ROOF',
    factorSelections: {
      'INSTALLATION_TYPE'    : 'ROOF',
      'ACCESS_DIFFICULTY'    : 'MEDIUM',
      'SITE_HSE_CLASS'       : 'STANDARD',
      'ENERGIZED_TIE_IN'     : 'NO',
      'SITE_DISTANCE_CLASS'  : 'LOCAL',
      'NIGHT_WORK_REQUIRED'  : 'NO',
      'PROJECT_COMPLEXITY'   : 'MEDIUM',
      'WEATHER_PROFILE'      : 'DRY'
    }
  };
}


// =============================================================================
// TESTS
// =============================================================================

// T1
registerTest({
  id: 'UNIT_WRITERS_V2_INST_THROWS_IF_NO_SHEET',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: throws when INSTALLATION_v2 sheet missing');
    var ss = _makeInstallWriterMockSpreadsheet({});
    t.assertThrows('clean error message',
      function() {
        writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers());
      },
      'INSTALLATION_v2 sheet not found');
  }
});

// T2
registerTest({
  id: 'UNIT_WRITERS_V2_INST_DRIVER_VALUES',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: numeric driver values in col B rows 5-23');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    // Driver order: rows 5-23 are numeric drivers (19 entries)
    t.assert('B5  = projectDcWp 5000',   5000, _writeAtInstV2(sheet, 5,  2));
    t.assert('B6  = projectDcKwp 5',     5,    _writeAtInstV2(sheet, 6,  2));
    t.assert('B7  = projectAcKw 4.5',    4.5,  _writeAtInstV2(sheet, 7,  2));
    t.assert('B8  = moduleCount 10',     10,   _writeAtInstV2(sheet, 8,  2));
    t.assert('B11 = arrayGrossAreaM2 25', 25,  _writeAtInstV2(sheet, 11, 2));
    t.assert('B15 = acCableM 200',       200,  _writeAtInstV2(sheet, 15, 2));
    t.assert('B21 = crewSize 3',         3,    _writeAtInstV2(sheet, 21, 2));
    t.assert('B22 = estProjectDays 2',   2,    _writeAtInstV2(sheet, 22, 2));
    t.assert('B23 = workHeightM 6',      6,    _writeAtInstV2(sheet, 23, 2));
  }
});

// T3
registerTest({
  id: 'UNIT_WRITERS_V2_INST_FACTOR_SELECTIONS',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: factor selections in col B rows 24-31');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    t.assert('B24 INSTALLATION_TYPE = ROOF',         'ROOF',     _writeAtInstV2(sheet,24,2));
    t.assert('B25 ACCESS_DIFFICULTY = MEDIUM',       'MEDIUM',   _writeAtInstV2(sheet,25,2));
    t.assert('B26 SITE_HSE_CLASS = STANDARD',        'STANDARD', _writeAtInstV2(sheet,26,2));
    t.assert('B27 ENERGIZED_TIE_IN = NO',            'NO',       _writeAtInstV2(sheet,27,2));
    t.assert('B28 SITE_DISTANCE_CLASS = LOCAL',      'LOCAL',    _writeAtInstV2(sheet,28,2));
    t.assert('B29 NIGHT_WORK_REQUIRED = NO',         'NO',       _writeAtInstV2(sheet,29,2));
    t.assert('B30 PROJECT_COMPLEXITY = MEDIUM',      'MEDIUM',   _writeAtInstV2(sheet,30,2));
    t.assert('B31 WEATHER_PROFILE = DRY',            'DRY',      _writeAtInstV2(sheet,31,2));
  }
});

// T4
registerTest({
  id: 'UNIT_WRITERS_V2_INST_BLENDED_LABOR_RATE',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: BLENDED_LABOR_RATE row 32 = totals.avgRateMxnMH');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    t.assert('B32 = 250 (avgRateMxnMH)', 250, _writeAtInstV2(sheet, 32, 2));
  }
});

// T5
registerTest({
  id: 'UNIT_WRITERS_V2_INST_PERCENT_ROWS',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: percent rows 33-34 = decimal values');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    t.assert('B33 = contingencyPct 0.05',  0.05, _writeAtInstV2(sheet, 33, 2));
    t.assert('B34 = insurancePct 0.03',    0.03, _writeAtInstV2(sheet, 34, 2));
  }
});

// T6
registerTest({
  id: 'UNIT_WRITERS_V2_INST_SUMMARY_BLOCK',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: summary block at rows 5-12 cols F-G');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    t.assert('F5 = TOTAL LABOR MXN', 'TOTAL LABOR MXN', _writeAtInstV2(sheet, 5, 6));
    t.assert('G5 = 3000',            3000,              _writeAtInstV2(sheet, 5, 7));
    t.assert('F7 = TOTAL OTHER MXN', 'TOTAL OTHER MXN', _writeAtInstV2(sheet, 7, 6));
    t.assert('G7 = 300',             300,               _writeAtInstV2(sheet, 7, 7));
    t.assert('F9 = GRAND TOTAL MXN', 'GRAND TOTAL MXN', _writeAtInstV2(sheet, 9, 6));
    t.assert('G9 = 3300',            3300,              _writeAtInstV2(sheet, 9, 7));
    t.assert('F10 = MXN / kWp',      'MXN / kWp',       _writeAtInstV2(sheet,10, 6));
    t.assert('G10 = 660',            660,               _writeAtInstV2(sheet,10, 7));
  }
});

// T7
registerTest({
  id: 'UNIT_WRITERS_V2_INST_SECTION_GRID',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: section grid header + 9 rows');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    t.assert('F14 = SECTION', 'SECTION', _writeAtInstV2(sheet, 14, 6));
    t.assert('J14 = TOTAL',   'TOTAL',   _writeAtInstV2(sheet, 14,10));
    t.assert('F15 = AC',      'AC',      _writeAtInstV2(sheet, 15, 6));
    t.assert('G15 = 3000',    3000,      _writeAtInstV2(sheet, 15, 7));
    t.assert('J15 = 3000',    3000,      _writeAtInstV2(sheet, 15,10));
    t.assert('F23 = INDIRECT','INDIRECT',_writeAtInstV2(sheet, 23, 6));
    t.assert('J23 = 300',     300,       _writeAtInstV2(sheet, 23,10));
  }
});

// T8
registerTest({
  id: 'UNIT_WRITERS_V2_INST_MH_BREAKDOWN',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: man-hours breakdown header + roles + TOTAL');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    t.assert('F24 = MAN-HOURS BREAKDOWN', 'MAN-HOURS BREAKDOWN', _writeAtInstV2(sheet,24, 6));
    t.assert('G24 = TOTAL MH',            'TOTAL MH',            _writeAtInstV2(sheet,24, 7));
    t.assert('F25 = electrician',         'electrician',         _writeAtInstV2(sheet,25, 6));
    t.assert('G25 = 12 MH',               12,                    _writeAtInstV2(sheet,25, 7));
    t.assert('F26 = TOTAL',               'TOTAL',               _writeAtInstV2(sheet,26, 6));
    t.assert('G26 = 12',                  12,                    _writeAtInstV2(sheet,26, 7));
  }
});

// T9
registerTest({
  id: 'UNIT_WRITERS_V2_INST_LINE_ITEMS',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: line-item zone (rows 40+)');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    t.assert('A40 = SECTION header', 'SECTION', _writeAtInstV2(sheet, 40, 1));
    t.assert('Y40 = TOTAL MXN header', 'TOTAL MXN', _writeAtInstV2(sheet, 40, 25));
    var row41A = _writeAtInstV2(sheet, 41, 1);
    t.assertTrue('row 41 col A is AC banner',
      String(row41A).indexOf('AC') !== -1);
    t.assert('A42 = AC (item row)', 'AC', _writeAtInstV2(sheet, 42, 1));
    t.assert('C42 = AC-01',         'AC-01', _writeAtInstV2(sheet, 42, 3));
    t.assert('Y42 = 2000',          2000,    _writeAtInstV2(sheet, 42, 25));
    t.assert('D44 = AC subtotal',   'AC subtotal', _writeAtInstV2(sheet, 44, 4));
    t.assert('Y44 = 3000',          3000, _writeAtInstV2(sheet, 44, 25));
  }
});

// T10
registerTest({
  id: 'UNIT_WRITERS_V2_INST_ZERO_COST_STYLING',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: zero-cost item rows are greyed');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    // DC-01 zero-cost row should have #F5F5F5 bg.
    // Row depends on dynamic counts: AC has 2 items + banner + subtotal + blank = rows 41,42,43,44,45
    // DC banner row 46, DC-01 item row 47.
    var found = false;
    sheet._writes.forEach(function(w) {
      if (w.type === 'bg' && w.row === 47 && w.value === '#F5F5F5') found = true;
    });
    t.assertTrue('zero-cost DC-01 row 47 has #F5F5F5 bg', found);
  }
});

// T11
registerTest({
  id: 'UNIT_WRITERS_V2_INST_GRAND_TOTAL',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: grand total row populated');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    var grandRow = null;
    sheet._writes.forEach(function(w) {
      if (w.type === 'value' && w.col === 4 && w.value === 'GRAND TOTAL') grandRow = w.row;
    });
    t.assertTrue('GRAND TOTAL row exists', grandRow !== null);
    if (grandRow !== null) {
      t.assert('GRAND TOTAL col Y = 3300', 3300, _writeAtInstV2(sheet, grandRow, 25));
    }
  }
});

// T12
registerTest({
  id: 'UNIT_WRITERS_V2_INST_LEGEND',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: legend rows after grand total');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    var legendFound = false;
    var laborProdFound = false;
    sheet._writes.forEach(function(w) {
      if (w.type === 'value') {
        if (w.col === 1 && String(w.value).indexOf('LEGEND') === 0) legendFound = true;
        if (w.value === 'LABOR_PRODUCTIVITY') laborProdFound = true;
      }
    });
    t.assertTrue('LEGEND header present',           legendFound);
    t.assertTrue('LABOR_PRODUCTIVITY item present', laborProdFound);
  }
});

// T13
registerTest({
  id: 'UNIT_WRITERS_V2_INST_DRIVER_MAP_NO_SHEET',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: driver-map no-op when sheet missing');
    var ss = _makeInstallWriterMockSpreadsheet({});
    var threw = false;
    try {
      writeInstallationDriverMapV2(ss, _makeStandardInstDrivers(),
                                    _makeStandardInstResult(), { skipFlush: true });
    } catch (e) { threw = true; }
    t.assertFalse('does not throw on missing sheet', threw);
  }
});

// T14
registerTest({
  id: 'UNIT_WRITERS_V2_INST_DRIVER_MAP_UPDATES',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: driver-map updates values for known keys');
    var ss = _makeInstallWriterMockSpreadsheet({
      sheets: {
        '95_INSTALL_DRIVER_MAP_v2': {
          seededData: [
            ['DRIVER_KEY', 'VALUE', 'FACTOR_GROUP', 'SELECTED_KEY', 'VALUE'],
            ['PROJECT_DC_KWP', '',  '',              '',            ''],
            ['MODULE_COUNT',   '',  '',              '',            ''],
            ['CREW_SIZE',      '',  '',              '',            ''],
            ['UNKNOWN_KEY',    '',  '',              '',            ''],
            ['',               '',  'INSTALLATION_TYPE', '',        '']
          ]
        }
      }
    });
    writeInstallationDriverMapV2(ss, _makeStandardInstDrivers(),
                                  _makeStandardInstResult(), { skipFlush: true });
    var sheet = ss._sheets['95_INSTALL_DRIVER_MAP_v2'];
    t.assert('row 2 col B = projectDcKwp 5', 5,  _writeAtInstV2(sheet, 2, 2));
    t.assert('row 3 col B = moduleCount 10', 10, _writeAtInstV2(sheet, 3, 2));
    t.assert('row 4 col B = crewSize 3',     3,  _writeAtInstV2(sheet, 4, 2));
    t.assert('row 5 col B unchanged',        null, _writeAtInstV2(sheet, 5, 2));
    t.assert('row 6 col D = ROOF',           'ROOF', _writeAtInstV2(sheet, 6, 4));
  }
});

// T15
registerTest({
  id: 'UNIT_WRITERS_V2_INST_NULL_RESULT',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: null result skips gracefully');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    var threw = false;
    var loggedWarning = false;
    try {
      writeInstallationV2(ss, null, _makeStandardInstDrivers(), {
        skipFlush: true,
        engineLogFn: function(_, __, level, ___) { if (level === 'WARNING') loggedWarning = true; }
      });
    } catch (e) { threw = true; }
    t.assertFalse('does not throw on null result', threw);
    t.assertTrue('warning was logged', loggedWarning);
    t.assert('no value writes', 0,
      _countWritesInstV2(ss._sheets['INSTALLATION_v2'],
        function(w) { return w.type === 'value'; }));
  }
});

// T16 — writer no longer writes col A driver-key labels (template owns those)
registerTest({
  id: 'UNIT_WRITERS_V2_INST_WRITER_DOES_NOT_WRITE_LABELS',
  group: 'unit', module: 'writers_v2/installation', scenarios: [],
  tags: ['writers', 'installation', 'v2', 'chunk5'],
  source: 'tests_unit/writers_v2/WriteInstallationV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('writers_v2/installation: writer does NOT write col A driver-key labels');
    var ss = _makeInstallWriterMockSpreadsheet({ sheets: { 'INSTALLATION_v2': {} } });
    writeInstallationV2(ss, _makeStandardInstResult(), _makeStandardInstDrivers(),
                        { skipFlush: true });
    var sheet = ss._sheets['INSTALLATION_v2'];
    // For rows 5-34 (driver block), col A (key column) should have NO value writes
    // from the writer. Template seeds them.
    var labelWritesInDriverBlock = 0;
    sheet._writes.forEach(function(w) {
      if (w.type === 'value' && w.col === 1 && w.row >= 5 && w.row <= 34) {
        labelWritesInDriverBlock++;
      }
    });
    t.assert('writer wrote 0 col-A cells in rows 5-34', 0, labelWritesInDriverBlock);
  }
});
