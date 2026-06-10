// =============================================================================
// ARGIA TESTS -- tests_unit/inputs/BessVoltageResolverTests.gs
// -----------------------------------------------------------------------------
// PASS 6 MIGRATION (unit half only): Battery voltage resolution suite.
//
// SOURCE: Originally lived as addPhase14BessTests in
//         99r_Phase14_BessVoltage.gs.
//
// This file migrates the PURE half (parts A + B in the source):
//   PART A: resolveBessVoltage as a pure unit (DB-wins / manual-fallback / junk->0)
//   PART B: INPUT_MAP entries point at the right INPUT_BESS cells
//
// NOT MIGRATED HERE (deferred to a deliberate integration pass):
//   PART C: live cell round-trip via readInputBess(ss) -- writes
//           INPUT_PROJECT!D64 and INPUT_BESS!C6,C7,C10,C11,C18,C19, then
//           restores in a finally block. That belongs in
//           tests_integration/inputs/, not here.
//
// CLASSIFICATION
//   group=unit. No sheet I/O at all in this file. resolveBessVoltage is
//   pure; INPUT_MAP is read-only metadata.
//
// DEPENDENCIES
//   - resolveBessVoltage (01a_ReadInputsBess.gs)
//   - INPUT_MAP (02c_InputMap.gs)
//
// CO-EXISTENCE
//   99r_Phase14_BessVoltage.gs is unchanged and still runs from legacy
//   runTests(). After Pass 6, the pure asserts (16 of them) run twice:
//   once via legacy, once via runUnitTests. The integration asserts (6)
//   continue to run only via legacy until the integration migration pass.
//   Final cleanup in Pass 7+ (depending on when integration migrates).
// =============================================================================


registerTest({
  id      : 'UNIT_INPUTS_BESS_VOLTAGE_RESOLVER',
  group   : 'unit',
  module  : 'inputs/bess_voltage',
  scenarios: [],
  tags    : ['inputs', 'bess', 'voltage', 'resolver'],
  source  : 'tests_unit/inputs/BessVoltageResolverTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT inputs/bess_voltage: resolveBessVoltage');

    // === Function availability =============================================
    t.assert('resolveBessVoltage defined',
             'function', typeof resolveBessVoltage);

    // === Pure resolution logic =============================================
    // BDF-7.1 contract: manual voltage cell wins if it's a valid positive
    // number; DB is the fallback for designers who haven't typed in a
    // voltage themselves. 0 means "not supplied".
    //
    // BDF-7.1 (manual-wins) inverted the previous DB-wins behavior so the
    // BESS path matches the rest of the engine where INPUT_* overrides
    // MASTER_DB. Resolver code (01a_ReadInputsBess.js:62-68) reflects the
    // current contract; this test was previously asserting the old DB-wins
    // contract and failing -- updated 2026-05-27.
    t.assert('DB 1200 + blank manual -> 1200',
             1200, resolveBessVoltage(1200, ''));
    t.assert('DB 1200 + manual 600 -> 600 (manual wins, BDF-7.1)',
             600,  resolveBessVoltage(1200, 600));
    t.assert('DB 0 + manual 600 -> 600 (manual fallback)',
             600,  resolveBessVoltage(0, 600));
    t.assert('DB 0 + blank manual -> 0 (not supplied)',
             0,    resolveBessVoltage(0, ''));
    t.assert('DB junk + manual 480 -> 480',
             480,  resolveBessVoltage('Loading...', 480));
    t.assert('DB 1200 + manual negative -> 1200 (negative manual ignored, DB fallback)',
             1200, resolveBessVoltage(1200, -5));
    t.assert('both junk -> 0',
             0,    resolveBessVoltage('x', 'y'));
  }
});


registerTest({
  id      : 'UNIT_INPUTS_BESS_VOLTAGE_MAP_SHAPE',
  group   : 'unit',
  module  : 'inputs/bess_voltage',
  scenarios: [],
  tags    : ['inputs', 'bess', 'voltage', 'input-map'],
  source  : 'tests_unit/inputs/BessVoltageResolverTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT inputs/bess_voltage: INPUT_MAP shape');

    // === Voltage cells unified onto §6 (2026-06-10) ========================
    // The former bessDcBusVoltageV (C18) / bessAcVoltageV (C19) entries were
    // removed; the engine now reads bessDcBusV (C44) / bessAcV (C45). Full
    // survivor coverage lives in REG_BESS_VOLTAGE_UNIFY_C44.
    t.assertTrue('bessDcBusVoltageV (C18) removed from INPUT_MAP',
                 !INPUT_MAP.hasOwnProperty('bessDcBusVoltageV'));
    t.assertTrue('bessAcVoltageV (C19) removed from INPUT_MAP',
                 !INPUT_MAP.hasOwnProperty('bessAcVoltageV'));

    // === Commercial + peak-shaving rows are stable =========================
    // (Sheet layout is unchanged by the map cleanup; these still hold.)
    t.assert('bessCapexMxn -> row 22',
             22, INPUT_MAP.bessCapexMxn.row);
    t.assert('bessLoadFactorFC -> row 25',
             25, INPUT_MAP.bessLoadFactorFC.row);
    t.assert('bessPuntaWindowSummerH -> row 26',
             26, INPUT_MAP.bessPuntaWindowSummerH.row);
    t.assert('bessPuntaWindowWinterH -> row 27',
             27, INPUT_MAP.bessPuntaWindowWinterH.row);
  }
});
