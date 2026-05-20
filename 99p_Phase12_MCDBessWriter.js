// =============================================================================
// ARGIA ENGINE -- Phase 12 test suite: MDC §7 BESS writer (Increment 4b-3b)
// Paste this function into 99_TestRunner.gs, and add the call
//   try { addPhase12Tests(t, ss); } catch (e) { t.error('Phase12 aborted', e); }
// right after the addPhase11Tests block in runTests().
//
// SCOPE: Increment 4b-3b made writeMDC fill the §7 BESS section (rows 100-110)
// from a bessResult object. Phase 12 runs the calc pipeline with a battery,
// calls writeMDC WITH a bessResult, and reads the §7 rows back from the sheet.
//
// It checks the honest current state: the §7 header and spec rows are written,
// and the circuit-status row prints a "pendiente" line (INPUT_BESS has no
// voltage cell, so calcBessCircuit reports not-sizeable). When a voltage input
// lands (4b-2.5), the per-run rows fill and this suite should be extended.
//
// SAFETY: snapshots INPUT_PROJECT!D64 + INPUT_BESS C10/C11, writes a test
// battery, asserts, and ALWAYS restores in a finally block. It also leaves
// the MDC §7 rows populated -- that is harmless (the next real engine run
// rewrites or clears them) and matches how Tier 3 leaves MDC populated.
// =============================================================================

function addPhase12Tests(t, ss) {
  t.suite('Phase12: MDC §7 BESS writer');

  var shProj = ss.getSheetByName('INPUT_PROJECT');
  var shBess = ss.getSheetByName('INPUT_BESS');
  var shMdc  = ss.getSheetByName(SH.MDC);
  if (!shProj || !shBess || !shMdc) {
    t.error('Phase12 setup',
            new Error('INPUT_PROJECT / INPUT_BESS / MDC sheet missing'));
    return;
  }

  var snap = {
    toggle: shProj.getRange(64, 4).getValue(),
    bCap:   shBess.getRange(10, 3).getValue(),
    bPow:   shBess.getRange(11, 3).getValue(),
  };

  function restore() {
    shProj.getRange(64, 4).setValue(snap.toggle);
    shBess.getRange(10, 3).setValue(snap.bCap);
    shBess.getRange(11, 3).setValue(snap.bPow);
    SpreadsheetApp.flush();
  }

  // read a §7 cell (col B label / col C value)
  function label(r) { return String(shMdc.getRange(r, MC.LABEL).getValue()); }
  function value(r) { return String(shMdc.getRange(r, MC.VALUE).getValue()); }
  function status(r){ return String(shMdc.getRange(r, MC.STATUS).getValue()); }

  try {
    // -- arrange: enable a valid battery ----------------------------------
    shProj.getRange(64, 4).setValue('YES');
    shBess.getRange(10, 3).setValue(200);   // 200 kWh
    shBess.getRange(11, 3).setValue(100);   // 100 kW
    SpreadsheetApp.flush();

    // -- run the calc pipeline (same headless path as Tier 3) -------------
    var nom     = loadNomConstants(ss);
    var inp     = readInputs(ss);
    var panel   = lookupPanel(ss, inp.panelModel);
    var invBank = buildInverterBank(ss, inp.inverterBank);
    var tbls    = readElecTables(ss);
    var dc      = calcDC(inp, panel, invBank, nom, tbls);
    var ac      = calcAC(inp, panel, invBank, nom, tbls, dc);
    var lay     = calcLayout(inp, dc, ac, nom);
    var bessRes = runBessStep(ss);

    // sanity: the test battery is actually enabled
    t.assertTrue('pipeline: bessResult.bessEnabled true', bessRes.bessEnabled);

    // -- act: write the MDC WITH the bessResult ---------------------------
    writeMDC(ss, inp, panel, invBank, dc, ac, lay, nom, bessRes);
    SpreadsheetApp.flush();

    // === TEST 1: §7 header is written ====================================
    t.assertTrue('§7 header mentions BESS',
                 label(MDC_ROW.SEC7_HEADER).indexOf('BESS') >= 0);

    // === TEST 2: spec rows carry the battery numbers =====================
    t.assertTrue('BESS_MODEL row shows the battery strategy',
                 value(MDC_ROW.BESS_MODEL).indexOf(bessRes.bess.strategy) >= 0);
    t.assertTrue('BESS_CAPACITY row shows 200 kWh',
                 value(MDC_ROW.BESS_CAPACITY).indexOf('200') >= 0);
    t.assertTrue('BESS_POWER row shows 100 kW',
                 value(MDC_ROW.BESS_POWER).indexOf('100') >= 0);
    t.assertTrue('BESS_USABLE row shows a kWh figure',
                 value(MDC_ROW.BESS_USABLE).indexOf('kWh') >= 0);

    // === TEST 3: coupling row matches the engine result ==================
    t.assert('BESS_COUPLING row = engine coupling',
             bessRes.coupling, value(MDC_ROW.BESS_COUPLING));

    // === TEST 4: circuit-status row reflects the engine result honestly ===
    // calcBessCircuit may be sizeable (battery voltage available from DB or
    // manual cell) or not (no voltage). Either is correct -- assert that the
    // status row matches whichever path the engine took.
    var circStatus = String(value(MDC_ROW.BESS_CIRC_STAT));
    var circStatusFlag = String(status(MDC_ROW.BESS_CIRC_STAT));
    var circ = bessRes.circuit;
    if (circ && circ.sizeable) {
      // sized -> status row must be non-empty AND must not say "Pendiente".
      // (Conductor/OCPD details live in BESS_CIRC_RUN1, asserted below.)
      t.assertTrue('BESS_CIRC_STAT (sized): non-empty', circStatus.length > 0);
      t.assertFalse('BESS_CIRC_STAT (sized): no Pendiente line',
                    circStatus.indexOf('Pendiente') >= 0);
    } else {
      // not sized -> "Pendiente" + REVIEW flag (the original 4b-3b contract)
      t.assertTrue('BESS_CIRC_STAT (not sized): shows a "Pendiente" line',
                   circStatus.indexOf('Pendiente') >= 0);
      t.assertTrue('BESS_CIRC_STAT (not sized): status is a REVIEW flag',
                   circStatusFlag.indexOf('REVIEW') >= 0);
    }

    // === TEST 5: per-run rows match the circuit state ====================
    // sized -> RUN1 carries conductor info; not sized -> RUN1 stays blank.
    var run1 = String(value(MDC_ROW.BESS_CIRC_RUN1));
    if (circ && circ.sizeable) {
      t.assertTrue('BESS_CIRC_RUN1 (sized): non-empty conductor line',
                   run1.length > 0);
    } else {
      t.assert('BESS_CIRC_RUN1 (not sized): blank', '', run1);
    }
    t.assert('BESS_CIRC_RUN2 blank (reserved for 4b-2.5)',
             '', value(MDC_ROW.BESS_CIRC_RUN2));

    // === TEST 6: busbar + NOM citation rows are written ==================
    t.assertTrue('BESS_BUSBAR row is non-empty',
                 value(MDC_ROW.BESS_BUSBAR).length > 0);
    t.assertTrue('BESS_NOM_CITE row cites NOM 706',
                 value(MDC_ROW.BESS_NOM_CITE).indexOf('706') >= 0);

    // === TEST 7: PV-only -> §7 stays blank ===============================
    // writeMDC clears rows 6-120 first; with no bessResult the §7 band must
    // be empty. Re-run writeMDC withOUT a bessResult and check.
    writeMDC(ss, inp, panel, invBank, dc, ac, lay, nom);
    SpreadsheetApp.flush();
    t.assert('PV-only run: §7 header blank',
             '', label(MDC_ROW.SEC7_HEADER));
    t.assert('PV-only run: BESS_CAPACITY blank',
             '', value(MDC_ROW.BESS_CAPACITY));

  } finally {
    restore();
    t.info('Phase12 cleanup',
           'INPUT_PROJECT/INPUT_BESS restored; MDC §7 left as written');
  }
}