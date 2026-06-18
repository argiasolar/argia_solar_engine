// =============================================================================
// ARGIA TESTS -- tests_unit/calc/InstallLaborBurdenTests.gs
// -----------------------------------------------------------------------------
// T8 (v4.42.0): LABOR_BURDEN factor (13_CalcInstallCost.js applyLaborBurden).
// PURE -- builds a synthetic install result at CULLIGAN scale and verifies the
// burden math + the totals/PERCENT/role recompute. No workbook.
//
// CULLIGAN baseline (pre-burden): LABOR 97,733.27 / EQUIP 166,880.00 /
// day-rate OTHER 440,199.40 / insurance 3% / contingency 5%. With burden 1.65:
//   LABOR  = 97,733.27 x 1.65                                  = 161,259.90
//   insur  = 0.03 x (161,259.90 + 166,880)                     =   9,844.20
//   conting= 0.05 x (161,259.90 + 166,880 + 440,199.40)        =  38,416.96
//   OTHER  = 440,199.40 + 9,844.20 + 38,416.96                 = 488,460.56
//   GRAND  = 161,259.90 + 166,880 + 488,460.56                 = 816,600.46
// =============================================================================

function _mkBurdenFixtureResult() {
  // Synthetic items mirroring the CULLIGAN install structure.
  var items = [
    { item: { section: 'GENERAL SITE', costType: 'LABOR_PRODUCTIVITY', laborRole: 'INSTALLER' },
      mhComputed: 869.2, laborMxn: 97733.27, equipMxn: 0, otherMxn: 0, totalMxn: 97733.27, roleRateVal: 112 },
    { item: { section: 'EQUIPMENT', costType: 'EQUIPMENT_DAY' },
      mhComputed: 0, laborMxn: 0, equipMxn: 166880.00, otherMxn: 0, totalMxn: 166880.00 },
    { item: { section: 'GENERAL SITE', costType: 'OTHER_FIXED' },
      mhComputed: 0, laborMxn: 0, equipMxn: 0, otherMxn: 440199.40, totalMxn: 440199.40 },
    { item: { section: 'INDIRECT', costType: 'PERCENT_OF_LABOR_EQUIP' },
      mhComputed: 0, laborMxn: 0, equipMxn: 0, otherMxn: 7938.40, totalMxn: 7938.40 },
    { item: { section: 'INDIRECT', costType: 'PERCENT_OF_SUBTOTAL' },
      mhComputed: 0, laborMxn: 0, equipMxn: 0, otherMxn: 35240.63, totalMxn: 35240.63 }
  ];
  return { items: items, sectionTotals: {}, totals: {}, roleAgg: {} };
}
var _BURDEN_DRIVERS = {
  insurancePct: 0.03, contingencyPct: 0.05,
  projectDcKwp: 864, projectDcWp: 864000, arrayGrossAreaM2: 0, crewSize: 6
};

registerTest({
  id: 'UNIT_INSTALL_LABOR_BURDEN',
  group: 'unit', module: 'calc/install_burden',
  scenarios: [], tags: ['calc', 'install', 'burden', 't8'],
  source: 'tests_unit/calc/InstallLaborBurdenTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/install: labor burden x1.65 + totals/PERCENT/role recompute');

    // -- burden 1.65 (CULLIGAN-scale numeric lock) ----------------------------
    var r = applyLaborBurden(_mkBurdenFixtureResult(), _BURDEN_DRIVERS, 1.65);

    t.assertNear('LABOR burdened: 97,733.27 x 1.65',          161259.90, r.totals.labor, 0.01);
    t.assertNear('EQUIP unchanged',                           166880.00, r.totals.equip, 0.01);
    t.assertNear('OTHER recomputed (day-rate + ins + cont)',  488460.56, r.totals.other, 0.01);
    t.assertNear('GRAND total',                               816600.46, r.totals.total, 0.01);
    t.assertNear('MXN/kWp = GRAND / 864',                     945.14,    r.totals.perKwp, 0.01);
    t.assert('burden factor recorded',  1.65, r.burden.factor);
    t.assertTrue('burden marked applied', r.burden.applied);

    // PERCENT items recomputed on the NEW base (not just carried over)
    var ins  = r.items.filter(function (x) { return x.item.costType === 'PERCENT_OF_LABOR_EQUIP'; })[0];
    var cont = r.items.filter(function (x) { return x.item.costType === 'PERCENT_OF_SUBTOTAL'; })[0];
    t.assertNear('insurance = 3% x (labor+equip)',   9844.20,  ins.otherMxn, 0.01);
    t.assertNear('contingency = 5% x subtotal',      38416.96, cont.otherMxn, 0.01);

    // day-rate OTHER item NOT burdened
    var dayrate = r.items.filter(function (x) { return x.item.costType === 'OTHER_FIXED'; })[0];
    t.assertNear('day-rate OTHER untouched by burden', 440199.40, dayrate.otherMxn, 0.01);

    // totals reconcile: labor+equip+other == grand
    t.assertNear('totals reconcile', r.totals.total, r.totals.labor + r.totals.equip + r.totals.other, 0.01);
    // role breakdown rebuilt and reflects burdened labor
    t.assertNear('roleAgg INSTALLER cost == burdened labor', 161259.90, r.roleAgg.INSTALLER.cost, 0.01);

    // -- burden 1.0 is a clean no-op on totals --------------------------------
    var r1 = applyLaborBurden(_mkBurdenFixtureResult(), _BURDEN_DRIVERS, 1.0);
    t.assertNear('burden 1.0: LABOR unchanged',  97733.27,  r1.totals.labor, 0.01);
    t.assertNear('burden 1.0: GRAND unchanged',  747991.70, r1.totals.total, 0.01);
    t.assertFalse('burden 1.0: not marked applied', r1.burden.applied);

    // -- default factor when override omitted ---------------------------------
    var rd = applyLaborBurden(_mkBurdenFixtureResult(), _BURDEN_DRIVERS);
    t.assert('default factor = LABOR_BURDEN_DEFAULT', LABOR_BURDEN_DEFAULT, rd.burden.factor);
  }
});
