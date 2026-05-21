// =============================================================================
// ARGIA TESTS -- tests_integration/writers/CfeOutputCellMapTests.gs
// -----------------------------------------------------------------------------
// PASS 14 MIGRATION: CFE_OUT_SRC cell map sanity (Phase 20 Bug B).
//
// SOURCE: addPhase20Tests in 99u_Phase20_CfeSimRepairandheadermap.gs,
//         Bug B portion only (lines covering CFE_OUT_SRC cell coords
//         and the live INPUT_CFE label match).
//         Bug A portion (repairCfeSimulationTotals) migrated separately
//         to tests_integration/engine/CfeSimRepairTests.gs.
//
// COVERAGE
//   Two-layer verification of the CFE_OUT_SRC cell map:
//
//   PART 1 -- JS cell-map coordinates
//     CFE_OUT_SRC now points at C4 / F4 / F5 / F6 (real OASIS layout)
//     instead of the previous wrong C5 / E6 / E7 / E8 (Phase 20 fix).
//     PV interconnection cells live at rows 41-44, not 40-43.
//
//   PART 2 -- Live INPUT_CFE labels at the new coordinates
//     Guards against the renderer drifting from the actual sheet again.
//     Substring-match (case-insensitive) so cosmetic edits don't fail.
//
// CLASSIFICATION
//   group=integration. Reads CFE_OUT_SRC global and INPUT_CFE cells.
//   No writes -- no try/finally needed.
//
// DEPENDENCIES
//   - CFE_OUT_SRC (06_WriteCfeOutput.gs)
//   - INPUT_CFE sheet (must be present)
//
// SPLIT RATIONALE (departure from legacy single-function)
//   Phase 20 legacy bundled Bug A (CFE_SIM repair) and Bug B (cell map)
//   in one addPhase20Tests function. Bug A writes cells in
//   CFE_SIMULATION; Bug B is pure read-only. Splitting into two
//   registered tests means Bug A failure (e.g. repair function changes)
//   doesn't block Bug B's structural sanity check from running.
//
// CO-EXISTENCE
//   99u_Phase20_CfeSimRepairandheadermap.gs unchanged. The legacy
//   addPhase20Tests still runs both halves from runTests() until the
//   legacy deletion pass.
// =============================================================================


registerTest({
  id      : 'INT_WRITERS_CFE_OUTPUT_CELL_MAP',
  group   : 'integration',
  module  : 'writers/cfe_output',
  scenarios: [],
  tags    : ['writers', 'cfe-output', 'cell-map', 'read-only',
             'header-strip'],
  source  : 'tests_integration/writers/CfeOutputCellMapTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers/cfe_output: CFE_OUT_SRC cell map sanity');

    var ss = ctx.ss;

    // ---- PART 1: cell-map coordinates -----------------------------------
    t.assertTrue('CFE_OUT_SRC exposed', typeof CFE_OUT_SRC === 'object');
    if (typeof CFE_OUT_SRC === 'object') {
      // Header strip cells (fixed after Phase 20)
      t.assert('input_tariffCode -> INPUT_CFE row 4',
               4, CFE_OUT_SRC.input_tariffCode.row);
      t.assert('input_tariffCode -> col 3 (C)',
               3, CFE_OUT_SRC.input_tariffCode.col);

      t.assert('input_serviceName -> row 4',
               4, CFE_OUT_SRC.input_serviceName.row);
      t.assert('input_serviceName -> col 6 (F)',
               6, CFE_OUT_SRC.input_serviceName.col);

      t.assert('input_serviceNumber -> row 5',
               5, CFE_OUT_SRC.input_serviceNumber.row);
      t.assert('input_serviceNumber -> col 6 (F)',
               6, CFE_OUT_SRC.input_serviceNumber.col);

      t.assert('input_contractedKw -> row 6',
               6, CFE_OUT_SRC.input_contractedKw.row);
      t.assert('input_contractedKw -> col 6 (F)',
               6, CFE_OUT_SRC.input_contractedKw.col);

      t.assert('input_2pctBT -> row 7',
               7, CFE_OUT_SRC.input_2pctBT.row);

      // PV interconnection rows (shifted from 40-43 to 41-44 in Phase 20)
      t.assert('input_interconnMode -> row 41',
               41, CFE_OUT_SRC.input_interconnMode.row);
      t.assert('input_exportPrice -> row 42',
               42, CFE_OUT_SRC.input_exportPrice.row);
      t.assert('input_autoconsumoPct -> row 43',
               43, CFE_OUT_SRC.input_autoconsumoPct.row);
      t.assert('input_fpUmbral -> row 44',
               44, CFE_OUT_SRC.input_fpUmbral.row);
    }

    // ---- PART 2: live INPUT_CFE labels at the new coordinates ----------
    // Guards against the renderer drifting from the actual sheet again.
    var inpCfe = ss.getSheetByName('INPUT_CFE');
    if (!inpCfe) {
      t.error('setup', new Error('INPUT_CFE sheet missing'));
      return;
    }

    function labelMatch(row, col, contains, descr) {
      var raw = inpCfe.getRange(row, col).getValue();
      var v = String(raw || '').toLowerCase();
      t.assertTrue(descr + ' (got "' + raw + '")',
                   v.indexOf(contains.toLowerCase()) >= 0);
    }

    // Header strip (rows 4-6)
    labelMatch(4,  2, 'tariff code',    'INPUT_CFE!B4 = TARIFF CODE label');
    labelMatch(4,  5, 'service name',   'INPUT_CFE!E4 = SERVICE NAME label');
    labelMatch(5,  5, 'service number', 'INPUT_CFE!E5 = SERVICE NUMBER label');
    labelMatch(6,  5, 'contracted',     'INPUT_CFE!E6 = CONTRACTED DEMAND label');

    // PV interconnection block (rows 41-44)
    labelMatch(41, 2, 'modo',           'INPUT_CFE!B41 = MODO INTERCONEXION');
    labelMatch(42, 2, 'precio',         'INPUT_CFE!B42 = PRECIO EXPORTACION');
    labelMatch(43, 2, 'autoconsumo',    'INPUT_CFE!B43 = AUTOCONSUMO %');
    labelMatch(44, 2, 'umbral',         'INPUT_CFE!B44 = UMBRAL FACTOR POTENCIA');
  }
});
