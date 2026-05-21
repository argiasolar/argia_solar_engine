// =============================================================================
// ARGIA TESTS -- tests_integration/engine/RunBessStepCircuitTests.gs
// -----------------------------------------------------------------------------
// PASS 12 MIGRATION: runBessStep circuit wiring (Increment 4b-2).
//
// SOURCE: addPhase10Tests in 99n_Phase10_RunBessStepCircuit.gs.
//         Migrated 2026-05-21 as part of Pass 12.
//
// COVERAGE
//   Verifies the NEW fields runBessStep gained in Increment 4b-2:
//     - result.coupling           (resolved from INPUT_DESIGN!C17)
//     - result.circuit            (calcBessCircuit output, or null)
//     - result.busbarNote         (coupling-aware string)
//     - circuit sizeable vs not-sizeable paths handled honestly
//
//   Four sub-tests share state:
//     1. DC_COUPLED: coupling resolves, busbar note set, circuit object
//        present; sizeable branch validated if voltage available
//     2. AC_COUPLED: busbar note changes, differs from DC
//     3. Summary includes coupling + circuit lines
//     4. PV-only (toggle NO): no circuit object, no crash
//
// CLASSIFICATION
//   group=integration. Writes 4 cells (D64 toggle, C17 INPUT_DESIGN
//   coupling, C10 capacity, C11 power).
//
// DEPENDENCIES
//   - runBessStep (01b_RunBessStep.gs)
//
// PATTERN NOTE
//   The legacy phase has a top-level helper _phase10HasWarning at file
//   scope. The new framework prefers inline helpers (no global pollution).
//   The helper is redefined inside fn: -- same logic, scoped to this test.
//
// HONESTY NOTE (carried from legacy)
//   When CUSTOM_MANUAL is selected with blank voltage cells, calcBessCircuit
//   correctly returns sizeable:false. The test asserts THAT honest behavior
//   instead of forcing a sizeable:true outcome. Both branches are validated
//   so the test stays valid as the live INPUT_BESS state changes.
//
// CO-EXISTENCE
//   99n_Phase10_RunBessStepCircuit.gs unchanged. The legacy
//   _phase10HasWarning helper is also unchanged (still file-scope global
//   in the legacy file).
// =============================================================================


registerTest({
  id      : 'INT_ENGINE_RUN_BESS_STEP_CIRCUIT',
  group   : 'integration',
  module  : 'engine/run_bess_step',
  scenarios: [],
  tags    : ['engine', 'bess', 'circuit', 'coupling', 'live-cell'],
  source  : 'tests_integration/engine/RunBessStepCircuitTests.gs',
  fn: function (t, ctx) {
    t.suite('INT engine/run_bess_step: circuit wiring + coupling');

    var ss = ctx.ss;

    // Inline helper -- case-insensitive substring search across warnings
    function hasWarning(warnings, needle) {
      if (!warnings) return false;
      var n = String(needle).toLowerCase();
      for (var i = 0; i < warnings.length; i++) {
        if (String(warnings[i]).toLowerCase().indexOf(n) >= 0) return true;
      }
      return false;
    }

    // Snapshot every cell we touch
    var snap = backupInputCells(
      ['installBattery', 'bessCoupling',
       'bessCapacityKwh', 'bessPowerKw'], ss);

    try {
      // -- arrange: a valid, enabled battery -----------------------------
      setInputValue('installBattery',  'YES', ss);
      setInputValue('bessCapacityKwh', 200,   ss);
      setInputValue('bessPowerKw',     100,   ss);
      SpreadsheetApp.flush();

      // === TEST 1: DC_COUPLED path =====================================
      setInputValue('bessCoupling', 'DC_COUPLED', ss);
      SpreadsheetApp.flush();
      var dc = runBessStep(ss);

      t.assertTrue('DC: bessEnabled true', dc.bessEnabled);
      t.assert('DC: result.coupling = DC_COUPLED',
               'DC_COUPLED', dc.coupling);
      t.assertTrue('DC: result.busbarNote is a non-empty string',
                   typeof dc.busbarNote === 'string'
                   && dc.busbarNote.length > 0);
      t.assertTrue('DC: busbarNote mentions DC-coupled',
                   dc.busbarNote.indexOf('DC-coupled') >= 0);

      // Circuit ran -- assert the call happened and produced a typed
      // object. Sizeable depends on voltage availability; accept BOTH
      // paths so the test stays valid as the live INPUT_BESS state changes.
      t.assertTrue('DC: result.circuit present',
                   dc.circuit !== null && dc.circuit !== undefined);
      if (dc.circuit) {
        if (dc.circuit.sizeable) {
          // Voltage available -> circuit was sized
          t.assertTrue('DC: sizeable -> has runs',
                       Array.isArray(dc.circuit.runs)
                       && dc.circuit.runs.length > 0);
          var hasCond = !!(dc.circuit.runs[0]
                        && dc.circuit.runs[0].conductorSize !== undefined
                        && dc.circuit.runs[0].conductorSize !== null
                        && String(dc.circuit.runs[0].conductorSize).length > 0);
          t.assertTrue('DC: sizeable -> first run has a conductor size',
                       hasCond);
          t.assertFalse('DC: sized -> no "circuit not sized" warning',
                        hasWarning(dc.warnings, 'circuit not sized'));
        } else {
          // No voltage -> graceful "not sized" with a reason + warning
          t.assertTrue('DC: not sizeable -> gives a reason',
                       typeof dc.circuit.reason === 'string'
                       && dc.circuit.reason.length > 0);
          t.assertTrue('DC: not sizeable -> "circuit not sized" warning raised',
                       hasWarning(dc.warnings, 'circuit not sized'));
        }
      }

      // === TEST 2: AC_COUPLED path -- busbar note changes ==============
      setInputValue('bessCoupling', 'AC_COUPLED', ss);
      SpreadsheetApp.flush();
      var ac = runBessStep(ss);

      t.assert('AC: result.coupling = AC_COUPLED',
               'AC_COUPLED', ac.coupling);
      t.assertTrue('AC: busbarNote mentions AC-coupled',
                   ac.busbarNote.indexOf('AC-coupled') >= 0);
      t.assertTrue('AC: busbarNote mentions main + PV + BESS',
                   ac.busbarNote.indexOf('BESS') >= 0);
      t.assertTrue('AC busbarNote differs from DC busbarNote',
                   ac.busbarNote !== dc.busbarNote);

      // === TEST 3: summary includes coupling + circuit lines ===========
      var hasCouplingLine = false, hasCircuitLine = false;
      for (var i = 0; i < ac.summary.length; i++) {
        if (ac.summary[i].indexOf('coupling') >= 0) hasCouplingLine = true;
        if (ac.summary[i].indexOf('circuit')  >= 0) hasCircuitLine  = true;
      }
      t.assertTrue('AC: summary has a coupling line', hasCouplingLine);
      t.assertTrue('AC: summary has a circuit line',  hasCircuitLine);

      // === TEST 4: PV-only project -- no circuit, no crash =============
      setInputValue('installBattery', 'NO', ss);
      SpreadsheetApp.flush();
      var pv = runBessStep(ss);
      t.assertFalse('PV-only: bessEnabled false', pv.bessEnabled);
      // disabled path is the original early-return -- it has no coupling field
      t.assertTrue('PV-only: no circuit object',
                   pv.circuit === undefined || pv.circuit === null);

    } finally {
      restoreInputCells(snap, ss);
      t.info('cleanup',
             'INPUT_PROJECT/INPUT_DESIGN/INPUT_BESS restored to pre-test state');
    }
  }
});
