// =============================================================================
// ARGIA TESTS -- tests_integration/templates/SetupMdcTemplateTests.gs
// -----------------------------------------------------------------------------
// CHUNK 1 — setupMdcTemplate idempotency on a scratch sheet.
//
// CRITICAL: these tests OPERATE ON A SCRATCH SHEET, not the live MDC_v2 the
// engine writes to. Reason: setupMdcTemplate is idempotent by virtue of calling
// sh.clear() at the top, which would wipe whatever CULLIGAN/TESTPROJ-001 run
// the workbook is holding. A scratch sheet keeps these tests isolated from
// the regression baseline, which needs MDC_v2 to hold real engine output.
//
// COVERAGE
//   - After setupMdcTemplate(ss, {sheetName: scratch}), the scratch sheet has
//     key labels in expected cells (B7=Proyecto, B8=Cliente, ...)
//   - Section headers in place (B6=§0, B20=§1, ..., B100=§7)
//   - Frozen rows = 5, frozen cols = 2
//   - Calling setupMdcTemplate twice doesn't accumulate CF rules (idempotent)
//
// CLEANUP
//   try/finally guarantees the scratch sheet is deleted even if assertions
//   throw. If a previous run crashed before cleanup, leftover sheets named
//   '_MDC_v2_TEST_*' are safe to delete manually -- they hold no production data.
//
// CHUNK TAG
//   'chunk1' so ▶ Run Tests for Current Chunk picks it up.
// =============================================================================


// Helper: create a uniquely-named scratch sheet name + cleanup closure.
function _scratchSheetName_() {
  return '_MDC_v2_TEST_' + new Date().getTime();
}
function _deleteSheetIfExists_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh) ss.deleteSheet(sh);
}


registerTest({
  id      : 'INT_TEMPLATES_SETUP_MDC_TEMPLATE_RENDERS_LABELS',
  group   : 'integration',
  module  : 'templates/mdc',
  scenarios: [],
  tags    : ['templates', 'mdc', 'v2', 'chunk1'],
  source  : 'tests_integration/templates/SetupMdcTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('INT templates/mdc: setupMdcTemplate renders expected labels (scratch)');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchSheetName_();

    try {
      setupMdcTemplate(ss, { sheetName: scratch });

      var sh = ss.getSheetByName(scratch);
      t.assertTrue('scratch sheet exists after setupMdcTemplate', sh !== null);
      if (!sh) return;

      // Banner — title row 2 col C
      t.assert('row 2 col C = "MEMORIA DE CÁLCULO"',
        'MEMORIA DE CÁLCULO', sh.getRange(MDC_ROW.BANNER_TITLE, 3).getValue());

      // Column headers row 4
      t.assert('row 4 col B = "DESCRIPCIÓN"',
        'DESCRIPCIÓN', sh.getRange(MDC_ROW.COLUMN_HEADERS, 2).getValue());
      t.assert('row 4 col C = "VALOR"',
        'VALOR', sh.getRange(MDC_ROW.COLUMN_HEADERS, 3).getValue());
      t.assert('row 4 col D = "UNIDAD"',
        'UNIDAD', sh.getRange(MDC_ROW.COLUMN_HEADERS, 4).getValue());
      t.assert('row 4 col E = "ESTADO"',
        'ESTADO', sh.getRange(MDC_ROW.COLUMN_HEADERS, 5).getValue());

      // Section header rows have headers in col B
      t.assert('SEC0_HEADER row col B = "0. GENERALES..."',
        '0. GENERALES DEL SISTEMA',
        sh.getRange(MDC_ROW.SEC0_HEADER, 2).getValue());
      t.assert('SEC1_HEADER row col B = "1.0 MEMORIA DE CÁLCULO DC"',
        '1.0 MEMORIA DE CÁLCULO DC',
        sh.getRange(MDC_ROW.SEC1_HEADER, 2).getValue());
      t.assert('SEC7_HEADER row col B = "7.0 ALMACENAMIENTO / BATERÍA (BESS)"',
        '7.0 ALMACENAMIENTO / BATERÍA (BESS)',
        sh.getRange(MDC_ROW.SEC7_HEADER, 2).getValue());

      // §0 body labels
      t.assert('PROJECT row col B = "Proyecto"',
        'Proyecto', sh.getRange(MDC_ROW.PROJECT, 2).getValue());
      t.assert('CLIENT row col B = "Cliente"',
        'Cliente', sh.getRange(MDC_ROW.CLIENT, 2).getValue());
      t.assert('QTY_MODULES row col B = "No. de módulos"',
        'No. de módulos', sh.getRange(MDC_ROW.QTY_MODULES, 2).getValue());

      // §7 BESS labels (the new bit Chunk 1 added)
      t.assert('BESS_CAPACITY row col B = "Capacidad nominal"',
        'Capacidad nominal', sh.getRange(MDC_ROW.BESS_CAPACITY, 2).getValue());
      t.assert('BESS_CAPACITY row col D = "kWh"',
        'kWh', sh.getRange(MDC_ROW.BESS_CAPACITY, 4).getValue());
      t.assert('BESS_POWER row col D = "kW"',
        'kW', sh.getRange(MDC_ROW.BESS_POWER, 4).getValue());

      // Freeze pane settings
      t.assert('frozen rows = 5', 5, sh.getFrozenRows());
      t.assert('frozen cols = 2', 2, sh.getFrozenColumns());
    } finally {
      _deleteSheetIfExists_(ss, scratch);
    }
  }
});


registerTest({
  id      : 'INT_TEMPLATES_SETUP_MDC_TEMPLATE_IDEMPOTENT',
  group   : 'integration',
  module  : 'templates/mdc',
  scenarios: [],
  tags    : ['templates', 'mdc', 'v2', 'idempotent', 'chunk1'],
  source  : 'tests_integration/templates/SetupMdcTemplateTests.gs',
  fn: function (t, ctx) {
    t.suite('INT templates/mdc: setupMdcTemplate is idempotent (scratch)');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchSheetName_();

    try {
      setupMdcTemplate(ss, { sheetName: scratch });
      var sh = ss.getSheetByName(scratch);
      if (!sh) {
        t.assertTrue('scratch sheet exists after first call', false);
        return;
      }

      // Snapshot the key state we want to be stable across re-runs
      var rules1count = sh.getConditionalFormatRules().length;
      var label1 = sh.getRange(MDC_ROW.PROJECT, 2).getValue();
      var hdr1   = sh.getRange(MDC_ROW.SEC7_HEADER, 2).getValue();
      var freeze1Rows = sh.getFrozenRows();
      var freeze1Cols = sh.getFrozenColumns();

      // Run again on the SAME scratch sheet
      setupMdcTemplate(ss, { sheetName: scratch });
      var rules2count = sh.getConditionalFormatRules().length;
      var label2 = sh.getRange(MDC_ROW.PROJECT, 2).getValue();
      var hdr2   = sh.getRange(MDC_ROW.SEC7_HEADER, 2).getValue();
      var freeze2Rows = sh.getFrozenRows();
      var freeze2Cols = sh.getFrozenColumns();

      t.assert('CF rule count is the same after 2nd call (no accumulation)',
        rules1count, rules2count);
      t.assert('PROJECT label unchanged on re-run', label1, label2);
      t.assert('SEC7_HEADER label unchanged on re-run', hdr1, hdr2);
      t.assert('frozen rows unchanged on re-run', freeze1Rows, freeze2Rows);
      t.assert('frozen cols unchanged on re-run', freeze1Cols, freeze2Cols);

      // CF rules should be exactly 7 (FAIL, BLOQUEADO, REVIEW, OBSERVATIONS,
      // PASS, OK, EMITTABLE). Locked here so a future tweak that drops a rule
      // shows up loudly.
      t.assert('exactly 7 CF rules on col E', 7, rules2count);
    } finally {
      _deleteSheetIfExists_(ss, scratch);
    }
  }
});
