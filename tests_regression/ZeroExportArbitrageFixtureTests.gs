// =============================================================================
// ARGIA -- tests_regression/ZeroExportArbitrageFixtureTests.gs
// -----------------------------------------------------------------------------
// [4.19.0] Regression protection for the ZERO_EXPORT arbitrage E2E fixture
// (test/ZeroExportArbitrageE2E.gs). Two layers:
//
//   1. FIXTURE INTEGRITY -- the derived inputs carry the three overrides
//      (SIN_EXPORTACION, LOAD_SHIFTING, solar-poor PV) and stay layout-
//      consistent (panelQty == strings * modsPerString) so the live engine
//      does not trip INP/STR validations. Also proves the deep-clone does NOT
//      mutate CULLIGAN_BASELINE.
//
//   2. PLANNER BEHAVIOR -- on the fixture's real GDMTH economics + CULLIGAN
//      battery, the planner grid-charges under ZERO_EXPORT and LOAD_SHIFTING
//      strictly out-performs PEAK_SHAVING. This is the offline proof that
//      option #1 fires for this fixture; the live E2E confirms the executor
//      reproduces it end-to-end.
//
// These run in Node (no workbook needed) -- buildZeroExportArbitrageInputs and
// _planMonthlyBessSchedule are pure.
// =============================================================================

registerTest({
  id      : 'REG_ZE_ARBITRAGE_FIXTURE_INTEGRITY',
  group   : 'regression',
  module  : 'regression/zero_export',
  scenarios: [],
  tags    : ['bess', 'zero_export', 'fixture', 'option1'],
  source  : 'tests_regression/ZeroExportArbitrageFixtureTests.gs',
  fn      : function (t, ctx) {
    t.suite('REG regression/zero_export [4.19.0]: fixture integrity');

    var inp = buildZeroExportArbitrageInputs();

    // The three overrides.
    t.assert('interconnection = SIN_EXPORTACION', 'SIN_EXPORTACION', inp.cfe.interconnectionMode);
    t.assert('strategy = LOAD_SHIFTING', 'LOAD_SHIFTING', inp.bess.bessStrategy);
    t.assert('no export credit under ZERO_EXPORT', 0, inp.cfe.exportPriceMxnPerKwh);

    // Solar-poor + layout consistency (must not trip STR/INP validations).
    t.assert('panelQty scaled to 162', 162, inp.design.panelQty);
    t.assert('stringsTotal scaled to 9', 9, inp.design.stringsTotal);
    t.assert('modsPerString unchanged (18)', 18, inp.design.modsPerString);
    t.assertTrue('panelQty == strings * modsPerString (consistent)',
                 inp.design.panelQty === inp.design.stringsTotal * inp.design.modsPerString);

    var kwp = inp.design.panelQty * inp.design.panelPowerW / 1000;
    t.assertTrue('system is solar-poor (~104 kWp, << CULLIGAN 864)',
                 kwp > 90 && kwp < 120);

    // Helioscope production scaled (annual PV << annual load).
    var annualPv = 0;
    for (var i = 0; i < inp.design.helioscopeMonthly.length; i++) {
      annualPv += inp.design.helioscopeMonthly[i][5];
    }
    t.assertTrue('annual PV gen scaled down (< 250 MWh)', annualPv < 250000);

    // Identity rename (so CULLIGAN baseline guards never misfire on this run).
    t.assert('project renamed', 'ZE_ARBITRAGE_TEST', inp.project.projectName);

    // Non-mutation: building the derived fixture must NOT alter CULLIGAN_BASELINE.
    t.assert('CULLIGAN source still MEDICION_NETA',
             'MEDICION_NETA', CULLIGAN_BASELINE.inputs.cfe.interconnectionMode);
    t.assert('CULLIGAN source still 1350 panels',
             1350, CULLIGAN_BASELINE.inputs.design.panelQty);
    t.assert('CULLIGAN source strategy still PEAK_SHAVING',
             'PEAK_SHAVING', CULLIGAN_BASELINE.inputs.bess.bessStrategy);
  }
});


registerTest({
  id      : 'REG_ZE_ARBITRAGE_PLANNER_GRID_CHARGES',
  group   : 'regression',
  module  : 'regression/zero_export',
  scenarios: [],
  tags    : ['bess', 'zero_export', 'dispatch', 'option1'],
  source  : 'tests_regression/ZeroExportArbitrageFixtureTests.gs',
  fn      : function (t, ctx) {
    t.suite('REG regression/zero_export [4.19.0]: planner grid-charges under ZERO_EXPORT');

    // Representative single-day context using the fixture's real economics:
    // CULLIGAN battery (2169 kWh / 972 kW), real GDMTH rates, solar-poor PV,
    // ZERO_EXPORT. A GDMTH-shaped day with punta load > base.
    function buckets() {
      var b = new Array(24);
      for (var h = 0; h < 24; h++) {
        if (h <= 5) b[h] = 'base';
        else if (h >= 18 && h <= 21) b[h] = 'punta';
        else b[h] = 'intermedia';
      }
      return b;
    }
    function loadShape() {
      var a = new Array(24);
      for (var h = 0; h < 24; h++) {
        if (h <= 5) a[h] = 380;
        else if (h >= 18 && h <= 21) a[h] = 620;
        else a[h] = 540;
      }
      return a;
    }
    function pvPoor() {
      var a = new Array(24).fill(0);
      var per = 525 / 14;            // ~104 kWp -> ~525 kWh/day
      for (var h = 6; h <= 19; h++) a[h] = per;
      return a;
    }
    function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }

    var c = {
      monthIndex: 5, daysInMonth: 30, bucketByHour: buckets(),
      loadByHour: loadShape(), pvByHour: pvPoor(),
      batteryCapKwh: 2169, batteryPowerKw: 972,
      minSocKwh: 2169 * 0.10, maxSocKwh: 2169 * 0.90, usableKwh: 2169 * 0.80,
      rte: 0.90, interconnMode: 'ZERO_EXPORT',
      rateBase: 0.864, rateInter: 1.454, ratePunta: 1.595,
      planningDemandLimitKw: 900
    };

    var ls = _planMonthlyBessSchedule(c, 'LOAD_SHIFTING');
    var ps = _planMonthlyBessSchedule(c, 'PEAK_SHAVING');

    // The core option-#1 assertions on the real fixture economics:
    t.assertTrue('LS grid-charges under ZERO_EXPORT (option #1 fires)',
                 sum(ls.gridChargeByHour) > 0);
    t.assertTrue('LS discharges in punta', sum(ls.dischargeByHour) > 0);
    t.assertTrue('LS strictly out-discharges PS (genuine differentiation)',
                 sum(ls.dischargeByHour) > sum(ps.dischargeByHour));

    // Realistic, NOT optimistic: at most one cycle (discharge <= usable).
    t.assertTrue('discharge <= usable (one cycle -- realistic, not optimum)',
                 sum(ls.dischargeByHour) <= c.usableKwh + 0.5);

    // Energy-arbitrage value is positive and in the defensible range
    // (not a phantom demand-charge windfall). Daily edge ~0.571 MXN/kWh.
    var dailyValue = sum(ls.dischargeByHour) * c.ratePunta
                   - sum(ls.gridChargeByHour) * c.rateBase;
    t.assertTrue('daily arbitrage value positive', dailyValue > 0);
  }
});
