// =============================================================================
// ARGIA ENGINE -- Phase 8 test suite: BESS NOM constants (Increment 4a)
// Paste this function into 99_TestRunner.gs, and add the call
//   try { addPhase8Tests(t, ss); } catch (e) { t.error('Phase8 aborted', e); }
// right after the addPhase7Tests block in runTests().
//
// SCOPE: verifies loadNomConstants() exposes the new nom.bess.* block, loaded
// from 61_NOM_LIMITS rows 20-25 (mirrored as 61M_NOM_LIMITS in MASTER_DB).
//
// This is a data-layer test: it confirms the NOM limits the battery MDC will
// later depend on are present and carry the expected values. It also confirms
// the fallback defaults are sane, so a stale mirror cannot silently break the
// engine.
//
// EXPECTED VALUES (from 61_NOM_LIMITS rows 20-25):
//   bess_dc_conductor_current_factor  = 1.25
//   bess_min_working_clearance_mm     = 900   (PROPOSED -- PEC to confirm)
//   bess_fire_clearance_mm            = 1000  (PROPOSED -- PEC to confirm)
//   bess_min_soc_default              = 0.10
//   bess_max_soc_default              = 0.90
//   bess_round_trip_efficiency_floor  = 0.90
// =============================================================================

function addPhase8Tests(t, ss) {
  t.suite('Phase8: BESS NOM constants');

  var nom = loadNomConstants(ss);

  // === TEST 1: the bess block exists =====================================
  t.assert('nom.bess block defined', 'object', typeof nom.bess);

  if (typeof nom.bess !== 'object' || nom.bess === null) {
    t.error('Phase8: nom.bess missing -- cannot run value checks',
            new Error('nom.bess is not an object'));
    return;
  }

  // === TEST 2: each constant loads with the expected value ===============
  // If the 61M_NOM_LIMITS mirror is current, these come from the sheet.
  // If the mirror is stale, the loader falls back to the same defaults --
  // so either way these values must hold.
  t.assert('nom.bess.dcCurrentFactor = 1.25', 1.25, nom.bess.dcCurrentFactor);
  t.assert('nom.bess.minWorkClearMm = 900',    900,  nom.bess.minWorkClearMm);
  t.assert('nom.bess.fireClearMm = 1000',     1000,  nom.bess.fireClearMm);
  t.assert('nom.bess.minSocDefault = 0.10',   0.10,  nom.bess.minSocDefault);
  t.assert('nom.bess.maxSocDefault = 0.90',   0.90,  nom.bess.maxSocDefault);
  t.assert('nom.bess.rteFloor = 0.90',        0.90,  nom.bess.rteFloor);

  // === TEST 3: sanity / consistency ======================================
  // The SOC defaults must agree with readInputBess defaults (Phase 5 locks
  // minSoc 0.10 / maxSoc 0.90). A mismatch here means the two layers would
  // disagree -- catch it at the data layer.
  t.assertTrue('bess minSoc < maxSoc',
               nom.bess.minSocDefault < nom.bess.maxSocDefault);
  t.assertTrue('bess RTE floor is a valid fraction (0..1)',
               nom.bess.rteFloor > 0 && nom.bess.rteFloor <= 1);
  t.assertTrue('bess fire clearance >= working clearance',
               nom.bess.fireClearMm >= nom.bess.minWorkClearMm);
  t.assertTrue('bess dcCurrentFactor >= 1.0 (continuous-duty uplift)',
               nom.bess.dcCurrentFactor >= 1.0);

  // === TEST 4: the underlying limit keys are in the limits map ===========
  // NOM limits are JS-sourced (buildNomLimitsDefaults) -- there is no
  // spreadsheet mirror. All 6 bess_ keys must therefore be present in
  // nom.limits; if any is missing, nom.bess fell back to its || literal
  // and the JS defaults table is incomplete.
  var keys = ['bess_dc_conductor_current_factor', 'bess_min_working_clearance_mm',
              'bess_fire_clearance_mm', 'bess_min_soc_default',
              'bess_max_soc_default', 'bess_round_trip_efficiency_floor'];
  var foundInTable = 0;
  for (var i = 0; i < keys.length; i++) {
    if (nom.limits[keys[i]] !== undefined) foundInTable++;
  }
  t.assert('all 6 bess_ keys present in JS NOM limits table',
           keys.length, foundInTable);
}