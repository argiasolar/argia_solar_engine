// =============================================================================
// ARGIA TESTS -- tests_unit/inputs/BessCouplingResolverTests.gs
// -----------------------------------------------------------------------------
// PASS 6 MIGRATION (unit half only): BESS coupling resolution suite.
//
// SOURCE: Originally lived as addPhase9bTests in
//         99m_Phase9b_BessCouplingReader.gs.
//
// This file migrates the PURE half (part A + map-shape from part B):
//   - resolveBessCoupling unit tests (blank / null / unknown / case+space)
//   - INPUT_MAP.bessCoupling entry points at INPUT_DESIGN!C17
//
// NOT MIGRATED HERE (deferred to a deliberate integration pass):
//   - Live INPUT_DESIGN!C17 round-trip via readInputs(ss). That belongs in
//     tests_integration/inputs/, not here.
//
// CLASSIFICATION
//   group=unit. No sheet I/O. resolveBessCoupling is pure; INPUT_MAP is
//   read-only metadata.
//
// DEPENDENCIES
//   - resolveBessCoupling (01_ReadInputs.gs or 01b_RunBessStep.gs -- engine
//     code; verified to exist via engine grep at migration time)
//   - INPUT_MAP (02c_InputMap.gs)
//
// FALLBACK CONTRACT
//   Per the legacy suite header: INPUT_DESIGN!C17 has a data-validation
//   dropdown locked to DC_COUPLED / AC_COUPLED only. The fallback path
//   (blank/null/unknown -> DC_COUPLED default) CANNOT be exercised via
//   the cell, only via the pure resolveBessCoupling helper. The pure
//   tests below ARE the proof that the fallback works.
//
// CO-EXISTENCE
//   99m_Phase9b_BessCouplingReader.gs is unchanged and still runs from
//   legacy runTests(). After Pass 6, the pure asserts (10 of them) run
//   twice: once via legacy, once via runUnitTests. The integration asserts
//   (~3) continue to run only via legacy until the integration migration.
// =============================================================================


registerTest({
  id      : 'UNIT_INPUTS_BESS_COUPLING_RESOLVER',
  group   : 'unit',
  module  : 'inputs/bess_coupling',
  scenarios: [],
  tags    : ['inputs', 'bess', 'coupling', 'resolver'],
  source  : 'tests_unit/inputs/BessCouplingResolverTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT inputs/bess_coupling: resolveBessCoupling');

    // === Function availability =============================================
    t.assert('resolveBessCoupling function defined',
             'function', typeof resolveBessCoupling);

    // === Valid inputs pass through =========================================
    t.assert('resolve("AC_COUPLED") -> AC_COUPLED',
             'AC_COUPLED', resolveBessCoupling('AC_COUPLED'));
    t.assert('resolve("DC_COUPLED") -> DC_COUPLED',
             'DC_COUPLED', resolveBessCoupling('DC_COUPLED'));

    // === Fallback to DC_COUPLED default ====================================
    // These paths CAN'T be tested via the live cell -- INPUT_DESIGN!C17
    // has a data-validation dropdown locked to the two valid values. The
    // fallback exists for defensive purposes; this is its only test.
    t.assert('resolve("") blank -> DC_COUPLED default',
             'DC_COUPLED', resolveBessCoupling(''));
    t.assert('resolve(null) -> DC_COUPLED default',
             'DC_COUPLED', resolveBessCoupling(null));
    t.assert('resolve("SOMETHING_ELSE") unknown -> DC_COUPLED default',
             'DC_COUPLED', resolveBessCoupling('SOMETHING_ELSE'));

    // === Case + whitespace tolerance =======================================
    t.assert('resolve("  ac_coupled  ") case+space tolerant -> AC_COUPLED',
             'AC_COUPLED', resolveBessCoupling('  ac_coupled  '));
  }
});


registerTest({
  id      : 'UNIT_INPUTS_BESS_COUPLING_MAP_SHAPE',
  group   : 'unit',
  module  : 'inputs/bess_coupling',
  scenarios: [],
  tags    : ['inputs', 'bess', 'coupling', 'input-map'],
  source  : 'tests_unit/inputs/BessCouplingResolverTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT inputs/bess_coupling: INPUT_MAP shape');

    var m = INPUT_MAP.bessCoupling;
    t.assertTrue('INPUT_MAP.bessCoupling entry exists', !!m);

    if (m) {
      t.assert('bessCoupling mapped sheet = INPUT_DESIGN',
               'INPUT_DESIGN', m.sheet);
      t.assert('bessCoupling mapped row = 17', 17, m.row);
      t.assert('bessCoupling mapped col = 3 (C)', 3, m.col);
    }
  }
});
