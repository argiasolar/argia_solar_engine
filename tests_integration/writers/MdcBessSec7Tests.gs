// =============================================================================
// ARGIA TESTS -- tests_integration/writers/MdcBessSec7Tests.gs
// -----------------------------------------------------------------------------
// PASS 11 MIGRATION: MDC §7 BESS writer (writeMDC with bessResult).
//
// SOURCE: addPhase12Tests in 99p_Phase12_MCDBessWriter.gs.
//         Migrated 2026-05-21 as part of Pass 11.
//
// COVERAGE
//   End-to-end pipeline integration test:
//     - Enable a test battery (200 kWh / 100 kW)
//     - Run the full calc pipeline: loadNomConstants, readInputs,
//       lookupPanel, buildInverterBank, readElecTables, calcDC, calcAC,
//       calcLayout, runBessStep
//     - Call writeMDC WITH the bessResult
//    - Verify §7 BESS rows (100-110) are filled correctly:
//         - Header mentions BESS
//         - Spec rows carry strategy, 200 kWh, 100 kW, usable kWh figure
//         - Coupling matches engine result
//         - Circuit-status row reflects sizeable/not-sizeable honestly
//         - Per-run rows match circuit state
//         - Busbar + NOM 706 citation present
//     - Re-run writeMDC WITHOUT bessResult; verify §7 stays blank (PV-only)
//
// CLASSIFICATION
//   group=integration. Runs the full pipeline + writes to MDC + reads back.
//
// DEPENDENCIES
//   - Full engine pipeline: loadNomConstants, readInputs, lookupPanel,
//     buildInverterBank, readElecTables, calcDC, calcAC, calcLayout,
//     runBessStep, writeMDC
//   - SH.MDC, MDC_ROW constants (00_Main.gs)
//   - MC.LABEL, MC.VALUE, MC.STATUS constants (07_WriteMDC.gs)
//
// SAFETY MODEL (matches legacy intent)
//   - Snapshots INPUT_PROJECT!D64 + INPUT_BESS C10/C11 only
//   - Restores those in finally
//   - LEAVES MDC §7 populated -- harmless because the next real engine
//     run rewrites or clears rows 6-120. Full MDC restore would be
//     expensive and not necessary because MDC is output, not input.
//   - Field keys for INPUT_BESS C10/C11: bessCapacityKwh, bessPowerKw
//
// CO-EXISTENCE
//   99p_Phase12_MCDBessWriter.gs unchanged.
// =============================================================================


registerTest({
  id      : 'INT_WRITERS_MDC_BESS_SEC7',
  group   : 'integration',
  module  : 'writers/mdc',
  scenarios: [],
  tags    : ['writers', 'mdc', 'bess', 'pipeline', 'end-to-end'],
  source  : 'tests_integration/writers/MdcBessSec7Tests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers/mdc: §7 BESS writer');

    var ss = ctx.ss;
    var shMdc = ss.getSheetByName(SH.MDC);
    if (!shMdc) {
      t.error('setup', new Error('MDC sheet missing'));
      return;
    }

    // Local readers for §7 cells (col B label / col C value / col F status)
    function label(r)  { return String(shMdc.getRange(r, MC.LABEL).getValue()); }
    function value(r)  { return String(shMdc.getRange(r, MC.VALUE).getValue()); }
    function status(r) { return String(shMdc.getRange(r, MC.STATUS).getValue()); }

    // Snapshot only the INPUT cells we modify
    var snap = backupInputCells(
      ['installBattery', 'bessCapacityKwh', 'bessPowerKw'], ss);

    try {
      // -- arrange: enable a valid test battery ---------------------------
      setInputValue('installBattery',  'YES', ss);
      setInputValue('bessCapacityKwh', 200,   ss);    // 200 kWh
      setInputValue('bessPowerKw',     100,   ss);    // 100 kW
      SpreadsheetApp.flush();

      // -- run the headless calc pipeline (same path as Tier 3) -----------
      var nom     = loadNomConstants(ss);
      var inp     = readInputs(ss);
      var panel   = lookupPanel(ss, inp.panelModel);
      var invBank = buildInverterBank(ss, inp.inverterBank);
      var tbls    = readElecTables(ss);
      var dc      = calcDC(inp, panel, invBank, nom, tbls);
      var ac      = calcAC(inp, panel, invBank, nom, tbls, dc);
      var lay     = calcLayout(inp, dc, ac, nom);
      var bessRes = runBessStep(ss);

      // Sanity: the test battery is actually enabled
      t.assertTrue('pipeline: bessResult.bessEnabled true',
                   bessRes.bessEnabled);

      // -- act: write the MDC WITH the bessResult -----------------------
      writeMDC(ss, inp, panel, invBank, dc, ac, lay, nom, bessRes);
      SpreadsheetApp.flush();

      // === TEST 1: §7 header is written =================================
      t.assertTrue('§7 header mentions BESS',
                   label(MDC_ROW.SEC7_HEADER).indexOf('BESS') >= 0);

      // === TEST 2: spec rows carry the battery numbers =================
      t.assertTrue('BESS_MODEL row shows the battery strategy',
                   value(MDC_ROW.BESS_MODEL).indexOf(bessRes.bess.strategy) >= 0);
      t.assertTrue('BESS_CAPACITY row shows 200 kWh',
                   value(MDC_ROW.BESS_CAPACITY).indexOf('200') >= 0);
      t.assertTrue('BESS_POWER row shows 100 kW',
                   value(MDC_ROW.BESS_POWER).indexOf('100') >= 0);
      t.assertTrue('BESS_USABLE row shows a kWh figure',
                   value(MDC_ROW.BESS_USABLE).indexOf('kWh') >= 0);

      // === TEST 3: coupling row matches engine result ==================
      t.assert('BESS_COUPLING row = engine coupling',
               bessRes.coupling, value(MDC_ROW.BESS_COUPLING));

      // === TEST 4: circuit-status reflects engine result honestly =======
      // calcBessCircuit may be sizeable (voltage available) or not (no
      // voltage). Either is correct; assert the status row matches.
      var circStatus     = value(MDC_ROW.BESS_CIRC_STAT);
      var circStatusFlag = status(MDC_ROW.BESS_CIRC_STAT);
      var circ = bessRes.circuit;
      if (circ && circ.sizeable) {
        t.assertTrue('BESS_CIRC_STAT (sized): non-empty',
                     circStatus.length > 0);
        t.assertFalse('BESS_CIRC_STAT (sized): no Pendiente line',
                      circStatus.indexOf('Pendiente') >= 0);
      } else {
        t.assertTrue('BESS_CIRC_STAT (not sized): shows a "Pendiente" line',
                     circStatus.indexOf('Pendiente') >= 0);
        t.assertTrue('BESS_CIRC_STAT (not sized): status is a REVIEW flag',
                     circStatusFlag.indexOf('REVIEW') >= 0);
      }

      // === TEST 5: per-run rows match the circuit state ===============
      var run1 = value(MDC_ROW.BESS_CIRC_RUN1);
      if (circ && circ.sizeable) {
        t.assertTrue('BESS_CIRC_RUN1 (sized): non-empty conductor line',
                     run1.length > 0);
      } else {
        t.assert('BESS_CIRC_RUN1 (not sized): blank', '', run1);
      }
      t.assert('BESS_CIRC_RUN2 blank (reserved for 4b-2.5)',
               '', value(MDC_ROW.BESS_CIRC_RUN2));

      // === TEST 6: busbar + NOM citation rows are written ==============
      t.assertTrue('BESS_BUSBAR row is non-empty',
                   value(MDC_ROW.BESS_BUSBAR).length > 0);
      t.assertTrue('BESS_NOM_CITE row cites NOM 706',
                   value(MDC_ROW.BESS_NOM_CITE).indexOf('706') >= 0);

      // === TEST 7: PV-only -> §7 stays blank ===========================
      // writeMDC clears rows 6-120 first; with no bessResult the §7 band
      // must be empty. Re-run writeMDC withOUT a bessResult and check.
      writeMDC(ss, inp, panel, invBank, dc, ac, lay, nom);
      SpreadsheetApp.flush();
      t.assert('PV-only run: §7 header blank',
               '', label(MDC_ROW.SEC7_HEADER));
      t.assert('PV-only run: BESS_CAPACITY blank',
               '', value(MDC_ROW.BESS_CAPACITY));

    } finally {
      restoreInputCells(snap, ss);
      t.info('cleanup',
             'INPUT_PROJECT/INPUT_BESS restored; MDC §7 left as written');
    }
  }
});
