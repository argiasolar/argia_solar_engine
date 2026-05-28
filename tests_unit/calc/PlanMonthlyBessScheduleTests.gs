// =============================================================================
// ARGIA TESTS -- tests_unit/calc/PlanMonthlyBessScheduleTests.gs
// -----------------------------------------------------------------------------
// CHUNK 5 -- Session 1
//
// Locks the invariants and behavior of _planMonthlyBessSchedule
// (20b_PlanMonthlyBessSchedule.js).
//
// Contract reference: docs/CHUNK_5_SESSION1_SPEC.md
//
// COVERAGE (15 tests total):
//    1.  UNIT_BESS_PLAN_PS_BASIC                            -- I1 conservation, punta discharge
//    2.  UNIT_BESS_PLAN_PS_PV_LIMITED_BUDGET                -- budget shrinks with PV
//    3.  UNIT_BESS_PLAN_PS_NO_DISCHARGE_IN_BASE             -- I7
//    4.  UNIT_BESS_PLAN_SC_EQUALS_PS                        -- PS=SC convergence
//    5.  UNIT_BESS_PLAN_LS_ARBITRAGE_GATE_FIRES             -- LS active path
//    6.  UNIT_BESS_PLAN_LS_GATE_BLOCKED_BY_INTERCONN        -- NET_METERING blocks
//    7.  UNIT_BESS_PLAN_LS_GATE_BLOCKED_BY_SPREAD           -- flat rate blocks
//    8.  UNIT_BESS_PLAN_LS_DEMAND_LIMIT_CAPS_GRID_CHARGE    -- I6
//    9.  UNIT_BESS_PLAN_POWER_LIMIT_RESPECTED               -- I4
//   10.  UNIT_BESS_PLAN_ONE_CYCLE_PER_DAY                   -- I3
//   11.  UNIT_BESS_PLAN_NO_CHARGE_AND_DISCHARGE_SAME_HOUR   -- I2
//   12.  UNIT_BESS_PLAN_LEDGER_BALANCES                     -- R1+R3 ledger consistency
//   13.  UNIT_BESS_PLAN_LIMIT_USES_BILLED_DEMAND            -- R2 actual billed demand
//   14.  UNIT_BESS_PLAN_WEAR_COST_BLOCKS_MARGINAL_LS        -- R2 wear cost gate
//   15.  UNIT_BESS_PLAN_PRIORITY_RESULTS_STRUCTURED         -- R3 priority results
// =============================================================================


// ---------------------------------------------------------------------------
// helpers -- typical-day fixtures
// ---------------------------------------------------------------------------

function _planTestBuckets() {
  // GDMTH skeleton:
  //   00..05  base       (6 hours)
  //   06..17  intermedia (12 hours)
  //   18..21  punta      (4 hours)
  //   22..23  intermedia (2 hours)
  var b = new Array(24);
  for (var h = 0; h < 24; h++) {
    if (h <= 5)              b[h] = 'base';
    else if (h >= 18 && h <= 21) b[h] = 'punta';
    else                     b[h] = 'intermedia';
  }
  return b;
}

function _planFlatLoad(kw) {
  var a = new Array(24);
  for (var h = 0; h < 24; h++) a[h] = kw;
  return a;
}

function _planDaylightPv(totalKwhDay) {
  // Flat shape for test predictability. The bell-curve utility is tested
  // separately via _planSyntheticPvBellShape.
  var a = new Array(24).fill(0);
  if (totalKwhDay <= 0) return a;
  var per = totalKwhDay / 14;
  for (var h = 6; h <= 19; h++) a[h] = per;
  return a;
}

function _planMkCtx(overrides) {
  var base = {
    monthIndex: 5,
    daysInMonth: 30,
    bucketByHour: _planTestBuckets(),
    loadByHour: _planFlatLoad(100),
    pvByHour: _planDaylightPv(1400),
    batteryCapKwh: 400,
    batteryPowerKw: 100,
    minSocKwh: 20,
    maxSocKwh: 380,
    usableKwh: 360,
    rte: 0.9,
    interconnMode: 'NET_BILLING',
    rateBase: 1.0,
    rateInter: 1.5,
    ratePunta: 3.0,
    planningDemandLimitKw: 100
  };
  if (overrides) {
    for (var k in overrides) if (overrides.hasOwnProperty(k)) base[k] = overrides[k];
  }
  return base;
}

function _planSum(a) {
  var s = 0;
  for (var i = 0; i < a.length; i++) s += a[i];
  return s;
}

function _planMax(a) {
  var m = 0;
  for (var i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
  return m;
}


// ---------------------------------------------------------------------------
// Test 1 -- PS_BASIC
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_PS_BASIC',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'peak_shaving', 'chunk5'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: PEAK_SHAVING basic conservation & placement');

    var c = _planMkCtx({
      loadByHour: _planFlatLoad(60),
      pvByHour: _planDaylightPv(14 * 200)
    });
    var s = _planMonthlyBessSchedule(c, 'PEAK_SHAVING');

    t.assertTrue('schedule has 24 charge entries', s.chargeByHour.length === 24);
    t.assertTrue('grid charge all zero (PS)', _planSum(s.gridChargeByHour) === 0);
    t.assert('tier label SCREENING', 'SCREENING', s.meta.tier);

    var totalCharge = _planSum(s.chargeByHour);
    var totalDisch = _planSum(s.dischargeByHour);
    t.assertTrue('I1 conservation: discharge <= pvCharge*rte',
                 totalDisch <= totalCharge * c.rte + 1e-6);

    var puntaDisch = 0;
    for (var h = 18; h <= 21; h++) puntaDisch += s.dischargeByHour[h];
    t.assertTrue('discharges in punta hours', puntaDisch > 0);
  }
});


// ---------------------------------------------------------------------------
// Test 2 -- PS_PV_LIMITED_BUDGET
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_PS_PV_LIMITED_BUDGET',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'peak_shaving', 'chunk5'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: PS budget shrinks when PV is small');

    var c = _planMkCtx({
      loadByHour: _planFlatLoad(60),
      pvByHour: _planDaylightPv(14 * 65)  // 5 kWh/h surplus -> 70 kWh/day PV surplus
    });
    var s = _planMonthlyBessSchedule(c, 'PEAK_SHAVING');

    var totalDisch = _planSum(s.dischargeByHour);
    t.assertTrue('discharge bounded by PV*rte', totalDisch <= 70 * c.rte + 1e-6);
    t.assertTrue('discharge well below usableKwh', totalDisch < c.usableKwh * 0.5);
    t.assertTrue('grid charge zero (PS)', _planSum(s.gridChargeByHour) === 0);
  }
});


// ---------------------------------------------------------------------------
// Test 3 -- PS_NO_DISCHARGE_IN_BASE (I7)
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_PS_NO_DISCHARGE_IN_BASE',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'peak_shaving', 'chunk5', 'invariant_i7'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: I7 -- never discharge in base hours');

    var c = _planMkCtx({
      loadByHour: (function () {
        var a = new Array(24);
        for (var h = 0; h < 24; h++) a[h] = 5;
        for (var p = 18; p <= 21; p++) a[p] = 30;
        return a;
      })(),
      pvByHour: _planDaylightPv(14 * 300)
    });
    var s = _planMonthlyBessSchedule(c, 'PEAK_SHAVING');

    var baseDisch = 0;
    for (var h = 0; h <= 5; h++) baseDisch += s.dischargeByHour[h];
    t.assert('base-hour discharge is exactly zero', 0, baseDisch);
    t.assert('ledger dischargedToBaseKwh = 0', 0, s.meta.ledger.dischargedToBaseKwh);
  }
});


// ---------------------------------------------------------------------------
// Test 4 -- SC_EQUALS_PS
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_SC_EQUALS_PS',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'self_consumption', 'convergence', 'chunk5'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: SELF_CONSUMPTION_MAX schedule == PEAK_SHAVING (deferred refinement)');

    var c = _planMkCtx({
      loadByHour: _planFlatLoad(60),
      pvByHour: _planDaylightPv(14 * 200)
    });
    var ps = _planMonthlyBessSchedule(c, 'PEAK_SHAVING');
    var sc = _planMonthlyBessSchedule(c, 'SELF_CONSUMPTION_MAX');

    var diff = 0;
    for (var h = 0; h < 24; h++) {
      diff += Math.abs(ps.chargeByHour[h]     - sc.chargeByHour[h]);
      diff += Math.abs(ps.gridChargeByHour[h] - sc.gridChargeByHour[h]);
      diff += Math.abs(ps.dischargeByHour[h]  - sc.dischargeByHour[h]);
    }
    t.assertTrue('schedules byte-equal', diff < 1e-9);
    t.assert('SC meta strategy preserved', 'SELF_CONSUMPTION_MAX', sc.meta.strategy);
  }
});


// ---------------------------------------------------------------------------
// Test 5 -- LS_ARBITRAGE_GATE_FIRES
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_LS_ARBITRAGE_GATE_FIRES',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'load_shifting', 'chunk5'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: LS gate fires under NET_BILLING + spread');

    var c = _planMkCtx({
      loadByHour: (function () {
        var a = _planFlatLoad(40);
        for (var p = 18; p <= 21; p++) a[p] = 200;
        return a;
      })(),
      pvByHour: _planDaylightPv(14 * 10),
      interconnMode: 'NET_BILLING',
      rateBase: 1.0, rateInter: 1.5, ratePunta: 3.0,
      planningDemandLimitKw: 200,
      batteryPowerKw: 50
    });
    var s = _planMonthlyBessSchedule(c, 'LOAD_SHIFTING');

    t.assertTrue('grid charge present (gate fired)', _planSum(s.gridChargeByHour) > 0);
    t.assertTrue('discharge present in punta', _planSum(s.dischargeByHour) > 0);

    var gridInNonBase = 0;
    for (var h = 0; h < 24; h++) {
      if (c.bucketByHour[h] !== 'base') gridInNonBase += s.gridChargeByHour[h];
    }
    t.assert('grid charge confined to base hours', 0, gridInNonBase);
  }
});


// ---------------------------------------------------------------------------
// Test 6 -- LS_GATE_BLOCKED_BY_INTERCONN
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_LS_GATE_BLOCKED_BY_INTERCONN',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'load_shifting', 'chunk5'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: LS blocked under NET_METERING');

    var c = _planMkCtx({
      loadByHour: _planFlatLoad(60),
      pvByHour: _planDaylightPv(14 * 200),
      interconnMode: 'NET_METERING',
      rateBase: 1.0, ratePunta: 3.0
    });
    var s = _planMonthlyBessSchedule(c, 'LOAD_SHIFTING');

    t.assert('grid charge zero', 0, _planSum(s.gridChargeByHour));
    var found = false;
    for (var i = 0; i < s.meta.notes.length; i++) {
      if (String(s.meta.notes[i]).indexOf('gate blocked') >= 0) found = true;
    }
    t.assertTrue('meta records gate-blocked note', found);
  }
});


// ---------------------------------------------------------------------------
// Test 7 -- LS_GATE_BLOCKED_BY_SPREAD
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_LS_GATE_BLOCKED_BY_SPREAD',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'load_shifting', 'chunk5'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: LS blocked when spread*rte <= rateBase');

    var c = _planMkCtx({
      interconnMode: 'NET_BILLING',
      rateBase: 1.0, rateInter: 1.05, ratePunta: 1.1,
      rte: 0.9
    });
    var s = _planMonthlyBessSchedule(c, 'LOAD_SHIFTING');
    t.assert('grid charge zero', 0, _planSum(s.gridChargeByHour));
  }
});


// ---------------------------------------------------------------------------
// Test 8 -- LS_DEMAND_LIMIT_CAPS_GRID_CHARGE (I6)
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_LS_DEMAND_LIMIT_CAPS_GRID_CHARGE',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'load_shifting', 'chunk5', 'invariant_i6'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: I6 -- grid charge respects planning demand limit');

    var c = _planMkCtx({
      loadByHour: (function () {
        var a = _planFlatLoad(80);
        for (var p = 18; p <= 21; p++) a[p] = 100;
        return a;
      })(),
      pvByHour: _planDaylightPv(0),
      planningDemandLimitKw: 100,
      batteryPowerKw: 200,
      interconnMode: 'NET_BILLING',
      rateBase: 1.0, ratePunta: 3.0
    });
    var s = _planMonthlyBessSchedule(c, 'LOAD_SHIFTING');

    var maxViolation = 0;
    for (var h = 0; h < 24; h++) {
      var net = c.loadByHour[h] + s.gridChargeByHour[h] - c.pvByHour[h];
      var over = net - c.planningDemandLimitKw;
      if (over > maxViolation) maxViolation = over;
    }
    t.assertTrue('I6 holds (max overshoot < 1e-6)', maxViolation < 1e-6);
    t.assertTrue('grid charge present (scenario fired the gate)',
                 _planSum(s.gridChargeByHour) > 0);
  }
});


// ---------------------------------------------------------------------------
// Test 9 -- POWER_LIMIT_RESPECTED (I4)
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_POWER_LIMIT_RESPECTED',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'chunk5', 'invariant_i4'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: I4 -- per-hour flow capped at batteryPowerKw');

    var c = _planMkCtx({
      loadByHour: (function () {
        var a = _planFlatLoad(30);
        for (var p = 18; p <= 21; p++) a[p] = 500;
        return a;
      })(),
      pvByHour: _planDaylightPv(14 * 200),
      batteryPowerKw: 40,
      planningDemandLimitKw: 500
    });

    function check(strategy) {
      var s = _planMonthlyBessSchedule(c, strategy);
      t.assertTrue(strategy + ': max charge <= power', _planMax(s.chargeByHour) <= c.batteryPowerKw + 1e-6);
      t.assertTrue(strategy + ': max gridCharge <= power', _planMax(s.gridChargeByHour) <= c.batteryPowerKw + 1e-6);
      t.assertTrue(strategy + ': max discharge <= power', _planMax(s.dischargeByHour) <= c.batteryPowerKw + 1e-6);
    }
    check('PEAK_SHAVING');
    check('SELF_CONSUMPTION_MAX');
    check('LOAD_SHIFTING');
  }
});


// ---------------------------------------------------------------------------
// Test 10 -- ONE_CYCLE_PER_DAY (I3)
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_ONE_CYCLE_PER_DAY',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'chunk5', 'invariant_i3'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: I3 -- at most one cycle per day');

    var c = _planMkCtx({
      loadByHour: (function () {
        var a = _planFlatLoad(40);
        for (var p = 18; p <= 21; p++) a[p] = 300;
        return a;
      })(),
      pvByHour: _planDaylightPv(14 * 500),
      interconnMode: 'NET_BILLING',
      rateBase: 1.0, ratePunta: 3.0,
      planningDemandLimitKw: 300
    });

    function checkCycle(strategy) {
      var s = _planMonthlyBessSchedule(c, strategy);
      var totalCharge = _planSum(s.chargeByHour) + _planSum(s.gridChargeByHour);
      var totalDisch  = _planSum(s.dischargeByHour);
      t.assertTrue(strategy + ': discharge <= usableKwh',
                   totalDisch <= c.usableKwh + 1e-6);
      t.assertTrue(strategy + ': total charge <= usableKwh/rte',
                   totalCharge <= c.usableKwh / c.rte + 1e-6);
    }
    checkCycle('PEAK_SHAVING');
    checkCycle('LOAD_SHIFTING');
  }
});


// ---------------------------------------------------------------------------
// Test 11 -- NO_CHARGE_AND_DISCHARGE_SAME_HOUR (I2)
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_NO_CHARGE_AND_DISCHARGE_SAME_HOUR',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'chunk5', 'invariant_i2'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: I2 -- no hour both charging and discharging');

    var c = _planMkCtx({
      loadByHour: (function () {
        var a = _planFlatLoad(80);
        for (var p = 18; p <= 21; p++) a[p] = 150;
        return a;
      })(),
      pvByHour: _planDaylightPv(14 * 120),
      interconnMode: 'NET_BILLING',
      rateBase: 1.0, ratePunta: 3.0,
      planningDemandLimitKw: 150
    });

    function checkI2(strategy) {
      var s = _planMonthlyBessSchedule(c, strategy);
      var v = 0;
      for (var h = 0; h < 24; h++) {
        var chg = s.chargeByHour[h] + s.gridChargeByHour[h];
        if (chg > 1e-9 && s.dischargeByHour[h] > 1e-9) v++;
      }
      t.assert(strategy + ': zero overlap hours', 0, v);
    }
    checkI2('PEAK_SHAVING');
    checkI2('LOAD_SHIFTING');
  }
});


// ---------------------------------------------------------------------------
// Test 12 -- LEDGER_BALANCES (R1 §2.4 + R3 §2)
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_LEDGER_BALANCES',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'ledger', 'chunk5'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: ledger totals match the schedule arrays');

    var c = _planMkCtx({
      loadByHour: (function () {
        var a = _planFlatLoad(60);
        for (var p = 18; p <= 21; p++) a[p] = 200;
        return a;
      })(),
      pvByHour: _planDaylightPv(14 * 80),
      interconnMode: 'NET_BILLING',
      rateBase: 1.0, ratePunta: 3.0,
      planningDemandLimitKw: 200,
      demandRates: { capacidadMxnPerKw: 350, distribucionMxnPerKw: 60 }
    });
    var s = _planMonthlyBessSchedule(c, 'LOAD_SHIFTING');
    var L = s.meta.ledger;

    var totalCharge = _planSum(s.chargeByHour);
    var totalGridCharge = _planSum(s.gridChargeByHour);
    var totalDisch = _planSum(s.dischargeByHour);

    t.assertNear('ledger.chargedFromPvSurplusKwh matches Σchargeby Hour',
                 totalCharge, L.chargedFromPvSurplusKwh, 1e-6);
    t.assertNear('ledger.chargedFromGridBaseKwh matches ΣgridChargeByHour',
                 totalGridCharge, L.chargedFromGridBaseKwh, 1e-6);

    var sumDest = L.dischargedToPuntaKwh + L.dischargedToIntermediaKwh + L.dischargedToBaseKwh;
    t.assertNear('ledger destination sum matches ΣdischargeByHour', totalDisch, sumDest, 1e-6);

    t.assert('I7 affirmed in ledger', 0, L.dischargedToBaseKwh);
    t.assertTrue('peakReductionKwOverall >= 0', L.peakReductionKwOverall >= 0);
    t.assertTrue('peakReductionPctOverall in [0,1]',
                 L.peakReductionPctOverall >= 0 && L.peakReductionPctOverall <= 1);
    t.assertTrue('effectiveBatteryUtilizationPct in [0,1]',
                 L.effectiveBatteryUtilizationPct >= 0
              && L.effectiveBatteryUtilizationPct <= 1);
    t.assertTrue('estAvoidedCapacidadMxn computed (rates supplied)',
                 L.estAvoidedCapacidadMxn >= 0);

    t.info('ledger snapshot',
      'pvCh=' + L.chargedFromPvSurplusKwh.toFixed(1) +
      ' gridCh=' + L.chargedFromGridBaseKwh.toFixed(1) +
      ' dPunta=' + L.dischargedToPuntaKwh.toFixed(1) +
      ' peakRedKw=' + L.peakReductionKwOverall.toFixed(1) +
      ' util%=' + (L.effectiveBatteryUtilizationPct * 100).toFixed(1));
  }
});


// ---------------------------------------------------------------------------
// Test 13 -- LIMIT_USES_BILLED_DEMAND (R2 §2.1)
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_LIMIT_USES_BILLED_DEMAND',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'demand_limit', 'chunk5'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: planning limit uses max(synthetic, actual)');

    // Scenario A: actual > synthetic. Actual wins. Use it as the limit.
    var cA = _planMkCtx({
      loadByHour: _planFlatLoad(60),
      pvByHour: _planDaylightPv(0),
      actualBilledDemandKw: 150,
      planningDemandLimitKw: null,   // remove the override so we test derivation
      interconnMode: 'NET_BILLING',
      rateBase: 1.0, ratePunta: 3.0
    });
    delete cA.planningDemandLimitKw;
    var sA = _planMonthlyBessSchedule(cA, 'LOAD_SHIFTING');
    t.assert('A: limit = actualBilledDemandKw (150)', 150, sA.meta.planningDemandLimitKw);
    t.assert('A: meta records actualBilledDemandKw', 150, sA.meta.actualBilledDemandKw);

    // Scenario B: synthetic > actual. Synthetic wins.
    var cB = _planMkCtx({
      loadByHour: (function () {
        var a = _planFlatLoad(60);
        a[10] = 250;
        return a;
      })(),
      pvByHour: _planDaylightPv(0),
      actualBilledDemandKw: 100
    });
    delete cB.planningDemandLimitKw;
    var sB = _planMonthlyBessSchedule(cB, 'LOAD_SHIFTING');
    t.assertTrue('B: limit = synthetic peak (250)',
                 Math.abs(sB.meta.planningDemandLimitKw - 250) < 1e-6);

    // Scenario C: actual missing/zero. Falls back to synthetic.
    var cC = _planMkCtx({
      loadByHour: (function () {
        var a = _planFlatLoad(60);
        a[10] = 180;
        return a;
      })(),
      pvByHour: _planDaylightPv(0)
    });
    delete cC.planningDemandLimitKw;
    delete cC.actualBilledDemandKw;
    var sC = _planMonthlyBessSchedule(cC, 'LOAD_SHIFTING');
    t.assertTrue('C: limit = synthetic when actual missing',
                 Math.abs(sC.meta.planningDemandLimitKw - 180) < 1e-6);
  }
});


// ---------------------------------------------------------------------------
// Test 14 -- WEAR_COST_BLOCKS_MARGINAL_LS (R2 §2.2)
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_WEAR_COST_BLOCKS_MARGINAL_LS',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'wear_cost', 'load_shifting', 'chunk5'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: wear cost gates marginal arbitrage');

    // Marginal spread: punta=1.5, base=1.0, spread=0.5, rte=0.9
    //   spread*rte = 0.45
    //   Without wear: 0.45 > 0  -> gate FIRES
    //   With wear=0.6: 0.45 - 0.6 = -0.15 -> gate BLOCKS
    var cBase = _planMkCtx({
      interconnMode: 'NET_BILLING',
      rateBase: 1.0, rateInter: 1.2, ratePunta: 1.5,
      rte: 0.9,
      loadByHour: (function () {
        var a = _planFlatLoad(40);
        for (var p = 18; p <= 21; p++) a[p] = 200;
        return a;
      })(),
      pvByHour: _planDaylightPv(14 * 10),
      planningDemandLimitKw: 200,
      batteryPowerKw: 50
    });

    // Without wear cost -> gate fires
    var sNoWear = _planMonthlyBessSchedule(cBase, 'LOAD_SHIFTING');
    t.assertTrue('no wear: grid charge present', _planSum(sNoWear.gridChargeByHour) > 0);

    // With wear that exceeds the RTE-corrected spread -> gate blocks
    var withWear = _planMkCtx(cBase);
    withWear.wearCostMxnPerKwh = 0.6;
    var sWear = _planMonthlyBessSchedule(withWear, 'LOAD_SHIFTING');
    t.assert('high wear: grid charge zero', 0, _planSum(sWear.gridChargeByHour));

    // With low wear -> gate still fires (and value reflected in P4 result)
    var lowWear = _planMkCtx(cBase);
    lowWear.wearCostMxnPerKwh = 0.1;
    var sLow = _planMonthlyBessSchedule(lowWear, 'LOAD_SHIFTING');
    t.assertTrue('low wear: grid charge still present', _planSum(sLow.gridChargeByHour) > 0);
  }
});


// ---------------------------------------------------------------------------
// Test 15 -- PRIORITY_RESULTS_STRUCTURED (R3 §3)
// ---------------------------------------------------------------------------

registerTest({
  id: 'UNIT_BESS_PLAN_PRIORITY_RESULTS_STRUCTURED',
  group: 'unit',
  module: 'calc/bess_plan',
  scenarios: [],
  tags: ['calc', 'bess_plan', 'priority_stack', 'chunk5'],
  source: 'tests_unit/calc/PlanMonthlyBessScheduleTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_plan: meta.priorityResults populated per strategy');

    var c = _planMkCtx({
      loadByHour: (function () {
        var a = _planFlatLoad(60);
        for (var p = 18; p <= 21; p++) a[p] = 200;
        return a;
      })(),
      pvByHour: _planDaylightPv(14 * 80),
      interconnMode: 'NET_BILLING',
      rateBase: 1.0, ratePunta: 3.0,
      planningDemandLimitKw: 200,
      demandRates: { capacidadMxnPerKw: 350, distribucionMxnPerKw: 60 }
    });

    var ps = _planMonthlyBessSchedule(c, 'PEAK_SHAVING');
    var ls = _planMonthlyBessSchedule(c, 'LOAD_SHIFTING');

    // PS: P1/P2/P3 attempted, P4 absent from stack
    t.assertTrue('PS: P1 attempted', ps.meta.priorityResults.P1_AVOID_NEW_PEAK.attempted);
    t.assertTrue('PS: P1 achieved (no peak created)', ps.meta.priorityResults.P1_AVOID_NEW_PEAK.achieved);
    t.assertTrue('PS: P2 attempted', ps.meta.priorityResults.P2_CAPTURE_PV.attempted);
    t.assertTrue('PS: P2 achieved (PV captured)', ps.meta.priorityResults.P2_CAPTURE_PV.achieved);
    t.assertTrue('PS: P3 attempted', ps.meta.priorityResults.P3_REDUCE_PUNTA.attempted);
    t.assertTrue('PS: P3 achieved (punta reduced)', ps.meta.priorityResults.P3_REDUCE_PUNTA.achieved);
    t.assertTrue('PS: P4 NOT in priority results', ps.meta.priorityResults.P4_ARBITRAGE == null);

    // LS: P4 attempted AND achieved (gate fired in this scenario)
    t.assertTrue('LS: P4 attempted', ls.meta.priorityResults.P4_ARBITRAGE.attempted);
    t.assertTrue('LS: P4 achieved (gate fired)', ls.meta.priorityResults.P4_ARBITRAGE.achieved);

    // Value tagging
    t.assertTrue('LS: P3 has valueMxn (rates supplied)',
                 ls.meta.priorityResults.P3_REDUCE_PUNTA.valueMxn != null
              && ls.meta.priorityResults.P3_REDUCE_PUNTA.valueMxn > 0);

    // LS with NET_METERING: P4 attempted but NOT achieved
    var cBlocked = _planMkCtx(c);
    cBlocked.interconnMode = 'NET_METERING';
    var lsBlocked = _planMonthlyBessSchedule(cBlocked, 'LOAD_SHIFTING');
    t.assertTrue('LS blocked: P4 attempted', lsBlocked.meta.priorityResults.P4_ARBITRAGE.attempted);
    t.assertTrue('LS blocked: P4 NOT achieved', !lsBlocked.meta.priorityResults.P4_ARBITRAGE.achieved);

    t.info('PS priorities', JSON.stringify(ps.meta.priorityResults));
    t.info('LS priorities', JSON.stringify(ls.meta.priorityResults));
  }
});
