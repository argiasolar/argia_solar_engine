// =============================================================================
// ARGIA TESTS -- tests_integration/inputs/BessCouplingReaderTests.gs
// -----------------------------------------------------------------------------
// PASS 7 MIGRATION (integration half): BESS coupling reader live round-trip.
//
// SOURCE: Integration half of addPhase9bTests in
//         99m_Phase9b_BessCouplingReader.gs (PART B in the legacy source).
//         Pure half migrated separately in Pass 6 as
//         UNIT_INPUTS_BESS_COUPLING_RESOLVER and ..._MAP_SHAPE.
//
// This is the FIRST integration test under the new framework. It writes to
// INPUT_DESIGN!C17 (one cell, two values), runs readInputs(), asserts, and
// restores in a finally block. Critical pattern validations:
//   1. try/finally restores cells even if an assertion fails
//   2. setInputValue/getInputValue (InputMap-backed) works for live cells
//   3. runIntegrationTests() actually executes and reports correctly
//   4. _TEST_RESULTS_V2 captures group=integration entries
//
// CLASSIFICATION
//   group=integration. Writes to live INPUT_DESIGN!C17.
//
// DEPENDENCIES
//   - readInputs (01_ReadInputs.gs)
//   - setInputValue / getInputValue / backupInputCells / restoreInputCells
//     (test/TestData.gs, InputMap-backed)
//
// SAFETY
//   - Snapshots C17 via backupInputCells before any write
//   - Restores in finally block -- runs even if assertions throw
//   - Only writes dropdown-VALID values ('AC_COUPLED', 'DC_COUPLED')
//   - INPUT_DESIGN!C17 has data validation; invalid values are rejected
//     by the sheet, which is correct behavior we don't test against
//
// CO-EXISTENCE
//   99m_Phase9b_BessCouplingReader.gs is unchanged. After Pass 7, the
//   live round-trip assertions (2) run twice: once via legacy runTests,
//   once via runIntegrationTests. The map shape and pure resolver
//   asserts only run via legacy + the Pass 6 unit tests.
// =============================================================================


registerTest({
  id      : 'INT_INPUTS_BESS_COUPLING_LIVE_CELL',
  group   : 'integration',
  module  : 'inputs/bess_coupling',
  scenarios: [],
  tags    : ['inputs', 'bess', 'coupling', 'live-cell'],
  source  : 'tests_integration/inputs/BessCouplingReaderTests.gs',
  fn: function (t, ctx) {
    t.suite('INT inputs/bess_coupling: live INPUT_DESIGN!C17 round-trip');

    // Snapshot the cell so we can restore no matter what
    var snap = backupInputCells(['bessCoupling'], ctx.ss);

    try {
      // -- AC_COUPLED -----------------------------------------------------
      setInputValue('bessCoupling', 'AC_COUPLED', ctx.ss);
      var inp1 = readInputs(ctx.ss);
      t.assert('C17=AC_COUPLED -> inp.bessCoupling',
               'AC_COUPLED', inp1.bessCoupling);

      // -- DC_COUPLED -----------------------------------------------------
      setInputValue('bessCoupling', 'DC_COUPLED', ctx.ss);
      var inp2 = readInputs(ctx.ss);
      t.assert('C17=DC_COUPLED -> inp.bessCoupling',
               'DC_COUPLED', inp2.bessCoupling);

    } finally {
      // ALWAYS restore -- runs even if an assertion failed or readInputs threw
      restoreInputCells(snap, ctx.ss);
      t.info('cleanup', 'INPUT_DESIGN!C17 restored to pre-test state');
    }
  }
});
