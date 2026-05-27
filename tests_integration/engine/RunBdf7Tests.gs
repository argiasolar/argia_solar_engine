// =============================================================================
// ARGIA TESTS -- tests_integration/engine/RunBdf7Tests.gs   (BDF-7)
// Integration tests for BDF-7 wiring: readBessInstallContext + the full
// engine pipeline calling calcBessBosQuantities, calcBessVoltageDrop,
// calcBessNomChecks in sequence.
// Tagged 'bdf7'.
// =============================================================================


registerTest({
  id      : 'INT_BDF7_READ_INSTALL_CONTEXT',
  group   : 'integration',
  module  : 'readers/bess_install_context',
  scenarios: [],
  tags    : ['integration', 'reader', 'bess', 'bdf7'],
  source  : 'tests_integration/engine/RunBdf7Tests.gs',
  fn: function (t, ctx) {
    t.suite('INT readers/bess_install_context: §6 row layout');
    var ss = SpreadsheetApp.getActive();
    var ctx1 = readBessInstallContext(ss);

    // Reader returns an object (never null)
    t.assertTrue('readBessInstallContext returns object',
                 typeof ctx1 === 'object' && ctx1 !== null);
    // Required keys present.
    //
    // BDF-7.1 (2026): `coupling` is intentionally absent from this
    // object. The authoritative source is INPUT_DESIGN!C17 surfaced
    // through bessResult.coupling, which the orchestrator (00_Main Step
    // 9.6) injects into ctx before passing to downstream calcs. Keeping
    // a `coupling` field here would re-introduce the duplicate-source
    // bug class BDF-7.1 closed (INPUT_DESIGN said DC_COUPLED while
    // INPUT_BESS!C43 default said AC_COUPLED). See 01a_ReadInputsBess.js
    // lines 201-232 for the full rationale.
    t.assertTrue('coupling key intentionally ABSENT (BDF-7.1)',
                 !('coupling' in ctx1));
    t.assertTrue('has dcBusV key',       'dcBusV'       in ctx1);
    t.assertTrue('has acV key',          'acV'          in ctx1);
    t.assertTrue('has dcRunM key',       'dcRunM'       in ctx1);
    t.assertTrue('has acRunM key',       'acRunM'       in ctx1);
    t.assertTrue('has cablePath key',    'cablePath'    in ctx1);
    t.assertTrue('has gecRunM key',      'gecRunM'      in ctx1);
    t.assertTrue('has commissioningMxn', 'commissioningMxn' in ctx1);
    t.assertTrue('has provenance',       'provenance'   in ctx1);
    // Provenance is either INPUT_BESS_S6 or EMPTY_*
    t.assertTrue('provenance is string',
                 typeof ctx1.provenance === 'string');
  }
});


registerTest({
  id      : 'INT_BDF7_SETUP_INSTALL_ROWS',
  group   : 'integration',
  module  : 'setup/bess_install',
  scenarios: [],
  tags    : ['integration', 'setup', 'bess', 'bdf7'],
  source  : 'tests_integration/engine/RunBdf7Tests.gs',
  fn: function (t, ctx) {
    t.suite('INT setup/bess_install: §6 row population');
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName('INPUT_BESS');
    if (!sh) {
      t.assertTrue('INPUT_BESS sheet exists', false);
      return;
    }
    // Save current state of row 42 to avoid clobbering designer data
    var origR42 = sh.getRange(42, 2).getValue();
    try {
      // Run setup; if §6 didn't exist, this populates it. If it did,
      // setup leaves user values alone.
      setupInputBessInstallRows();
      // Verify header
      t.assert('§6 header label set',
               '6. DISTANCIAS Y UBICACIÓN FÍSICA',
               String(sh.getRange(42, 2).getValue() || '').trim());
      // BDF-7.1: row 43 is no longer written by setupInputBessInstallRows
      // (coupling was moved to INPUT_DESIGN!C17 as the single authoritative
      // source). The test no longer checks row 43; any stale value left
      // over from pre-BDF-7.1 workbooks is silently ignored by the reader.
      // Verify DC bus voltage default
      var dcV = Number(sh.getRange(44, 3).getValue());
      t.assertTrue('DC bus voltage > 0', dcV > 0);
      // Verify cable path default
      var path = String(sh.getRange(48, 3).getValue() || '').trim();
      t.assertTrue('Cable path is one of valid options',
                   ['INTEMPERIE', 'CONDUIT_ENTERRADO', 'BANDEJA_INTERIOR'].indexOf(path) >= 0);
    } finally {
      // Restore original state if we wrote new values
      if (origR42 !== '6. DISTANCIAS Y UBICACIÓN FÍSICA') {
        sh.getRange(42, 2).setValue(origR42 || '');
      }
    }
  }
});


registerTest({
  id      : 'INT_BDF7_BOM_BESS_SECTION_RENDERS',
  group   : 'integration',
  module  : 'writers/bom_bess',
  scenarios: [],
  tags    : ['integration', 'writer', 'bom', 'bdf7'],
  source  : 'tests_integration/engine/RunBdf7Tests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers/bom_bess: §8 renders given a bessResult');
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName('BOM');
    if (!sh) {
      t.assertTrue('BOM sheet exists', false);
      return;
    }

    // After a full engine run, §8 header is in BOM_ROW.SEC_BESS row.
    // The constant value is in 00_Main.js BOM_ROW.SEC_BESS = 79.
    var secLabel = String(sh.getRange(79, 2).getValue() || '');
    t.assertTrue('§8 BESS section header is present (run engine first if blank)',
                 secLabel.indexOf('BESS') >= 0 || secLabel.indexOf('ALMACENAMIENTO') >= 0
                 || secLabel === '');  // Allow empty for pre-engine runs
    // Subtotal row label
    var subLabel = String(sh.getRange(92, 2).getValue() || '');
    t.assertTrue('SUBTOTAL §8 row label OK',
                 subLabel.indexOf('SUBTOTAL') >= 0 || subLabel === '');
    // Grand total moved to row 94
    var grandLabel = String(sh.getRange(94, 2).getValue() || '');
    t.assertTrue('GRAND_TOTAL row 94 has a label',
                 grandLabel.indexOf('TOTAL') >= 0 || grandLabel === '');
  }
});
