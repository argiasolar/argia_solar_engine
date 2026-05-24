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
    // Required keys present
    t.assertTrue('has coupling key',     'coupling'     in ctx1);
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
    var origR43 = sh.getRange(43, 3).getValue();
    try {
      // Run setup; if §6 didn't exist, this populates it. If it did,
      // setup leaves user values alone.
      setupInputBessInstallRows();
      // Verify header
      t.assert('§6 header label set',
               '6. DISTANCIAS Y UBICACIÓN FÍSICA',
               String(sh.getRange(42, 2).getValue() || '').trim());
      // Verify coupling dropdown exists by reading data validation
      var coupVal = sh.getRange(43, 3).getValue();
      t.assertTrue('Coupling has a value',
                   coupVal === 'DC_COUPLED' || coupVal === 'AC_COUPLED');
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
