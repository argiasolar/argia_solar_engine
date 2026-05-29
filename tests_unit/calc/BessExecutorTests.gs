// =============================================================================
// ARGIA TESTS -- tests_unit/calc/BessExecutorTests.gs
// -----------------------------------------------------------------------------
// CHUNK 5 -- Session 2
//
// Locks the schedule-aware path through _bessDispatchHour. When
// opts.scheduleHour is supplied, the dispatcher executes the precomputed
// schedule with real-SoC clamping. When absent, the legacy greedy path
// runs (covered by BessDispatchStrategyTests).
//
// COVERAGE (6 tests):
//   1. UNIT_BESS_EXECUTOR_FOLLOWS_SCHEDULE       -- planned discharge happens
//   2. UNIT_BESS_EXECUTOR_CLAMPS_TO_SOC_LOW      -- can't discharge below min
//   3. UNIT_BESS_EXECUTOR_CLAMPS_TO_SOC_HIGH     -- can't charge above max
//   4. UNIT_BESS_EXECUTOR_NO_SCHEDULE_LEGACY     -- absent scheduleHour = legacy
//   5. UNIT_BESS_EXECUTOR_RETURN_SHAPE_PRESERVED -- same keys as legacy
//   6. UNIT_BESS_EXECUTOR_DOESNT_OVERFEED        -- discharge capped by residual load
// =============================================================================


function _execBase(overrides) {
  var b = {
    strategy: 'PEAK_SHAVING',
    bucket: 'punta',
    residualNetLoadKwh: 50,
    pvSurplusKwh: 0,
    batterySoc: 100,
    minSocKwh: 10,
    maxSocKwh: 190,
    batteryPowerKw: 100,
    rte: 0.9,
    interconnMode: 'NET_BILLING',
    rateBase: 0.9,
    rateInter: 1.2,
    ratePunta: 1.5
  };
  if (overrides) {
    for (var k in overrides) if (overrides.hasOwnProperty(k)) b[k] = overrides[k];
  }
  return _bessDispatchHour(b);
}


registerTest({
  id      : 'UNIT_BESS_EXECUTOR_FOLLOWS_SCHEDULE',
  group   : 'unit',
  module  : 'calc/bess_executor',
  scenarios: [],
  tags    : ['calc', 'bess_executor', 'chunk5'],
  source  : 'tests_unit/calc/BessExecutorTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_executor: executes a planned discharge');

    var r = _execBase({
      scheduleHour: { dischargeKwh: 30, chargeKwh: 0, gridChargeKwh: 0 },
      residualNetLoadKwh: 50,
      batterySoc: 100   // plenty above minSocKwh
    });
    t.assert('discharge matches planned (30)', 30, r.dischargeKwh);
    t.assertTrue('batteryActionKwh positive', r.batteryActionKwh > 0);
    t.assert('SoC dropped by discharge amount', 70, r.batterySoc);
  }
});


registerTest({
  id      : 'UNIT_BESS_EXECUTOR_CLAMPS_TO_SOC_LOW',
  group   : 'unit',
  module  : 'calc/bess_executor',
  scenarios: [],
  tags    : ['calc', 'bess_executor', 'chunk5'],
  source  : 'tests_unit/calc/BessExecutorTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_executor: clamps discharge to available SoC');

    var r = _execBase({
      scheduleHour: { dischargeKwh: 50, chargeKwh: 0, gridChargeKwh: 0 },
      residualNetLoadKwh: 50,
      batterySoc: 15,
      minSocKwh: 10            // only 5 kWh available
    });
    t.assertTrue('discharge clamped to 5', Math.abs(r.dischargeKwh - 5) < 1e-9);
    t.assert('SoC at minimum after clamp', 10, r.batterySoc);
  }
});


registerTest({
  id      : 'UNIT_BESS_EXECUTOR_CLAMPS_TO_SOC_HIGH',
  group   : 'unit',
  module  : 'calc/bess_executor',
  scenarios: [],
  tags    : ['calc', 'bess_executor', 'chunk5'],
  source  : 'tests_unit/calc/BessExecutorTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_executor: clamps charge to available headroom');

    var r = _execBase({
      scheduleHour: { dischargeKwh: 0, chargeKwh: 0, gridChargeKwh: 30 },
      residualNetLoadKwh: 0,
      batterySoc: 185,
      minSocKwh: 10,
      maxSocKwh: 190,
      pvSurplusKwh: 0
      // only 5 kWh of room before maxSoc
    });
    t.assert('charge clamped to 5', 5, r.chargeKwh);
    // SoC went up by 5 × rte (0.9) = 4.5 from 185 -> 189.5
    t.assertTrue('SoC near max after clamp', r.batterySoc > 189 && r.batterySoc <= 190);
  }
});


registerTest({
  id      : 'UNIT_BESS_EXECUTOR_NO_SCHEDULE_LEGACY',
  group   : 'unit',
  module  : 'calc/bess_executor',
  scenarios: [],
  tags    : ['calc', 'bess_executor', 'chunk5'],
  source  : 'tests_unit/calc/BessExecutorTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_executor: absent scheduleHour falls through to legacy greedy');

    // No scheduleHour -> PEAK_SHAVING in punta -> greedy discharges to cover load.
    // This is the same scenario as UNIT_BESS_DISPATCH_PEAK_SHAVING_PUNTA_FIRST,
    // confirming the additive change doesn't break legacy behavior.
    var r = _execBase({
      strategy: 'PEAK_SHAVING',
      bucket: 'punta',
      residualNetLoadKwh: 50
    });
    t.assertTrue('legacy discharge fires', r.dischargeKwh > 0);
    t.assert('legacy covers load (50)', 50, Math.round(r.dischargeKwh));
  }
});


registerTest({
  id      : 'UNIT_BESS_EXECUTOR_RETURN_SHAPE_PRESERVED',
  group   : 'unit',
  module  : 'calc/bess_executor',
  scenarios: [],
  tags    : ['calc', 'bess_executor', 'chunk5'],
  source  : 'tests_unit/calc/BessExecutorTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_executor: schedule-aware return has same keys as legacy');

    var legacyR = _execBase({});
    var schedR = _execBase({
      scheduleHour: { dischargeKwh: 20, chargeKwh: 0, gridChargeKwh: 0 }
    });

    var requiredKeys = ['batteryActionKwh', 'batterySoc', 'pvSurplusKwh',
                        'residualNetLoadKwh', 'dischargeKwh', 'chargeKwh'];
    for (var i = 0; i < requiredKeys.length; i++) {
      var k = requiredKeys[i];
      t.assertTrue('legacy has key ' + k,  legacyR[k] !== undefined);
      t.assertTrue('schedule has key ' + k, schedR[k] !== undefined);
    }
  }
});


registerTest({
  id      : 'UNIT_BESS_EXECUTOR_DOESNT_OVERFEED',
  group   : 'unit',
  module  : 'calc/bess_executor',
  scenarios: [],
  tags    : ['calc', 'bess_executor', 'chunk5'],
  source  : 'tests_unit/calc/BessExecutorTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_executor: discharge capped by residual load (no grid feed-back)');

    // Planner scheduled 80 kWh discharge, but actual residual load is only 30.
    // Battery should discharge only 30 -- no point pushing surplus to grid
    // through the battery.
    var r = _execBase({
      scheduleHour: { dischargeKwh: 80, chargeKwh: 0, gridChargeKwh: 0 },
      residualNetLoadKwh: 30,
      batterySoc: 150
    });
    t.assert('discharge capped at residual load', 30, r.dischargeKwh);
  }
});
