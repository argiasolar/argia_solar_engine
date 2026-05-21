// =============================================================================
// ARGIA TESTS -- tests_integration/engine/RunBessStepTests.gs
// -----------------------------------------------------------------------------
// PASS 12 MIGRATION: runBessStep() engine step (spec/throughput/validation).
//
// SOURCE: addPhase6Tests in 99i_Phase6_RunBessStep.gs.
//         Migrated 2026-05-21 as part of Pass 12.
//
// COVERAGE
//   Sequential state-machine integration test. Seven sub-tests share state:
//     1. Function availability
//     2. Toggle NO -> clean disabled result (null bess, 0 throughput, 0 warnings)
//     3. Valid 200 kWh / 100 kW battery -> correct derived quantities:
//        - usable = 200 * (maxSoc-minSoc) * (1-deg) * (1-backup) = 156.00 kWh
//        - throughput = usable * cycles/day * 30.42 * RTE = 4270.968 kWh/mo
//        - cross-check usable == _bessUsableKwh(bess)
//        - 0 SPEC warnings (circuit warnings excluded -- Phase 10 covers them)
//     4. maxSoc <= minSoc -> hard throw
//     5. Low RTE + zero CAPEX -> warnings but no throw
//     6. Capacity 0 -> bessEnabled false (no throw)
//     7. Summary has >= 1 line
//
// CLASSIFICATION
//   group=integration. Writes 13 cells (D64 + 12 INPUT_BESS cells).
//   Same cell surface as Phase 5 plus C18/C19 voltage cells.
//
// DEPENDENCIES
//   - runBessStep (01b_RunBessStep.gs)
//   - _bessUsableKwh (04a_CalcCFEBill.gs) -- helper cross-check
//   - setInputValue / backupInputCells / restoreInputCells (test/TestData.gs)
//
// NEW MODULE PATH: tests_integration/engine/
//   First test under engine/. runBessStep is genuinely an engine
//   orchestration step -- not an input reader, not a writer. Keeps
//   the module hierarchy honest about what each test actually does.
//
// STRUCTURE NOTE: ONE registered test, NOT split into sub-tests
//   Same rationale as Phase 5 -- the sub-tests share sequential cell
//   state. Splitting would require redundant 12-cell writes between
//   sub-tests, ~10x the runtime.
//
// CIRCUIT-WARNING FILTER NOTE
//   Increment 4b-2 wired calcBessCircuit into runBessStep. With no
//   battery voltage available (INPUT_BESS C18/C19 may be blank for
//   CUSTOM_MANUAL), calcBessCircuit returns sizeable:false and adds
//   a "circuit not sized" warning. That's EXPECTED behavior (Phase 10
//   covers it). Phase 6 filters circuit warnings out of its
//   "0 spec warnings" assertion -- only spec warnings count here.
//
// CO-EXISTENCE
//   99i_Phase6_RunBessStep.gs is unchanged. Both run the same 17
//   asserts until the legacy deletion pass.
// =============================================================================


registerTest({
  id      : 'INT_ENGINE_RUN_BESS_STEP_SPEC',
  group   : 'integration',
  module  : 'engine/run_bess_step',
  scenarios: [],
  tags    : ['engine', 'bess', 'orchestration', 'live-cell'],
  source  : 'tests_integration/engine/RunBessStepTests.gs',
  fn: function (t, ctx) {
    t.suite('INT engine/run_bess_step: spec/throughput/validation');

    var ss = ctx.ss;

    // Snapshot every cell we write
    var fieldsToBackup = [
      'installBattery',
      'bessBatteryId', 'bessStrategy',
      'bessCapacityKwh', 'bessPowerKw',
      'bessMinSocPct', 'bessMaxSocPct', 'bessRtePct',
      'bessCyclesPerDay', 'bessDegradationPct', 'bessBackupReservePct',
      'bessDcBusVoltageV', 'bessAcVoltageV',
      'bessCapexMxn'
    ];
    var snap = backupInputCells(fieldsToBackup, ss);

    // Helper: write a full, valid 200 kWh / 100 kW battery (inline; no
    // file-scope helper because this test is the only consumer).
    function writeValidBattery() {
      setInputValue('installBattery',       'YES',                  ss);
      setInputValue('bessBatteryId',        'CUSTOM_MANUAL',        ss);
      setInputValue('bessStrategy',         'SELF_CONSUMPTION_MAX', ss);
      setInputValue('bessCapacityKwh',      200,                    ss);
      setInputValue('bessPowerKw',          100,                    ss);
      setInputValue('bessMinSocPct',        0.10,                   ss);
      setInputValue('bessMaxSocPct',        0.90,                   ss);
      setInputValue('bessRtePct',           0.90,                   ss);
      setInputValue('bessCyclesPerDay',     1.0,                    ss);
      setInputValue('bessDegradationPct',   0.025,                  ss);
      setInputValue('bessBackupReservePct', 0.0,                    ss);
      setInputValue('bessCapexMxn',         1500000,                ss);
      SpreadsheetApp.flush();
    }

    try {
      // === TEST 1: function exists ========================================
      t.assert('runBessStep function defined',
               'function', typeof runBessStep);

      // === TEST 2: toggle NO -> clean disabled result =====================
      setInputValue('installBattery', 'NO', ss);
      SpreadsheetApp.flush();
      var off = runBessStep(ss);
      t.assertFalse('Toggle NO -> bessEnabled false',     off.bessEnabled);
      t.assert('Toggle NO -> bess is null',
               null, off.bess);
      t.assert('Toggle NO -> usableCapacityKwh 0',
               0, off.usableCapacityKwh);
      t.assert('Toggle NO -> monthlyThroughputKwh 0',
               0, off.monthlyThroughputKwh);
      t.assert('Toggle NO -> 0 warnings',
               0, off.warnings.length);

      // === TEST 3: valid battery -> correct derived quantities ============
      writeValidBattery();
      var on = runBessStep(ss);
      t.assertTrue('Valid battery -> bessEnabled true', on.bessEnabled);

      // usable = 200 * (0.90-0.10) * (1-0.025) * (1-0.0)
      //        = 200 * 0.80 * 0.975 * 1.0 = 156.00 kWh
      t.assert('usableCapacityKwh = 156.00',
               156.00, on.usableCapacityKwh, 0.001);

      // throughput = 156.00 * 1.0 cycles/day * 30.42 days * 0.90 RTE
      //            = 156.00 * 27.378 = 4270.968 kWh/month
      t.assert('monthlyThroughputKwh = 4270.968',
               4270.968, on.monthlyThroughputKwh, 0.01);

      // Cross-check: usable here must equal _bessUsableKwh() from 04a
      // (same formula, single source of truth for the deration chain)
      t.assert('usableCapacityKwh matches _bessUsableKwh helper',
               _bessUsableKwh(on.bess), on.usableCapacityKwh, 0.001);

      // Clean valid battery -> no SPEC warnings. Circuit warnings are
      // expected when no battery voltage is available and are covered by
      // Phase 10 -- filter them out here so only spec warnings count.
      var specWarnings = on.warnings.filter(function (w) {
        return String(w).toLowerCase().indexOf('circuit') < 0;
      });
      t.assert('Valid battery -> 0 spec warnings (circuit warnings excluded)',
               0, specWarnings.length);

      // === TEST 4: invalid spec -> throws =================================
      // maxSoc <= minSoc must be a hard error
      writeValidBattery();
      setInputValue('bessMinSocPct', 0.90, ss);
      setInputValue('bessMaxSocPct', 0.10, ss);   // inverted
      SpreadsheetApp.flush();
      t.assertThrows('maxSoc <= minSoc -> runBessStep throws', function () {
        runBessStep(ss);
      });

      // === TEST 5: soft warnings fire (valid but flagged) =================
      // Low RTE (0.70) + zero CAPEX -> warnings, but NOT an error
      writeValidBattery();
      setInputValue('bessRtePct',   0.70, ss);
      setInputValue('bessCapexMxn', 0,    ss);
      SpreadsheetApp.flush();
      var warned = runBessStep(ss);
      t.assertTrue('Low RTE + zero CAPEX -> still enabled (no throw)',
                   warned.bessEnabled);
      t.assertTrue('Low RTE + zero CAPEX -> warnings raised',
                   warned.warnings.length >= 2);

      // === TEST 6: toggle YES but capacity 0 -> disabled, no throw ========
      writeValidBattery();
      setInputValue('bessCapacityKwh', 0, ss);
      SpreadsheetApp.flush();
      var zeroCap = runBessStep(ss);
      t.assertFalse('Toggle YES + capacity 0 -> bessEnabled false',
                    zeroCap.bessEnabled);

      // === TEST 7: summary lines are produced =============================
      writeValidBattery();
      var summed = runBessStep(ss);
      t.assertTrue('Valid battery -> summary has >= 1 line',
                   summed.summary.length >= 1);

    } finally {
      restoreInputCells(snap, ss);
      t.info('cleanup',
             'INPUT_PROJECT/INPUT_BESS restored to pre-test state');
    }
  }
});
