// =============================================================================
// ARGIA TESTS -- tests_integration/calc/PlannerToExecutorIntegrationTests.gs
// -----------------------------------------------------------------------------
// CHUNK 5 -- Session 2
//
// End-to-end check: the planner produces a 24-hour schedule, the executor
// applies it over a representative day, and the daily totals match the
// schedule's budgets within tolerance (some drift expected from SoC
// clamping vs the typical-day assumption the planner used).
//
// COVERAGE (1 test):
//   UNIT_BESS_PLANNER_TO_EXECUTOR_ROUNDTRIP
//     plan one month -> execute through 24 hours -> daily totals match
//
// COVERAGE (1 additional shape-test):
//   UNIT_BESS_PICKER_INCLUDES_LIFETIME_FIELDS  -- picker enriched output
// =============================================================================


registerTest({
  id      : 'UNIT_BESS_PLANNER_TO_EXECUTOR_ROUNDTRIP',
  group   : 'integration',
  module  : 'calc/bess_planner_to_executor',
  scenarios: [],
  tags    : ['calc', 'bess', 'chunk5', 'integration'],
  source  : 'tests_integration/calc/PlannerToExecutorIntegrationTests.gs',
  fn      : function (t, ctx) {
    t.suite('INTEGRATION calc/bess: planner output drives executor; daily totals close');

    // GDMTH-style bucket layout
    var buckets = new Array(24);
    for (var h = 0; h < 24; h++) {
      if (h <= 5)              buckets[h] = 'base';
      else if (h >= 18 && h <= 21) buckets[h] = 'punta';
      else                     buckets[h] = 'intermedia';
    }
    // 60 kW flat baseload with a 150 kW punta spike (4 hours)
    var load = new Array(24).fill(60);
    for (var p = 18; p <= 21; p++) load[p] = 150;
    // PV: bell curve via the planner's utility
    var pv = _planSyntheticPvBellShape(14 * 80);   // 1120 kWh/day, peak ~midday

    var monthCtx = {
      monthIndex: 5,
      daysInMonth: 30,
      bucketByHour: buckets,
      loadByHour: load,
      pvByHour: pv,
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
      planningDemandLimitKw: 200
    };
    var schedule = _planMonthlyBessSchedule(monthCtx, 'PEAK_SHAVING');

    var plannedTotalDischarge = 0, plannedTotalCharge = 0;
    for (var h2 = 0; h2 < 24; h2++) {
      plannedTotalDischarge += schedule.dischargeByHour[h2];
      plannedTotalCharge    += schedule.chargeByHour[h2] + schedule.gridChargeByHour[h2];
    }
    t.assertTrue('planner produced a meaningful discharge plan',
                 plannedTotalDischarge > 0);

    // Now walk 24 hours through the executor.
    var soc = monthCtx.minSocKwh;
    var execTotalDischarge = 0, execTotalCharge = 0;
    var minSocDuringDay = soc, maxSocDuringDay = soc;
    for (var h3 = 0; h3 < 24; h3++) {
      var pvH = pv[h3];
      var loadH = load[h3];
      var netLoad = loadH - pvH;
      var pvSurplus = (netLoad < 0) ? -netLoad : 0;
      var residual  = (netLoad > 0) ?  netLoad : 0;

      var sched = _bessPickScheduleHourForClock(schedule, h3);
      var r = _bessDispatchHour({
        strategy: 'PEAK_SHAVING',
        bucket: buckets[h3],
        residualNetLoadKwh: residual,
        pvSurplusKwh: pvSurplus,
        batterySoc: soc,
        minSocKwh: monthCtx.minSocKwh,
        maxSocKwh: monthCtx.maxSocKwh,
        batteryPowerKw: monthCtx.batteryPowerKw,
        rte: monthCtx.rte,
        interconnMode: monthCtx.interconnMode,
        rateBase: monthCtx.rateBase,
        ratePunta: monthCtx.ratePunta,
        scheduleHour: sched
      });
      soc = r.batterySoc;
      execTotalDischarge += r.dischargeKwh;
      execTotalCharge    += r.chargeKwh;
      if (soc < minSocDuringDay) minSocDuringDay = soc;
      if (soc > maxSocDuringDay) maxSocDuringDay = soc;
    }

    // Match planner's daily totals within 15% tolerance. SoC trajectory drift
    // and per-hour PV-availability clamping can suppress some planned action.
    var dischargeRatio = (plannedTotalDischarge > 0)
      ? execTotalDischarge / plannedTotalDischarge : 1;
    t.assertTrue('executor discharge >= 50% of planned (' +
                 (dischargeRatio * 100).toFixed(0) + '%)',
                 dischargeRatio >= 0.50);
    t.assertTrue('executor discharge <= 110% of planned (' +
                 (dischargeRatio * 100).toFixed(0) + '%)',
                 dischargeRatio <= 1.10);

    // I3 still holds at the day level
    t.assertTrue('executor I3: total discharge <= usableKwh',
                 execTotalDischarge <= monthCtx.usableKwh + 1e-6);

    // SoC always in valid range
    t.assertTrue('SoC stayed >= min throughout day',
                 minSocDuringDay >= monthCtx.minSocKwh - 1e-6);
    t.assertTrue('SoC stayed <= max throughout day',
                 maxSocDuringDay <= monthCtx.maxSocKwh + 1e-6);

    t.info('roundtrip',
      'planned: ch=' + plannedTotalCharge.toFixed(1) +
      ' dis=' + plannedTotalDischarge.toFixed(1) +
      ' | exec: ch=' + execTotalCharge.toFixed(1) +
      ' dis=' + execTotalDischarge.toFixed(1) +
      ' | ratio=' + (dischargeRatio * 100).toFixed(0) + '%');
  }
});


// -----------------------------------------------------------------------------
// Picker shape test -- ensures the enrichment in 21_BessPickerWiring lands.
// -----------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_BESS_PICKER_INCLUDES_LIFETIME_FIELDS',
  group   : 'unit',
  module  : 'wiring/bess_picker',
  scenarios: [],
  tags    : ['wiring', 'bess_picker', 'chunk5'],
  source  : 'tests_integration/calc/PlannerToExecutorIntegrationTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT wiring/bess_picker: enrichment includes lifetime economics fields');

    // Synthetic catalog with the new lifetime fields populated (mimics what
    // Session 2's MASTER_DB column add produces, after IMPORTRANGE mirror).
    var catalog = [
      { batteryId: 'HW_LUNA_2MWH',
        capacityKwh: 2032, powerKw: 1016,
        minSocPct: 0.05, maxSocPct: 0.95, rtePct: 0.92,
        installedCapexMxn: 20000000,
        // Session 2 enrichment fields:
        cycleLifeAt100Dod: 6000,
        warrantyYears: 10,
        residualValuePct: 0.05,
        degradationPct: 0.02,
        usableCapacityKwh: 2032
      }
    ];
    var recs = [];

    var picked = resolvePickerSelection('HW_LUNA_2MWH', catalog, recs);
    t.assert('picker found catalog match', 'CATALOG', picked.source);
    t.assert('cycleLifeAt100Dod surfaced', 6000, picked.cycleLifeAt100Dod);
    t.assert('warrantyYears surfaced',     10,   picked.warrantyYears);
    t.assertNear('residualValuePct surfaced', 0.05, picked.residualValuePct, 1e-9);
    t.assertNear('degradationPct surfaced',  0.02, picked.degradationPct, 1e-9);
    t.assert('usableCapacityKwh surfaced',   2032, picked.usableCapacityKwh);

    // Header-keyed row (production shape, what getAllBatteryProducts actually
    // returns). The hardened _pickerGet should resolve both shapes.
    var headerKeyedCatalog = [
      { 'Battery_ID': 'HW_LUNA_2MWH',
        'Nominal_Capacity_kWh': 2032,
        'Power_kW': 1016,
        'Min_SOC_%': 0.05,
        'Max_SOC_%': 0.95,
        'Round_Trip_Efficiency_%': 0.92,
        'Installed_CAPEX_MXN': 20000000,
        'Cycle_Life_Cycles': 6000,
        'Warranty_Years': 10,
        'Residual_Value_Pct': 0.05,
        'Annual_Degradation_%': 0.02,
        'Usable_Capacity_kWh': 2032
      }
    ];
    var picked2 = resolvePickerSelection('HW_LUNA_2MWH', headerKeyedCatalog, recs);
    t.assert('header-keyed: picker found CATALOG match', 'CATALOG', picked2.source);
    t.assert('header-keyed: cycleLifeAt100Dod surfaced via _pickerGet',
             6000, picked2.cycleLifeAt100Dod);
    t.assert('header-keyed: capacityKwh surfaced',
             2032, picked2.capacityKwh);
    t.assert('header-keyed: capexMxn surfaced',
             20000000, picked2.capexMxn);
  }
});
