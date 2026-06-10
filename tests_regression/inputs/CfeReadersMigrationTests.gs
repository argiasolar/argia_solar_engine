// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/CfeReadersMigrationTests.gs
// -----------------------------------------------------------------------------
// [A2b] Locks the migration of four INPUT_CFE readers in 02_LoadDB.js off
// hardcoded getRange() onto readInput()/INPUT_MAP:
//   - readBessInterconnectionFromInputCfe  (scalar C41 mode / C42 export price)
//   - deriveBessTariffRatesFromInputCfe     (range C10/C12/C25/C27)
//   - buildBessLoadProfileFromInputCfe      (range C12/C15/C18)
//   - deriveBessDemandChargeFromInputCfe    (range C21/C19)
//
// Each is driven with a mock INPUT_CFE that serves BOTH scalar reads
// (getRange(row,col).getValue()) and range reads (getRange('Cr:Nr').getValues()),
// so the readers run without a live workbook and are asserted against the exact
// values the pre-migration code produced — including the empty-cell / threshold
// / provenance behavior.
//
// The single most important assertion is the interconnection empty-cell case:
// an unset C41 must resolve to UNKNOWN. The map default for cfeInterconnMode was
// flipped to '' specifically so this stays true after migration; the old
// 'SIN_EXPORTACION' default would have silently promoted it to ZERO_EXPORT.
// =============================================================================

function _mockCfeSs(opts) {
  opts = opts || {};
  var scalars = opts.scalars || {};   // { 41: 'SIN_EXPORTACION', 42: 1.5 }  (col-3 cells)
  var monthly = opts.monthly || {};   // { 12: [..12..], 15: [..12..] }  (row -> C..N values)
  var EMPTY12 = [0,0,0,0,0,0,0,0,0,0,0,0];
  return {
    getSheetByName: function (name) {
      if (name !== 'INPUT_CFE') return null;
      return {
        getRange: function (a /* row | a1 */, b /* col */) {
          if (typeof a === 'string') {            // range mode: 'C12:N12'
            var m = a.match(/^[A-Z]+(\d+):[A-Z]+\d+$/);
            var row = m ? Number(m[1]) : 0;
            var vals = monthly.hasOwnProperty(row) ? monthly[row] : EMPTY12;
            return { getValues: function () { return [ vals.slice() ]; } };
          }
          return { getValue: function () {        // scalar mode: (row, col)
            return scalars.hasOwnProperty(a) ? scalars[a] : '';
          }};
        }
      };
    }
  };
}

function _arr12(v) { return [v, v, v, v, v, v, v, v, v, v, v, v]; }

registerTest({
  id      : 'REG_MIGRATE_CFE_READERS',
  group   : 'regression',
  module  : 'inputs/migration',
  scenarios: [],
  tags    : ['inputs', 'map', 'cfe', 'a2', 'migration'],
  source  : 'tests_regression/inputs/CfeReadersMigrationTests.gs',
  fn: function (t, ctx) {

    // ---- readBessInterconnectionFromInputCfe --------------------------------
    t.suite('REG inputs/migration [A2b]: readBessInterconnectionFromInputCfe');
    function icx(c41, c42) {
      return readBessInterconnectionFromInputCfe(
        _mockCfeSs({ scalars: (function(){ var s={}; if(c41!==undefined)s[41]=c41; if(c42!==undefined)s[42]=c42; return s; })() })
      );
    }
    t.assert('MEDICION_NETA -> NET_METERING',    'NET_METERING', icx('MEDICION_NETA').mode);
    t.assert('FACTURACION_NETA -> NET_BILLING',  'NET_BILLING',  icx('FACTURACION_NETA').mode);
    t.assert('SIN_EXPORTACION -> ZERO_EXPORT',   'ZERO_EXPORT',  icx('SIN_EXPORTACION').mode);
    t.assert('lowercase is uppercased',          'ZERO_EXPORT',  icx('sin_exportacion').mode);
    t.assert('whitespace trimmed',               'NET_METERING', icx('  MEDICION_NETA ').mode);
    t.assert('known mode -> provenance INPUT_CFE','INPUT_CFE',   icx('SIN_EXPORTACION').provenance);
    t.assert('export price read from C42',        1.5,           icx('SIN_EXPORTACION', 1.5).exportPriceMxnPerKwh);
    // The parity-critical pair: empty C41 must stay UNKNOWN/MISSING (default '' fix).
    t.assert('EMPTY C41 -> UNKNOWN (not ZERO_EXPORT)', 'UNKNOWN', icx(undefined).mode);
    t.assert('EMPTY C41 -> provenance MISSING',   'MISSING',     icx(undefined).provenance);
    t.assert('garbage mode -> UNKNOWN',           'UNKNOWN',      icx('FOO_BAR').mode);
    t.assert('empty export price -> 0',           0,              icx('SIN_EXPORTACION').exportPriceMxnPerKwh);
    var icNoSheet = readBessInterconnectionFromInputCfe({ getSheetByName: function(){ return null; } });
    t.assert('no sheet -> UNKNOWN',  'UNKNOWN', icNoSheet.mode);
    t.assert('no sheet -> MISSING',  'MISSING', icNoSheet.provenance);

    // ---- deriveBessTariffRatesFromInputCfe ----------------------------------
    t.suite('REG inputs/migration [A2b]: deriveBessTariffRatesFromInputCfe');
    // 12 full months: kwhP=100, kwhB=200, enrP=500, enrB=600
    //   punta = (500*12)/(100*12) = 5.0 ; base = (600*12)/(200*12) = 3.0
    var tr = deriveBessTariffRatesFromInputCfe(_mockCfeSs({ monthly: {
      10: _arr12(200), 12: _arr12(100), 25: _arr12(600), 27: _arr12(500)
    }}));
    t.assert('tariff months read = 12',    12,  tr.monthsRead);
    t.assertNear('puntaMxnPerKwh = 5.0',   5.0, tr.puntaMxnPerKwh, 1e-9);
    t.assertNear('baseMxnPerKwh = 3.0',    3.0, tr.baseMxnPerKwh,  1e-9);
    t.assert('tariff provenance',          'INPUT_CFE_DERIVED', tr.provenance);
    // Only 5 valid months (rest zero) -> INSUFFICIENT_DATA, rates 0
    function first5(v){ return [v,v,v,v,v,0,0,0,0,0,0,0]; }
    var trLow = deriveBessTariffRatesFromInputCfe(_mockCfeSs({ monthly: {
      10: first5(200), 12: first5(100), 25: first5(600), 27: first5(500)
    }}));
    t.assert('insufficient months read = 5',    5, trLow.monthsRead);
    t.assert('insufficient -> rates 0',         0, trLow.puntaMxnPerKwh);
    t.assert('insufficient provenance',  'INSUFFICIENT_DATA', trLow.provenance);
    t.assert('tariff no sheet provenance', 'NO_INPUT_CFE_SHEET',
      deriveBessTariffRatesFromInputCfe({ getSheetByName: function(){ return null; } }).provenance);

    // ---- buildBessLoadProfileFromInputCfe -----------------------------------
    t.suite('REG inputs/migration [A2b]: buildBessLoadProfileFromInputCfe');
    // 12 months, kwhP=100, kwP=50, dias empty(0) -> days defaults to 30
    var lp = buildBessLoadProfileFromInputCfe(_mockCfeSs({ monthly: {
      12: _arr12(100), 15: _arr12(50), 18: _arr12(0)
    }}));
    t.assert('load profile months = 12',  12, lp.months.length);
    t.assert('default days = 30',          30, lp.months[0].days);
    t.assert('kwhPunta passthrough',       100, lp.months[0].kwhPunta);
    t.assert('kwPunta passthrough',        50,  lp.months[0].kwPunta);
    t.assert('load profile provenance',    'SYNTHESIZED', lp.provenance);
    // Explicit days respected; a month with kwP=0 is dropped
    var diasMix = [28,28,28,28,28,28,28,28,28,28,28,28];
    var kwMix   = [50,50,0, 50,50,50,50,50,50,50,50,50];   // month 3 dropped
    var lp2 = buildBessLoadProfileFromInputCfe(_mockCfeSs({ monthly: {
      12: _arr12(100), 15: kwMix, 18: diasMix
    }}));
    t.assert('explicit days respected',    28, lp2.months[0].days);
    t.assert('zero-kW month dropped',      11, lp2.months.length);
    t.assert('lp no sheet provenance', 'NO_INPUT_CFE_SHEET',
      buildBessLoadProfileFromInputCfe({ getSheetByName: function(){ return null; } }).provenance);

    // ---- deriveBessDemandChargeFromInputCfe ---------------------------------
    t.suite('REG inputs/migration [A2b]: deriveBessDemandChargeFromInputCfe');
    // cap=1000, dem=100 over 12 months -> (1000*12)/(100*12) = 10.0
    var dc = deriveBessDemandChargeFromInputCfe(_mockCfeSs({ monthly: {
      21: _arr12(1000), 19: _arr12(100)
    }}));
    t.assert('demand months read = 12',    12,   dc.monthsRead);
    t.assertNear('demandChargeMxnPerKw = 10.0', 10.0, dc.demandChargeMxnPerKw, 1e-9);
    t.assert('demand provenance',          'INPUT_CFE_DERIVED', dc.provenance);
    var dcLow = deriveBessDemandChargeFromInputCfe(_mockCfeSs({ monthly: {
      21: first5(1000), 19: first5(100)
    }}));
    t.assert('demand insufficient read = 5',   5, dcLow.monthsRead);
    t.assert('demand insufficient -> 0',       0, dcLow.demandChargeMxnPerKw);
    t.assert('demand insufficient provenance', 'INSUFFICIENT_DATA', dcLow.provenance);
    t.assert('demand no sheet provenance', 'NO_INPUT_CFE_SHEET',
      deriveBessDemandChargeFromInputCfe({ getSheetByName: function(){ return null; } }).provenance);
  }
});
