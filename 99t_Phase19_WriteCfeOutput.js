// =============================================================================
// ARGIA ENGINE -- Phase 19 test suite: CFE_OUTPUT writer (4b-2.5d)
// Paste into 99_TestRunner.gs, and add the call
//   try { addPhase19Tests(t, ss); } catch (e) { t.error('Phase19 aborted', e); }
// right after the addPhase15Tests block in runTests().
//
// SCOPE: Increment 4b-2.5d added writeCfeOutput(ss) in 06_WriteCfeOutput.gs.
// It RENDERS a new CFE_OUTPUT tab by reading INPUT_CFE / CFE_SIMULATION /
// BESS_SIMULATION cells. Pure renderer -- no calculation logic of its own.
//
// This suite has two layers:
//
//   LAYER A -- SOURCE ROW SANITY
//   The writer reads source cells by hardcoded row index (e.g. INPUT_CFE
//   row 37 = TOTAL). If a future row insert ever shifts those rows, the
//   writer would silently render wrong numbers. To catch this, Layer A
//   asserts that each row STILL carries the LABEL TEXT it had when the
//   writer was authored. A label drift -> loud failure here, BEFORE the
//   renderer ships wrong values.
//
//   LAYER B -- RENDERER PULL-THROUGH
//   Calls writeCfeOutput(ss). Asserts the CFE_OUTPUT tab is created, the
//   headline KPI numbers equal the source cells, the three charts exist,
//   and the freeze panes are set. No snapshot/restore: writeCfeOutput
//   recreates the tab from scratch each run, so leaving it written is
//   the normal end state.
// =============================================================================

function addPhase19Tests(t, ss) {
  t.suite('Phase19: CFE_OUTPUT writer');

  // -- function + constant availability ------------------------------------
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

  // ==========================================================================
  // LAYER A -- SOURCE ROW SANITY
  // For each source we read, assert that the LABEL in column B of that row
  // still matches what the writer was authored against. A label change is
  // the canary -- it means the row moved or was re-purposed.
  //
  // Match is case-insensitive substring (contains), so cosmetic edits to
  // labels don't fail the test, only structural moves.
  // ==========================================================================
  function expectLabel(sheetName, row, expectedSubstring) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh) {
      t.assertTrue('source sheet ' + sheetName + ' exists', false);
      return;
    }
    var actual = String(sh.getRange(row, 2).getValue() || '').toLowerCase();
    var ok = actual.indexOf(expectedSubstring.toLowerCase()) >= 0;
    t.assertTrue(sheetName + '!B' + row + ' contains "'
                 + expectedSubstring + '" (got: "'
                 + sh.getRange(row, 2).getValue() + '")',
                 ok);
  }

  // INPUT_CFE labels
  expectLabel('INPUT_CFE', 10, 'base');           // kWh base
  expectLabel('INPUT_CFE', 11, 'intermedia');     // kWh intermedia
  expectLabel('INPUT_CFE', 12, 'punta');          // kWh punta
  expectLabel('INPUT_CFE', 19, 'demanda');        // Demanda Facturable (B20=FP%)
  expectLabel('INPUT_CFE', 35, 'facturac');       // Facturacion
  expectLabel('INPUT_CFE', 37, 'total');          // TOTAL

  // CFE_SIMULATION labels (rows differ from INPUT_CFE -- bill block shifted)
  expectLabel('CFE_SIMULATION',  8, 'solar');     // Solar kWh
  expectLabel('CFE_SIMULATION', 37, 'facturac');  // Facturacion (was 35)
  expectLabel('CFE_SIMULATION', 39, 'total');     // TOTAL (was 37)
  expectLabel('CFE_SIMULATION', 41, 'saving');    // ENERGY SAVINGS

  // BESS_SIMULATION labels -- the waterfall is the most fragile to row drift,
  // so we check every row that the writer reads as a scalar.
  expectLabel('BESS_SIMULATION', 12, 'recibo');           // Recibo CFE base
  expectLabel('BESS_SIMULATION', 13, 'ahorro pv');        // Ahorro PV
  expectLabel('BESS_SIMULATION', 14, 'recibo');           // Recibo despues de PV
  expectLabel('BESS_SIMULATION', 15, 'capacidad');        // Ahorro BESS Capacidad
  expectLabel('BESS_SIMULATION', 16, 'distribuci');       // Ahorro BESS Distribucion
  expectLabel('BESS_SIMULATION', 17, 'variable');         // Ahorro BESS Variable
  expectLabel('BESS_SIMULATION', 18, 'recibo');           // RECIBO CFE FINAL
  expectLabel('BESS_SIMULATION', 25, 'dmax');             // Dmax sin BESS
  expectLabel('BESS_SIMULATION', 27, 'dmax');             // Dmax con BESS
  expectLabel('BESS_SIMULATION', 30, 'capacidad');        // monthly ahorro cap
  expectLabel('BESS_SIMULATION', 36, 'usable');           // Energia usable
  expectLabel('BESS_SIMULATION', 37, 'potencia');         // Potencia bateria

  // -- DIAGNOSTIC LABEL DUMP -------------------------------------------------
  // If any label assertion fails (or if a future row insert silently moves
  // things), having the actual column-B labels of rows 5-45 in the test
  // output lets us fix CFE_OUT_SRC in a single pass without guessing.
  // Info-only -- never fails, never throws.
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

  // ==========================================================================
  // LAYER B -- RENDERER PULL-THROUGH
  // ==========================================================================
  // Snapshot any pre-existing CFE_OUTPUT so a buggy write doesn't lose work.
  // (writeCfeOutput deletes any existing CFE_OUTPUT before recreating, so
  // strictly we don't need to restore -- but if writeCfeOutput throws AFTER
  // delete and BEFORE recreate, we'd have lost the tab. We accept this risk
  // because the tab is recreated from sources every engine run anyway.)

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

  // Freeze panes -- banner + header strip should stay on scroll.
  // Only vertical freeze is set; setFrozenColumns was removed because the
  // KPI strip on row 10 has merged ranges starting at col B that span across
  // any reasonable freeze line, which Sheets rejects.
  t.assert('CFE_OUTPUT freezes 10 rows', 10, sh.getFrozenRows());

  // Section headers -- structural anchors
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

  // Headline KPI strip -- numbers should reflect BESS_SIMULATION scalars.
  // Each KPI cell is a label+value combined string -- we check substring.
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

  // Annual footer values row 35 -- the 5 cascade numbers should equal
  // the 5 BESS_SIMULATION scalars we read.
  var bsim = ss.getSheetByName('BESS_SIMULATION');
  if (bsim) {
    var reciboBase   = Number(bsim.getRange(12, 4).getValue()) || 0;
    var ahorroPv     = Number(bsim.getRange(13, 4).getValue()) || 0;
    var reciboTrasPv = Number(bsim.getRange(14, 4).getValue()) || 0;
    var ahorroBess   = (Number(bsim.getRange(15, 4).getValue()) || 0)
                     + (Number(bsim.getRange(16, 4).getValue()) || 0)
                     + (Number(bsim.getRange(17, 4).getValue()) || 0);
    var reciboFinal  = Number(bsim.getRange(18, 4).getValue()) || 0;

    // The footer values are formatted strings ('$1,234'). Parse back out
    // for comparison. Allow ±1 MXN tolerance for rounding to whole pesos.
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

    t.info('Phase19 KPI annual',
           'Base=' + reciboBase + '  PV_save=' + ahorroPv
           + '  AfterPv=' + reciboTrasPv + '  BESS_save=' + ahorroBess
           + '  Final=' + reciboFinal);

    if (reciboBase === 0 && reciboFinal === 0) {
      t.info('Phase19 NOTE',
             'All KPI values are 0 -- BESS toggle is likely OFF or '
             + 'CFE_SIMULATION has no data yet. Renderer wired correctly; '
             + 'turn BESS ON to see real numbers in CFE_OUTPUT.');
    }
  }

  // Charts -- expect 3
  var charts = sh.getCharts();
  t.info('Phase19 charts', 'CFE_OUTPUT has ' + charts.length + ' charts');
  t.assert('CFE_OUTPUT has 3 charts (waterfall, monthly cmp, demand shave)',
           3, charts.length);

  t.info('Phase19 cleanup',
         'CFE_OUTPUT tab left in place (regenerated from sources each run)');
}