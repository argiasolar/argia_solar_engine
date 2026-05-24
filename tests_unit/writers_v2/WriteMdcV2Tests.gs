// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/WriteMdcV2Tests.gs
// -----------------------------------------------------------------------------
// CHUNK 1 — writeMdcV2 unit tests.
//
// COVERAGE
//   Pure unit tests over the data-handling logic of writeMdcV2. Uses a mock
//   sheet that captures every cell write into a flat log, then asserts:
//     - the right rows got the right values for §0 GENERALES
//     - issuance-status logic produces the expected ESTADO string
//     - BESS section writes when bessEnabled, skips when not
//     - normalizeStatus + stripStatus inline helpers behave correctly
//
// WHAT IS NOT COVERED HERE
//   - End-to-end numeric parity with CULLIGAN (that's REG_CULLIGAN_BASELINE_V2)
//   - Side-by-side visual comparison vs legacy MDC (manual eyeball)
//   - Template idempotency (that's the template-tier integration test)
//
// FIXTURES
//   These tests use minimal hand-built `inp`, `panel`, `invBank`, `dc`, `ac`,
//   `lay`, `nom`, `bessResult` objects that satisfy writeMdcV2's contract.
//   They're not real engine outputs; they're shape-correct mocks.
//
// CHUNK TAG
//   All tests tagged 'chunk1' so they show up under
//   ▶ Run Tests for Current Chunk while ACTIVE_CHUNK_TAG === 'chunk1'.
// =============================================================================


// ---------------------------------------------------------------------------
// _makeMdcMockSpreadsheet
// ---------------------------------------------------------------------------
//   Returns a mock SS that has one sheet (MDC_v2). The sheet records every
//   setValue / setFormula / setNote call into ss._sheet._writes so the test
//   can assert on what landed where.
// ---------------------------------------------------------------------------
function _makeMdcMockSpreadsheet() {
  var writes = [];

  function makeRange(row, col, numRows, numCols) {
    var isMulti = (numRows > 1) || (numCols > 1);
    var key = 'R' + row + 'C' + col +
              (isMulti ? ':R' + (row + numRows - 1) + 'C' + (col + numCols - 1) : '');
    var proxy = {
      _rangeKey: key,
      _row: row,
      _col: col,
      setValue: function(v) { writes.push({type:'value', row:row, col:col, range:key, value:v}); return proxy; },
      setFormula: function(v) { writes.push({type:'formula', row:row, col:col, range:key, value:v}); return proxy; },
      setNote: function(v) { writes.push({type:'note', row:row, col:col, range:key, value:v}); return proxy; },
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

  var sheet = {
    _writes: writes,
    getRange: function(row, col, numRows, numCols) {
      return makeRange(row, col, numRows || 1, numCols || 1);
    },
    setRowHeight: function() {},
    setColumnWidth: function() {},
    setHiddenGridlines: function() {},
    setFrozenRows: function() {},
    setFrozenColumns: function() {},
    clear: function() {},
    clearConditionalFormatRules: function() {},
    setConditionalFormatRules: function() {},
    getConditionalFormatRules: function() { return []; }
  };

  return {
    _sheet: sheet,
    getSheetByName: function(name) {
      return (name === 'MDC_v2') ? sheet : null;
    },
    insertSheet: function() { return sheet; }
  };
}


// Look up the value that was setValue'd at a specific (row, col).
// Last write wins (matches Sheets behavior).
function _writeAt(writes, row, col, type) {
  type = type || 'value';
  for (var i = writes.length - 1; i >= 0; i--) {
    var w = writes[i];
    if (w.type === type && w.row === row && w.col === col) return w.value;
  }
  return null;
}


// ---------------------------------------------------------------------------
// _makeFixtures
// ---------------------------------------------------------------------------
//   Returns a minimal set of fixture objects that writeMdcV2 expects.
//   Numbers are not from any real project — they're chosen to be obviously
//   distinct so assertion failures point at the right field.
// ---------------------------------------------------------------------------
function _makeFixtures() {
  var inp = {
    projectName: 'UNIT_TEST_PROJ',
    clientName: 'UNIT_TEST_CLIENT',
    panelQty: 100,
    totalInverters: 2,
    modsPerString: 20,
    stringsTotal: 5,
    minTemp: -5,
    maxTemp: 40,
    avgTemp: 25,
    roofClearanceMm: 200,
    distInverter: 30,
    stationCorridorM: 15,
    distAcProt: 10,
    distGrid: 20,
    feederExtraM: 5,
    powerFactor: 0.95,
    projectRevision: '01',
    areaRequired: 300,
    availableSpace: 500,
    panelAreaM2: 2.2,
    walkwayFactor: 1.2,
    rowPitch: 4,
    layoutRows: 5,
    dcSpareFactor: 1.1,
    acSpareFactor: 1.1
  };

  var panel = {
    'PANEL_MODEL': 'TEST_PANEL_500W',
    'PANEL_POWER_W': 500,
    'PANEL_VOC_V': 50,
    'PANEL_VMP_V': 42,
    'PANEL_ISC_A': 12,
    'PANEL_TEMP_PMAX': -0.003,
    'PANEL_VERIFIED_ON': '2026-05-01',
    'PROD_ID': 'TST-001'
  };

  var invBank = [{
    model: 'TEST_INV_60K',
    invId: 'INV-001',
    qty: 2,
    acKw: 60,
    voltage: 480,
    phase: 3,
    topology: 'string',
    mdcReady: true,
    mpptVmin: 200,
    maxDcV: 1000,
    stringsAssigned: 5,
    totalDcInputs: 12
  }];

  var dc = {
    dcKwp: 50,
    acKwTotal: 120,
    dcAcRatio: 0.417,
    dcAcRatioStatus: '[OK]',
    isc: 12,
    iDesignPerStr: 18.75,
    Ft_dc: 0.91,
    Fag_dc: 1.0,
    ambientDC: 40,
    roofAdder: 15,
    totalDCCables: 10,
    ampReqDC: 20.6,
    conductorDC: 10,
    areaConDC: 5.26,
    ocpdDC: 25,
    ocpdDCPass: true,
    egcDC: 10,
    vdropDC: 0.012,
    vdropDCFail: false,
    vdropDCReview: false,
    conduitDC: 0.75,
    dcLength: 45,
    totalDCInsArea: 60,
    vString: 800,
    resultDC: '[PASS]',
    vocColdString: 1020,
    vocColdPerMod: 51,
    vmpHotString: 750,
    vmpHotPerMod: 37.5,
    minMods: 7,
    maxMods: 19,
    bifacial: false,
    dc01Pass: true,
    dc02Pass: true,
    str01Pass: true,
    str02Pass: true,
    str03Pass: true,
    dc09Pass: true,
    dc01Results: [{ invModel: 'TEST_INV_60K', vocCold: 1020, maxDcV: 1000, pass: true }],
    dc02Results: [{ invModel: 'TEST_INV_60K', vmpHot: 750, mpptVmin: 200, pass: true }],
    str02Results: [{
      invModel: 'TEST_INV_60K', stringsAssigned: 5, stringsAvailable: 12,
      totalDcInputs: 12, qty: 2, strPerMppt: 1.25, mpptCapacity: 2,
      pass: true, unevenLoading: false, mpptOverload: false
    }],
    str02UnevenWarnings: [],
    str03Results: [{
      invModel: 'TEST_INV_60K', skipped: false,
      iDesignIntoMppt: 18.75, iOpLimit: 30, passOp: true,
      iScIntoMppt: 15, iScLimit: 20, passSc: true
    }]
  };

  var ac = {
    iTotalAC: 144.4, mainBreaker: 200, parallelRuns: 1, iPerRun: 144.4,
    condMain: 1, areaConMain: 42.4, egcMain: 6, vdropFeeder: 0.008,
    vdropFeederPass: true, conduitMain: 2.5, apparentPower: 126.3,
    apparentWith20pct: 151.6, transformer: 200, transformerPass: true,
    resultFeeder: '[PASS]', mainVoltage: 480, ampReqMain: 158.7,
    Ft_main: 0.91, Fag_main: 1.0, feederLen: 35, totalInsMain: 80,
    primary: {
      model: 'TEST_INV_60K', iNom: 72.2, ocpd: 100, ocpdReq: 90.25,
      ocpdPass: true, Ft_ac: 0.91, Fag_ac: 1.0, ampReqAC: 79.3,
      conductor: 3, cuAreaMm2: 26.7, egc: 8, vdropAC: 0.005,
      vdropACPass: true, conduit: 1.5, totalInsArea: 30,
      acLenInv: 40, status: 'PASS'
    },
    perInverter: [{
      qty: 2, model: 'TEST_INV_60K', iNom: 72.2, ocpd: 100,
      conductor: 3, conduit: 1.5, vdropAC: 0.005, status: 'PASS'
    }]
  };

  var lay = {
    grossArea: 264, arrayWidth: 22, arrayLength: 12,
    bom: { dcCableM: 495, mainFeederCableM: 105 },
    statusScaling: '[PASS]'
  };

  var nom = {
    bifacialFactor: 1.0, currentFactor1: 1.25, currentFactor2: 1.5625,
    cuResistivity: 0.0172, dcVdropHard: 0.03, dcVdropTarget: 0.015,
    acVdropTarget: 0.02, fillRatioOver2: 0.4, transformerMargin: 0.20,
    maxParallelRunA: 300, roofClearanceLow: 100
  };

  return {
    inp: inp, panel: panel, invBank: invBank, dc: dc, ac: ac,
    lay: lay, nom: nom, bessResult: null
  };
}


// =============================================================================
// TEST: PV-only run writes the expected §0 GENERALES values
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_MDC_SEC0_GENERALES',
  group   : 'unit',
  module  : 'writers_v2/mdc',
  scenarios: [],
  tags    : ['writers_v2', 'mdc', 'chunk1'],
  source  : 'tests_unit/writers_v2/WriteMdcV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/mdc: §0 GENERALES writes');

    var f = _makeFixtures();
    var ss = _makeMdcMockSpreadsheet();
    writeMdcV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, f.bessResult);
    var w = ss._sheet._writes;

    t.assert('PROJECT row (7) col C = projectName',
      'UNIT_TEST_PROJ', _writeAt(w, MDC_ROW.PROJECT, MC.VALUE));
    t.assert('CLIENT row (8) col C = clientName',
      'UNIT_TEST_CLIENT', _writeAt(w, MDC_ROW.CLIENT, MC.VALUE));
    // Numeric inputs flow through stripStatus -> String(); the writer's
    // contract since legacy is to write stringified numbers, NOT raw numbers,
    // for these fields. Sheets coerces back to numeric on display.
    t.assert('QTY_MODULES row (11) col C = "100"',
      '100', _writeAt(w, MDC_ROW.QTY_MODULES, MC.VALUE));
    t.assert('QTY_INVERTERS row (12) col C = "2"',
      '2', _writeAt(w, MDC_ROW.QTY_INVERTERS, MC.VALUE));
    t.assert('MODS_PER_STRING row (13) col C = "20"',
      '20', _writeAt(w, MDC_ROW.MODS_PER_STRING, MC.VALUE));
    t.assert('DC_KW row (15) col C = "50.00" (formatted)',
      '50.00', _writeAt(w, MDC_ROW.DC_KW, MC.VALUE));
    t.assert('AC_KW row (16) col C = "120.00" (formatted)',
      '120.00', _writeAt(w, MDC_ROW.AC_KW, MC.VALUE));
    t.assert('DC_AC_RATIO row (17) col C = "0.417" (3-decimal)',
      '0.417', _writeAt(w, MDC_ROW.DC_AC_RATIO, MC.VALUE));
  }
});


// =============================================================================
// TEST: issuance status is PASS when no critical fails, no major flags
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_MDC_ISSUANCE_PASS',
  group   : 'unit',
  module  : 'writers_v2/mdc',
  scenarios: [],
  tags    : ['writers_v2', 'mdc', 'chunk1'],
  source  : 'tests_unit/writers_v2/WriteMdcV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/mdc: clean run -> EMITTABLE');

    var f = _makeFixtures();
    var ss = _makeMdcMockSpreadsheet();
    writeMdcV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, f.bessResult);
    var w = ss._sheet._writes;

    var emissionLabel = _writeAt(w, MDC_ROW.EMISSION_STATUS, MC.LABEL);
    t.assertTrue('emission row 5 col B contains "EMITTABLE"',
      typeof emissionLabel === 'string' && emissionLabel.indexOf('EMITTABLE') !== -1);
    t.assertTrue('emission row says all checks passed',
      typeof emissionLabel === 'string'
      && emissionLabel.indexOf('Todos los checks NOM aprobados') !== -1);

    // FLAG_FINAL row (72) col C = the issuance verdict
    var finalVerdict = _writeAt(w, MDC_ROW.FLAG_FINAL, MC.VALUE);
    t.assert('FLAG_FINAL value = "EMITTABLE"', 'EMITTABLE', finalVerdict);
  }
});


// =============================================================================
// TEST: a critical DC fail flips the issuance to BLOCKED
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_MDC_ISSUANCE_BLOCKED',
  group   : 'unit',
  module  : 'writers_v2/mdc',
  scenarios: [],
  tags    : ['writers_v2', 'mdc', 'chunk1'],
  source  : 'tests_unit/writers_v2/WriteMdcV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/mdc: critical fail -> NOT EMITTABLE');

    var f = _makeFixtures();
    // Force a DC-01 fail (Voc cold > inverter Vmax)
    f.dc.dc01Pass = false;
    f.dc.dc01Results[0].pass = false;

    var ss = _makeMdcMockSpreadsheet();
    writeMdcV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, f.bessResult);
    var w = ss._sheet._writes;

    var emissionLabel = _writeAt(w, MDC_ROW.EMISSION_STATUS, MC.LABEL);
    t.assertTrue('emission row contains "NOT EMITTABLE"',
      typeof emissionLabel === 'string' && emissionLabel.indexOf('NOT EMITTABLE') !== -1);

    var finalVerdict = _writeAt(w, MDC_ROW.FLAG_FINAL, MC.VALUE);
    t.assert('FLAG_FINAL = NOT EMITTABLE', 'NOT EMITTABLE', finalVerdict);
  }
});


// =============================================================================
// TEST: PV-only run leaves §7 BESS section empty in col C
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_MDC_SEC7_PV_ONLY_EMPTY',
  group   : 'unit',
  module  : 'writers_v2/mdc',
  scenarios: [],
  tags    : ['writers_v2', 'mdc', 'bess', 'chunk1'],
  source  : 'tests_unit/writers_v2/WriteMdcV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/mdc: §7 BESS empty when bessEnabled=false');

    var f = _makeFixtures();
    f.bessResult = { bessEnabled: false, bess: null };

    var ss = _makeMdcMockSpreadsheet();
    writeMdcV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, f.bessResult);
    var w = ss._sheet._writes;

    t.assert('BESS_MODEL col C not written', null,
      _writeAt(w, MDC_ROW.BESS_MODEL, MC.VALUE));
    t.assert('BESS_CAPACITY col C not written', null,
      _writeAt(w, MDC_ROW.BESS_CAPACITY, MC.VALUE));
    t.assert('BESS_POWER col C not written', null,
      _writeAt(w, MDC_ROW.BESS_POWER, MC.VALUE));
    t.assert('BESS_USABLE col C not written', null,
      _writeAt(w, MDC_ROW.BESS_USABLE, MC.VALUE));
    t.assert('BESS_COUPLING col C not written', null,
      _writeAt(w, MDC_ROW.BESS_COUPLING, MC.VALUE));
  }
});


// =============================================================================
// TEST: bessEnabled run populates §7 with the expected values
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_MDC_SEC7_BESS_POPULATED',
  group   : 'unit',
  module  : 'writers_v2/mdc',
  scenarios: [],
  tags    : ['writers_v2', 'mdc', 'bess', 'chunk1'],
  source  : 'tests_unit/writers_v2/WriteMdcV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/mdc: §7 BESS writes when bessEnabled=true');

    var f = _makeFixtures();
    f.bessResult = {
      bessEnabled: true,
      coupling: 'DC_COUPLED',
      usableCapacityKwh: 156.0,
      bess: {
        batteryId: 'HW_LUNA_200KWH',
        strategy: 'PEAK_SHAVING',
        capacityKwh: 200, powerKw: 100,
        minSocPct: 0.10, maxSocPct: 0.90,
        degradationPct: 0.025, backupReservePct: 0
      },
      circuit: { sizeable: false, reason: 'voltaje de batería no especificado', runs: [] },
      busbarNote: 'Verificar 120% en tablero del sitio'
    };

    var ss = _makeMdcMockSpreadsheet();
    writeMdcV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, f.bessResult);
    var w = ss._sheet._writes;

    var modelVal = _writeAt(w, MDC_ROW.BESS_MODEL, MC.VALUE);
    t.assertTrue('BESS_MODEL contains batteryId',
      typeof modelVal === 'string' && modelVal.indexOf('HW_LUNA_200KWH') !== -1);
    t.assertTrue('BESS_MODEL contains strategy',
      typeof modelVal === 'string' && modelVal.indexOf('PEAK_SHAVING') !== -1);
    t.assert('BESS_CAPACITY col C = "200 kWh"', '200 kWh',
      _writeAt(w, MDC_ROW.BESS_CAPACITY, MC.VALUE));
    t.assert('BESS_POWER col C = "100 kW"', '100 kW',
      _writeAt(w, MDC_ROW.BESS_POWER, MC.VALUE));
    t.assert('BESS_USABLE col C = "156.0 kWh"', '156.0 kWh',
      _writeAt(w, MDC_ROW.BESS_USABLE, MC.VALUE));
    t.assert('BESS_COUPLING col C = "DC_COUPLED"', 'DC_COUPLED',
      _writeAt(w, MDC_ROW.BESS_COUPLING, MC.VALUE));

    // Circuit status: not sizeable -> "Pendiente — ..."
    var circStat = _writeAt(w, MDC_ROW.BESS_CIRC_STAT, MC.VALUE);
    t.assertTrue('BESS_CIRC_STAT starts with "Pendiente"',
      typeof circStat === 'string' && circStat.indexOf('Pendiente') === 0);

    // NOM citation always written
    var nomCite = _writeAt(w, MDC_ROW.BESS_NOM_CITE, MC.VALUE);
    t.assertTrue('BESS_NOM_CITE references NOM-001-SEDE Art. 706',
      typeof nomCite === 'string' && nomCite.indexOf('NOM-001-SEDE Art. 706') !== -1);
  }
});


// =============================================================================
// TEST: writeMdcV2 throws clear error when MDC_v2 sheet is missing
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_MDC_THROWS_WHEN_SHEET_MISSING',
  group   : 'unit',
  module  : 'writers_v2/mdc',
  scenarios: [],
  tags    : ['writers_v2', 'mdc', 'chunk1'],
  source  : 'tests_unit/writers_v2/WriteMdcV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/mdc: throws if MDC_v2 sheet missing');

    var emptySs = {
      getSheetByName: function() { return null; }
    };
    var f = _makeFixtures();

    t.assertThrows('writeMdcV2 throws when MDC_v2 not present', function() {
      writeMdcV2(emptySs, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, f.bessResult);
    }, 'MDC_v2');
  }
});
