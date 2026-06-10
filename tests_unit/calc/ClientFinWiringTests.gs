// =============================================================================
// ARGIA TESTS -- tests_unit/calc/ClientFinWiringTests.gs
// -----------------------------------------------------------------------------
// [Track B P0] Locks the runClientFinancials wiring readers:
//   - _cfinReadBills: sin-PV = row19+row20, with = row31, banner fallbacks
//   - _cfinReadCapexTotalMxn: BOM grand total + INSTALLATION grand total
//   - _cfinReadDemandSavings: rows 27+28
//   - _cfinReadEnergyKwh: row 15
// Mock spreadsheet serves both getRange(row, col) and getRange('A1') forms.
// =============================================================================

function _cfinMockSs(sheets) {
  // sheets: { SHEET_NAME: { 'r,c': value, 'A1': value } }
  function mkSheet(cells) {
    return {
      getRange: function (a, b) {
        var key = (typeof a === 'string') ? a : (a + ',' + b);
        return { getValue: function () {
          return cells.hasOwnProperty(key) ? cells[key] : '';
        } };
      }
    };
  }
  return {
    getSheetByName: function (name) {
      return sheets.hasOwnProperty(name) ? mkSheet(sheets[name]) : null;
    }
  };
}

// Build a CFE_OUTPUT_v2 cell dict with a flat monthly value per row.
function _cfinCfeCells(perMonth) {
  // perMonth: { rowNumber: monthlyValue }
  var cells = {};
  var cols = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  Object.keys(perMonth).forEach(function (row) {
    cols.forEach(function (c) { cells[row + ',' + c] = perMonth[row]; });
  });
  return cells;
}

registerTest({
  id      : 'UNIT_CALC_CLIENT_FIN_WIRING',
  group   : 'unit',
  module  : 'calc/client_financials',
  scenarios: [],
  tags    : ['calc', 'financials', 'trackb', 'wiring'],
  source  : 'tests_unit/calc/ClientFinWiringTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/client_financials: wiring readers');

    // -- CASE 1: fully populated (flat monthly values, hand-computable) ------
    // row19 con-PV 100k/mo, row20 ahorro-PV 50k/mo -> sinPV 1.8M annual
    // row31 final 80k/mo -> 0.96M; rows 27/28 -> 180k; row15 50k kWh -> 600k
    var ss1 = _cfinMockSs({
      'CFE_OUTPUT_v2': _cfinCfeCells({ 15: 50000, 19: 100000, 20: 50000,
                                       27: 10000, 28: 5000, 31: 80000 }),
      'BOM_v2':          (function () { var c = {}; c[BOM_ROW.GRAND_TOTAL + ',' + BOM_COL.TOTAL_MXN] = 12000000; return c; })(),
      'INSTALLATION_v2': (function () { var c = {}; c[_INST_V2_SUM_ROWS.GRAND_TOTAL + ',' + _INST_V2_SUM_COL_VAL] = 3000000; return c; })()
    });

    var bills1 = _cfinReadBills(ss1);
    t.assert('bills: sin-PV = 12x(100k+50k) = 1.8M', 1800000, bills1.billWithoutMxn);
    t.assert('bills: with system = 12x80k = 960k',   960000,  bills1.billWithMxn);
    t.assertTrue('bills: ok', bills1.ok);
    t.assert('bills: no warnings on direct read', 0, bills1.warnings.length);

    var capex1 = _cfinReadCapexTotalMxn(ss1);
    t.assert('capex: materials from BOM G' + BOM_ROW.GRAND_TOTAL, 12000000, capex1.materialsMxn);
    t.assert('capex: install from INSTALL G' + _INST_V2_SUM_ROWS.GRAND_TOTAL, 3000000, capex1.installMxn);
    t.assert('capex: total = 15M', 15000000, capex1.totalMxn);
    t.assertTrue('capex: ok', capex1.ok);

    t.assert('demand savings = 12x(10k+5k) = 180k', 180000, _cfinReadDemandSavings(ss1));
    t.assert('energy = 12x50k = 600k kWh',          600000, _cfinReadEnergyKwh(ss1));

    // -- CASE 2: monthly rows empty -> banner fallback ------------------------
    var cells2 = {};
    cells2['C10'] = 'RECIBO ANUAL SIN PV\n$1,800,000';
    cells2['L10'] = 'RECIBO FINAL\n$960,000';
    var ss2 = _cfinMockSs({ 'CFE_OUTPUT_v2': cells2 });
    var bills2 = _cfinReadBills(ss2);
    t.assert('fallback: sin-PV from C10 banner', 1800000, bills2.billWithoutMxn);
    t.assert('fallback: final from L10 banner',  960000,  bills2.billWithMxn);
    t.assert('fallback: two warnings logged', 2, bills2.warnings.length);

    // -- CASE 3: missing sheets -> graceful zeros + warnings -------------------
    var ss3 = _cfinMockSs({});
    var bills3 = _cfinReadBills(ss3);
    t.assertTrue('missing CFE: not ok', !bills3.ok);
    t.assert('missing CFE: bills zero', 0, bills3.billWithoutMxn + bills3.billWithMxn);
    var capex3 = _cfinReadCapexTotalMxn(ss3);
    t.assertTrue('missing BOM+INSTALL: not ok', !capex3.ok);
    t.assert('missing BOM+INSTALL: 2 warnings', 2, capex3.warnings.length);
    t.assert('missing CFE: demand savings 0', 0, _cfinReadDemandSavings(ss3));
    t.assert('missing CFE: energy 0',          0, _cfinReadEnergyKwh(ss3));

    // -- CASE 4: bills sanity gate (with >= without -> not ok) ----------------
    var ss4 = _cfinMockSs({
      'CFE_OUTPUT_v2': _cfinCfeCells({ 19: 100000, 20: 0, 31: 100000 })
    });
    t.assertTrue('with == without -> ok=false (no savings to analyze)',
                 !_cfinReadBills(ss4).ok);
  }
});
