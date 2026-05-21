// =============================================================================
// ARGIA TESTS -- tests_integration/writers/CfeOutputWriterTests.gs
// -----------------------------------------------------------------------------
// PASS 13 MIGRATION: CFE_OUTPUT writer (writeCfeOutput).
//
// SOURCE: addPhase19Tests in 99t_Phase19_WriteCfeOutput.gs.
//         Migrated 2026-05-21 as part of Pass 13.
//
// SPLIT INTO TWO REGISTERED TESTS (was ONE function in legacy)
//
//   INT_WRITERS_CFE_OUTPUT_SOURCE_LABELS  (LAYER A)
//     Read-only sanity check. writeCfeOutput reads source cells by
//     hardcoded row index (e.g. INPUT_CFE row 37 = TOTAL). If a future
//     row insert ever shifts those rows, the writer would silently
//     render wrong numbers. Layer A asserts each row still carries its
//     canonical LABEL TEXT -- substring match, case-insensitive.
//     Also dumps row labels of three sheets as INFO for diagnostic
//     value when something drifts.
//
//   INT_WRITERS_CFE_OUTPUT_RENDERER       (LAYER B)
//     Calls writeCfeOutput. Asserts the CFE_OUTPUT tab is created,
//     positioned correctly, has freeze panes, section headers,
//     KPI strip, footer values matching BESS_SIMULATION sources,
//     and exactly 3 charts.
//
// RATIONALE FOR SPLITTING (departure from legacy single-function)
//   - Layer A is read-only and fast (~22 asserts, no side effects)
//   - Layer B writes a tab and runs the writer (~14 asserts, slow,
//     produces a CFE_OUTPUT tab in the live sheet)
//   - If Layer A surfaces a label drift, you want that signal BEFORE
//     trying to render. With the split, Layer A failure doesn't block
//     Layer B from also running -- both surface state independently.
//   - The dumpLabels diagnostic INFO rows live with Layer A (their
//     natural home), not duplicated across both.
//
// CLASSIFICATION
//   group=integration. Layer A is read-only; Layer B creates/recreates
//   the CFE_OUTPUT tab.
//
// DEPENDENCIES
//   - writeCfeOutput, setupCfeOutput, CFE_OUT_SRC (06_WriteCfeOutput.gs)
//   - SH.CFE_OUTPUT, SH.CFE_SIM, SH.BESS_SIM, SH.MDC (00_Main.gs)
//
// SAFETY MODEL
//   Layer A: no writes, no try/finally needed.
//   Layer B: writeCfeOutput recreates the tab from scratch each run
//   (legacy comment: "leaving it written is the normal end state").
//   After the test, the CFE_OUTPUT tab will exist in the live sheet
//   showing whatever the engine state computed -- intended behavior,
//    not a leak. No restore needed.
//
// BEHAVIOR PRESERVATION
//   The legacy phase has hardcoded expectations for column indices
//   (KPI strip cols B/G/L, footer cols C/E/G/I/K). These mirror the
//    writer's hardcoded column layout. If writeCfeOutput ever changes
//   column placement, these tests will fail loudly -- which is the
//   correct behavior for a structural contract check.
//
// CO-EXISTENCE
//   99t_Phase19_WriteCfeOutput.gs unchanged. Both run the same
//   underlying assertions until the legacy deletion pass.
// =============================================================================


// ===========================================================================
// LAYER A: source row labels (read-only)
// ===========================================================================

registerTest({
  id      : 'INT_WRITERS_CFE_OUTPUT_SOURCE_LABELS',
  group   : 'integration',
  module  : 'writers/cfe_output',
  scenarios: [],
  tags    : ['writers', 'cfe-output', 'source-labels', 'read-only'],
  source  : 'tests_integration/writers/CfeOutputWriterTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers/cfe_output: source row labels (Layer A)');

    var ss = ctx.ss;

    // Local helper: assert that sheet!B<row> contains the expected
    // substring (case-insensitive). A label drift -> loud failure here,
    // BEFORE the renderer ships wrong values.
    function expectLabel(sheetName, row, expectedSubstring) {
      var sh = ss.getSheetByName(sheetName);
      if (!sh) {
        t.assertTrue('source sheet ' + sheetName + ' exists', false);
        return;
      }
      var raw = sh.getRange(row, 2).getValue();
      var actual = String(raw || '').toLowerCase();
      var ok = actual.indexOf(expectedSubstring.toLowerCase()) >= 0;
      t.assertTrue(sheetName + '!B' + row + ' contains "' + expectedSubstring
                   + '" (got: "' + raw + '")', ok);
    }

    // INPUT_CFE labels
    expectLabel('INPUT_CFE', 10, 'base');         // kWh base
    expectLabel('INPUT_CFE', 11, 'intermedia');   // kWh intermedia
    expectLabel('INPUT_CFE', 12, 'punta');        // kWh punta
    expectLabel('INPUT_CFE', 19, 'demanda');      // Demanda Facturable (B20=FP%)
    expectLabel('INPUT_CFE', 35, 'facturac');     // Facturacion
    expectLabel('INPUT_CFE', 37, 'total');        // TOTAL

    // CFE_SIMULATION labels (rows differ from INPUT_CFE -- bill block shifted)
    expectLabel('CFE_SIMULATION',  8, 'solar');     // Solar kWh
    expectLabel('CFE_SIMULATION', 37, 'facturac');  // Facturacion (was 35)
    expectLabel('CFE_SIMULATION', 39, 'total');     // TOTAL (was 37)
    expectLabel('CFE_SIMULATION', 41, 'saving');    // ENERGY SAVINGS

    // BESS_SIMULATION labels -- the waterfall is the most fragile to row
    // drift, so we check every row that the writer reads as a scalar.
    expectLabel('BESS_SIMULATION', 12, 'recibo');      // Recibo CFE base
    expectLabel('BESS_SIMULATION', 13, 'ahorro pv');   // Ahorro PV
    expectLabel('BESS_SIMULATION', 14, 'recibo');      // Recibo despues de PV
    expectLabel('BESS_SIMULATION', 15, 'capacidad');   // Ahorro BESS Capacidad
    expectLabel('BESS_SIMULATION', 16, 'distribuci');  // Ahorro BESS Distribucion
    expectLabel('BESS_SIMULATION', 17, 'variable');    // Ahorro BESS Variable
    expectLabel('BESS_SIMULATION', 18, 'recibo');      // RECIBO CFE FINAL
    expectLabel('BESS_SIMULATION', 25, 'dmax');        // Dmax sin BESS
    expectLabel('BESS_SIMULATION', 27, 'dmax');        // Dmax con BESS
    expectLabel('BESS_SIMULATION', 30, 'capacidad');   // monthly ahorro cap
    expectLabel('BESS_SIMULATION', 36, 'usable');      // Energia usable
    expectLabel('BESS_SIMULATION', 37, 'potencia');    // Potencia bateria

    // DIAGNOSTIC LABEL DUMP -----------------------------------------------
    // Info-only; never fails. If something does drift in the future,
    // having the actual column-B labels in the test output lets you fix
    // CFE_OUT_SRC in a single pass without guessing.
    function dumpLabels(sheetName, fromRow, toRow) {
      var s = ss.getSheetByName(sheetName);
      if (!s) return;
      var vals = s.getRange(fromRow, 2, toRow - fromRow + 1, 1).getValues();
      for (var i = 0; i < vals.length; i++) {
        var v = String(vals[i][0] || '').replace(/\s+/g, ' ').trim();
        if (v !== '') {
          t.info(sheetName + ' B' + (fromRow + i), v);
        }
      }
    }
    dumpLabels('INPUT_CFE',       5, 45);
    dumpLabels('CFE_SIMULATION',  5, 45);
    dumpLabels('BESS_SIMULATION', 5, 45);
  }
});


// ===========================================================================
// LAYER B: renderer pull-through (calls writeCfeOutput)
// ===========================================================================

registerTest({
  id      : 'INT_WRITERS_CFE_OUTPUT_RENDERER',
  group   : 'integration',
  module  : 'writers/cfe_output',
  scenarios: [],
  tags    : ['writers', 'cfe-output', 'renderer', 'tab-creation'],
  source  : 'tests_integration/writers/CfeOutputWriterTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers/cfe_output: writer pull-through (Layer B)');

    var ss = ctx.ss;

    // === Function + constant availability ===============================
    t.assert('writeCfeOutput defined',
             'function', typeof writeCfeOutput);
    t.assert('setupCfeOutput defined',
             'function', typeof setupCfeOutput);
    t.assert('SH.CFE_OUTPUT constant defined',
             'CFE_OUTPUT', SH.CFE_OUTPUT);
    t.assert('SH.CFE_SIM constant defined',
             'CFE_SIMULATION', SH.CFE_SIM);
    t.assert('SH.BESS_SIM constant defined',
             'BESS_SIMULATION', SH.BESS_SIM);
    t.assert('CFE_OUT_SRC map exposed',
             'object', typeof CFE_OUT_SRC);

    // === Run the writer =================================================
    // No try/finally for CFE_OUTPUT tab itself -- writeCfeOutput recreates
    // it each run, so leaving it written is the normal end state.
    var sh;
    try {
      sh = writeCfeOutput(ss);
    } catch (e) {
      t.error('writeCfeOutput threw', e);
      return;
    }

    t.assertTrue('CFE_OUTPUT tab created',
                 !!ss.getSheetByName(SH.CFE_OUTPUT));
    t.assertTrue('writeCfeOutput returned a Sheet object',
                 sh && typeof sh.getName === 'function');

    if (!sh) return;

    // Tab positioning: CFE_OUTPUT should land immediately before MDC, so
    // the customer-facing economic view comes before the engineering doc.
    // If MDC doesn't exist, this assertion is skipped.
    var mdcSheet = ss.getSheetByName(SH.MDC);
    if (mdcSheet) {
      var cfeIdx = sh.getIndex();
      var mdcIdx = mdcSheet.getIndex();
      t.assert('CFE_OUTPUT positioned immediately before MDC',
               mdcIdx - 1, cfeIdx);
    } else {
      t.info('positioning', 'MDC tab missing -- position check skipped');
    }

    // === Freeze panes ===================================================
    // Only vertical freeze (10 rows) is set; setFrozenColumns was removed
    // because the KPI strip on row 10 has merged ranges that Sheets rejects.
    t.assert('CFE_OUTPUT freezes 10 rows', 10, sh.getFrozenRows());

    // === Section headers -- structural anchors ==========================
    function cellContains(row, col, needle) {
      var v = String(sh.getRange(row, col).getValue() || '').toLowerCase();
      return v.indexOf(needle.toLowerCase()) >= 0;
    }
    t.assertTrue('row 12 col B = section 1 header (contains "RECIBO CON PV")',
                 cellContains(12, 2, 'recibo con pv'));
    t.assertTrue('row 22 col B = section 2 header (contains "PV + BESS")',
                 cellContains(22, 2, 'pv + bess'));
    t.assertTrue('row 33 col B = footer header (contains "RESUMEN ANUAL")',
                 cellContains(33, 2, 'resumen anual'));

    // === Headline KPI strip -- row 10 columns B, G, L ===================
    function kpiContains(col, needle) {
      return String(sh.getRange(10, col).getValue() || '').toLowerCase()
               .indexOf(needle.toLowerCase()) >= 0;
    }
    t.assertTrue('KPI strip row 10 col B mentions "SIN PV"',
                 kpiContains(2, 'sin pv'));
    t.assertTrue('KPI strip row 10 col G mentions "CON PV"',
                 kpiContains(7, 'con pv'));
    t.assertTrue('KPI strip row 10 col L mentions "BESS"',
                 kpiContains(12, 'bess'));

    // === Annual footer values row 35 ====================================
    // The 5 cascade numbers should equal the 5 BESS_SIMULATION scalars
    var bsim = ss.getSheetByName('BESS_SIMULATION');
    if (bsim) {
      var reciboBase   = Number(bsim.getRange(12, 4).getValue()) || 0;
      var ahorroPv     = Number(bsim.getRange(13, 4).getValue()) || 0;
      var reciboTrasPv = Number(bsim.getRange(14, 4).getValue()) || 0;
      var ahorroBess   = (Number(bsim.getRange(15, 4).getValue()) || 0)
                       + (Number(bsim.getRange(16, 4).getValue()) || 0)
                       + (Number(bsim.getRange(17, 4).getValue()) || 0);
      var reciboFinal  = Number(bsim.getRange(18, 4).getValue()) || 0;

      // Footer values are formatted strings ('$1,234'). Parse back out
      // for comparison. Allow ±1 MXN tolerance for rounding.
      function parseMxn(s) {
        var clean = String(s || '').replace(/[$,\s]/g, '');
        return Number(clean) || 0;
      }
      function fmtKey(col, expected, label) {
        var got = parseMxn(sh.getRange(35, col).getValue());
        t.assert(label + ' (footer row 35 col ' + col + ' ~= source)',
                 Math.round(expected), got, 1);
      }
      fmtKey(3,  reciboBase,   'Sin PV');
      fmtKey(5,  ahorroPv,     'Ahorro PV');
      fmtKey(7,  reciboTrasPv, 'Despues de PV');
      fmtKey(9,  ahorroBess,   'Ahorro BESS');
      fmtKey(11, reciboFinal,  'Recibo final');

      t.info('KPI annual',
             'Base=' + reciboBase + '  PV_save=' + ahorroPv
             + '  AfterPv=' + reciboTrasPv + '  BESS_save=' + ahorroBess
             + '  Final=' + reciboFinal);

      if (reciboBase === 0 && reciboFinal === 0) {
        t.info('NOTE',
               'All KPI values are 0 -- BESS toggle is likely OFF or '
               + 'CFE_SIMULATION has no data yet. Renderer wired '
               + 'correctly; turn BESS ON to see real numbers in CFE_OUTPUT.');
      }
    }

    // === Charts -- expect 3 ============================================
    var charts = sh.getCharts();
    t.info('charts', 'CFE_OUTPUT has ' + charts.length + ' charts');
    t.assert('CFE_OUTPUT has 3 charts (waterfall, monthly cmp, demand shave)',
             3, charts.length);

    t.info('cleanup',
           'CFE_OUTPUT tab left in place (regenerated from sources each run)');
  }
});
