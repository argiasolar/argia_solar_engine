// =============================================================================
// ARGIA TESTS -- tests_integration/engine/CfeSimRepairTests.gs
// -----------------------------------------------------------------------------
// PASS 14 MIGRATION: repairCfeSimulationTotals (Phase 20 Bug A).
//
// SOURCE: addPhase20Tests in 99u_Phase20_CfeSimRepairandheadermap.gs,
//         Bug A portion only (lines covering repairCfeSimulationTotals
//         function exercise + idempotency check).
//         Bug B portion (CFE_OUT_SRC cell map) migrated separately to
//         tests_integration/writers/CfeOutputCellMapTests.gs.
//
// COVERAGE
//   Verifies repairCfeSimulationTotals fills CFE_SIMULATION annual
//   totals correctly:
//     - Function + run wrapper exist
//     - Repair returns a non-empty string summary
//     - Each of O37, O39, O40, O41, O42 carries =SUM(C<r>:N<r>) formula
//     - Idempotency: second run summary mentions "skipped (already populated)"
//
// CLASSIFICATION
//   group=integration. Writes formulas to 5 cells in CFE_SIMULATION
//   (O37, O39, O40, O41, O42), restores them in finally even though
//   the repair function is idempotent and non-destructive.
//
// DEPENDENCIES
//   - repairCfeSimulationTotals, runRepairCfeSimulationTotals
//     (02g_RepairCfeSimulationTotals.gs)
//   - SH.CFE_SIM constant (00_Main.gs)
//
// MODULE PLACEMENT: tests_integration/engine/cfe_sim_repair
//   The repair function is engine maintenance, not a renderer/writer.
//   New module dir keeps the module hierarchy honest about what each
//   test actually does.
//
// SAFETY MODEL
//   - Snapshots formula + value of O37, O39-O42 before any write
//   - Restores in finally: setFormula() if original had formula,
//     else setValue() or clearContent()
//   - Uses direct getRange/setFormula/setValue rather than
//     setInputValue (those cells aren't in INPUT_MAP -- they're
//     output-formula cells in CFE_SIMULATION)
//
// CO-EXISTENCE
//   99u_Phase20_CfeSimRepairandheadermap.gs unchanged. Legacy still
//   runs Bug A + Bug B from runTests() until the deletion pass.
// =============================================================================


registerTest({
  id      : 'INT_ENGINE_CFE_SIM_REPAIR',
  group   : 'integration',
  module  : 'engine/cfe_sim_repair',
  scenarios: [],
  tags    : ['engine', 'cfe-sim', 'repair', 'idempotent', 'live-cell'],
  source  : 'tests_integration/engine/CfeSimRepairTests.gs',
  fn: function (t, ctx) {
    t.suite('INT engine/cfe_sim_repair: repairCfeSimulationTotals');

    var ss = ctx.ss;

    // === Function availability =========================================
    t.assertTrue('repairCfeSimulationTotals function defined',
                 typeof repairCfeSimulationTotals === 'function');
    t.assertTrue('runRepairCfeSimulationTotals function defined',
                 typeof runRepairCfeSimulationTotals === 'function');

    var cfeSim = ss.getSheetByName(SH.CFE_SIM);
    if (!cfeSim) {
      t.info('NOTE',
             'CFE_SIMULATION sheet missing -- repair tests skipped');
      return;
    }

    // Snapshot O37, O39-O42 (formula + value) so we can restore even
    // though the repair function is idempotent. Direct getRange used --
    // these cells are output formulas, not in INPUT_MAP.
    var TARGET_ROWS = [37, 39, 40, 41, 42];
    var COL_O = 15;
    var snap = {};
    TARGET_ROWS.forEach(function (r) {
      snap[r] = {
        formula: cfeSim.getRange(r, COL_O).getFormula(),
        value:   cfeSim.getRange(r, COL_O).getValue()
      };
    });

    try {
      // === Run 1: repair populates the 5 cells with =SUM formulas =====
      var summary1 = repairCfeSimulationTotals(ss);
      t.assertTrue('repair: returns a non-empty string summary',
                   typeof summary1 === 'string' && summary1.length > 0);
      t.info('repair summary (run 1)', summary1);

      SpreadsheetApp.flush();

      // Each target cell must now carry a SUM formula spanning C<r>:N<r>
      // (the 12 monthly columns of CFE_SIMULATION).
      TARGET_ROWS.forEach(function (r) {
        var f = cfeSim.getRange(r, COL_O).getFormula();
        var hasSum   = f.indexOf('SUM') >= 0;
        var hasStart = f.indexOf('C' + r) >= 0;
        var hasEnd   = f.indexOf('N' + r) >= 0;
        t.assertTrue('CFE_SIMULATION!O' + r + ' has a SUM(C' + r + ':N' + r
                     + ') formula (got: "' + f + '")',
                     hasSum && hasStart && hasEnd);
      });

      // The TOTAL row should evaluate to a non-zero number if the live
      // sheet has monthly bill data (OASIS LATINOAMERICA does). Logged
      // as info, not asserted -- the formula correctness is the test;
      // the resulting value depends on engine state.
      var totalAnnual = cfeSim.getRange(39, COL_O).getValue();
      var totalStr = (typeof totalAnnual === 'number')
                       ? '$' + totalAnnual.toFixed(2)
                       : String(totalAnnual);
      t.info('CFE_SIMULATION!O39 annual TOTAL', totalStr);

      // === Run 2: idempotency -- second call must skip ================
      var summary2 = repairCfeSimulationTotals(ss);
      t.assertTrue('repair: idempotent (second-run summary mentions '
                   + '"skipped (already populated)")',
                   summary2.indexOf('skipped (already populated)') >= 0);
      t.info('repair summary (run 2)', summary2);

    } finally {
      // Restore original state. If a row had a formula, restore the
      // formula. If only a value, restore the value. If neither, clear.
      TARGET_ROWS.forEach(function (r) {
        var rng = cfeSim.getRange(r, COL_O);
        if (snap[r].formula) {
          rng.setFormula(snap[r].formula);
        } else if (snap[r].value !== '' && snap[r].value !== null) {
          rng.setValue(snap[r].value);
        } else {
          rng.clearContent();
        }
      });
      SpreadsheetApp.flush();
      t.info('cleanup', 'CFE_SIMULATION!O37,O39-O42 restored');
    }
  }
});
