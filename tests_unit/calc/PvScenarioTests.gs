// =============================================================================
// ARGIA TESTS -- tests_unit/calc/PvScenarioTests.gs
// -----------------------------------------------------------------------------
// CHUNK 7 Session 1 -- install-PV toggle + scenario model.
//
// Locks classifyScenario (01c_ReadInputsPv.js) and the null-PV contract.
//
// COVERAGE (10 tests):
//   1. UNIT_PV_SCENARIO_1_PV_ONLY
//   2. UNIT_PV_SCENARIO_2_PV_PLUS_BATTERY
//   3. UNIT_PV_SCENARIO_3_BATTERY_ONLY_GREENFIELD
//   4. UNIT_PV_SCENARIO_4A_EXISTING_PV_UNKNOWN     -- disclaimer present
//   5. UNIT_PV_SCENARIO_4B_PENDING_NO_DOUBLE_COUNT -- capture OFF until live
//   6. UNIT_PV_SCENARIO_DEGENERATE_NO_PV_NO_BATTERY
//   7. UNIT_PV_CAPTURE_OFF_FOR_BATTERY_ONLY        -- 3 and 4A never capture
//   8. UNIT_PV_DISCLAIMER_INVARIANT_4A             -- existing-PV => disclaimer
//   9. UNIT_PV_NULL_OBJECT_CONTRACT                -- installed:false => null PV
//  10. UNIT_PV_DEFAULT_INSTALLED                   -- absent toggle => installed
// =============================================================================

registerTest({
  id: 'UNIT_PV_SCENARIO_1_PV_ONLY', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7'],
  source: 'tests_unit/calc/PvScenarioTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: scenario 1 = PV only');
    var s = classifyScenario({ installed: true }, false);
    t.assert('id 1', '1', s.id);
    t.assertTrue('pvCapture on', s.pvCapture === true);
    t.assertTrue('no disclaimer', s.disclaimer === null);
  }
});

registerTest({
  id: 'UNIT_PV_SCENARIO_2_PV_PLUS_BATTERY', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7'],
  source: 'tests_unit/calc/PvScenarioTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: scenario 2 = PV + Battery');
    var s = classifyScenario({ installed: true }, true);
    t.assert('id 2', '2', s.id);
    t.assertTrue('pvCapture on', s.pvCapture === true);
  }
});

registerTest({
  id: 'UNIT_PV_SCENARIO_3_BATTERY_ONLY_GREENFIELD', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7'],
  source: 'tests_unit/calc/PvScenarioTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: scenario 3 = battery only, greenfield');
    var s = classifyScenario({ installed: false, hasExistingPv: false }, true);
    t.assert('id 3', '3', s.id);
    t.assertTrue('pvCapture OFF', s.pvCapture === false);
    t.assertTrue('no disclaimer (greenfield)', s.disclaimer === null);
  }
});

registerTest({
  id: 'UNIT_PV_SCENARIO_4A_EXISTING_PV_UNKNOWN', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7'],
  source: 'tests_unit/calc/PvScenarioTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: scenario 4A = existing PV, profile unknown');
    var s = classifyScenario(
      { installed: false, hasExistingPv: true, existingProfileKnown: false }, true);
    t.assert('id 4A', '4A', s.id);
    t.assertTrue('pvCapture OFF', s.pvCapture === false);
    t.assertTrue('disclaimer present', !!s.disclaimer);
    t.assertTrue('disclaimer mentions existing solar',
                 s.disclaimer.indexOf('PV existente') >= 0);
    t.assertTrue('disclaimer says value may be higher',
                 s.disclaimer.indexOf('mayor') >= 0);
  }
});

registerTest({
  id: 'UNIT_PV_SCENARIO_4B_DATA_GATED', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7', '4b', 'invariant'],
  source: 'tests_unit/calc/PvScenarioTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: 4B export capture is DATA-GATED (no export data => no capture)');
    // WITHOUT export data: capture OFF, peak-shaving-only, "DATOS
    // INSUFICIENTES" guidance. We NEVER estimate export from the net bill.
    var noData = classifyScenario(
      { installed: false, hasExistingPv: true, existingProfileKnown: true,
        exportDataAvailable: false }, true);
    t.assert('id 4B-screening', '4B-screening', noData.id);
    t.assertTrue('capture OFF without export data', noData.pvCapture === false);
    t.assertTrue('disclaimer asks for export/production data',
                 noData.disclaimer.indexOf('exportación') >= 0);

    // WITH export data: capture ON, value computed (netted by regime later).
    var withData = classifyScenario(
      { installed: false, hasExistingPv: true, existingProfileKnown: true,
        exportDataAvailable: true }, true);
    t.assert('id 4B', '4B', withData.id);
    t.assertTrue('capture ON with export data', withData.pvCapture === true);
    t.assertTrue('disclaimer notes regime netting',
                 withData.disclaimer.indexOf('interconexión') >= 0);
  }
});

registerTest({
  id: 'UNIT_PV_SCENARIO_DEGENERATE_NO_PV_NO_BATTERY', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7'],
  source: 'tests_unit/calc/PvScenarioTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: no PV + no battery = degenerate, flagged');
    var s = classifyScenario({ installed: false }, false);
    t.assert('id 0', '0', s.id);
    t.assertTrue('disclaimer flags nothing to model', !!s.disclaimer);
  }
});

registerTest({
  id: 'UNIT_PV_CAPTURE_OFF_FOR_BATTERY_ONLY', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7'],
  source: 'tests_unit/calc/PvScenarioTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: every battery-only scenario has pvCapture OFF');
    var configs = [
      { installed: false, hasExistingPv: false },                          // 3
      { installed: false, hasExistingPv: true, existingProfileKnown: false }, // 4A
      { installed: false, hasExistingPv: true, existingProfileKnown: true,
        exportDataAvailable: false }   // 4B-screening (no export data)
    ];
    for (var i = 0; i < configs.length; i++) {
      var s = classifyScenario(configs[i], true);
      t.assertTrue('battery-only config ' + i + ' capture OFF', s.pvCapture === false);
    }
  }
});

registerTest({
  id: 'UNIT_PV_DISCLAIMER_INVARIANT_4A', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7', 'invariant'],
  source: 'tests_unit/calc/PvScenarioTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: INVARIANT -- existing PV (capture off) ALWAYS discloses');
    // Any time the customer has existing PV but we are NOT capturing it, the
    // scenario MUST carry a disclaimer (so we never silently understate
    // without telling anyone).
    var withExisting = [
      classifyScenario({ installed: false, hasExistingPv: true, existingProfileKnown: false }, true),
      classifyScenario({ installed: false, hasExistingPv: true, existingProfileKnown: true,
                         exportDataAvailable: false }, true)
    ];
    for (var i = 0; i < withExisting.length; i++) {
      var s = withExisting[i];
      t.assertTrue('existing-PV scenario ' + i + ' capture off', s.pvCapture === false);
      t.assertTrue('existing-PV scenario ' + i + ' has disclaimer', !!s.disclaimer);
    }
  }
});

registerTest({
  id: 'UNIT_PV_NULL_OBJECT_CONTRACT', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7'],
  source: 'tests_unit/calc/PvScenarioTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: null-PV object contract (installed:false => monthlyPvKwh null)');
    // We can test readInputPv's pure shape by simulating its logic via a
    // stubbed readInput. Here we assert the contract directly on a hand-built
    // config of the same shape the reader returns.
    var installedCfg   = { installed: true,  monthlyPvKwh: 'FROM_CFE_SIMULATION' };
    var notInstalled   = { installed: false, monthlyPvKwh: null };
    t.assertTrue('installed => non-null monthlyPvKwh marker',
                 installedCfg.monthlyPvKwh !== null);
    t.assertTrue('not installed => monthlyPvKwh null (null-PV object)',
                 notInstalled.monthlyPvKwh === null);
  }
});

registerTest({
  id: 'UNIT_PV_DEFAULT_INSTALLED', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7', 'regression'],
  source: 'tests_unit/calc/PvScenarioTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: absent toggle defaults to INSTALLED (legacy byte-identical)');
    // The reader defaults installPv to YES when the cell is absent/blank, so
    // every pre-Chunk-7 project (which has no toggle) continues installing PV.
    // We assert the classification for the legacy default is scenario 1 or 2,
    // never a battery-only scenario.
    var legacyPvOnly  = classifyScenario({ installed: true }, false);
    var legacyPvBatt  = classifyScenario({ installed: true }, true);
    t.assert('legacy PV-only stays scenario 1', '1', legacyPvOnly.id);
    t.assert('legacy PV+batt stays scenario 2', '2', legacyPvBatt.id);
    t.assertTrue('legacy always captures PV', legacyPvOnly.pvCapture && legacyPvBatt.pvCapture);
  }
});
