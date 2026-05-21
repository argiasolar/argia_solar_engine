// =============================================================================
// ARGIA TESTS -- tests_unit/standards/NomBessConstantsTests.gs
// -----------------------------------------------------------------------------
// PASS 5 MIGRATION: BESS NOM constants suite.
//
// SOURCE: Originally lived as addPhase8Tests in 99k_Phase8_NomBessConstants.gs
//         (whole-file suite). Migrated 2026-05-21 as part of Pass 5.
//
// COVERAGE
//   loadNomConstants() exposes nom.bess.* with the expected values, loaded
//   from 61_NOM_LIMITS rows 20-25 (mirrored as 61M_NOM_LIMITS in MASTER_DB).
//   Verifies:
//     - The nom.bess block exists
//     - Each of the 6 BESS constants has its expected value
//     - Sanity invariants: minSoc < maxSoc, RTE in (0,1], fire >= work,
//       dcCurrentFactor >= 1.0
//     - All 6 bess_ keys are present in the JS NOM limits table
//
// EXPECTED VALUES (from 61_NOM_LIMITS rows 20-25)
//   bess_dc_conductor_current_factor  = 1.25
//   bess_min_working_clearance_mm     = 900   (PROPOSED -- PEC to confirm)
//   bess_fire_clearance_mm            = 1000  (PROPOSED -- PEC to confirm)
//   bess_min_soc_default              = 0.10
//   bess_max_soc_default              = 0.90
//   bess_round_trip_efficiency_floor  = 0.90
//
// CLASSIFICATION
//   group=unit. The sheet read in loadNomConstants is setup, not the
//   behavior under test (per the taxonomy established in Pass 3).
//
// DEPENDENCIES
//   - loadNomConstants (02_LoadDB.gs)
//
// CO-EXISTENCE
//   99k_Phase8_NomBessConstants.gs is unchanged and still runs from legacy
//   runTests(). Deleted in Pass 7 along with the rest of 99h-99u_*.gs.
// =============================================================================


registerTest({
  id      : 'UNIT_STANDARDS_NOM_BESS_CONSTANTS',
  group   : 'unit',
  module  : 'standards/nom_constants',
  scenarios: [],
  tags    : ['standards', 'nom', 'bess', 'constants'],
  source  : 'tests_unit/standards/NomBessConstantsTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT standards/nom_constants: BESS limits');

    var nom = loadNomConstants(ctx.ss);

    // === 1. The bess block exists ==========================================
    t.assert('nom.bess block defined', 'object', typeof nom.bess);

    if (typeof nom.bess !== 'object' || nom.bess === null) {
      t.error('nom.bess missing -- cannot run value checks',
              new Error('nom.bess is not an object'));
      return;
    }

    // === 2. Each constant has its expected value ==========================
    // If the 61M_NOM_LIMITS mirror is current, these come from the sheet.
    // If the mirror is stale, the loader falls back to the same defaults --
    // so either way these values must hold.
    t.assert('nom.bess.dcCurrentFactor = 1.25', 1.25, nom.bess.dcCurrentFactor);
    t.assert('nom.bess.minWorkClearMm = 900',    900, nom.bess.minWorkClearMm);
    t.assert('nom.bess.fireClearMm = 1000',     1000, nom.bess.fireClearMm);
    t.assert('nom.bess.minSocDefault = 0.10',   0.10, nom.bess.minSocDefault);
    t.assert('nom.bess.maxSocDefault = 0.90',   0.90, nom.bess.maxSocDefault);
    t.assert('nom.bess.rteFloor = 0.90',        0.90, nom.bess.rteFloor);

    // === 3. Sanity / consistency invariants ===============================
    // The SOC defaults must agree with readInputBess defaults (Phase 5
    // locks minSoc 0.10 / maxSoc 0.90). A mismatch here would mean the
    // two layers disagree -- catch it at the data layer.
    t.assertTrue('bess minSoc < maxSoc',
                 nom.bess.minSocDefault < nom.bess.maxSocDefault);
    t.assertTrue('bess RTE floor is a valid fraction (0..1)',
                 nom.bess.rteFloor > 0 && nom.bess.rteFloor <= 1);
    t.assertTrue('bess fire clearance >= working clearance',
                 nom.bess.fireClearMm >= nom.bess.minWorkClearMm);
    t.assertTrue('bess dcCurrentFactor >= 1.0 (continuous-duty uplift)',
                 nom.bess.dcCurrentFactor >= 1.0);

    // === 4. Underlying limit keys present in the JS NOM limits table ======
    // NOM limits are JS-sourced (buildNomLimitsDefaults) -- there is no
    // spreadsheet mirror for this table. All 6 bess_ keys must be present
    // in nom.limits; if any is missing, nom.bess fell back to its || literal
    // and the JS defaults table is incomplete.
    var keys = [
      'bess_dc_conductor_current_factor',
      'bess_min_working_clearance_mm',
      'bess_fire_clearance_mm',
      'bess_min_soc_default',
      'bess_max_soc_default',
      'bess_round_trip_efficiency_floor'
    ];
    var foundInTable = 0;
    for (var i = 0; i < keys.length; i++) {
      if (nom.limits[keys[i]] !== undefined) foundInTable++;
    }
    t.assert('all 6 bess_ keys present in JS NOM limits table',
             keys.length, foundInTable);
  }
});
