// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/CfeFullBillMigrationTests.gs
// -----------------------------------------------------------------------------
// [A2b] Locks the migration of the remaining two INPUT_CFE readers in
// 02_LoadDB.js off hardcoded getRange() onto readInput()/INPUT_MAP:
//   - deriveFullTariffRatesFromInputCfe  (range r10/r11/r12 + r25/r26/r27)
//   - buildFullBillFromInputCfe          (header C4/C5 scalars + range r10-r15)
//
// Reuses the _mockCfeSs / _arr12 helpers defined in CfeReadersMigrationTests.gs
// (shared global scope under both GAS and the Node self-test rig). buildFullBill
// adds the header tariff/region scalar reads, so the header coercion
// (text default '' -> String(...).trim().toUpperCase()) is asserted explicitly.
// =============================================================================

registerTest({
  id      : 'REG_MIGRATE_CFE_FULLBILL',
  group   : 'regression',
  module  : 'inputs/migration',
  scenarios: [],
  tags    : ['inputs', 'map', 'cfe', 'a2', 'migration'],
  source  : 'tests_regression/inputs/CfeFullBillMigrationTests.gs',
  fn: function (t, ctx) {

    // ---- deriveFullTariffRatesFromInputCfe ----------------------------------
    t.suite('REG inputs/migration [A2b]: deriveFullTariffRatesFromInputCfe');
    // 12 full months: kwhB=200,kwhI=150,kwhP=100 ; mxnB=600,mxnI=450,mxnP=500
    //   punta=(500*12)/(100*12)=5.0 ; inter=(450*12)/(150*12)=3.0 ; base=600/200=3.0
    var fr = deriveFullTariffRatesFromInputCfe(_mockCfeSs({ monthly: {
      10: _arr12(200), 11: _arr12(150), 12: _arr12(100),
      25: _arr12(600), 26: _arr12(450), 27: _arr12(500)
    }}));
    t.assert('full tariff months = 12',        12,  fr.monthsRead);
    t.assertNear('puntaMxnPerKwh = 5.0',       5.0, fr.puntaMxnPerKwh,      1e-9);
    t.assertNear('intermediaMxnPerKwh = 3.0',  3.0, fr.intermediaMxnPerKwh, 1e-9);
    t.assertNear('baseMxnPerKwh = 3.0',        3.0, fr.baseMxnPerKwh,       1e-9);
    t.assert('full tariff provenance',  'INPUT_CFE_DERIVED', fr.provenance);
    // Intermedia tier entirely zero -> intermediaMxnPerKwh 0, months still count
    var frNoI = deriveFullTariffRatesFromInputCfe(_mockCfeSs({ monthly: {
      10: _arr12(200), 11: _arr12(0), 12: _arr12(100),
      25: _arr12(600), 26: _arr12(0), 27: _arr12(500)
    }}));
    t.assert('zero-intermedia still 12 months', 12, frNoI.monthsRead);
    t.assert('zero-intermedia -> intermedia 0',  0, frNoI.intermediaMxnPerKwh);
    t.assertNear('zero-intermedia base intact', 3.0, frNoI.baseMxnPerKwh, 1e-9);
    // <6 valid months -> INSUFFICIENT_DATA
    function first5(v){ return [v,v,v,v,v,0,0,0,0,0,0,0]; }
    var frLow = deriveFullTariffRatesFromInputCfe(_mockCfeSs({ monthly: {
      10: first5(200), 11: first5(150), 12: first5(100),
      25: first5(600), 26: first5(450), 27: first5(500)
    }}));
    t.assert('full tariff insufficient read = 5', 5, frLow.monthsRead);
    t.assert('full tariff insufficient provenance', 'INSUFFICIENT_DATA', frLow.provenance);
    t.assert('full tariff no sheet provenance', 'NO_INPUT_CFE_SHEET',
      deriveFullTariffRatesFromInputCfe({ getSheetByName: function(){ return null; } }).provenance);

    // ---- buildFullBillFromInputCfe ------------------------------------------
    t.suite('REG inputs/migration [A2b]: buildFullBillFromInputCfe');
    // Header lowercase/whitespace must be trimmed + uppercased; bill rows passthrough.
    var bill = buildFullBillFromInputCfe(_mockCfeSs({
      scalars: { 4: 'gdmth', 5: '  golfo norte ' },
      monthly: {
        10: _arr12(100), 11: _arr12(50), 12: _arr12(30),
        13: _arr12(10),  14: _arr12(5),  15: _arr12(3)
      }
    }));
    t.assert('tariff trimmed + uppercased',  'GDMTH',       bill.tariff);
    t.assert('region trimmed + uppercased',  'GOLFO NORTE', bill.region);
    t.assert('monthlyBill kwhBase length 12', 12, bill.monthlyBill.kwhBase.length);
    t.assert('kwhBase[0] passthrough',        100, bill.monthlyBill.kwhBase[0]);
    t.assert('kwhIntermedia[0] passthrough',  50,  bill.monthlyBill.kwhIntermedia[0]);
    t.assert('kwPunta[0] passthrough',        3,   bill.monthlyBill.kwPunta[0]);
    t.assert('non-empty bill -> INPUT_CFE',   'INPUT_CFE', bill.provenance);
    // Empty bill rows -> provenance EMPTY, header still read
    var billEmpty = buildFullBillFromInputCfe(_mockCfeSs({ scalars: { 4: 'PDBT' } }));
    t.assert('empty bill provenance',  'EMPTY', billEmpty.provenance);
    t.assert('empty bill header read', 'PDBT',  billEmpty.tariff);
    t.assert('empty region -> ""',     '',      billEmpty.region);
    t.assert('empty bill kwhBase all 0', 0,
      billEmpty.monthlyBill.kwhBase.reduce(function(a,b){ return a + b; }, 0));
    // No sheet -> null monthlyBill, NO_INPUT_CFE_SHEET
    var billNoSheet = buildFullBillFromInputCfe({ getSheetByName: function(){ return null; } });
    t.assert('no sheet provenance', 'NO_INPUT_CFE_SHEET', billNoSheet.provenance);
    t.assertTrue('no sheet monthlyBill null', billNoSheet.monthlyBill === null);
  }
});
