// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/WriteProjectCardV2Tests.gs
// -----------------------------------------------------------------------------
// CHUNK 3 — writeProjectCardV2 unit tests.
//
// COVERAGE
//   Pure unit tests over the data-handling logic of writeProjectCardV2.
//   Uses a mock spreadsheet that:
//     1. Pretends a PROJECT_CARD_v2 sheet exists and captures every cell
//        write into a flat log (so we can assert what landed where).
//     2. Pretends BOM and INSTALLATION sheets exist with controllable
//        subtotals (so we can verify cost-comparison reads).
//     3. Pretends INPUT_PROJECT has the validation envelopes the writer
//        expects (mocking readInput).
//   Then asserts:
//     - 9 cost-category rows populate correctly from BOM + install
//     - BESS row is blank/em-dash when disabled, populated when enabled
//     - Scope-of-work BESS line appears (and not) per bessEnabled
//     - BESS validation PASS/FAIL boundaries (inside / outside range)
//     - TOTAL row sums all 9 categories including BESS
//     - Margin derivation: explicit > derived > 20% fallback
//     - Storage info-row formats correctly
//     - Throws cleanly when PROJECT_CARD_v2 sheet is missing
//
// WHAT IS NOT COVERED HERE
//   - End-to-end numeric parity with a real BOM (manual side-by-side test)
//   - Template idempotency (covered in ProjectCardTemplateTests.gs)
//   - Live formulas evaluating correctly inside Sheets (visual smoke test
//     on a real workbook is the right tool for that)
//
// CHUNK TAG
//   All tests tagged 'chunk3' so they show up under
//   ▶ Run Tests for Current Chunk while ACTIVE_CHUNK_TAG === 'chunk3'.
// =============================================================================


// ---------------------------------------------------------------------------
// _makePcMockSpreadsheet(opts)
// ---------------------------------------------------------------------------
//   Returns a mock SS with three sheets:
//     PROJECT_CARD_v2 — captures every write into ss._pc._writes
//     BOM             — pretends to hold BOM subtotal values
//     INSTALLATION    — pretends to hold install total at G9
//
//   opts.bomValues: { [rowNum]: { f: usd_value, g: mxn_value } }
//   opts.installG9: number (MXN value at INSTALLATION!G9)
//   opts.exchangeRate: number (BOM!F6, default 18.5)
//   opts.inputs: { [readInputKey]: value }  -- the readInput mock
// ---------------------------------------------------------------------------
function _makePcMockSpreadsheet(opts) {
  opts = opts || {};
  var bomValues   = opts.bomValues   || {};
  var installG9   = opts.installG9   != null ? opts.installG9 : 0;
  var exchangeRate = opts.exchangeRate || 18.5;

  // ---- PC_v2 mock sheet (captures writes) -------------------------------
  var pcWrites = [];
  function pcRange(row, col, numRows, numCols) {
    var isMulti = (numRows > 1) || (numCols > 1);
    var key = 'R' + row + 'C' + col +
              (isMulti ? ':R' + (row + numRows - 1) + 'C' + (col + numCols - 1) : '');
    var proxy = {
      _row: row, _col: col, _key: key,
      setValue: function(v) {
        pcWrites.push({ type:'value', row:row, col:col, range:key, value:v });
        return proxy;
      },
      setFormula: function(v) {
        pcWrites.push({ type:'formula', row:row, col:col, range:key, value:v });
        return proxy;
      },
      setNote: function(v) {
        pcWrites.push({ type:'note', row:row, col:col, range:key, value:v });
        return proxy;
      },
      // Style methods are no-ops in tests
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
      setWrap: function() { return proxy; },
      // Added 2026-05-27: writeProjectCardV2 now calls .clearContent() on
      // ranges before populating them (defensive cleanup added when the
      // writer started running against templates that may already have
      // stale content). The mock needs to support it; it's a no-op here
      // because the mock doesn't track cell state -- only writes.
      clearContent: function() { return proxy; }
    };
    return proxy;
  }
  var pcSheet = {
    _writes: pcWrites,
    getRange: function(row, col, numRows, numCols) {
      return pcRange(row, col, numRows || 1, numCols || 1);
    },
    setRowHeight: function() {},
    setColumnWidth: function() {},
    setHiddenGridlines: function() {},
    setFrozenRows: function() {},
    setFrozenColumns: function() {},
    clear: function() {},
    clearConditionalFormatRules: function() {},
    setConditionalFormatRules: function() {},
    getConditionalFormatRules: function() { return []; },
    getLastRow: function() { return 100; }
  };

  // ---- BOM mock sheet (returns canned cell values via getRange().getValue()) ----
  function bomRange(row, col) {
    return {
      getValue: function() {
        // Exchange rate cell — BOM!F6 (row 6 col 6)
        if (row === BOM_ROW.EXCHANGE_RATE && col === BOM_COL.TOTAL_USD) return exchangeRate;
        var entry = bomValues[row];
        if (!entry) return '';
        if (col === 6) return (entry.f != null) ? entry.f : '';
        if (col === 7) return (entry.g != null) ? entry.g : '';
        return '';
      }
    };
  }
  var bomSheet = {
    getRange: function(row, col) { return bomRange(row, col); },
    getLastRow: function() { return 100; }
  };

  // ---- INSTALLATION mock sheet ------------------------------------------
  function installRange(row, col) {
    return {
      getValue: function() {
        if (row === 9 && col === 7) return installG9;
        // For other rows the fallback chain walks col G; return 0 so we
        // exercise the canonical G9 path.
        return 0;
      }
    };
  }
  var installSheet = {
    getRange: function(row, col) { return installRange(row, col); },
    getLastRow: function() { return 30; }
  };

  return {
    _pc: pcSheet,
    _bom: bomSheet,
    _install: installSheet,
    getSheetByName: function(name) {
      // PC sheet: v2 only.
      if (name === V2_SHEETS.PROJECT_CARD) return pcSheet;
      // BOM: the writer was migrated to read from 'BOM_v2' in Tier 2
      // (2026-05-26) -- the legacy 'BOM' sheet is no longer refreshed by
      // the engine after Tier 1. Recognize both names so this mock works
      // for any caller that still passes through legacy code paths, but
      // the primary key is 'BOM_v2'.
      if (name === 'BOM_v2' || name === SH.BOM) return bomSheet;
      // INSTALLATION: same Tier 2 migration -- writer reads from
      // 'INSTALLATION_v2'. Cell positions are identical to legacy.
      if (name === 'INSTALLATION_v2' || name === 'INSTALLATION') return installSheet;
      return null;
    }
  };
}


// ---------------------------------------------------------------------------
// _writeAtPc(writes, row, col[, type])
//   Look up the last write at a specific (row, col). Last write wins.
// ---------------------------------------------------------------------------
function _writeAtPc(writes, row, col, type) {
  type = type || 'value';
  for (var i = writes.length - 1; i >= 0; i--) {
    var w = writes[i];
    if (w.type === type && w.row === row && w.col === col) return w.value;
  }
  return null;
}


// ---------------------------------------------------------------------------
// _makeReadInputFn(inputs)
//   Returns a readInput-shaped function (ss, key) → value that pulls from
//   the `inputs` map. Pass it to writeProjectCardV2 as _testOpts.readInputFn
//   to override the global readInput() in tests.
//
//   We use this rather than swapping globalThis.readInput because Apps Script
//   V8 (and Node, where the syntax check runs) resolves bare-name function
//   calls to lexical bindings, not globalThis properties. Injection via
//   parameter is the only reliable seam.
// ---------------------------------------------------------------------------
function _makeReadInputFn(inputs) {
  return function(ss, key) {
    return inputs.hasOwnProperty(key) ? inputs[key] : '';
  };
}


// ---------------------------------------------------------------------------
// _baseInputs() — default INPUT_PROJECT values used by most tests
//   Picks numbers that make assertion failures obvious (e.g. coverage 0.85
//   so 85% is unique). Each test can override via opts.
// ---------------------------------------------------------------------------
function _basePcInputs() {
  return {
    projectNumber:          'TEST-PROJ-001',
    projectManager:         'Test PM',
    systemCoveragePct:      0.85,
    sellingPriceUsdPerWp:   0,
    marginPct:              0.20,
    paymentTerms:           'Net 30',
    paymentDays:            30,
    dateSign:               '',
    dateFinishContract:     '',
    dateDelivery:           '',
    dateInstallStart:       '',
    dateInstallFinish:      '',
    receivedBy:             'Luis Juaristi',
    approvedBy:             'Vit Kovarik',
    // Cost-range envelopes (defaults from _MAP_PROJECT)
    costRangePanelsMin:      20, costRangePanelsMax:     200,
    costRangeInvertersMin:    5, costRangeInvertersMax:   80,
    costRangeStructureMin:    5, costRangeStructureMax:   80,
    costRangeElecDcMin:       0, costRangeElecDcMax:     200,
    costRangeElecAcMin:       0, costRangeElecAcMax:     200,
    costRangeMonitoringMin:   0, costRangeMonitoringMax:  30,
    costRangePermitsMin:      1, costRangePermitsMax:     20,
    costRangeInstallMin:     30, costRangeInstallMax:    120,
    costRangeTotalMin:      200, costRangeTotalMax:      700,
    costRangeBessMin:       350, costRangeBessMax:       650
  };
}


// ---------------------------------------------------------------------------
// _basePcFixtures()
//   Returns the inp / panel / invBank / dc objects the writer needs.
//   Numbers are "obviously test-y" so assertion failures point at the
//   right field.
// ---------------------------------------------------------------------------
function _basePcFixtures() {
  return {
    inp: {
      projectName: 'PC_TEST_PROJ',
      clientName:  'PC_TEST_CLIENT',
      panelQty:    100,
      bizManager:  'Test BizMgr',
      designer:    'Test Designer',
      street:      '123 Test St',
      city:        'Testopolis',
      state:       'TS',
      structure:   'TestRack v2',
      structure2:  '',
      businessType: 'Industrial'
    },
    panel: {
      'PANEL_BRAND':     'TestBrand',
      'PANEL_MODEL':     'TestModel-X',
      'PANEL_POWER_W':   500
    },
    invBank: [
      { model: 'TEST_INV_60K', qty: 2, acKw: 60 }
    ],
    dc: { dcKwp: 50 },
    ac: {},
    lay: {},
    nom: {}
  };
}


// =============================================================================
// TEST 1 — Cost Comparison: 8 legacy categories + INSTALLATION populate from
//          BOM and INSTALLATION sheets at the expected rows
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_COSTS_LEGACY_CATS',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: 8 legacy cost categories populate correctly');

    var f = _basePcFixtures();
    // BOM subtotal cells — pick obvious-test numbers
    var bomValues = {};
    bomValues[BOM_ROW.SUBTOTAL_PANELS]      = { f: 10000, g: 185000 };  // panels
    bomValues[BOM_ROW.SUBTOTAL_INVERTERS]   = { f:  3000, g:  55500 };  // inverters
    bomValues[BOM_ROW.SUBTOTAL_STRUCTURE]   = { f:  2000, g:  37000 };  // structure
    bomValues[BOM_ROW.SUBTOTAL_DC]          = { f:  1500, g:  27750 };  // DC
    bomValues[BOM_ROW.SUBTOTAL_AC]          = { f:  1200, g:  22200 };  // AC
    bomValues[BOM_ROW.SUBTOTAL_TRANSFORMER] = { f:   500, g:   9250 };  // xfmr (folds into AC)
    bomValues[BOM_ROW.SUBTOTAL_MONITORING]  = { f:   800, g:  14800 };  // monitoring + permits
    // Permits = sum of 4 service rows (UVIE/CFE/comm/thermo)
    bomValues[BOM_ROW.MON_UVIE]             = { f:   200, g:   3700 };
    bomValues[BOM_ROW.MON_CFE]              = { f:   150, g:   2775 };
    bomValues[BOM_ROW.MON_COMMISSIONING]    = { f:   100, g:   1850 };
    bomValues[BOM_ROW.MON_THERMOGRAPHY]     = { f:    50, g:    925 };

    var ss = _makePcMockSpreadsheet({
      bomValues: bomValues,
      installG9: 50000   // INSTALLATION MXN
    });
    var inputs = _basePcInputs();

          writeProjectCardV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, null,
                         { readInputFn: _makeReadInputFn(inputs) });

    var w = ss._pc._writes;

    // PANELS row, col C (USD cost) = 10000 (rounded)
    t.assert('Panels USD = 10000', 10000,
      _writeAtPc(w, PC_ROW.COST_PANELS, PC_COL.USD_COST));
    t.assert('Panels MXN = 185000', 185000,
      _writeAtPc(w, PC_ROW.COST_PANELS, PC_COL.MXN_COST));

    // INVERTERS row
    t.assert('Inverters USD = 3000', 3000,
      _writeAtPc(w, PC_ROW.COST_INVERTERS, PC_COL.USD_COST));

    // STRUCTURE
    t.assert('Structure USD = 2000', 2000,
      _writeAtPc(w, PC_ROW.COST_STRUCTURE, PC_COL.USD_COST));

    // ELEC DC
    t.assert('Elec DC USD = 1500', 1500,
      _writeAtPc(w, PC_ROW.COST_ELEC_DC, PC_COL.USD_COST));

    // ELEC AC (folds in transformer): 1200 + 500 = 1700
    t.assert('Elec AC USD = 1700 (incl transformer)', 1700,
      _writeAtPc(w, PC_ROW.COST_ELEC_AC, PC_COL.USD_COST));

    // Monitoring = SUBTOTAL_MONITORING (800) − permits (200+150+100+50=500) = 300
    t.assert('Monitoring USD = 300 (subtotal minus permits)', 300,
      _writeAtPc(w, PC_ROW.COST_MONITORING, PC_COL.USD_COST));

    // Permits = 200+150+100+50 = 500
    t.assert('Permits USD = 500', 500,
      _writeAtPc(w, PC_ROW.COST_PERMITS, PC_COL.USD_COST));

    // Installation: INSTALLATION!G9 = 50000 MXN; USD = 50000/18.5 = 2702.7 → 2703
    t.assert('Installation MXN = 50000', 50000,
      _writeAtPc(w, PC_ROW.COST_INSTALL, PC_COL.MXN_COST));
    t.assert('Installation USD = 2703 (50000 MXN / 18.5)', 2703,
      _writeAtPc(w, PC_ROW.COST_INSTALL, PC_COL.USD_COST));
  }
});


// =============================================================================
// TEST 2 — BESS cost row: em-dash when disabled (PV-only)
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_BESS_ROW_EMPTY_WHEN_DISABLED',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'bess', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: BESS row shows em-dash on PV-only run');

    var f = _basePcFixtures();
    var ss = _makePcMockSpreadsheet({
      bomValues: {},   // no BESS subtotal — and bessResult disabled
      installG9: 0
    });
    var inputs = _basePcInputs();

    // PV-only run (bessResult=null)
    writeProjectCardV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, null,
                       { readInputFn: _makeReadInputFn(inputs) });

    var w = ss._pc._writes;

    // BESS row USD cell should contain em-dash (not zero, not blank)
    t.assert('BESS USD cell = em-dash (PV-only)', '\u2014',
      _writeAtPc(w, PC_ROW.COST_BESS, PC_COL.USD_COST));
    t.assert('BESS MXN cell = em-dash (PV-only)', '\u2014',
      _writeAtPc(w, PC_ROW.COST_BESS, PC_COL.MXN_COST));
    // BESS validation cell should NOT be filled (no PASS/FAIL when disabled)
    t.assert('BESS validation cell not written on PV-only', null,
      _writeAtPc(w, PC_ROW.COST_BESS, PC_COL.VALIDATION));
  }
});


// =============================================================================
// TEST 3 — BESS cost row: populated when enabled
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_BESS_ROW_POPULATED_WHEN_ENABLED',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'bess', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: BESS row pulls from BOM!SUBTOTAL_BESS');

    var f = _basePcFixtures();
    var bomValues = {};
    bomValues[BOM_ROW.SUBTOTAL_BESS] = { f: 100000, g: 1850000 };  // $100K USD / $1.85M MXN

    var ss = _makePcMockSpreadsheet({
      bomValues: bomValues,
      installG9: 0,
      exchangeRate: 18.5
    });
    var inputs = _basePcInputs();

    var bessResult = {
      bessEnabled: true,
      bess: {
        batteryId:  'TEST_BAT_STACK_5',
        capacityKwh: 215,        // $100K / 215 = $465/kWh → inside [350,650]
        stackQty:    5
      }
    };

          writeProjectCardV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, bessResult,
                         { readInputFn: _makeReadInputFn(inputs) });

    var w = ss._pc._writes;

    t.assert('BESS USD = 100000', 100000,
      _writeAtPc(w, PC_ROW.COST_BESS, PC_COL.USD_COST));
    t.assert('BESS MXN = 1850000', 1850000,
      _writeAtPc(w, PC_ROW.COST_BESS, PC_COL.MXN_COST));

    // BESS sales: cost / (1 - margin) where margin defaults to 0.20
    // → 100000 / 0.8 = 125000
    t.assert('BESS sales USD = 125000 (cost/0.8)', 125000,
      _writeAtPc(w, PC_ROW.COST_BESS, PC_COL.USD_SALES));
  }
});


// =============================================================================
// TEST 4 — BESS validation: PASS when $/kWh inside envelope
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_BESS_VALIDATION_PASS',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'bess', 'validation', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: BESS validation PASS inside [350,650]/kWh');

    var f = _basePcFixtures();
    var bomValues = {};
    // $100,000 / 215 kWh = $465.12/kWh → inside [350,650]
    bomValues[BOM_ROW.SUBTOTAL_BESS] = { f: 100000, g: 1850000 };

    var ss = _makePcMockSpreadsheet({
      bomValues: bomValues, installG9: 0
    });
    var inputs = _basePcInputs();
    var bessResult = {
      bessEnabled: true,
      bess: { batteryId: 'TEST', capacityKwh: 215, stackQty: 1 }
    };

          writeProjectCardV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, bessResult,
                         { readInputFn: _makeReadInputFn(inputs) });

    t.assert('BESS validation = PASS', 'PASS',
      _writeAtPc(ss._pc._writes, PC_ROW.COST_BESS, PC_COL.VALIDATION));
  }
});


// =============================================================================
// TEST 5 — BESS validation: FAIL when $/kWh above ceiling
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_BESS_VALIDATION_FAIL_HIGH',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'bess', 'validation', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: BESS validation FAIL when above $650/kWh');

    var f = _basePcFixtures();
    var bomValues = {};
    // $200,000 / 215 kWh = $930/kWh → above $650 ceiling
    bomValues[BOM_ROW.SUBTOTAL_BESS] = { f: 200000, g: 3700000 };

    var ss = _makePcMockSpreadsheet({
      bomValues: bomValues, installG9: 0
    });
    var inputs = _basePcInputs();
    var bessResult = {
      bessEnabled: true,
      bess: { batteryId: 'OVERPRICED', capacityKwh: 215, stackQty: 1 }
    };

          writeProjectCardV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, bessResult,
                         { readInputFn: _makeReadInputFn(inputs) });

    t.assert('BESS validation = FAIL (above $650/kWh)', 'FAIL',
      _writeAtPc(ss._pc._writes, PC_ROW.COST_BESS, PC_COL.VALIDATION));
  }
});


// =============================================================================
// TEST 6 — TOTAL row sums all 9 categories including BESS
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_TOTAL_INCLUDES_BESS',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'bess', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: TOTAL row sums all 9 categories incl BESS');

    var f = _basePcFixtures();
    var bomValues = {};
    // Simple distinct-prime numbers so the sum is unambiguous
    bomValues[BOM_ROW.SUBTOTAL_PANELS]      = { f: 100, g: 0 };
    bomValues[BOM_ROW.SUBTOTAL_INVERTERS]   = { f:  50, g: 0 };
    bomValues[BOM_ROW.SUBTOTAL_STRUCTURE]   = { f:  30, g: 0 };
    bomValues[BOM_ROW.SUBTOTAL_DC]          = { f:  20, g: 0 };
    bomValues[BOM_ROW.SUBTOTAL_AC]          = { f:  10, g: 0 };
    bomValues[BOM_ROW.SUBTOTAL_TRANSFORMER] = { f:   5, g: 0 };
    bomValues[BOM_ROW.SUBTOTAL_MONITORING]  = { f:   8, g: 0 };
    // No permits-services to zero out monitoring math
    bomValues[BOM_ROW.SUBTOTAL_BESS]        = { f:1000, g: 0 };

    var ss = _makePcMockSpreadsheet({
      bomValues: bomValues, installG9: 0  // no install cost
    });
    var inputs = _basePcInputs();
    var bessResult = {
      bessEnabled: true,
      bess: { batteryId: 'TEST', capacityKwh: 2, stackQty: 1 }  // $1000/2 = $500/kWh, PASS
    };

          writeProjectCardV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, bessResult,
                         { readInputFn: _makeReadInputFn(inputs) });

    // TOTAL cost USD should equal sum of all 9 categories:
    //   panels 100 + inv 50 + struct 30 + DC 20 + AC 15 (10+5) + mon 8 + perm 0 + inst 0 + BESS 1000
    //   = 1223
    t.assert('TOTAL cost USD = 1223 (sum of all 9 categories)', 1223,
      _writeAtPc(ss._pc._writes, PC_ROW.COST_TOTAL, PC_COL.USD_COST));
  }
});


// =============================================================================
// TEST 7 — Scope of Work: BESS line appears when bessEnabled
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_SCOPE_BESS_LINE_WHEN_ENABLED',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'bess', 'scope', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: Scope of Work shows BESS line when enabled');

    var f = _basePcFixtures();
    var ss = _makePcMockSpreadsheet({ bomValues: {}, installG9: 0 });
    var inputs = _basePcInputs();
    var bessResult = {
      bessEnabled: true,
      bess: { batteryId: 'BYD-HVM-22.1', capacityKwh: 265, stackQty: 12 }
    };

          writeProjectCardV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, bessResult,
                         { readInputFn: _makeReadInputFn(inputs) });

    // Scope order: panel + 1 inv + structure + BESS = row FIRST..FIRST+3
    // Panel at row FIRST, inverter at FIRST+1, structure at FIRST+2, BESS at FIRST+3
    var bessScopeRow = PC_ROW.SCOPE_ROW_FIRST + 3;
    var bessScopeLabel = _writeAtPc(ss._pc._writes, bessScopeRow, PC_COL.LABEL_L);

    t.assertTrue('BESS scope label contains batteryId',
      typeof bessScopeLabel === 'string' && bessScopeLabel.indexOf('BYD-HVM-22.1') !== -1);
    t.assertTrue('BESS scope label contains "12 stacks"',
      typeof bessScopeLabel === 'string' && bessScopeLabel.indexOf('12 stacks') !== -1);
    t.assertTrue('BESS scope label contains "265 kWh nominal"',
      typeof bessScopeLabel === 'string' && bessScopeLabel.indexOf('265 kWh nominal') !== -1);

    // The qty cell (col D) should show kWh capacity
    t.assert('BESS scope qty cell = "265 kWh"', '265 kWh',
      _writeAtPc(ss._pc._writes, bessScopeRow, PC_COL.MXN_COST));
  }
});


// =============================================================================
// TEST 8 — Scope of Work: NO BESS line when bessEnabled=false
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_SCOPE_NO_BESS_LINE_WHEN_DISABLED',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'bess', 'scope', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: Scope has no BESS line when disabled');

    var f = _basePcFixtures();
    var ss = _makePcMockSpreadsheet({ bomValues: {}, installG9: 0 });
    var inputs = _basePcInputs();

          writeProjectCardV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, null,
                         { readInputFn: _makeReadInputFn(inputs) });

    // Walk every label written in the scope rows; none should mention "stacks"
    // or "kWh nominal" (which would be the BESS line format).
    var hasBessLine = false;
    for (var r = PC_ROW.SCOPE_ROW_FIRST; r <= PC_ROW.SCOPE_ROW_LAST; r++) {
      var lbl = _writeAtPc(ss._pc._writes, r, PC_COL.LABEL_L);
      if (typeof lbl === 'string' &&
          (lbl.indexOf('kWh nominal') !== -1 || lbl.indexOf('stacks') !== -1)) {
        hasBessLine = true;
        break;
      }
    }
    t.assertFalse('Scope rows contain no BESS line', hasBessLine);
  }
});


// =============================================================================
// TEST 9 — Scope of Work: CUSTOM_MANUAL batteryId falls back to generic label
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_SCOPE_CUSTOM_MANUAL_FALLBACK',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'bess', 'scope', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: CUSTOM_MANUAL batteryId → "Battery storage system"');

    var f = _basePcFixtures();
    var ss = _makePcMockSpreadsheet({ bomValues: {}, installG9: 0 });
    var inputs = _basePcInputs();
    var bessResult = {
      bessEnabled: true,
      bess: { batteryId: 'CUSTOM_MANUAL', capacityKwh: 150, stackQty: 1 }
    };

          writeProjectCardV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, bessResult,
                         { readInputFn: _makeReadInputFn(inputs) });

    // Find the BESS scope row (panel + inv + struct + BESS = row FIRST+3)
    var bessScopeRow = PC_ROW.SCOPE_ROW_FIRST + 3;
    var label = _writeAtPc(ss._pc._writes, bessScopeRow, PC_COL.LABEL_L);

    t.assertTrue('Label uses generic fallback "Battery storage system"',
      typeof label === 'string' && label.indexOf('Battery storage system') !== -1);
    t.assertTrue('Label does NOT contain "CUSTOM_MANUAL"',
      typeof label === 'string' && label.indexOf('CUSTOM_MANUAL') === -1);
    // Singular: 1 stack
    t.assertTrue('Label uses singular "stack" (not "stacks") when stackQty=1',
      typeof label === 'string' &&
      label.indexOf('1 stack ') !== -1 &&
      label.indexOf('1 stacks') === -1);
  }
});


// =============================================================================
// TEST 10 — Margin derivation: derives from selling price when marginPct=0
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_MARGIN_DERIVATION',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: margin derives from selling price when marginPct=0');

    var f = _basePcFixtures();
    // dcKwp = 50 → dcWp = 50000
    // Total cost USD = 10000 (panels only); cost/Wp = 10000/50000 = $0.20/Wp
    // Selling price = $0.40/Wp → margin = (0.40-0.20)/0.40 = 0.50 → 50%
    var bomValues = {};
    bomValues[BOM_ROW.SUBTOTAL_PANELS] = { f: 10000, g: 0 };
    var ss = _makePcMockSpreadsheet({ bomValues: bomValues, installG9: 0 });
    var inputs = _basePcInputs();
    inputs.marginPct            = 0;     // not explicit
    inputs.sellingPriceUsdPerWp = 0.40;  // 40 c/Wp

          writeProjectCardV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, null,
                         { readInputFn: _makeReadInputFn(inputs) });

    // The margin % shows up at COST_TOTAL row, col J (margin pct)
    var marginCell = _writeAtPc(ss._pc._writes, PC_ROW.COST_TOTAL, PC_COL.MARGIN_PCT);
    t.assert('Derived margin shows as "50%"', '50%', marginCell);
  }
});


// =============================================================================
// TEST 11 — Storage info row formats capacity correctly when enabled
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_STORAGE_INFO_ROW',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'bess', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: Storage info-row shows kWh capacity, no power');

    var f = _basePcFixtures();
    var ss = _makePcMockSpreadsheet({ bomValues: {}, installG9: 0 });
    var inputs = _basePcInputs();

    // Enabled case: 265 kWh
    var bessResult = {
      bessEnabled: true,
      bess: { batteryId: 'TEST', capacityKwh: 265, stackQty: 12, powerKw: 132 }
    };
          writeProjectCardV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, bessResult,
                         { readInputFn: _makeReadInputFn(inputs) });

    var storageVal = _writeAtPc(ss._pc._writes, PC_ROW.INFO_STORAGE, PC_COL.USD_SALES);
    t.assert('Storage row shows "265 kWh"', '265 kWh', storageVal);
    t.assertTrue('Storage row does NOT show kW (capacity only, no power)',
      typeof storageVal === 'string' && storageVal.indexOf('kW') === storageVal.length - 3);
      // Note: "265 kWh" contains "kW" as substring. We check the last "kW"
      // is part of "kWh" by checking the position is at length-3 (kWh occupies
      // last 3 chars). This guards against accidental " / 132 kW" appended.

    // Disabled case: em-dash
    var ss2 = _makePcMockSpreadsheet({ bomValues: {}, installG9: 0 });
          writeProjectCardV2(ss2, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, null,
                         { readInputFn: _makeReadInputFn(inputs) });
    t.assert('Storage row em-dash when disabled', '\u2014',
      _writeAtPc(ss2._pc._writes, PC_ROW.INFO_STORAGE, PC_COL.USD_SALES));
  }
});


// =============================================================================
// TEST 12 — writeProjectCardV2 throws clear error when sheet is missing
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_PC_THROWS_WHEN_SHEET_MISSING',
  group   : 'unit',
  module  : 'writers_v2/pc',
  scenarios: [],
  tags    : ['writers_v2', 'pc', 'chunk3'],
  source  : 'tests_unit/writers_v2/WriteProjectCardV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/pc: throws when PROJECT_CARD_v2 missing');

    var emptySs = { getSheetByName: function() { return null; } };
    var f = _basePcFixtures();

    t.assertThrows('throws when PROJECT_CARD_v2 not present', function() {
      writeProjectCardV2(emptySs, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay, f.nom, null);
    }, 'PROJECT_CARD_v2');
  }
});
