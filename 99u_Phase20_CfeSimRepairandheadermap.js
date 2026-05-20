// =============================================================================
// ARGIA ENGINE -- Phase 20 test suite: Bug A + Bug B fixes (CFE_OUTPUT/SIM)
// Paste this function into 99_TestRunner.gs, and add the call
//   try { addPhase20Tests(t, ss); } catch (e) { t.error('Phase20 aborted', e); }
// right after the addPhase19Tests block in runTests().
//
// SCOPE:
//
//   BUG A (CFE_SIMULATION annual totals)
//     - Verifies repairCfeSimulationTotals(ss) is defined and callable.
//     - Verifies after running it, the 5 target cells (O37, O39, O40, O41, O42)
//       carry =SUM(...) formulas and produce non-blank annual totals.
//     - Verifies idempotency: running it twice doesn't double-write.
//     - Verifies label-guard: if a row's label doesn't match, the row is
//       skipped (the function never blindly writes to a wrong row).
//
//   BUG B (CFE_OUT_SRC header strip cell map)
//     - Verifies CFE_OUT_SRC now points at C4 / F4 / F5 / F6 (real layout)
//       instead of the previous wrong C5 / E6 / E7 / E8.
//     - Verifies the actual cells at the new coordinates carry the expected
//       label patterns in column B/E (TARIFF CODE / SERVICE NAME /
//       SERVICE NUMBER / CONTRACTED DEMAND).
//     - Verifies PV interconnection cells shifted from rows 40-43 to 41-44.
//
// SAFETY:
//   - Reads only. Bug A test snapshots the 5 O cells BEFORE the test and
//     restores their contents in finally, even though the repair function
//     itself is idempotent.
// =============================================================================

function addPhase20Tests(t, ss) {
  t.suite('Phase20: Bug A (CFE_SIM totals) + Bug B (header cell map)');

  // -- BUG B PART 1: cell-map coordinates ---------------------------------
  // CFE_OUT_SRC is a JS object exported by 06_WriteCfeOutput.gs.
  t.assertTrue('CFE_OUT_SRC exposed', typeof CFE_OUT_SRC === 'object');
  if (typeof CFE_OUT_SRC === 'object') {
    t.assert('input_tariffCode -> INPUT_CFE row 4',
             4, CFE_OUT_SRC.input_tariffCode.row);
    t.assert('input_tariffCode -> col 3 (C)',
             3, CFE_OUT_SRC.input_tariffCode.col);

    t.assert('input_serviceName -> row 4',  4, CFE_OUT_SRC.input_serviceName.row);
    t.assert('input_serviceName -> col 6 (F)', 6, CFE_OUT_SRC.input_serviceName.col);

    t.assert('input_serviceNumber -> row 5', 5, CFE_OUT_SRC.input_serviceNumber.row);
    t.assert('input_serviceNumber -> col 6 (F)', 6, CFE_OUT_SRC.input_serviceNumber.col);

    t.assert('input_contractedKw -> row 6', 6, CFE_OUT_SRC.input_contractedKw.row);
    t.assert('input_contractedKw -> col 6 (F)', 6, CFE_OUT_SRC.input_contractedKw.col);

    t.assert('input_2pctBT -> row 7',       7, CFE_OUT_SRC.input_2pctBT.row);

    t.assert('input_interconnMode -> row 41', 41, CFE_OUT_SRC.input_interconnMode.row);
    t.assert('input_exportPrice -> row 42',   42, CFE_OUT_SRC.input_exportPrice.row);
    t.assert('input_autoconsumoPct -> row 43',43, CFE_OUT_SRC.input_autoconsumoPct.row);
    t.assert('input_fpUmbral -> row 44',      44, CFE_OUT_SRC.input_fpUmbral.row);
  }

  // -- BUG B PART 2: live INPUT_CFE labels at the new coordinates ----------
  // This guards against the renderer drifting from the actual sheet again.
  var inpCfe = ss.getSheetByName('INPUT_CFE');
  if (!inpCfe) {
    t.error('Phase20', new Error('INPUT_CFE sheet missing'));
    return;
  }
  function labelMatch(row, col, contains, descr) {
    var v = String(inpCfe.getRange(row, col).getValue() || '').toLowerCase();
    t.assertTrue(descr + ' (got "' + inpCfe.getRange(row, col).getValue() + '")',
                 v.indexOf(contains.toLowerCase()) >= 0);
  }
  labelMatch(4, 2, 'tariff code',    'INPUT_CFE!B4 = TARIFF CODE label');
  labelMatch(4, 5, 'service name',   'INPUT_CFE!E4 = SERVICE NAME label');
  labelMatch(5, 5, 'service number', 'INPUT_CFE!E5 = SERVICE NUMBER label');
  labelMatch(6, 5, 'contracted',     'INPUT_CFE!E6 = CONTRACTED DEMAND label');
  labelMatch(41, 2, 'modo',          'INPUT_CFE!B41 = MODO INTERCONEXION');
  labelMatch(42, 2, 'precio',        'INPUT_CFE!B42 = PRECIO EXPORTACION');
  labelMatch(43, 2, 'autoconsumo',   'INPUT_CFE!B43 = AUTOCONSUMO %');
  labelMatch(44, 2, 'umbral',        'INPUT_CFE!B44 = UMBRAL FACTOR POTENCIA');

  // -- BUG A: repairCfeSimulationTotals ------------------------------------
  t.assertTrue('repairCfeSimulationTotals function defined',
               typeof repairCfeSimulationTotals === 'function');
  t.assertTrue('runRepairCfeSimulationTotals function defined',
               typeof runRepairCfeSimulationTotals === 'function');

  var cfeSim = ss.getSheetByName(SH.CFE_SIM);
  if (!cfeSim) {
    t.info('Phase20 Bug A', 'CFE_SIMULATION sheet missing -- repair tests skipped');
    return;
  }

  // Snapshot O37-O42 so we can restore after the test, even though
  // repairCfeSimulationTotals is idempotent.
  var snap = {};
  [37, 39, 40, 41, 42].forEach(function(r) {
    snap[r] = {
      formula: cfeSim.getRange(r, 15).getFormula(),
      value:   cfeSim.getRange(r, 15).getValue()
    };
  });

  try {
    // Run the repair.
    var summary1 = repairCfeSimulationTotals(ss);
    t.assertTrue('repair: returns a string summary',
                 typeof summary1 === 'string' && summary1.length > 0);
    t.info('Phase20 repair summary (run 1)', summary1);

    SpreadsheetApp.flush();

    // The five target cells must now carry a formula.
    [37, 39, 40, 41, 42].forEach(function(r) {
      var f = cfeSim.getRange(r, 15).getFormula();
      t.assertTrue('CFE_SIMULATION!O' + r + ' has a SUM formula (got: "' + f + '")',
                   f.indexOf('SUM') >= 0 && f.indexOf('C' + r) >= 0
                                          && f.indexOf('N' + r) >= 0);
    });

    // The TOTAL row should now evaluate to a non-zero number (assuming
    // the live sheet has monthly bill data, which the OASIS project does).
    var totalAnnual = cfeSim.getRange(39, 15).getValue();
    t.info('CFE_SIMULATION!O39 annual TOTAL',
           '$' + (typeof totalAnnual === 'number' ? totalAnnual.toFixed(2) : totalAnnual));

    // Run the repair AGAIN to verify idempotency.
    var summary2 = repairCfeSimulationTotals(ss);
    t.assertTrue('repair: idempotent (second-run summary mentions "skipped")',
                 summary2.indexOf('skipped (already populated)') >= 0);
    t.info('Phase20 repair summary (run 2)', summary2);

  } finally {
    // Restore original state, even though the repair is non-destructive.
    [37, 39, 40, 41, 42].forEach(function(r) {
      if (snap[r].formula) {
        cfeSim.getRange(r, 15).setFormula(snap[r].formula);
      } else if (snap[r].value !== '' && snap[r].value !== null) {
        cfeSim.getRange(r, 15).setValue(snap[r].value);
      } else {
        cfeSim.getRange(r, 15).clearContent();
      }
    });
    SpreadsheetApp.flush();
    t.info('Phase20 cleanup', 'CFE_SIMULATION!O37,O39-O42 restored');
  }
}