// =============================================================================
// ARGIA TESTS -- tests_integration/inputs/ReadInputBessTests.gs
// -----------------------------------------------------------------------------
// PASS 11 MIGRATION: readInputBess input-layer contract.
//
// SOURCE: addPhase5Tests in 99h_Phase5_ReadInputBess.gs.
//         Migrated 2026-05-21 as part of Pass 11.
//
// COVERAGE
//   Sequential state-machine integration test. Writes BESS-related cells
//   across INPUT_PROJECT!D64 + INPUT_BESS C6-C17 + C22, calls readInputBess,
//   asserts against expected return shape, then mutates state and asserts
//   again. Six logical sub-tests:
//     1. Function availability
//     2. Toggle NO -> null
//     3. Toggle YES + capacity 0 -> null
//     4. Full valid specs -> typed object with all 11 fields
//     5. Object passes calcBessImpact field validation
//     6. Blank optional cells fall back to INPUT_MAP defaults
//
// CLASSIFICATION
//   group=integration. Writes 12 cells (D64 + 11 INPUT_BESS cells).
//   All restored in finally via backupInputCells/restoreInputCells.
//
// DEPENDENCIES
//   - readInputBess (01a_ReadInputsBess.gs)
//   - calcBessImpact (04a_CalcCFEBill.gs) -- for field-validation cross-check
//   - setInputValue / backupInputCells / restoreInputCells (test/TestData.gs)
//   - All 13 INPUT_MAP field keys: installBattery, bessBatteryId,
//     bessStrategy, bessCapacityKwh, bessPowerKw, bessMinSocPct,
//     bessMaxSocPct, bessRtePct, bessCyclesPerDay, bessDegradationPct,
//     bessBackupReservePct, bessCoupling (read-only, not written here),
//     bessCapexMxn
//
// STRUCTURE NOTE: ONE registered test, NOT split into sub-tests
//   The legacy phase is a sequential state machine: each sub-test depends
//   on the cells written by the previous one. Splitting into multiple
//   registered tests would require re-running 11 cell writes + flushes
//   for each, ~10x the runtime. Kept as one test for the same reason the
//   legacy had it as one function.
//
// CO-EXISTENCE
//   99h_Phase5_ReadInputBess.gs is unchanged. Both run the same 16
//   asserts until the legacy deletion pass.
// =============================================================================


registerTest({
  id      : 'INT_INPUTS_READ_INPUT_BESS',
  group   : 'integration',
  module  : 'inputs/read_input_bess',
  scenarios: [],
  tags    : ['inputs', 'bess', 'reader', 'live-cell'],
  source  : 'tests_integration/inputs/ReadInputBessTests.gs',
  fn: function (t, ctx) {
    t.suite('INT inputs/read_input_bess: readInputBess contract');

    // Snapshot every cell that gets written
    var fieldsToBackup = [
      'installBattery',
      'bessBatteryId', 'bessStrategy',
      'bessCapacityKwh', 'bessPowerKw',
      'bessMinSocPct', 'bessMaxSocPct', 'bessRtePct',
      'bessCyclesPerDay', 'bessDegradationPct', 'bessBackupReservePct',
      'bessCoupling',
      'bessCapexMxn'
    ];
    var snap = backupInputCells(fieldsToBackup, ctx.ss);

    try {
      // === TEST 1: function exists ========================================
      t.assert('readInputBess function defined',
               'function', typeof readInputBess);

      // === TEST 2: toggle = NO -> null ====================================
      setInputValue('installBattery', 'NO', ctx.ss);
      SpreadsheetApp.flush();
      t.assertTrue('Toggle NO -> readInputBess returns null',
                   readInputBess(ctx.ss) === null);

      // === TEST 3: toggle = YES, capacity 0 -> null =======================
      // Toggle on but designer has not entered specs: must still be null,
      // never a degenerate zero-capacity battery object.
      setInputValue('installBattery', 'YES', ctx.ss);
      setInputValue('bessCapacityKwh', 0, ctx.ss);
      SpreadsheetApp.flush();
      t.assertTrue('Toggle YES + capacity 0 -> readInputBess returns null',
                   readInputBess(ctx.ss) === null);

      // === TEST 4: toggle = YES, full valid specs -> typed object =========
      setInputValue('installBattery',       'YES',                  ctx.ss);
      setInputValue('bessBatteryId',        'CUSTOM_MANUAL',        ctx.ss);
      setInputValue('bessStrategy',         'SELF_CONSUMPTION_MAX', ctx.ss);
      setInputValue('bessCapacityKwh',      200,                    ctx.ss);
      setInputValue('bessPowerKw',          100,                    ctx.ss);
      setInputValue('bessMinSocPct',        0.10,                   ctx.ss);
      setInputValue('bessMaxSocPct',        0.90,                   ctx.ss);
      setInputValue('bessRtePct',           0.90,                   ctx.ss);
      setInputValue('bessCyclesPerDay',     1.0,                    ctx.ss);
      setInputValue('bessDegradationPct',   0.025,                  ctx.ss);
      setInputValue('bessBackupReservePct', 0.0,                    ctx.ss);
      setInputValue('bessCapexMxn',         1500000,                ctx.ss);
      SpreadsheetApp.flush();

      var bess = readInputBess(ctx.ss);
      t.assertTrue('Toggle YES + valid specs -> object (not null)',
                   bess !== null);

      if (bess) {
        t.assert('bess.capacityKwh',
                 200, bess.capacityKwh);
        t.assert('bess.powerKw',
                 100, bess.powerKw);
        t.assert('bess.strategy',
                 'SELF_CONSUMPTION_MAX', bess.strategy);
        t.assert('bess.batteryId',
                 'CUSTOM_MANUAL', bess.batteryId);
        t.assert('bess.minSocPct',
                 0.10, bess.minSocPct);
        t.assert('bess.maxSocPct',
                 0.90, bess.maxSocPct);
        t.assert('bess.rtePct',
                 0.90, bess.rtePct);
        t.assert('bess.cyclesPerDay',
                 1.0, bess.cyclesPerDay);
        t.assert('bess.degradationPct',
                 0.025, bess.degradationPct);
        t.assert('bess.backupReservePct',
                 0.0, bess.backupReservePct);
        t.assert('bess.capexMxn',
                 1500000, bess.capexMxn);

        // === TEST 5: object is consumable by calcBessImpact ==============
        // The whole point of the typed shape: no field renaming needed.
        // calcBessImpact validates SoC/RTE bounds and throws on bad input;
        // a clean run here proves the contract holds.
        var consumable = true;
        try {
          calcBessImpact(
            {},                                                    // inp
            null,                                                  // tar
            { monthlyKwh: 0, interconnectionMode: 'MEDICION_NETA' }, // pv
            bess
          );
        } catch (err) {
          // A throw about pv/tar is fine; a throw about a bess field is NOT
          if (/minSocPct|maxSocPct|rtePct|degradationPct|backupReservePct|strategy/
                .test(err.message)) {
            consumable = false;
          }
        }
        t.assertTrue('bess object passes calcBessImpact field validation',
                     consumable);
      }

      // === TEST 6: blank optional cells fall back to INPUT_MAP defaults ===
      // Clear SoC/RTE; readInputBess should supply map defaults (0.10/0.90/0.90).
      setInputValue('bessMinSocPct', '', ctx.ss);
      setInputValue('bessMaxSocPct', '', ctx.ss);
      setInputValue('bessRtePct',    '', ctx.ss);
      SpreadsheetApp.flush();
      var bessDef = readInputBess(ctx.ss);
      t.assertTrue('Blank optional cells -> object still returned',
                   bessDef !== null);
      if (bessDef) {
        t.assert('Blank minSoc -> default 0.10', 0.10, bessDef.minSocPct);
        t.assert('Blank maxSoc -> default 0.90', 0.90, bessDef.maxSocPct);
        t.assert('Blank rte   -> default 0.90', 0.90, bessDef.rtePct);
      }

    } finally {
      // ALWAYS restore the user's real data
      restoreInputCells(snap, ctx.ss);
      t.info('cleanup',
             'INPUT_PROJECT/INPUT_BESS restored to pre-test state');
    }
  }
});
