// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/BessSpecMigrationTests.gs
// -----------------------------------------------------------------------------
// [A2b] Locks the migration of _readBatterySpecForHourlySim (20a) off hardcoded
// getRange(row, 3) onto readInput()/INPUT_MAP (_MAP_BESS).
//
// Reuses the _mockBessS6Ss helper (BessInstallContextMigrationTests.gs), which
// serves any col-3 INPUT_BESS row, so the reader runs without a live workbook.
//
// Two assertions carry the most weight:
//   1. Populated spec (CULLIGAN-like) -> exact passthrough of cap/power/SoC/RTE,
//      usable = cap*(maxSoc-minSoc), and strategy.
//   2. Empty C7 -> strategy 'PEAK_SHAVING'. The map default for bessStrategy was
//      flipped to '' so this stays true; the old 'SELF_CONSUMPTION_MAX' default
//      would have changed the hourly dispatch strategy on a blank cell.
// =============================================================================

registerTest({
  id      : 'REG_MIGRATE_BESS_SPEC_HOURLYSIM',
  group   : 'regression',
  module  : 'inputs/migration',
  scenarios: [],
  tags    : ['inputs', 'map', 'bess', 'a2', 'migration'],
  source  : 'tests_regression/inputs/BessSpecMigrationTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/migration [A2b]: _readBatterySpecForHourlySim via readInput');

    // -- Case 1: fully populated, CULLIGAN-like (no resilience) ----------------
    var spec = _readBatterySpecForHourlySim(_mockBessS6Ss({
      7: 'PEAK_SHAVING', 10: 2169, 11: 972, 12: 0.1, 13: 0.9, 14: 0.9,
      15: 1, 17: 0, 58: 0, 59: 0, 60: 0, 61: 0, 62: ''
    }));
    t.assert('capacityKwh',     2169, spec.capacityKwh);
    t.assert('powerKw',          972, spec.powerKw);
    t.assert('minSocPct',        0.1, spec.minSocPct);
    t.assert('maxSocPct',        0.9, spec.maxSocPct);
    t.assert('rtePct',           0.9, spec.rtePct);
    t.assert('strategy',         'PEAK_SHAVING', spec.strategy);
    t.assertNear('usableKwh = cap*(max-min)', 1735.2, spec.usableKwh, 1e-6);
    t.assert('cyclesPerDay',     1, spec.cyclesPerDay);
    t.assert('backupReservePct', 0, spec.backupReservePct);
    t.assert('resilienceReservedFrac (no resilience)', 0, spec.resilienceReservedFrac);

    // -- Case 2: empty C7 -> PEAK_SHAVING (default-flip proof) -----------------
    var sBlank = _readBatterySpecForHourlySim(_mockBessS6Ss({ 10: 1000 }));
    t.assert('EMPTY strategy -> PEAK_SHAVING (not SELF_CONSUMPTION_MAX)',
      'PEAK_SHAVING', sBlank.strategy);
    // SoC / RTE / cycles map defaults applied on empty cells
    t.assert('empty minSoc default 0.10', 0.10, sBlank.minSocPct);
    t.assert('empty maxSoc default 0.90', 0.90, sBlank.maxSocPct);
    t.assert('empty rte default 0.90',    0.90, sBlank.rtePct);
    t.assert('empty cyclesPerDay default 1', 1, sBlank.cyclesPerDay);

    // -- Case 3: lowercase strategy is uppercased -----------------------------
    t.assert('strategy uppercased', 'SELF_CONSUMPTION_MAX',
      _readBatterySpecForHourlySim(_mockBessS6Ss({ 10: 1000, 7: 'self_consumption_max' })).strategy);

    // -- Case 4: no battery configured -> null --------------------------------
    t.assertTrue('capacity 0 -> null',
      _readBatterySpecForHourlySim(_mockBessS6Ss({ 10: 0 })) === null);
    t.assertTrue('no INPUT_BESS sheet -> null',
      _readBatterySpecForHourlySim({ getSheetByName: function(){ return null; } }) === null);

    // -- Case 5: resilience inputs carried through ----------------------------
    var sRes = _readBatterySpecForHourlySim(_mockBessS6Ss({
      10: 1000, 12: 0.1, 13: 0.9,
      58: 50, 59: 4, 60: 2, 61: 100000, 62: 'estimate'
    }));
    t.assert('resil criticalLoadKw',      50,     sRes.resilienceInputs.criticalLoadKw);
    t.assert('resil backupDurationHours', 4,      sRes.resilienceInputs.backupDurationHours);
    t.assert('resil eventsPerYear',       2,      sRes.resilienceInputs.eventsPerYear);
    t.assert('resil eventCostMxn',        100000, sRes.resilienceInputs.eventCostMxn);
    t.assert('resil eventValueSource uppercased', 'ESTIMATE', sRes.resilienceInputs.eventValueSource);
    t.assertTrue('resilienceReservedFrac is a number',
      typeof sRes.resilienceReservedFrac === 'number' && sRes.resilienceReservedFrac >= 0);
  }
});
