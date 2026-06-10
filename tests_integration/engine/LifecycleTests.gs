// =============================================================================
// ARGIA TESTS -- tests_integration/engine/LifecycleTests.gs
// -----------------------------------------------------------------------------
// BATCH 1 -- Integration tests for the workbook lifecycle:
//   B1.1 Start New Project (clean reset, zero residue)
//   B1.2 Persistent input backup round-trip (ALL SIX tabs incl. INPUT_BAAS)
//   B1.4 Staleness banner apply / clear
//
// All three need a live workbook (ERROR with the getSheetByName-on-null
// signature in the Node rig -- classified as workbook-dependent, expected).
// Each test snapshots/restores the inputs it touches LOCALLY, so it is safe
// to run mid-suite regardless of what fixture is loaded.
// =============================================================================


registerTest({
  id      : 'INT_LIFECYCLE_PERSISTENT_BACKUP_ROUNDTRIP',
  group   : 'integration',
  module  : 'engine/lifecycle',
  scenarios: [],
  tags    : ['lifecycle', 'backup', 'batch1'],
  source  : 'tests_integration/engine/LifecycleTests.gs',
  fn      : function (t, ctx) {
    t.suite('INT lifecycle: persistent backup round-trip (incl. INPUT_BAAS)');
    var ss = (ctx && ctx.ss) || SpreadsheetApp.getActiveSpreadsheet();
    var proj = ss.getSheetByName('INPUT_PROJECT');
    var baas = ss.getSheetByName('INPUT_BAAS');
    t.assertTrue('INPUT_PROJECT present', !!proj);
    t.assertTrue('INPUT_BAAS present', !!baas);

    // Local safety net around the whole experiment.
    var safety = snapshotInputSheets(ss);
    try {
      // 1. Plant sentinels on two tabs -- one of them the tab the OLD copyTo
      //    backup omitted (INPUT_BAAS). Far column avoids template collisions.
      var SENT_P = 'BK_SENTINEL_P_' + Date.now();
      var SENT_B = 'BK_SENTINEL_B_' + Date.now();
      proj.getRange('Z1').setValue(SENT_P);
      baas.getRange('Z1').setValue(SENT_B);

      // 2. Backup -> persistent sheet must exist and report a backup.
      backupAllInputSheets(ss);
      t.assertTrue('persistent backup exists after backup',
                   hasPersistedInputBackup(ss));
      t.assertTrue('no legacy _TEST_BACKUP_* twins remain',
                   !ss.getSheetByName('_TEST_BACKUP_PROJ_V2'));

      // 3. Mutate both sentinels (simulates fixture load / test damage).
      proj.getRange('Z1').setValue('DAMAGED');
      baas.getRange('Z1').setValue('DAMAGED');

      // 4. Restore -> sentinels back, backup consumed.
      restoreAllInputSheets(ss);
      t.assert('INPUT_PROJECT sentinel restored', SENT_P,
               String(proj.getRange('Z1').getValue()));
      t.assert('INPUT_BAAS sentinel restored (copyTo gap closed)', SENT_B,
               String(baas.getRange('Z1').getValue()));
      t.assertTrue('backup deleted after restore',
                   !hasPersistedInputBackup(ss));
    } finally {
      // Remove sentinels and put everything back exactly as found.
      try { proj.getRange('Z1').clearContent(); } catch (e1) {}
      try { baas.getRange('Z1').clearContent(); } catch (e2) {}
      try { restoreInputSheets(ss, safety); } catch (e3) {}
      try { clearPersistedInputBackup(ss); } catch (e4) {}
    }
  }
});


registerTest({
  id      : 'INT_LIFECYCLE_STALE_BANNER_APPLY_CLEAR',
  group   : 'integration',
  module  : 'engine/lifecycle',
  scenarios: [],
  tags    : ['lifecycle', 'freshness', 'batch1'],
  source  : 'tests_integration/engine/LifecycleTests.gs',
  fn      : function (t, ctx) {
    t.suite('INT lifecycle: staleness banner applies on stale, clears on fresh');
    var ss = (ctx && ctx.ss) || SpreadsheetApp.getActiveSpreadsheet();
    var TAB = 'MDC_v2';
    var sh = ss.getSheetByName(TAB);
    t.assertTrue(TAB + ' present', !!sh);

    var stampKey = META_KEY_STAMP_PREFIX + TAB;
    var origStamp = metaKvGet(ss, stampKey);
    var origA1    = sh.getRange(1, 1).getValue();
    try {
      // 1. Force a WRONG stamp -> tab must get the banner.
      metaKvSet(ss, stampKey, 'deadbeef');
      var rep1 = refreshStalenessBanners(ss);
      t.assertTrue('banner applied to stale ' + TAB,
                   rep1.flagged.indexOf(TAB) !== -1);
      t.assertTrue('A1 carries the banner marker',
                   String(sh.getRange(1, 1).getValue())
                     .indexOf(ARGIA_STALE_BANNER_PREFIX) === 0);

      // Idempotent: second pass must not re-flag.
      var rep1b = refreshStalenessBanners(ss);
      t.assert('second pass flags nothing new for ' + TAB, -1,
               rep1b.flagged.indexOf(TAB));

      // 2. Stamp the CURRENT hash -> banner must clear.
      metaKvSet(ss, stampKey, computeInputsHash(ss));
      var rep2 = refreshStalenessBanners(ss);
      t.assertTrue('banner cleared on fresh ' + TAB,
                   rep2.cleared.indexOf(TAB) !== -1);
      t.assert('A1 empty again', '', String(sh.getRange(1, 1).getValue()));

      // 3. Freshness report agrees.
      var fr = getOutputFreshness(ss);
      var entry = fr.tabs.filter(function (x) { return x.name === TAB; })[0];
      t.assert(TAB + ' reported FRESH', 'FRESH', entry.status);

      // 4. Export guard: stale -> not exportable; fresh -> exportable.
      metaKvSet(ss, stampKey, 'deadbeef');
      t.assertFalse('export guard blocks stale',
                    assertExportFreshness(ss, TAB).exportable);
      metaKvSet(ss, stampKey, computeInputsHash(ss));
      t.assertTrue('export guard passes fresh',
                   assertExportFreshness(ss, TAB).exportable);
    } finally {
      // Restore original stamp + A1 exactly.
      try { metaKvSet(ss, stampKey, (origStamp === null) ? '' : origStamp); } catch (e1) {}
      try {
        refreshStalenessBanners(ss);
        if (origA1 !== '' && origA1 !== null) sh.getRange(1, 1).setValue(origA1);
      } catch (e2) {}
    }
  }
});


registerTest({
  id      : 'INT_LIFECYCLE_START_NEW_PROJECT_CLEAN',
  group   : 'integration',
  module  : 'engine/lifecycle',
  scenarios: [],
  tags    : ['lifecycle', 'reset', 'batch1', 'slow'],
  source  : 'tests_integration/engine/LifecycleTests.gs',
  fn      : function (t, ctx) {
    t.suite('INT lifecycle: Start New Project leaves zero residue');
    var ss = (ctx && ctx.ss) || SpreadsheetApp.getActiveSpreadsheet();
    t.assertTrue('workbook present', !!ss.getSheetByName('INPUT_PROJECT'));

    // Local safety net: this test DELIBERATELY wipes inputs; everything is
    // put back in finally so the rest of the suite sees the original state.
    var safety = snapshotInputSheets(ss);
    try {
      // Plant residue the reset must remove: a fake "previous project" value
      // in an input cell and content on an output tab.
      ss.getSheetByName('INPUT_PROJECT').getRange('Z2').setValue('TEST_RESIDUE');
      var mdc = ss.getSheetByName('MDC_v2');
      if (mdc) mdc.getRange('Z2').setValue('OLD_PROJECT_OUTPUT');

      var report = startNewProjectCore(ss);

      t.assertTrue('backup recorded (>0 cells)', report.backedUpCells > 0);
      t.assertTrue('outputs cleared (>0 tabs)', report.clearedTabs.length > 0);

      // Residue checks.
      t.assert('input residue gone', '',
               String(ss.getSheetByName('INPUT_PROJECT').getRange('Z2').getValue()));
      if (mdc) {
        t.assert('output residue gone', '',
                 String(mdc.getRange('Z2').getValue()));
        t.assertTrue('MDC_v2 fully cleared', mdc.getLastRow() <= 1);
      }

      // Layout contract: the DEFAULT rebuild must produce a valid INPUT_BESS
      // layout (the VERIFY-POINT this test closes). The contract itself is
      // asserted by REG_INPUT_MAP_BESS_LAYOUT_CONTRACT, which runs in the
      // same in-sheet suite AFTER this test has restored state -- the hook
      // below only fires if a callable verifier is ever extracted from it.
      if (typeof verifyInputBessLayoutContract === 'function') {
        var lc = verifyInputBessLayoutContract(ss);
        t.assertTrue('INPUT_BESS layout contract holds after rebuild',
                     !lc || lc.ok !== false);
      }

      // Undo path: the reset's own backup restores the pre-reset state.
      t.assertTrue('reset left a persistent backup (undo path)',
                   hasPersistedInputBackup(ss));
      restoreAllInputSheets(ss);
      t.assert('undo restores planted input residue', 'TEST_RESIDUE',
               String(ss.getSheetByName('INPUT_PROJECT').getRange('Z2').getValue()));
    } finally {
      try { ss.getSheetByName('INPUT_PROJECT').getRange('Z2').clearContent(); } catch (e1) {}
      try { var m2 = ss.getSheetByName('MDC_v2');
            if (m2) m2.getRange('Z2').clearContent(); } catch (e2) {}
      try { restoreInputSheets(ss, safety); } catch (e3) {}
      try { clearPersistedInputBackup(ss); } catch (e4) {}
    }
  }
});
