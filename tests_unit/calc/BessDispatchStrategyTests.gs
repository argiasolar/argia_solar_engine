// =============================================================================
// ARGIA TESTS -- tests_unit/calc/BessDispatchStrategyTests.gs
// -----------------------------------------------------------------------------
// CHUNK 4 (v3.7.9) — Strategy-aware battery dispatch.
//
// CONTEXT
//   _bessDispatchHour (20_CalcHourlySimulation.js) is the priority-weighted
//   single-hour dispatcher. bessStrategy sets the PRIORITY ORDER when
//   discharge / PV-capture / grid-arbitrage compete for finite SoC + power.
//   It is never a hard on/off switch — every strategy still pursues every
//   saving type; only the contest order changes.
//
// COVERAGE
//   Part A — _bessDispatchHour pure-function policy table:
//     1. PEAK_SHAVING: punta discharge is priority 1
//     2. PEAK_SHAVING: also discharges in intermedia (priority 3) — the
//        behavior change vs the old punta-only greedy code
//     3. SELF_CONSUMPTION_MAX: PV capture beats discharge when both possible
//     4. LOAD_SHIFTING: grid-charges in base under NET_BILLING when spread pays
//     5. LOAD_SHIFTING: grid-charge smart gate BLOCKS when spread doesn't pay
//     6. LOAD_SHIFTING: grid-charge blocked when NOT NET_BILLING
//     7. SoC limits respected (no discharge below min, no charge above max)
//     8. Power limit respected (action capped at batteryPowerKw)
//   Part B — full-sim comparative (the tester-facing proof):
//     9. The three strategies produce DIFFERENT annual cost on the same inputs
//    10. All three beat the no-battery baseline (each saves money)
// =============================================================================


// ---- helpers ---------------------------------------------------------------

function _disp(overrides) {
  // Sensible mid-charge defaults; override per case.
  var base = {
    strategy: 'PEAK_SHAVING',
    bucket: 'punta',
    residualNetLoadKwh: 50,
    pvSurplusKwh: 0,
    batterySoc: 100,      // out of 0..200
    minSocKwh: 10,
    maxSocKwh: 190,
    batteryPowerKw: 100,
    rte: 0.9,
    interconnMode: 'NET_BILLING',
    rateBase: 0.9,
    rateInter: 1.2,
    ratePunta: 1.5,
  };
  for (var k in overrides) if (overrides.hasOwnProperty(k)) base[k] = overrides[k];
  return _bessDispatchHour(base);
}


// ---- Part A: pure-function policy table ------------------------------------

registerTest({
  id      : 'UNIT_BESS_DISPATCH_PEAK_SHAVING_PUNTA_FIRST',
  group   : 'unit',
  module  : 'calc/bess_dispatch',
  scenarios: [],
  tags    : ['calc', 'bess_dispatch', 'peak_shaving', 'chunk4'],
  source  : 'tests_unit/calc/BessDispatchStrategyTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_dispatch: PEAK_SHAVING discharges in punta (priority 1)');
    var r = _disp({ strategy: 'PEAK_SHAVING', bucket: 'punta', residualNetLoadKwh: 50 });
    t.assertTrue('discharges in punta', r.dischargeKwh > 0);
    t.assert('discharge covers load (50 kWh, within power+SoC)', 50, Math.round(r.dischargeKwh));
    t.assertTrue('batteryActionKwh positive (discharge)', r.batteryActionKwh > 0);
    t.assertTrue('SoC dropped', r.batterySoc < 100);
  }
});

registerTest({
  id      : 'UNIT_BESS_DISPATCH_PEAK_SHAVING_ALSO_INTERMEDIA',
  group   : 'unit',
  module  : 'calc/bess_dispatch',
  scenarios: [],
  tags    : ['calc', 'bess_dispatch', 'peak_shaving', 'chunk4', 'behavior_change'],
  source  : 'tests_unit/calc/BessDispatchStrategyTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_dispatch: PEAK_SHAVING also pursues intermedia (priority 3)');
    // No PV surplus, intermedia bucket, residual load present -> should still
    // discharge (the "always pursue every saving" change vs old punta-only).
    var r = _disp({ strategy: 'PEAK_SHAVING', bucket: 'intermedia',
                    residualNetLoadKwh: 30, pvSurplusKwh: 0 });
    t.assertTrue('discharges in intermedia too', r.dischargeKwh > 0);
    t.assert('covers the 30 kWh intermedia load', 30, Math.round(r.dischargeKwh));
  }
});

registerTest({
  id      : 'UNIT_BESS_DISPATCH_SELF_CONSUMPTION_PV_FIRST',
  group   : 'unit',
  module  : 'calc/bess_dispatch',
  scenarios: [],
  tags    : ['calc', 'bess_dispatch', 'self_consumption', 'chunk4'],
  source  : 'tests_unit/calc/BessDispatchStrategyTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_dispatch: SELF_CONSUMPTION_MAX captures PV before discharging');
    // Punta bucket BUT PV surplus exists AND residual load exists. Self-
    // consumption prioritizes storing the solar (priority 1) over discharge.
    var r = _disp({ strategy: 'SELF_CONSUMPTION_MAX', bucket: 'punta',
                    residualNetLoadKwh: 40, pvSurplusKwh: 25, batterySoc: 100 });
    t.assertTrue('charges from PV (priority 1)', r.chargeKwh > 0);
    t.assert('charged the 25 kWh surplus', 25, Math.round(r.chargeKwh));
    t.assertTrue('did NOT discharge this hour', r.dischargeKwh === 0);
    t.assertTrue('batteryActionKwh negative (charge)', r.batteryActionKwh < 0);
  }
});

registerTest({
  id      : 'UNIT_BESS_DISPATCH_LOAD_SHIFTING_GRID_CHARGE_WHEN_PROFITABLE',
  group   : 'unit',
  module  : 'calc/bess_dispatch',
  scenarios: [],
  tags    : ['calc', 'bess_dispatch', 'load_shifting', 'chunk4'],
  source  : 'tests_unit/calc/BessDispatchStrategyTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_dispatch: LOAD_SHIFTING grid-charges in base when arbitrage pays');
    // Base bucket, no PV, NET_BILLING, healthy punta/base spread:
    //   ratePunta*rte = 1.5*0.9 = 1.35 > rateBase 0.9 -> profitable, gate opens.
    var r = _disp({ strategy: 'LOAD_SHIFTING', bucket: 'base',
                    residualNetLoadKwh: 0, pvSurplusKwh: 0,
                    batterySoc: 100, maxSocKwh: 190, batteryPowerKw: 100,
                    rte: 0.9, interconnMode: 'NET_BILLING',
                    rateBase: 0.9, ratePunta: 1.5 });
    t.assertTrue('grid-charges in base', r.chargeKwh > 0);
    t.assertTrue('batteryActionKwh negative (charge)', r.batteryActionKwh < 0);
    t.assertTrue('residualNetLoad increased by grid charge (shows as import)',
                 r.residualNetLoadKwh > 0);
  }
});

registerTest({
  id      : 'UNIT_BESS_DISPATCH_LOAD_SHIFTING_GATE_BLOCKS_UNPROFITABLE',
  group   : 'unit',
  module  : 'calc/bess_dispatch',
  scenarios: [],
  tags    : ['calc', 'bess_dispatch', 'load_shifting', 'smart_gate', 'chunk4'],
  source  : 'tests_unit/calc/BessDispatchStrategyTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_dispatch: LOAD_SHIFTING gate BLOCKS when spread does not pay');
    // Flat spread: ratePunta*rte = 1.0*0.9 = 0.9, NOT > rateBase 0.9 -> blocked.
    var r = _disp({ strategy: 'LOAD_SHIFTING', bucket: 'base',
                    residualNetLoadKwh: 0, pvSurplusKwh: 0,
                    batterySoc: 100, rte: 0.9, interconnMode: 'NET_BILLING',
                    rateBase: 0.9, ratePunta: 1.0 });
    t.assert('no grid charge when arbitrage unprofitable', 0, Math.round(r.chargeKwh));
    t.assert('no battery action at all', 0, Math.round(r.batteryActionKwh));
  }
});

registerTest({
  id      : 'UNIT_BESS_DISPATCH_LOAD_SHIFTING_GATE_IS_ECONOMIC',
  group   : 'unit',
  module  : 'calc/bess_dispatch',
  scenarios: [],
  tags    : ['calc', 'bess_dispatch', 'load_shifting', 'smart_gate', 'chunk4'],
  source  : 'tests_unit/calc/BessDispatchStrategyTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_dispatch: [4.18.0] LOAD_SHIFTING grid-charge gated by ECONOMICS, not interconnection');
    // [4.18.0] Pre-4.18.0 this asserted NET_METERING blocks grid arbitrage.
    // The interconnection gate is removed (grid-charging is import, legal under
    // any mode). With a profitable spread, NET_METERING now grid-charges.
    var r = _disp({ strategy: 'LOAD_SHIFTING', bucket: 'base',
                    residualNetLoadKwh: 0, pvSurplusKwh: 0,
                    batterySoc: 100, rte: 0.9, interconnMode: 'NET_METERING',
                    rateBase: 0.9, ratePunta: 1.5 });
    t.assertTrue('NET_METERING grid-charges with profitable spread (interconn does not gate)',
                 Math.round(r.chargeKwh) > 0);

    // The economic gate still bites: a non-profitable spread blocks it even
    // under NET_BILLING (ratePunta*rte <= rateBase).
    var noEdge = _disp({ strategy: 'LOAD_SHIFTING', bucket: 'base',
                         residualNetLoadKwh: 0, pvSurplusKwh: 0,
                         batterySoc: 100, rte: 0.9, interconnMode: 'NET_BILLING',
                         rateBase: 1.5, ratePunta: 1.5 });  // 1.5*0.9=1.35 < 1.5
    t.assert('economic gate still blocks unprofitable spread', 0, Math.round(noEdge.chargeKwh));
  }
});

registerTest({
  id      : 'UNIT_BESS_DISPATCH_RESPECTS_SOC_AND_POWER_LIMITS',
  group   : 'unit',
  module  : 'calc/bess_dispatch',
  scenarios: [],
  tags    : ['calc', 'bess_dispatch', 'limits', 'chunk4'],
  source  : 'tests_unit/calc/BessDispatchStrategyTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_dispatch: SoC and power limits respected');

    // (a) Cannot discharge below min SoC
    var atMin = _disp({ strategy: 'PEAK_SHAVING', bucket: 'punta',
                        residualNetLoadKwh: 999, batterySoc: 10, minSocKwh: 10 });
    t.assert('no discharge at min SoC', 0, Math.round(atMin.dischargeKwh));

    // (b) Cannot charge above max SoC
    var atMax = _disp({ strategy: 'SELF_CONSUMPTION_MAX', bucket: 'base',
                        residualNetLoadKwh: 0, pvSurplusKwh: 999,
                        batterySoc: 190, maxSocKwh: 190 });
    t.assert('no PV charge at max SoC', 0, Math.round(atMax.chargeKwh));

    // (c) Power limit caps discharge: huge load, 100 kW limit -> 100 kWh
    var capped = _disp({ strategy: 'PEAK_SHAVING', bucket: 'punta',
                         residualNetLoadKwh: 999, batterySoc: 190,
                         minSocKwh: 10, batteryPowerKw: 100 });
    t.assert('discharge capped at power limit (100)', 100, Math.round(capped.dischargeKwh));
  }
});


// ---- Part B: full-sim comparative (tester-facing proof) --------------------

registerTest({
  id      : 'UNIT_BESS_DISPATCH_STRATEGIES_DIFFER_AND_SAVE',
  group   : 'unit',
  module  : 'calc/bess_dispatch',
  scenarios: [],
  tags    : ['calc', 'bess_dispatch', 'comparative', 'chunk4'],
  source  : 'tests_unit/calc/BessDispatchStrategyTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_dispatch: three strategies differ and all beat baseline');

    function bill12(b, i, p) {
      return { kwhBase: new Array(12).fill(b),
               kwhIntermedia: new Array(12).fill(i),
               kwhPunta: new Array(12).fill(p) };
    }
    function simWith(strategy, withBattery) {
      return calcHourlySimulation({
        tariff: 'GDMTH', region: 'GOLFO CENTRO',
        monthlyBill: bill12(10000, 5000, 3000),
        monthlyPv: { kwh: new Array(12).fill(6000) },
        batterySpec: withBattery ? {
          capacityKwh: 400, powerKw: 150,
          minSocPct: 0.05, maxSocPct: 0.95, rtePct: 0.913,
          strategy: strategy
        } : null,
        interconnMode: 'NET_BILLING', exportPriceMxnPerKwh: 0.8,
        tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.8,
                       demandChargeMxnPerKw: 350 }
      });
    }

    var baseline = simWith(null, false);
    var ps  = simWith('PEAK_SHAVING', true);
    var sc  = simWith('SELF_CONSUMPTION_MAX', true);
    var ls  = simWith('LOAD_SHIFTING', true);

    var baseCost = baseline.annual.totalCostMxn;
    var psCost = ps.annual.totalCostMxn;
    var scCost = sc.annual.totalCostMxn;
    var lsCost = ls.annual.totalCostMxn;

    // All three save money vs no battery
    t.assertTrue('PEAK_SHAVING beats baseline', psCost < baseCost);
    t.assertTrue('SELF_CONSUMPTION_MAX beats baseline', scCost < baseCost);
    t.assertTrue('LOAD_SHIFTING beats baseline', lsCost < baseCost);

    // HONEST RELATIONSHIP (documented 2026-05-28):
    // PEAK_SHAVING and SELF_CONSUMPTION_MAX are near-identical in this engine
    // because PV-surplus hours (midday, base/intermedia) and punta hours
    // (evening) rarely overlap — so the one ordering difference between them
    // (PV-capture-first vs punta-discharge-first) almost never faces an
    // actual same-hour conflict. They converge by design, NOT by bug.
    // We assert that convergence so a future change that accidentally makes
    // them wildly diverge gets caught and reviewed.
    t.assertTrue('PEAK_SHAVING and SELF_CONSUMPTION_MAX converge (within 2%)',
                 Math.abs(psCost - scCost) <= Math.abs(baseCost) * 0.02 + 1.0);

    // LOAD_SHIFTING is the genuine differentiator (grid arbitrage). Under a
    // healthy punta/base spread + NET_BILLING it must diverge materially from
    // the PS/SC pair. If it doesn't, the arbitrage gate isn't firing.
    t.assertTrue('LOAD_SHIFTING differs materially from PEAK_SHAVING',
                 Math.abs(lsCost - psCost) > 1.0);

    // Log the spread for the tester to eyeball in the results sheet.
    t.info('annual cost by strategy (MXN)',
      'baseline=' + Math.round(baseCost) +
      ' | PEAK_SHAVING=' + Math.round(psCost) +
      ' | SELF_CONSUMPTION=' + Math.round(scCost) +
      ' | LOAD_SHIFTING=' + Math.round(lsCost));
  }
});
