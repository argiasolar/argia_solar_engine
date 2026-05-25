// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/WriteBomV2Tests.gs
// -----------------------------------------------------------------------------
// CHUNK 4 — writeBomV2 unit tests.
//
// COVERAGE
//   Pure unit tests over the data-handling logic of writeBomV2. Uses a
//   mock spreadsheet that pretends BOM_v2 exists and captures every cell
//   write into a flat log we can assert against. The writer's hidden
//   _testOpts param injects mock DB loaders + readInput + battery price +
//   electable + conduit selector + conductorUnit so no real sheet I/O.
//
//   Asserts:
//     - Project meta row 4 written with project/client/kWp string
//     - Column headers row 5 written (8 labels)
//     - Exchange rate at F6 = 18.50
//     - §1 PANELS: primary panel + secondary (when present) + subtotal formula
//     - §2 INVERTERS: each bank fills its row, subtotal range correct
//     - §3 STRUCTURE: resolveStructure used, secondary structure optional,
//                     inverter mounting always present
//     - §4 DC: PV WIRE cable, EGC, MC4, OCPD, conduit (or tray with trayM>0),
//             RSD when rsdRequired
//     - §5 AC: main feeder + EGC + breaker + conduit + panelboard, per-inverter
//             blocks at AC_INV_BLOCK_START + slotIdx * 4
//     - §6 TRANSFORMER: supplyTransformer=0 → "suministro del cliente", no price
//     - §7 MONITORING: datalogger + meter + 4 services @ $1500 USD each
//     - §8 BESS: PV-only → single "pendiente" line at BESS_BATTERY_LINE;
//                BESS-enabled → maps BESS-01..12 codes to fixed rows
//     - Grand total formula sums all 8 subtotals
//     - Throws cleanly when BOM_v2 sheet doesn't exist
//
// WHAT IS NOT COVERED HERE
//   - End-to-end numeric parity with legacy BOM (manual side-by-side test)
//   - Template idempotency (BomTemplateTests.gs)
//   - Live formulas evaluating in real Sheets (visual smoke test)
//   - Actual DB lookup correctness (BomDbHelpersTests.gs)
//
// CHUNK TAG
//   All tests tagged 'chunk4'.
// =============================================================================


// ---------------------------------------------------------------------------
// _makeBomMockSpreadsheet(opts)
//
//   Returns a mock SS with a BOM_v2 sheet that captures writes into
//   ss._bom._writes. Also exposes inputs map for readInputFn injection.
//
//   opts.inputs:        { trayM: 0, ... }  for readInputFn
//   opts.batteryPrices: { batteryId: { priceMxn, provenance } } for lookup
//   opts.sheetMissing:  true → returns null from getSheetByName('BOM_v2')
// ---------------------------------------------------------------------------
function _makeBomMockSpreadsheet(opts) {
  opts = opts || {};
  var inputs = opts.inputs || {};
  var batteryPrices = opts.batteryPrices || {};
  var sheetMissing = !!opts.sheetMissing;

  var writes = [];
  var notes = [];
  function makeRange(row, col, numRows, numCols) {
    var isMulti = (numRows > 1) || (numCols > 1);
    var key = 'R' + row + 'C' + col +
              (isMulti ? ':R' + (row + numRows - 1) + 'C' + (col + numCols - 1) : '');
    var proxy = {
      _row: row, _col: col, _key: key,
      setValue: function(v) {
        writes.push({ type:'value', row:row, col:col, range:key, value:v });
        return proxy;
      },
      setFormula: function(v) {
        writes.push({ type:'formula', row:row, col:col, range:key, value:v });
        return proxy;
      },
      setNote: function(v) {
        notes.push({ row:row, col:col, text:v });
        return proxy;
      },
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
  var bomSheet = {
    _writes: writes,
    _notes: notes,
    getRange: function(row, col, numRows, numCols) {
      return makeRange(row, col, numRows || 1, numCols || 1);
    },
    setRowHeight: function() {},
    setColumnWidth: function() {},
    setHiddenGridlines: function() {},
    setFrozenRows: function() {},
    setFrozenColumns: function() {}
  };

  return {
    _bom: bomSheet,
    _inputs: inputs,
    _batteryPrices: batteryPrices,
    getSheetByName: function(name) {
      if (sheetMissing) return null;
      if (name === V2_SHEETS.BOM) return bomSheet;
      return null;
    }
  };
}

// Find last write to (row, col); returns the value or null.
function _writeAtBom(writes, row, col) {
  for (var i = writes.length - 1; i >= 0; i--) {
    var w = writes[i];
    if (w.type === 'value' && w.row === row && w.col === col) return w.value;
  }
  return null;
}
function _formulaAtBom(writes, row, col) {
  for (var i = writes.length - 1; i >= 0; i--) {
    var w = writes[i];
    if (w.type === 'formula' && w.row === row && w.col === col) return w.value;
  }
  return null;
}
function _noteAtBom(notes, row, col) {
  for (var i = notes.length - 1; i >= 0; i--) {
    if (notes[i].row === row && notes[i].col === col) return notes[i].text;
  }
  return null;
}


// ---------------------------------------------------------------------------
// Build a "vanilla PV" fixture set: small project, 1 inverter, no secondaries,
// no BESS, no tray. Used by most tests.
// ---------------------------------------------------------------------------
function _makeBomFixtures() {
  return {
    inp: {
      projectName: 'TEST PROJ',
      clientName: 'TEST CLIENT',
      panelQty: 100,
      stringsTotal: 8,
      structure: 'CLIP&RAIL \u2014 KR18 CLIP \u2014 STR_004',
      structure2: '',
      supplyTransformer: 1,
      secondaryPanels: []
    },
    panel: {
      PANEL_BRAND: 'JINKO',
      PANEL_MODEL: 'TIGER-NEO',
      PANEL_POWER_W: 580,
      PANEL_TECHNOLOGY: 'MONO',
      PANEL_CELL_TYPE: 'TOPCon',
      PANEL_PRICE_Wp_USD: 0.22,
      PROD_ID: 'PANEL_JK_580'
    },
    invBank: [
      { model: 'SUN2000-100KTL', acKw: 100, voltage: 480, phase: 3,
        qty: 1, invId: 'INV_HW_100', priceUsd: 9500 }
    ],
    dc: {
      dcKwp: 58.0,
      acKwTotal: 50,
      conductorDC: '10',
      egcDC: '8',
      ocpdDC: 20,
      conduitDC: 1.0
    },
    ac: {
      condMain: '4/0',
      egcMain: '6',
      mainBreaker: 200,
      conduitMain: 2.0,
      transformer: 75,
      apparentPower: 62.5
    },
    lay: {
      bom: {
        dcCableM: 320,
        dcGroundingM: 60,
        mc4Pairs: 8,
        dcOcpdUnits: 16,
        dcConduitM: 45,
        rsdRequired: false,
        mainFeederCableM: 195,
        mainEgcM: 65,
        acPerInverterBOM: [
          { model: 'SUN2000-100KTL', qty: 1, conductorSize: '2/0', egcSize: '6',
            ocpdA: 200, conduitSize: 2.0, cableM: 60, egcM: 20 }
        ]
      }
    },
    nom: {},
    bessResult: null
  };
}

// Vanilla DB fixtures — match what _bomV2_ helpers expect
function _makeBomBosDbFixture() {
  return [
    // PV WIRE 10 AWG
    { BOS_ID: 'PV_10', BOS_CATEGORY: 'CONDUCTORS', BOS_SUBCATEGORY: 'PV WIRE',
      BOS_RATING_OR_SIZE: '10 AWG', BOS_PRICE_PER_UNIT_MXN: 30,
      BOS_CURRENCY: 'MXN', _bosId: 'PV_10', _raw: ['PV_10'] },
    // Bare copper EGC 8, 6
    { BOS_ID: 'BC_8', BOS_CATEGORY: 'CONDUCTORS', BOS_SUBCATEGORY: 'BARE COPPER',
      BOS_RATING_OR_SIZE: '8 AWG', BOS_PRICE_PER_UNIT_MXN: 35,
      BOS_CURRENCY: 'MXN', _bosId: 'BC_8', _raw: ['BC_8'] },
    { BOS_ID: 'BC_6', BOS_CATEGORY: 'CONDUCTORS', BOS_SUBCATEGORY: 'BARE COPPER',
      BOS_RATING_OR_SIZE: '6 AWG', BOS_PRICE_PER_UNIT_MXN: 50,
      BOS_CURRENCY: 'MXN', _bosId: 'BC_6', _raw: ['BC_6'] },
    // THHW 4/0 and 2/0
    { BOS_ID: 'TH_40', BOS_CATEGORY: 'CONDUCTORS', BOS_SUBCATEGORY: 'WIRE THHW',
      BOS_RATING_OR_SIZE: '4/0 AWG', BOS_PRICE_PER_UNIT_MXN: 280,
      BOS_CURRENCY: 'MXN', _bosId: 'TH_40', _raw: ['TH_40'] },
    { BOS_ID: 'TH_20', BOS_CATEGORY: 'CONDUCTORS', BOS_SUBCATEGORY: 'WIRE THHW',
      BOS_RATING_OR_SIZE: '2/0 AWG', BOS_PRICE_PER_UNIT_MXN: 180,
      BOS_CURRENCY: 'MXN', _bosId: 'TH_20', _raw: ['TH_20'] },
    // MC4
    { BOS_ID: 'MC4_10', BOS_CATEGORY: 'CONNECTORS', BOS_SUBCATEGORY: 'MC4',
      BOS_RATING_OR_SIZE: '10', BOS_PRICE_PER_UNIT_MXN: 5.50,
      BOS_CURRENCY: 'USD', _bosId: 'MC4_10', _raw: ['MC4_10'] },
    // DC fuse
    { BOS_ID: 'FUSE_20', BOS_CATEGORY: 'PROTECTION', BOS_SUBCATEGORY: 'DC FUSES',
      BOS_RATING_OR_SIZE: '20A 10X38MM', BOS_PRICE_PER_UNIT_MXN: 75,
      BOS_CURRENCY: 'MXN', _bosId: 'FUSE_20', _raw: ['FUSE_20'] },
    // Conduit 1" + 2"
    { BOS_ID: 'COND_1', BOS_CATEGORY: 'CONDUIT', BOS_SUBCATEGORY: 'RIGID IMC',
      BOS_MODEL: 'TUBO CONDUIT IMC DE 1" X 3M', BOS_PRICE_PER_UNIT_MXN: 145,
      BOS_CURRENCY: 'MXN', _bosId: 'COND_1', _raw: ['COND_1'] },
    { BOS_ID: 'COND_2', BOS_CATEGORY: 'CONDUIT', BOS_SUBCATEGORY: 'RIGID IMC',
      BOS_MODEL: 'TUBO CONDUIT IMC DE 2" X 3M', BOS_PRICE_PER_UNIT_MXN: 320,
      BOS_CURRENCY: 'MXN', _bosId: 'COND_2', _raw: ['COND_2'] },
    // Ladder tray (for tray-mode tests)
    { BOS_ID: 'TRAY_001', BOS_CATEGORY: 'SUPPORT', BOS_SUBCATEGORY: 'LADDER TRAY',
      BOS_MODEL: 'CHAROLA TIPO ESCALERA 4X12', BOS_PRICE_PER_UNIT_MXN: 850,
      BOS_CURRENCY: 'MXN', _bosId: 'TRAY_001', _raw: ['TRAY_001'] },
    // Breakers: 200A 3P, 200A 2P
    { BOS_ID: 'BRK_200_3', BOS_CATEGORY: 'DISTRIBUTION', BOS_SUBCATEGORY: 'BREAKERS',
      BOS_RATING_OR_SIZE: '200 A / 3 POLES', BOS_PRICE_PER_UNIT_MXN: 8500,
      BOS_CURRENCY: 'MXN', _bosId: 'BRK_200_3', _raw: ['BRK_200_3'] },
    { BOS_ID: 'BRK_200_2', BOS_CATEGORY: 'DISTRIBUTION', BOS_SUBCATEGORY: 'BREAKERS',
      BOS_RATING_OR_SIZE: '200 A / 2 POLES', BOS_PRICE_PER_UNIT_MXN: 7800,
      BOS_CURRENCY: 'MXN', _bosId: 'BRK_200_2', _raw: ['BRK_200_2'] },
    // Panelboard 200A
    { BOS_ID: 'PB_200', BOS_CATEGORY: 'DISTRIBUTION', BOS_SUBCATEGORY: 'LOAD CENTER',
      BOS_RATING_OR_SIZE: 200, BOS_PRICE_PER_UNIT_MXN: 18500,
      BOS_CURRENCY: 'MXN', _bosId: 'PB_200', _raw: ['PB_200'] },
    // Transformer 75 kVA
    { BOS_ID: 'TR_75', BOS_CATEGORY: 'DISTRIBUTION', BOS_SUBCATEGORY: 'TRANSFORMERS',
      BOS_RATING_OR_SIZE: 75, BOS_PRICE_PER_UNIT_MXN: 95000,
      BOS_CURRENCY: 'MXN', _bosId: 'TR_75', _raw: ['TR_75'] },
    // Monitoring + meter
    { BOS_ID: 'MON_HW', BOS_CATEGORY: 'MISC', BOS_SUBCATEGORY: 'MONITORING',
      BOS_MODEL: 'HUAWEI MONITORING PACK', BOS_PRICE_PER_UNIT_MXN: 4200,
      BOS_CURRENCY: 'MXN', _bosId: 'MON_HW', _raw: ['MON_HW'] },
    { BOS_ID: 'METER_ION', BOS_CATEGORY: 'MISC', BOS_SUBCATEGORY: 'METER',
      BOS_MODEL: 'ION MEDIDOR BIDIRECCIONAL', BOS_PRICE_PER_UNIT_MXN: 8500,
      BOS_CURRENCY: 'MXN', _bosId: 'METER_ION', _raw: ['METER_ION'] }
  ];
}

function _makeBomStructureDbFixture() {
  return [
    { _raw: ['STR_004', 'CLIP&RAIL', 'KR18 CLIP', '', '', '', '', '', '', '', '', '', 8.50],
      STR_ID: 'STR_004', STR_BRAND: 'CLIP&RAIL', STR_MODEL: 'KR18 CLIP' },
    { _raw: ['STR_006', 'CLIP&RAIL', 'RIEL KR18', '', '', '', '', '', '', '', '', '', 4.25],
      STR_ID: 'STR_006', STR_BRAND: 'CLIP&RAIL', STR_MODEL: 'RIEL KR18' }
  ];
}

// Build the _testOpts payload that injects all collaborators
function _makeBomTestOpts(opts) {
  opts = opts || {};
  var bosDb       = opts.bosDb       || _makeBomBosDbFixture();
  var structureDb = opts.structureDb || _makeBomStructureDbFixture();
  var inputs      = opts.inputs      || { trayM: 0 };
  var batteryPrices = opts.batteryPrices || {};

  return {
    readInputFn: function(ss, key) { return inputs[key]; },
    loadBosDbFn: function() { return bosDb; },
    loadStructureDbFn: function() { return structureDb; },
    lookupBatteryPriceFn: function(ss, batteryId) {
      return batteryPrices[batteryId] || { priceMxn: 0, provenance: 'NONE' };
    },
    readElecTablesFn: function() { return {}; },
    selectConduitFn: function() { return 1.25; },
    conductorUnitFn: function(awg) {
      var s = String(awg || '').toUpperCase();
      return (s === '4/0' || s === '2/0' || s === '1/0') ? 'kcmil' : 'AWG';
    }
  };
}


// =============================================================================
// TEST 1 — throws when BOM_v2 sheet missing
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_THROWS_IF_NO_SHEET',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: throws when BOM_v2 sheet missing');

    var f = _makeBomFixtures();
    var ss = _makeBomMockSpreadsheet({ sheetMissing: true });
    var opts = _makeBomTestOpts();

    t.assertThrows('writeBomV2 throws clean error when sheet missing',
      function() {
        writeBomV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay,
                   f.nom, f.bessResult, opts);
      },
      'BOM_v2 sheet not found');
  }
});


// =============================================================================
// TEST 2 — Project meta + headers + exchange rate
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_HEADER_BAND',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: project meta row 4 + headers row 5 + TC row 6');

    var f = _makeBomFixtures();
    var ss = _makeBomMockSpreadsheet({ inputs: { trayM: 0 } });
    writeBomV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay,
               f.nom, f.bessResult, _makeBomTestOpts());
    var w = ss._bom._writes;

    // Project meta at row 4 col 1
    var meta = _writeAtBom(w, BOM_ROW.PROJECT_META, BOM_COL.ITEM);
    t.assertTrue('project meta string present', meta && typeof meta === 'string');
    t.assertTrue('meta mentions project name',
      meta && meta.indexOf('TEST PROJ') !== -1);
    t.assertTrue('meta mentions client name',
      meta && meta.indexOf('TEST CLIENT') !== -1);
    t.assertTrue('meta mentions kWp',
      meta && meta.indexOf('58.00 kWp') !== -1);

    // Headers at row 5
    var expected = ['#','DESCRIPCION','QTY','UNIDAD',
                    'PRECIO U (USD)','TOTAL (USD)','TOTAL (MXN)','REFERENCIA'];
    for (var ci = 0; ci < expected.length; ci++) {
      t.assert('header col ' + (ci+1) + ' = "' + expected[ci] + '"',
        expected[ci], _writeAtBom(w, BOM_ROW.HEADERS, ci + 1));
    }

    // Exchange rate label at E6, value 18.50 at F6
    t.assert('TC label at E6', 'TC USD/MXN:',
      _writeAtBom(w, BOM_ROW.EXCHANGE_RATE, BOM_COL.UNIT_PRICE));
    t.assert('TC value 18.50 at F6', 18.50,
      _writeAtBom(w, BOM_ROW.EXCHANGE_RATE, BOM_COL.TOTAL_USD));
  }
});


// =============================================================================
// TEST 3 — §1 PANELS primary panel row
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_PANELS',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: §1 PANELS writes primary panel correctly');

    var f = _makeBomFixtures();
    var ss = _makeBomMockSpreadsheet({ inputs: { trayM: 0 } });
    writeBomV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay,
               f.nom, f.bessResult, _makeBomTestOpts());
    var w = ss._bom._writes;

    // Section header at SEC_PANELS
    t.assert('§1 header label at B/SEC_PANELS', '1. PANELES SOLARES',
      _writeAtBom(w, BOM_ROW.SEC_PANELS, BOM_COL.DESCRIPTION));

    // Primary panel: item #, description, qty, unit, ref, price
    t.assertTrue('panel item # written',
      _writeAtBom(w, BOM_ROW.PANEL_PRIMARY, BOM_COL.ITEM) > 0);
    var desc = _writeAtBom(w, BOM_ROW.PANEL_PRIMARY, BOM_COL.DESCRIPTION);
    t.assertTrue('panel desc contains brand', desc && desc.indexOf('JINKO') !== -1);
    t.assertTrue('panel desc contains model', desc && desc.indexOf('TIGER-NEO') !== -1);
    t.assert('panel qty = 100', 100,
      _writeAtBom(w, BOM_ROW.PANEL_PRIMARY, BOM_COL.QTY));
    t.assert('panel unit = pcs', 'pcs',
      _writeAtBom(w, BOM_ROW.PANEL_PRIMARY, BOM_COL.UNIT));
    t.assert('panel ref = PROD_ID', 'PANEL_JK_580',
      _writeAtBom(w, BOM_ROW.PANEL_PRIMARY, BOM_COL.REFERENCE));
    // panelUsdUnit = 0.22 * 580 = 127.60 USD per panel
    t.assert('panel unit price USD = 127.60', 127.60,
      _writeAtBom(w, BOM_ROW.PANEL_PRIMARY, BOM_COL.UNIT_PRICE));

    // Subtotal formula at SUBTOTAL_PANELS
    var sub = _formulaAtBom(w, BOM_ROW.SUBTOTAL_PANELS, BOM_COL.TOTAL_USD);
    t.assertTrue('panels subtotal is SUM formula',
      sub && sub.indexOf('=SUM(F') === 0);
    t.assertTrue('panels subtotal spans PANEL_PRIMARY..SUBTOTAL_PANELS-1',
      sub.indexOf('F' + BOM_ROW.PANEL_PRIMARY) !== -1 &&
      sub.indexOf('F' + (BOM_ROW.SUBTOTAL_PANELS - 1)) !== -1);
    t.assert('panels subtotal label written',
      'SUBTOTAL PANELES SOLARES',
      _writeAtBom(w, BOM_ROW.SUBTOTAL_PANELS, BOM_COL.DESCRIPTION));
  }
});


// =============================================================================
// TEST 4 — §2 INVERTERS + §3 STRUCTURE
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_INVERTERS_AND_STRUCTURE',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: §2 INVERTERS + §3 STRUCTURE (resolved via structureDb)');

    var f = _makeBomFixtures();
    var ss = _makeBomMockSpreadsheet({ inputs: { trayM: 0 } });
    writeBomV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay,
               f.nom, f.bessResult, _makeBomTestOpts());
    var w = ss._bom._writes;

    // §2 INVERTERS
    t.assert('§2 header', '2. INVERSORES',
      _writeAtBom(w, BOM_ROW.SEC_INVERTERS, BOM_COL.DESCRIPTION));
    var invDesc = _writeAtBom(w, BOM_ROW.INVERTER_PRIMARY, BOM_COL.DESCRIPTION);
    t.assertTrue('inverter desc contains model',
      invDesc && invDesc.indexOf('SUN2000-100KTL') !== -1);
    t.assertTrue('inverter desc contains 3F',
      invDesc && invDesc.indexOf('3F') !== -1);
    t.assert('inverter qty = 1', 1,
      _writeAtBom(w, BOM_ROW.INVERTER_PRIMARY, BOM_COL.QTY));
    t.assert('inverter ref = invId', 'INV_HW_100',
      _writeAtBom(w, BOM_ROW.INVERTER_PRIMARY, BOM_COL.REFERENCE));
    t.assert('inverter price = 9500 USD', 9500,
      _writeAtBom(w, BOM_ROW.INVERTER_PRIMARY, BOM_COL.UNIT_PRICE));

    // §3 STRUCTURE — primary resolved via structureDb (STR_004)
    t.assert('§3 header', '3. ESTRUCTURA',
      _writeAtBom(w, BOM_ROW.SEC_STRUCTURE, BOM_COL.DESCRIPTION));
    var strDesc = _writeAtBom(w, BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.DESCRIPTION);
    t.assert('structure resolved to "CLIP&RAIL KR18 CLIP"',
      'CLIP&RAIL KR18 CLIP', strDesc);
    t.assert('structure qty = panelQty = 100', 100,
      _writeAtBom(w, BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.QTY));
    t.assert('structure price = 8.50 USD/panel', 8.50,
      _writeAtBom(w, BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.UNIT_PRICE));
    var strRef = _writeAtBom(w, BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.REFERENCE);
    t.assertTrue('structure ref includes STR_004',
      strRef && strRef.indexOf('STR_004') !== -1);

    // Inverter mounting row — always present
    var imDesc = _writeAtBom(w, BOM_ROW.STRUCTURE_INVERTER, BOM_COL.DESCRIPTION);
    t.assertTrue('inverter mounting desc present',
      imDesc && imDesc.indexOf('Estructura montaje inversores') !== -1);
    t.assert('inverter mounting qty = 1 (invCount=1)', 1,
      _writeAtBom(w, BOM_ROW.STRUCTURE_INVERTER, BOM_COL.QTY));
  }
});


// =============================================================================
// TEST 5 — §4 DC: cable + EGC + MC4 + OCPD + conduit (no tray, no RSD)
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_DC_BASIC',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: §4 DC writes cable/EGC/MC4/OCPD/conduit (no tray, no RSD)');

    var f = _makeBomFixtures();
    var ss = _makeBomMockSpreadsheet({ inputs: { trayM: 0 } });
    writeBomV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay,
               f.nom, f.bessResult, _makeBomTestOpts());
    var w = ss._bom._writes;

    t.assert('§4 header', '4. ELECTRICO DC',
      _writeAtBom(w, BOM_ROW.SEC_DC, BOM_COL.DESCRIPTION));

    // DC cable (PV WIRE 10 AWG @ 30 MXN/m, qty=320m)
    var cableDesc = _writeAtBom(w, BOM_ROW.DC_CABLE, BOM_COL.DESCRIPTION);
    t.assertTrue('DC cable desc contains PV WIRE',
      cableDesc && cableDesc.indexOf('PV WIRE') !== -1);
    t.assert('DC cable qty = 320m', 320,
      _writeAtBom(w, BOM_ROW.DC_CABLE, BOM_COL.QTY));
    // NOTE: legacy parity quirk — wp(row, null, pvWireObj.price) writes the
    // BOS price as USD without checking isUsd. This matches legacy 08_WriteBOM.js.
    // pvWireObj returns {price:30, isUsd:false} but the writer dispatches it
    // as USD anyway. We assert what the writer actually does (literal value 30
    // at E27), not what would be technically correct.
    t.assert('DC cable unit price = 30 (literal — matches legacy parity quirk)', 30,
      _writeAtBom(w, BOM_ROW.DC_CABLE, BOM_COL.UNIT_PRICE));

    // EGC 8 AWG
    var egcDesc = _writeAtBom(w, BOM_ROW.DC_GROUNDING, BOM_COL.DESCRIPTION);
    t.assertTrue('DC EGC desc mentions 8',
      egcDesc && egcDesc.indexOf('8') !== -1);
    t.assert('DC EGC qty = 60m', 60,
      _writeAtBom(w, BOM_ROW.DC_GROUNDING, BOM_COL.QTY));

    // MC4 — USD price (5.50)
    t.assert('MC4 unit price = 5.50 USD', 5.50,
      _writeAtBom(w, BOM_ROW.DC_MC4, BOM_COL.UNIT_PRICE));
    t.assert('MC4 qty = 8 pairs', 8,
      _writeAtBom(w, BOM_ROW.DC_MC4, BOM_COL.QTY));

    // OCPD 16 fuses
    t.assert('DC OCPD qty = 16', 16,
      _writeAtBom(w, BOM_ROW.DC_OCPD, BOM_COL.QTY));

    // Conduit IMC 1" — ceil(45/3)=15 sticks
    var conduitDesc = _writeAtBom(w, BOM_ROW.DC_CONDUIT, BOM_COL.DESCRIPTION);
    t.assertTrue('DC conduit desc IMC 1"',
      conduitDesc && conduitDesc.indexOf('Conduit IMC 1"') !== -1);
    t.assert('DC conduit qty = 15 sticks', 15,
      _writeAtBom(w, BOM_ROW.DC_CONDUIT, BOM_COL.QTY));

    // RSD not required → no qty
    t.assert('DC RSD qty empty (not required)', null,
      _writeAtBom(w, BOM_ROW.DC_RSD, BOM_COL.QTY));

    // Subtotal at SUBTOTAL_DC
    var dcSub = _formulaAtBom(w, BOM_ROW.SUBTOTAL_DC, BOM_COL.TOTAL_USD);
    t.assertTrue('DC subtotal SUM formula present',
      dcSub && dcSub.indexOf('=SUM(F' + BOM_ROW.DC_CABLE) === 0);
  }
});


// =============================================================================
// TEST 6 — §4 DC with trayM > 0 switches to ladder tray rows
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_DC_TRAY_MODE',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: §4 DC switches to "charola" when trayM > 0');

    var f = _makeBomFixtures();
    var ss = _makeBomMockSpreadsheet({ inputs: { trayM: 30 } });  // 30m tray
    var opts = _makeBomTestOpts({ inputs: { trayM: 30 } });       // ← readInputFn must see 30
    writeBomV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay,
               f.nom, f.bessResult, opts);
    var w = ss._bom._writes;

    var trayDesc = _writeAtBom(w, BOM_ROW.DC_CONDUIT, BOM_COL.DESCRIPTION);
    t.assertTrue('DC slot description switched to "charola"',
      trayDesc && trayDesc.indexOf('Charola tipo escalera') !== -1);
    // trayTramosDC = ceil(30 / 3) = 10
    t.assert('DC tray tramos qty = 10', 10,
      _writeAtBom(w, BOM_ROW.DC_CONDUIT, BOM_COL.QTY));
    t.assert('DC tray unit = tramo', 'tramo',
      _writeAtBom(w, BOM_ROW.DC_CONDUIT, BOM_COL.UNIT));
  }
});


// =============================================================================
// TEST 7 — §5 AC main feeder + breaker + panelboard + per-inverter block
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_AC',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: §5 AC main feeder/breaker/panelboard + per-inverter block');

    var f = _makeBomFixtures();
    var ss = _makeBomMockSpreadsheet({ inputs: { trayM: 0 } });
    writeBomV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay,
               f.nom, f.bessResult, _makeBomTestOpts());
    var w = ss._bom._writes;

    t.assert('§5 header', '5. ELECTRICO AC',
      _writeAtBom(w, BOM_ROW.SEC_AC, BOM_COL.DESCRIPTION));

    // Main feeder (THHW 4/0)
    var feederDesc = _writeAtBom(w, BOM_ROW.AC_FEEDER, BOM_COL.DESCRIPTION);
    t.assertTrue('feeder desc contains 4/0', feederDesc && feederDesc.indexOf('4/0') !== -1);
    t.assert('feeder qty = 195m', 195,
      _writeAtBom(w, BOM_ROW.AC_FEEDER, BOM_COL.QTY));

    // Main EGC
    t.assert('main EGC qty = 65m', 65,
      _writeAtBom(w, BOM_ROW.AC_EGC, BOM_COL.QTY));

    // Main breaker 200A 3P (exact match → 8500 MXN in fixture)
    // Legacy parity quirk: wp(row, null, mBrkResult.price) dispatches as USD
    // even though breakerPriceWithFallback returns MXN. We assert what the
    // writer actually does (literal 8500 at E39), matching legacy 08_WriteBOM.js.
    t.assert('main breaker unit price = 8500 (literal — legacy parity)', 8500,
      _writeAtBom(w, BOM_ROW.AC_BREAKER, BOM_COL.UNIT_PRICE));

    // Panelboard 200A (PB_200)
    var pbRef = _writeAtBom(w, BOM_ROW.AC_PANELBOARD, BOM_COL.REFERENCE);
    t.assertTrue('panelboard ref includes PB_200',
      pbRef && pbRef.indexOf('PB_200') !== -1);

    // Per-inverter block at AC_INV_BLOCK_START (slot 0)
    var slot0Base = BOM_ROW.AC_INV_BLOCK_START;
    var slot0Cable = _writeAtBom(w, slot0Base, BOM_COL.DESCRIPTION);
    t.assertTrue('slot 0 cable line written',
      slot0Cable && slot0Cable.indexOf('SUN2000-100KTL') !== -1);
    t.assertTrue('slot 0 cable mentions 2/0',
      slot0Cable && slot0Cable.indexOf('2/0') !== -1);
    t.assert('slot 0 cable qty = cableM 60', 60,
      _writeAtBom(w, slot0Base, BOM_COL.QTY));

    // Subtotal at SUBTOTAL_AC
    var acSub = _formulaAtBom(w, BOM_ROW.SUBTOTAL_AC, BOM_COL.TOTAL_USD);
    t.assertTrue('AC subtotal formula present',
      acSub && acSub.indexOf('=SUM(F' + BOM_ROW.AC_FEEDER) === 0);
  }
});


// =============================================================================
// TEST 8 — §6 TRANSFORMER conditional on supplyTransformer
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_TRANSFORMER_VARIANTS',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: §6 TRANSFORMER reflects supplyTransformer flag');

    // CASE A: Argia supplies (supplyTransformer != 0)
    var fA = _makeBomFixtures();
    var ssA = _makeBomMockSpreadsheet({ inputs: { trayM: 0 } });
    writeBomV2(ssA, fA.inp, fA.panel, fA.invBank, fA.dc, fA.ac, fA.lay,
               fA.nom, fA.bessResult, _makeBomTestOpts());
    var descA = _writeAtBom(ssA._bom._writes, BOM_ROW.TRANSFORMER, BOM_COL.DESCRIPTION);
    t.assertTrue('Argia-supplied desc contains kVA value',
      descA && descA.indexOf('75 kVA') !== -1);
    t.assertFalse('Argia-supplied does NOT mention "suministro del cliente"',
      descA && descA.indexOf('suministro del cliente') !== -1);

    // CASE B: customer supplies (supplyTransformer === 0)
    var fB = _makeBomFixtures();
    fB.inp.supplyTransformer = 0;
    var ssB = _makeBomMockSpreadsheet({ inputs: { trayM: 0 } });
    writeBomV2(ssB, fB.inp, fB.panel, fB.invBank, fB.dc, fB.ac, fB.lay,
               fB.nom, fB.bessResult, _makeBomTestOpts());
    var descB = _writeAtBom(ssB._bom._writes, BOM_ROW.TRANSFORMER, BOM_COL.DESCRIPTION);
    t.assertTrue('customer-supplied desc mentions "suministro del cliente"',
      descB && descB.indexOf('suministro del cliente') !== -1);
    // No unit price written
    var priceB = _writeAtBom(ssB._bom._writes, BOM_ROW.TRANSFORMER, BOM_COL.UNIT_PRICE);
    t.assert('customer-supplied has no unit price', null, priceB);
  }
});


// =============================================================================
// TEST 9 — §7 MONITORING writes 4 services at $1500 USD each
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_MONITORING',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: §7 MONITORING — datalogger + meter + 4 $1500 services');

    var f = _makeBomFixtures();
    var ss = _makeBomMockSpreadsheet({ inputs: { trayM: 0 } });
    writeBomV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay,
               f.nom, f.bessResult, _makeBomTestOpts());
    var w = ss._bom._writes;

    // Datalogger
    t.assert('datalogger qty = 1', 1,
      _writeAtBom(w, BOM_ROW.MON_DATALOGGER, BOM_COL.QTY));
    // Meter
    t.assert('meter qty = 1', 1,
      _writeAtBom(w, BOM_ROW.MON_METER, BOM_COL.QTY));

    // 4 services each $1500 USD
    var serviceRows = [BOM_ROW.MON_UVIE, BOM_ROW.MON_CFE,
                       BOM_ROW.MON_COMMISSIONING, BOM_ROW.MON_THERMOGRAPHY];
    serviceRows.forEach(function(r) {
      t.assert('service row ' + r + ' unit_price = 1500 USD', 1500,
        _writeAtBom(w, r, BOM_COL.UNIT_PRICE));
      t.assert('service row ' + r + ' unit = "servicio"', 'servicio',
        _writeAtBom(w, r, BOM_COL.UNIT));
      t.assert('service row ' + r + ' qty = 1', 1,
        _writeAtBom(w, r, BOM_COL.QTY));
    });
  }
});


// =============================================================================
// TEST 10 — §8 BESS PV-only: single "pendiente" line, no further rows
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_BESS_PV_ONLY',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: §8 BESS PV-only writes single "pendiente" line');

    var f = _makeBomFixtures();
    // bessResult: BESS not enabled
    f.bessResult = { bessEnabled: false, bos: { blocked: false, lines: [] } };
    var ss = _makeBomMockSpreadsheet({ inputs: { trayM: 0 } });
    writeBomV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay,
               f.nom, f.bessResult, _makeBomTestOpts());
    var w = ss._bom._writes;

    t.assert('§8 header', '8. ALMACENAMIENTO / BESS',
      _writeAtBom(w, BOM_ROW.SEC_BESS, BOM_COL.DESCRIPTION));

    // Single pendiente line at BESS_BATTERY_LINE
    var bessLine = _writeAtBom(w, BOM_ROW.BESS_BATTERY_LINE, BOM_COL.DESCRIPTION);
    t.assertTrue('PV-only writes "Sistema BESS — pendiente" at BESS_BATTERY_LINE',
      bessLine && bessLine.indexOf('Sistema BESS') !== -1 &&
      bessLine.indexOf('pendiente') !== -1);
    // No qty written
    t.assert('BESS pendiente line has no qty', null,
      _writeAtBom(w, BOM_ROW.BESS_BATTERY_LINE, BOM_COL.QTY));
    // No other BESS row should have a description
    t.assert('BESS_DC_CABLE not populated', null,
      _writeAtBom(w, BOM_ROW.BESS_DC_CABLE, BOM_COL.DESCRIPTION));
  }
});


// =============================================================================
// TEST 11 — §8 BESS enabled: maps BESS-01..12 codes to fixed rows
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_BESS_LINES',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: §8 BESS-enabled maps BoS codes to fixed rows');

    var f = _makeBomFixtures();
    // Realistic BESS result with battery + commissioning + a conductor line
    f.bessResult = {
      bessEnabled: true,
      bos: {
        blocked: false,
        lines: [
          { code: 'BESS-01', description: 'Battery rack BMS', qty: 4, unit: 'pcs',
            productCategory: 'BESS_BATTERY',
            productSpec: { batteryId: 'BAT_TAIGENE_100' },
            nomCite: 'NOM 690-15' },
          { code: 'BESS-12', description: 'BESS commissioning', qty: 1, unit: 'servicio',
            productCategory: 'COMMISSIONING',
            productSpec: { flatPriceMxn: 45000 },
            nomCite: 'QA-BESS' }
        ]
      }
    };
    var ss = _makeBomMockSpreadsheet({
      inputs: { trayM: 0 },
      batteryPrices: {
        'BAT_TAIGENE_100': { priceMxn: 250000, provenance: 'DIRECT' }
      }
    });
    var opts = _makeBomTestOpts({
      inputs: { trayM: 0 },
      batteryPrices: {
        'BAT_TAIGENE_100': { priceMxn: 250000, provenance: 'DIRECT' }
      }
    });
    writeBomV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay,
               f.nom, f.bessResult, opts);
    var w = ss._bom._writes;

    // BESS-01 → BESS_BATTERY_LINE
    t.assert('BESS-01 desc at BESS_BATTERY_LINE', 'Battery rack BMS',
      _writeAtBom(w, BOM_ROW.BESS_BATTERY_LINE, BOM_COL.DESCRIPTION));
    t.assert('BESS-01 qty = 4', 4,
      _writeAtBom(w, BOM_ROW.BESS_BATTERY_LINE, BOM_COL.QTY));
    // Battery price 250000 MXN → formula =250000.0000/$F$<EXCHANGE_RATE>
    var batPrice = _formulaAtBom(w, BOM_ROW.BESS_BATTERY_LINE, BOM_COL.UNIT_PRICE);
    t.assertTrue('battery price is MXN formula referencing 250000',
      batPrice && batPrice.indexOf('250000') !== -1 &&
      batPrice.indexOf('/$F$' + BOM_ROW.EXCHANGE_RATE) !== -1);

    // BESS-12 → BESS_COMMISSIONING
    t.assert('BESS-12 desc at BESS_COMMISSIONING', 'BESS commissioning',
      _writeAtBom(w, BOM_ROW.BESS_COMMISSIONING, BOM_COL.DESCRIPTION));
    // Commissioning price 45000 MXN
    var commPrice = _formulaAtBom(w, BOM_ROW.BESS_COMMISSIONING, BOM_COL.UNIT_PRICE);
    t.assertTrue('commissioning price is MXN formula referencing 45000',
      commPrice && commPrice.indexOf('45000') !== -1);
  }
});


// =============================================================================
// TEST 12 — Grand total formula sums all 8 subtotals
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_V2_BOM_GRAND_TOTAL',
  group   : 'unit',
  module  : 'writers_v2/bom',
  scenarios: [],
  tags    : ['writers_v2', 'bom', 'chunk4'],
  source  : 'tests_unit/writers_v2/WriteBomV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/bom: GRAND_TOTAL formula sums all 8 section subtotals');

    var f = _makeBomFixtures();
    var ss = _makeBomMockSpreadsheet({ inputs: { trayM: 0 } });
    writeBomV2(ss, f.inp, f.panel, f.invBank, f.dc, f.ac, f.lay,
               f.nom, f.bessResult, _makeBomTestOpts());

    var gt = _formulaAtBom(ss._bom._writes, BOM_ROW.GRAND_TOTAL, BOM_COL.TOTAL_USD);
    t.assertTrue('grand total formula present', gt && gt.indexOf('=F') === 0);

    // Verify it sums all 8 subtotal rows
    var requiredRefs = [
      BOM_ROW.SUBTOTAL_PANELS, BOM_ROW.SUBTOTAL_INVERTERS,
      BOM_ROW.SUBTOTAL_STRUCTURE, BOM_ROW.SUBTOTAL_DC,
      BOM_ROW.SUBTOTAL_AC, BOM_ROW.SUBTOTAL_TRANSFORMER,
      BOM_ROW.SUBTOTAL_MONITORING, BOM_ROW.SUBTOTAL_BESS
    ];
    requiredRefs.forEach(function(r) {
      t.assertTrue('GT formula references F' + r,
        gt.indexOf('F' + r) !== -1);
    });

    // MXN row formula references grand total F-row times rate
    var gtMxn = _formulaAtBom(ss._bom._writes, BOM_ROW.GRAND_TOTAL, BOM_COL.TOTAL_MXN);
    t.assertTrue('GT MXN formula references USD GT row',
      gtMxn && gtMxn.indexOf('F' + BOM_ROW.GRAND_TOTAL) !== -1);
  }
});
