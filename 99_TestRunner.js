// =============================================================================
// ARGIA ENGINE -- File: 99_TestRunner.gs
// Apps Script native test runner. Runs entirely inside Google Sheets.
//
// Entry point: runTests() -- wired to the ARGIA menu.
//
// Architecture:
//   Tier 1: Lookup helpers (elec tables, NOM constants)    -- pure, fast
//   Tier 2: Calc modules (calcDC / calcAC / calcLayout)    -- with fixture
//   Tier 3: End-to-end (runs engine, reads MDC cells)      -- writes sheet state
//
// All tests write results to a sheet named '_TEST_RESULTS', which is
// cleared and rewritten on each run. Tests NEVER pollute the engine's
// real input sheets -- Tier 3 saves inputs to a hidden backup first.
// =============================================================================

var TEST_RESULTS_SHEET = '_TEST_RESULTS';
// Backup sheet names defined in TEST_BACKUP_NAMES near backupInputs()

// ---------------------------------------------------------------------------
// MAIN ENTRY POINT
// ---------------------------------------------------------------------------
function runTests() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var startMs = Date.now();

  var results = [];
  var currentSuite = '';

  // Test runner API exposed to individual test functions
  var t = {
    suite: function(name) { currentSuite = name; },
    assert: function(label, expected, actual, tolerance) {
      tolerance = (typeof tolerance === 'number') ? tolerance : 0;
      var pass;
      if (typeof expected === 'number' && typeof actual === 'number') {
        pass = Math.abs(expected - actual) <= tolerance;
      } else {
        pass = (expected === actual);
      }
      results.push({
        suite: currentSuite,
        label: label,
        status: pass ? 'PASS' : 'FAIL',
        expected: expected,
        actual: actual,
        note: pass ? '' : (tolerance > 0 ? ('tol ' + tolerance) : '')
      });
    },
    assertTrue: function(label, actual) {
      var pass = actual === true;
      results.push({
        suite: currentSuite, label: label,
        status: pass ? 'PASS' : 'FAIL',
        expected: true, actual: actual, note: ''
      });
    },
    assertFalse: function(label, actual) {
      var pass = actual === false;
      results.push({
        suite: currentSuite, label: label,
        status: pass ? 'PASS' : 'FAIL',
        expected: false, actual: actual, note: ''
      });
    },
    fail: function(label, reason) {
      results.push({
        suite: currentSuite, label: label,
        status: 'FAIL', expected: '', actual: '',
        note: reason
      });
    },
    error: function(label, err) {
      results.push({
        suite: currentSuite, label: label,
        status: 'ERROR', expected: '', actual: '',
        note: String(err && err.message || err) + (err && err.stack ? (' | ' + err.stack.split('\n').slice(0, 2).join(' ')) : '')
      });
    },
    info: function(label, note) {
      results.push({
        suite: currentSuite, label: label,
        status: 'INFO', expected: '', actual: '',
        note: String(note || '')
      });
    }
  };

  // Tier 1 -- pure lookup helpers. Fast. No side effects.
  try { testElecTables(t, ss); }
  catch (e) { t.error('Tier 1 aborted', e); }

  // Tier 2 -- calc modules with fixture. No sheet writes.
  try { testCalcModules(t, ss); }
  catch (e) { t.error('Tier 2 aborted', e); }

  // Tier 3 -- end-to-end with full engine run. Writes + restores sheet state.
  try { testEndToEnd(t, ss); }
  catch (e) { t.error('Tier 3 aborted', e); }

  // -------------------------------------------------------------------------
  // Tier 4 -- Phase 0 + 0.5 regression suites (v2.0.0)
  // Added 2026-05-13. See 99a_TestRunner_Phase0.gs.
  // -------------------------------------------------------------------------
  try { addPhase0Tests(t, ss); }
  catch (e) { t.error('Phase0 aborted', e); }

  // -------------------------------------------------------------------------
  // Tier 5 -- Phase 1 CFE export rule (v2.1.0)
  // Added 2026-05-15. See 99b_TestRunner_Phase1.gs.
  // Pure JS unit tests for calcCfeBillWithPv — no spreadsheet I/O.
  // -------------------------------------------------------------------------
  try { addPhase1Tests(t, ss); }
  catch (e) { t.error('Phase1 aborted', e); }

  // -------------------------------------------------------------------------
  // Tier 6 -- Phase 1.2 PF threshold fix (v2.1.2)
  // Added 2026-05-15. See 99c_TestRunner_Phase1_2.gs.
  // Bug fix: PF threshold was hardcoded at 0.90; per Acuerdo A/073/2023 it
  // is 0.95 for ≥1MW customers, 0.97 after April 8, 2026 (Código de Red).
  // Verified against Culligan CFE bills.
  // -------------------------------------------------------------------------
  try { addPhase12Tests(t, ss); }
  catch (e) { t.error('Phase1.2 aborted', e); }

  // -------------------------------------------------------------------------
  // Tier 7 -- Phase 1.4 mode-aware cascade + FP threshold integration (v2.1.4)
  // Added 2026-05-15. See 99d_TestRunner_Phase1_4.gs.
  // CHANGES: SE/FN cascade now intermedia-only (was proportional in v2.1.0).
  // FN/SE v2.1.0 lock targets SUPERSEDED. NM unchanged.
  // -------------------------------------------------------------------------
  try { addPhase14Tests(t, ss); }
  catch (e) { t.error('Phase1.4 aborted', e); }

  // -------------------------------------------------------------------------
  // Tier 8 -- Phase 2 BESS impact (v2.2.0)
  // Added 2026-05-15. See 99e_TestRunner_Phase2.gs.
  // SCOPE: SELF_CONSUMPTION_MAX strategy only. PEAK_SHAVING and HYBRID
  // deferred to v2.3.0 pending 15-min interval data.
  // -------------------------------------------------------------------------
  try { addPhase2Tests(t, ss); }
  catch (e) { t.error('Phase2 aborted', e); }

  // -------------------------------------------------------------------------
  // Tier 9 -- Phase 3 PEAK_SHAVING strategy (v2.3.0)
  // Added 2026-05-18. See 99f_TestRunner_Phase3.gs.
  // SCOPE: PEAK_SHAVING strategy (Capacidad + Distribución verifiable tiers,
  // Variable estimated tier). HYBRID remains deferred to v2.4.0.
  // -------------------------------------------------------------------------
  try { addPhase3Tests(t, ss); }
  catch (e) { t.error('Phase3 aborted', e); }

  var elapsedMs = Date.now() - startMs;
  writeResultsSheet(ss, results, elapsedMs);

  // Summary toast
  // Count by status: PASS = real test pass, FAIL = real test failure,
  // INFO = diagnostic logging (not a test, just data dump).
  var passCount = results.filter(function(r) { return r.status === 'PASS'; }).length;
  var failCount = results.filter(function(r) { return r.status === 'FAIL'; }).length;
  var infoCount = results.filter(function(r) { return r.status === 'INFO'; }).length;
  var msg = passCount + ' passed, ' + failCount + ' failed';
  if (infoCount > 0) msg += ', ' + infoCount + ' info';
  msg += ' in ' + (elapsedMs/1000).toFixed(1) + 's';
  if (failCount > 0) {
    ui.alert('ARGIA Tests -- FAIL', msg + '\n\nSee ' + TEST_RESULTS_SHEET + ' sheet for details.', ui.ButtonSet.OK);
  } else {
    ss.toast(msg, 'ARGIA Tests -- PASS', 5);
  }
}

// ---------------------------------------------------------------------------
// TIER 1 -- elec tables and NOM constants
// ---------------------------------------------------------------------------
function testElecTables(t, ss) {
  t.suite('Tier 1 -- elec tables');

  var tbls = readElecTables(ss);

  // Roof temp adder
  t.assert('getRoofTempAdder(90)  = 22',  22, getRoofTempAdder(90, tbls));
  t.assert('getRoofTempAdder(13)  = 33',  33, getRoofTempAdder(13, tbls));
  t.assert('getRoofTempAdder(300) = 17',  17, getRoofTempAdder(300, tbls));

  // Temp factor (Ft)
  t.assert('getTempFactor(60)  = 0.71',   0.71, getTempFactor(60, tbls));
  t.assert('getTempFactor(38)  = 0.91',   0.91, getTempFactor(38, tbls));
  t.assert('getTempFactor(47)  = 0.82',   0.82, getTempFactor(47, tbls));
  t.assert('getTempFactor(10)  = 1.15',   1.15, getTempFactor(10, tbls));

  // Grouping factor (Fag)
  t.assert('getGroupingFactor(2)  = 1.00',  1.00, getGroupingFactor(2, tbls));
  t.assert('getGroupingFactor(3)  = 1.00',  1.00, getGroupingFactor(3, tbls));
  t.assert('getGroupingFactor(6)  = 0.80',  0.80, getGroupingFactor(6, tbls));
  t.assert('getGroupingFactor(10) = 0.50',  0.50, getGroupingFactor(10, tbls));

  // Next breaker
  t.assert('nextBreaker(22.30)  = 25',  25,  nextBreaker(22.30, tbls));
  t.assert('nextBreaker(150.35) = 175', 175, nextBreaker(150.35, tbls));
  t.assert('nextBreaker(601.40) = 800', 800, nextBreaker(601.40, tbls));

  // Conductor selection
  var c1 = selectConductor(31.40, tbls);
  t.assert('selectConductor(31.40)  = 10 AWG',    '10',  String(c1.size));
  t.assert('selectConductor(31.40)  ampacity 40', 40,     c1.ampacity);
  var c2 = selectConductor(132.18, tbls);
  t.assert('selectConductor(132.18) = 1 AWG',     '1',    String(c2.size));
  var c3 = selectConductor(330.44, tbls);
  t.assert('selectConductor(330.44) = 350 kcmil', '350',  String(c3.size));

  // EGC
  var egc1 = getEgcSize(25, tbls);
  t.assert('getEgcSize(25)  = 10 AWG',    '10',  String(egc1.egcSize));
  var egc2 = getEgcSize(175, tbls);
  t.assert('getEgcSize(175) = 6 AWG',     '6',   String(egc2.egcSize));
  var egc3 = getEgcSize(800, tbls);
  t.assert('getEgcSize(800) = 1/0 AWG',   '1/0', String(egc3.egcSize));

  // Next transformer
  t.assert('nextTransformer(533.33) = 750', 750, nextTransformer(533.33, tbls));
  t.assert('nextTransformer(500)    = 500', 500, nextTransformer(500, tbls));
  t.assert('nextTransformer(501)    = 750', 750, nextTransformer(501, tbls));

  // NOM constants -- verifying the load path works and returns expected defaults
  t.suite('Tier 1 -- NOM constants');
  var nom = loadNomConstants(ss);
  t.assert('nom.currentFactor1 = 1.25',  1.25,   nom.currentFactor1);
  t.assert('nom.currentFactor2 = 1.5625', 1.5625, nom.currentFactor2);
  t.assertTrue('nom.bifacialFactor exists', typeof nom.bifacialFactor === 'number');
  t.assertTrue('nom.maxParallelRunA exists', typeof nom.maxParallelRunA === 'number');
}

// ---------------------------------------------------------------------------
// TIER 2 -- calc modules with TESTPROJ-001 fixture
// Runs calcDC/calcAC/calcLayout with synthetic inputs, asserts outputs.
// No sheet writes.
// ---------------------------------------------------------------------------
function testCalcModules(t, ss) {
  var exp = TESTPROJ_001.expected;
  var tol = TESTPROJ_001.tolerance;

  // Build synthetic inputs and panel/inv objects that match the fixture.
  // We don't read from INPUT_DESIGN here -- tests must be repeatable even if
  // someone edited the inputs between runs.

  var inp = buildTestInputs();
  var panel = buildTestPanel();
  var invBank = buildTestInverterBank();
  var nom = loadNomConstants(ss);
  var tbls = readElecTables(ss);

  // --- Tier 2a -- calcDC ----------------------------------------------------
  t.suite('Tier 2 -- calcDC');
  var dc;
  try { dc = calcDC(inp, panel, invBank, nom, tbls); }
  catch (e) { t.error('calcDC threw', e); return; }

  t.assert('bifFactor',        exp.dc.bifFactor,      dc.bifFactor,      tol['default']);
  t.assert('bifacial flag',    exp.dc.bifacial,       dc.bifacial);
  t.assert('isc',              exp.dc.isc,            dc.isc,            tol['default']);
  t.assert('isc125',           exp.dc.isc125,         dc.isc125,         tol['default']);
  t.assert('iDesignPerStr',    exp.dc.iDesignPerStr,  dc.iDesignPerStr,  tol['default']);
  t.assert('iDesign total',    exp.dc.iDesign,        dc.iDesign,        tol['default']);
  t.assert('roofAdder',        exp.dc.roofAdder,      dc.roofAdder);
  t.assert('ambientDC',        exp.dc.ambientDC,      dc.ambientDC);
  t.assert('ambientAvg',       exp.dc.ambientAvg,     dc.ambientAvg);
  t.assert('Ft_dc',            exp.dc.Ft_dc,          dc.Ft_dc,          tol['default']);
  t.assert('Fag_dc',           exp.dc.Fag_dc,         dc.Fag_dc,         tol['default']);
  t.assert('ampReqDC',         exp.dc.ampReqDC,       dc.ampReqDC,       tol['loose']);
  t.assert('conductorDC',      exp.dc.conductorDC,    String(dc.conductorDC));
  t.assert('areaConDC',        exp.dc.areaConDC,      dc.areaConDC,      tol['default']);
  t.assert('ocpdDC',           exp.dc.ocpdDC,         dc.ocpdDC);
  t.assert('moduleMaxFuse',    exp.dc.moduleMaxFuse,  dc.moduleMaxFuse);
  t.assert('ocpdDCPass (expected false = AUDIT-FLAG)', exp.dc.ocpdDCPass, dc.ocpdDCPass);
  t.assert('egcDC',            exp.dc.egcDC,          String(dc.egcDC));
  t.assert('vString',          exp.dc.vString,        dc.vString,        tol['default']);
  t.assert('dcLength',         exp.dc.dcLength,       dc.dcLength);
  t.assert('vdropDC',          exp.dc.vdropDC,        dc.vdropDC,        tol['vdrop']);
  t.assert('vdropDCPass',      exp.dc.vdropDCPass,    dc.vdropDCPass);
  t.assert('conduitDC',        exp.dc.conduitDC,      String(dc.conduitDC));
  t.assert('vocColdPerMod',    exp.dc.vocColdPerMod,  dc.vocColdPerMod,  tol['default']);
  t.assert('vocColdString',    exp.dc.vocColdString,  dc.vocColdString,  tol['loose']);
  t.assert('dc01Pass (Voc cold)', exp.dc.dc01Pass,    dc.dc01Pass);
  t.assert('vmpHotString',     exp.dc.vmpHotString,   dc.vmpHotString,   tol['loose']);
  t.assert('dc02Pass (Vmp hot)', exp.dc.dc02Pass,     dc.dc02Pass);

  // --- Tier 2b -- calcAC ----------------------------------------------------
  t.suite('Tier 2 -- calcAC');
  var ac;
  try { ac = calcAC(inp, panel, invBank, nom, tbls, dc); }
  catch (e) { t.error('calcAC threw', e); return; }

  t.assert('ambientAC',        exp.ac.ambientAC,      ac.ambientAC);
  t.assert('iNom per inv',     exp.ac.iNomPerInv,     ac.perInverter[0].iNom,     tol['default']);
  t.assert('ocpdReq per inv',  exp.ac.ocpdReqPerInv,  ac.perInverter[0].ocpdReq,  tol['default']);
  t.assert('ocpd per inv',     exp.ac.ocpdPerInv,     ac.perInverter[0].ocpd);
  t.assert('Ft_ac',            exp.ac.Ft_ac,          ac.perInverter[0].Ft_ac,    tol['default']);
  t.assert('Fag_ac',           exp.ac.Fag_ac,         ac.perInverter[0].Fag_ac,   tol['default']);
  t.assert('ampReq per inv',   exp.ac.ampReqPerInv,   ac.perInverter[0].ampReqAC, tol['loose']);
  t.assert('conductor per inv', exp.ac.conductorPerInv, String(ac.perInverter[0].conductor));
  t.assert('egc per inv',      exp.ac.egcPerInv,      String(ac.perInverter[0].egc));
  t.assert('acLenInv',         exp.ac.acLenInv,       ac.perInverter[0].acLenInv);
  t.assert('vdropAC per inv',  exp.ac.vdropACPerInv,  ac.perInverter[0].vdropAC,  tol['vdrop']);
  t.assert('conduit per inv',  exp.ac.conduitPerInv,  String(ac.perInverter[0].conduit));
  t.assert('iTotalAC',         exp.ac.iTotalAC,       ac.iTotalAC,                tol['default']);
  t.assert('mainBreaker',      exp.ac.mainBreaker,    ac.mainBreaker);
  t.assert('parallelRuns',     exp.ac.parallelRuns,   ac.parallelRuns);
  t.assert('iPerRun',          exp.ac.iPerRun,        ac.iPerRun,                 tol['default']);
  t.assert('Fag_main',         exp.ac.Fag_main,       ac.Fag_main,                tol['default']);
  t.assert('ampReqMain',       exp.ac.ampReqMain,     ac.ampReqMain,              tol['loose']);
  t.assert('condMain',         exp.ac.condMain,       String(ac.condMain));
  t.assert('egcMain',          exp.ac.egcMain,        String(ac.egcMain));
  t.assert('feederLen',        exp.ac.feederLen,      ac.feederLen);
  t.assert('vdropFeeder',      exp.ac.vdropFeeder,    ac.vdropFeeder,             tol['vdrop']);
  t.assert('vdropFeederPass',  exp.ac.vdropFeederPass, ac.vdropFeederPass);
  t.assert('conduitMain',      exp.ac.conduitMain,    String(ac.conduitMain));
  t.assert('apparentPower',    exp.ac.apparentPower,  ac.apparentPower,           tol['default']);
  t.assert('transformer',      exp.ac.transformer,    ac.transformer);
  t.assert('transformerPass',  exp.ac.transformerPass, ac.transformerPass);
}

// ---------------------------------------------------------------------------
// TIER 3 -- end-to-end: runs full engine, asserts writer outputs
// SAFETY: backs up input sheets before writing test data, restores on finish.
// ---------------------------------------------------------------------------
function testEndToEnd(t, ss) {
  t.suite('Tier 3 -- end-to-end');

  // Check that MDC and INPUT sheets exist -- if not, skip with a clear message
  // v2.0.2: INPUT_GENERAL retired in favor of INPUT_PROJECT. The new
  // input architecture routes identity / commercial fields to INPUT_PROJECT
  // via INPUT_MAP logical keys.
  var requiredSheets = ['INPUT_PROJECT', 'INPUT_DESIGN', 'MDC'];
  for (var i = 0; i < requiredSheets.length; i++) {
    if (ss.getSheetByName(requiredSheets[i]) === null) {
      t.fail('Tier 3 skipped', 'Required sheet not found: ' + requiredSheets[i]);
      return;
    }
  }

  var backedUp = false;
  try {
    // Backup current inputs so we can restore after the test
    backupInputs(ss);
    backedUp = true;

    // Write TESTPROJ-001 inputs to the sheets. Any cell with data validation
    // that rejects our value is reported as an INFO note (not a failure) --
    // those cells don't affect engine math (they're labels, names, metadata).
    var skipped = writeTestInputs(ss);
    skipped.forEach(function(info) {
      t.info('input cell skipped', info);
    });
    SpreadsheetApp.flush();

    // Run the full engine.
    // runArgiaEngine() shows a UI dialog which breaks in menu-less contexts.
    // For tests, we call the calc pipeline directly so we can run headless.
    var nom     = loadNomConstants(ss);
    var inp     = readInputs(ss);
    var panel   = lookupPanel(ss, inp.panelModel);
    var invBank = buildInverterBank(ss, inp.inverterBank);
    var tbls    = readElecTables(ss);
    var dc      = calcDC(inp, panel, invBank, nom, tbls);
    var ac      = calcAC(inp, panel, invBank, nom, tbls, dc);
    var lay     = calcLayout(inp, dc, ac, nom);
    writeMDC(ss, inp, panel, invBank, dc, ac, lay, nom);
    SpreadsheetApp.flush();

    // Now read back the MDC cells and compare
    assertMdcWriterOutputs(t, ss);

    // Tier 3.6 -- BOM quantities + writeBOM smoke test
    testBomDiagnostic(t, ss, inp, panel, invBank, dc, ac, lay);

    // Tier 3.5 -- INSTALL COST DIAGNOSTIC (no assertions, INFO only)
    // Runs runInstallCost against TESTPROJ-001 inputs and reports every line
    // item + section totals + grand total as INFO rows. Use this output to
    // decide what numbers to lock as regression baseline in the next iteration.
    testInstallCostDiagnostic(t, ss, inp, invBank, dc, ac, lay);

  } catch (e) {
    t.error('Tier 3 pipeline threw', e);
  } finally {
    // Always restore inputs, even on crash
    if (backedUp) {
      try { restoreInputs(ss); }
      catch (restoreErr) {
        t.fail('Tier 3 RESTORE failed', 'Inputs NOT restored: ' + restoreErr.message);
      }
    }
  }
}

function assertMdcWriterOutputs(t, ss) {
  var mdc = ss.getSheetByName('MDC');
  var C = MDC_COL.VALUE;  // col 3
  var F = MDC_COL.STATUS; // col 6
  var R = MDC_ROW;
  var exp = TESTPROJ_001.expected.dc;
  var expAc = TESTPROJ_001.expected.ac;
  var tol = TESTPROJ_001.tolerance;

  // Helpers that handle the MDC writer's cell formats:
  //   - Numeric cells may include unit suffixes: "25 A", "1010.81 V", "750 kVA"
  //     -> parseFloat() strips trailing unit text, returns the number
  //   - Size cells have format like "10 AWG", "1/0 AWG", "350 kcmil"
  //     -> mdcSize() extracts first whitespace-delimited token: "10", "1/0", "350"
  //   - Plain text cells (project name, client): just trim
  function mdcNumber(row) {
    return parseFloat(mdc.getRange(row, C).getValue());
  }
  function mdcSize(row) {
    var v = mdc.getRange(row, C).getValue();
    var m = String(v).match(/^\S+/);
    return m ? m[0] : '';
  }
  function mdcString(row) {
    return String(mdc.getRange(row, C).getValue()).trim();
  }

  // ---- Identity
  t.assert('MDC.projectName',   'TESTPROJ-001',                 mdcString(R.PROJECT));
  t.assert('MDC.client',        'TEST CUSTOMER S.A. de C.V.',   mdcString(R.CLIENT));
  t.assert('MDC.moduleModel contains "585M"', true, mdcString(R.MODULE).indexOf('585M') !== -1);
  t.assert('MDC.qtyModules',    720,                            mdcNumber(R.QTY_MODULES));
  t.assert('MDC.qtyInverters',  4,                              mdcNumber(R.QTY_INVERTERS));
  t.assert('MDC.modsPerString', 18,                             mdcNumber(R.MODS_PER_STRING));

  // ---- DC math results
  t.assert('MDC.isc',           exp.isc,             mdcNumber(R.ISC),           tol['default']);
  t.assert('MDC.iDesign',       exp.iDesign,         mdcNumber(R.I_DESIGN),      tol['default']);
  t.assert('MDC.Ft_dc',         exp.Ft_dc,           mdcNumber(R.FT_DC),         tol['default']);
  t.assert('MDC.conductorDC',   exp.conductorDC,     mdcSize(R.COND_DC));
  t.assert('MDC.ocpdDC',        exp.ocpdDC,          mdcNumber(R.OCPD_DC));
  t.assert('MDC.vocCold',       exp.vocColdString,   mdcNumber(R.VOC_COLD),      tol['mdc']);
  t.assert('MDC.vmpHot',        exp.vmpHotString,    mdcNumber(R.VMP_HOT),       tol['mdc']);

  // ---- AC results
  t.assert('MDC.iNomAC',        expAc.iNomPerInv,    mdcNumber(R.I_AC_NOM),      tol['default']);
  t.assert('MDC.mainBreaker',   expAc.mainBreaker,   mdcNumber(R.MAIN_BREAKER));
  t.assert('MDC.parallelRuns',  expAc.parallelRuns,  mdcNumber(R.PARALLEL_RUNS));
  t.assert('MDC.condMain',      expAc.condMain,      mdcSize(R.COND_MAIN));
  t.assert('MDC.transformer',   expAc.transformer,   mdcNumber(R.TRANSFORMER));
}

// ---------------------------------------------------------------------------
// TIER 3.6 -- BOM
//
// Two layers of coverage:
//   (1) Assertions on lay.bom.* -- these are pure calcLayout engine math
//       (quantities, cable lengths, breaker/conductor sizes). Deterministic.
//   (2) writeBOM smoke test -- calls writeBOM, reads back the BOM sheet,
//       emits non-empty rows as INFO. NOT asserted yet (same pattern as
//       install cost diagnostic -- first run captures ground truth, next
//       iteration locks specific cells).
//
// Failure modes:
//   - writeBOM depends on 70M_STRUCTURE and 71M_BOS mirror sheets. If those
//     are unsynced or missing, writeBOM throws. Wrapped in try/catch so the
//     Tier 3.5 install cost diagnostic still runs.
//   - BOM sheet might not exist; writeBOM creates it if missing.
// ---------------------------------------------------------------------------
function testBomDiagnostic(t, ss, inp, panel, invBank, dc, ac, lay) {
  t.suite('Tier 3.6 -- BOM');

  if (!lay || !lay.bom) {
    t.fail('lay.bom missing', 'calcLayout did not populate lay.bom');
    return;
  }
  var bom = lay.bom;

  // ---- (1) Assertions on lay.bom engine quantities (KNOWN for TESTPROJ-001) ----
  // Note: conductor/conduit sizes are STRINGS in the engine (like '350', '1').
  // Tier 2 wraps them with String() before comparing. Doing the same here.
  t.assert('bom.dcOcpdUnits',              40,     bom.dcOcpdUnits);
  t.assert('bom.mc4Pairs',                 40,     bom.mc4Pairs);
  t.assert('bom.rsdRequired',              true,   bom.rsdRequired);
  t.assert('bom.mainBreakerA',             800,    bom.mainBreakerA);
  t.assert('bom.mainConductor',            '350',  String(bom.mainConductor));
  t.assert('bom.mainEgc',                  '1/0',  bom.mainEgc);
  t.assert('bom.mainConduit',              '4',    String(bom.mainConduit));
  t.assert('bom.transformer',              750,    bom.transformer);

  var invList = bom.acPerInverterBOM || [];
  t.assert('bom.perInverter count',        1,      invList.length);
  var inv0 = invList[0] || {};
  t.assert('bom.perInverter[0].qty',       4,      inv0.qty);
  t.assert('bom.perInverter[0].ocpdA',     175,    inv0.ocpdA);
  t.assert('bom.perInverter[0].conductorSize', '1', String(inv0.conductorSize));
  t.assert('bom.perInverter[0].egcSize',   '6',    String(inv0.egcSize));

  // ---- (2) Assertions on computed geometric quantities (baseline 2026-04-24) ----
  // Locked from the first diagnostic run. If any changes, calcLayout math moved.
  //
  // BASELINE UPDATE 2026-04-24 (bug #1 fix cascade):
  //   mainFeederCableM: 306 -> 234
  //   mainEgcM:         102 -> 78
  // Original baselines were computed when legacy readInputs had
  // `feederExtraM = parseFloat(dv(36)) || 20`. Fixture writes M36=0, which
  // was silently overridden to 20 by the `|| default` pattern (JS falsy).
  // feederLen was therefore 15+50+20=85, not 15+50+0=65. New readInput()
  // honors 0, so feederLen=65, feederCableM = 65*3*1.2 = 234 (correct).
  t.assert('bom.dcCableM',                 6720,   bom.dcCableM);
  t.assert('bom.dcGroundingM',             2500,   bom.dcGroundingM);
  t.assert('bom.dcConduitM',               84,     bom.dcConduitM);
  t.assert('bom.mainFeederCableM',         234,    bom.mainFeederCableM);
  t.assert('bom.mainEgcM',                 78,     bom.mainEgcM);
  t.assert('bom.perInverter[0].cableM',    936,    inv0.cableM);
  t.assert('bom.perInverter[0].egcM',      312,    inv0.egcM);
  t.assert('bom.areaPass',                 true,   bom.areaPass);

  // Emit same values as INFO too for readability in the results sheet
  t.info('bom.dcCableM',                   String(bom.dcCableM));
  t.info('bom.dcGroundingM',               String(bom.dcGroundingM));
  t.info('bom.dcConduitM',                 String(bom.dcConduitM));
  t.info('bom.mainFeederCableM',           String(bom.mainFeederCableM));
  t.info('bom.mainEgcM',                   String(bom.mainEgcM));
  t.info('bom.perInverter[0].cableM',      String(inv0.cableM));
  t.info('bom.perInverter[0].egcM',        String(inv0.egcM));
  t.info('bom.areaRequired',               String(bom.areaRequired));
  t.info('bom.availableSpace',             String(bom.availableSpace));
  t.info('bom.areaPass',                   String(bom.areaPass));

  // ---- (3) writeBOM smoke test ----
  try {
    writeBOM(ss, inp, panel, invBank, dc, ac, lay);
    SpreadsheetApp.flush();
  } catch (e) {
    t.error('writeBOM threw', e);
    return;
  }

  // Read back BOM sheet and emit non-empty rows as INFO.
  // BOM sheet uses fixed rows 1-90 x cols A-H (1-8).
  var sh = ss.getSheetByName('BOM');
  if (!sh) {
    t.fail('BOM sheet not found after writeBOM',
           'writeBOM should have created it if missing');
    return;
  }

  var data = sh.getRange(1, 1, 90, 8).getValues();
  var rowsWithContent = 0;
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var hasContent = false;
    for (var j = 0; j < r.length; j++) {
      if (r[j] !== '' && r[j] !== null) { hasContent = true; break; }
    }
    if (!hasContent) continue;
    rowsWithContent++;
    var desc = String(r[1] || '').substring(0, 55);
    t.info('BOM row ' + (i + 1),
           'A=' + String(r[0] || '') +
           ' | B=' + desc +
           ' | qty=' + String(r[2] || '') +
           ' | unit=' + String(r[3] || ''));
  }
  t.info('BOM rows with content', String(rowsWithContent));
  // Row-count smoke check: 44 was the OLD layout baseline (no banner).
  // New layout has banner + project meta + headers + exchange rate at rows 1-6,
  // plus ~41 content rows = ~46-48 depending on banner state. Loose range
  // catches gross writer breakage without false-failing on cosmetic shifts.
  // Re-tighten this assertion once setupBOMTemplate() establishes a clean baseline.
  t.assert('BOM rows with content in [41,50]', true,
    rowsWithContent >= 41 && rowsWithContent <= 50);

  // Read the grand total cell explicitly. Use the BOM_ROW constant so the
  // test survives any future BOM layout shifts (was hardcoded to row 77).
  var grandTotalRowIdx = BOM_ROW.GRAND_TOTAL - 1;  // 0-based for data[]
  var row77 = data[grandTotalRowIdx] || [];
  var row77Total = null;
  for (var k = 0; k < row77.length; k++) {
    if (typeof row77[k] === 'number' && row77[k] > 0) { row77Total = row77[k]; break; }
  }
  t.info('BOM row ' + BOM_ROW.GRAND_TOTAL + ' grand total', row77Total == null ? '(none found -- check template)' : String(row77Total));
  // Lock grand total at 2026-04-24 baseline.
  //
  // BASELINE UPDATE 2026-04-24 (bug #1 fix cascade):
  //   210157.4512 -> 202803.8834
  // Drop of $7353.57 comes from feeder cable 306m -> 234m (72m of 350 kcmil
  // at ~$95/m ≈ $6840) and main EGC 102m -> 78m (24m of 1/0 at ~$21/m ≈ $504),
  // plus small conduit change. See mainFeederCableM/mainEgcM note above.
  //
  // BASELINE UPDATE 2026-04-28 (08_WriteBOM_32.gs Patch 1: AC main conduit divisor):
  //   202803.8834 -> 194492.5126
  // Drop of $8,311.37 from AC main conduit qty 78 -> 26 (52 fewer 3m sticks of
  // IMC 4" at ~$160/stick ≈ $8,311). The pre-patch code did `ceil(cableM/3)`
  // which treated the 234m cable-meters (= 78m run × 3 phases) as if it were
  // run-meters, overcounting the conduit ~3×. Patch is `ceil(cableM/3/3)` —
  // matches the per-inverter pattern at 08_WriteBOM line 756. The sibling
  // tray branch (lay.bom.trayM > 0) had the same bug and was fixed identically.
  t.assert('BOM grand total (USD)', 194492.5126, row77Total, 0.01);

  // ── REGRESSION GUARD (added 2026-04-28 alongside Patch 1) ────────────────
  // The AC main conduit qty was overcounted ~3× before Patch 1. Tier 3.6 had
  // assertions on lay.bom.mainFeederCableM (the cable meters) but NONE on the
  // BOM ROW itself, so the divisor bug shipped green. This assertion locks
  // down the qty as written into the BOM sheet, computed from cable-meters
  // using the corrected divisor. If anyone removes one of the /3's in a
  // "cleanup" pass, this fails loudly.
  var acConduitRow = data[BOM_ROW.AC_CONDUIT - 1] || [];
  var acConduitQty = acConduitRow[2];   // col C (idx 2) = QTY
  var expectedConduitQty = Math.ceil(lay.bom.mainFeederCableM / 3 / 3);
  t.assert('AC main conduit qty (cableM / 3 phases / 3 m-per-stick)',
    expectedConduitQty, acConduitQty);
}


//
// Runs the full install cost pipeline against TESTPROJ-001 inputs.
// Asserts section totals, grand total, and key driver values against the
// verified baseline captured on 2026-04-23.
//
// Also emits each line item as INFO for visibility. INFO rows don't count
// as pass/fail -- they're there so anyone reviewing the results can see
// the full breakdown without having to open the INSTALLATION sheet.
//
// Baseline was produced with:
//   - INSTALL_DB.xlsx as of 2026-04-23 (46 of 53 active items apply to ROOF)
//   - TESTPROJ-001 fixture incl. M80-M83 benchmarks (0.30/0.20/0.15/0.12)
//   - Factors: ROOF, EASY, STANDARD, NO, LOCAL, NO, LOW, DRY, height 6m
//   - If any of those change, baseline must be updated.
// ---------------------------------------------------------------------------
function testInstallCostDiagnostic(t, ss, inp, invBank, dc, ac, lay) {
  t.suite('Tier 3.5 -- install cost');

  var result;
  try {
    result = runInstallCost(ss, inp, invBank, dc, ac, lay);
  } catch (e) {
    t.error('runInstallCost threw', e);
    return;
  }

  if (!result) {
    t.fail('runInstallCost returned null',
           'INSTALL_DB mirror sheets likely empty or IMPORTRANGE not synced');
    return;
  }

  // ---- Emit line items as INFO (no assertions per-item) ----
  var items = result.items || [];
  var nonZero = 0;
  var skipped = 0;
  items.forEach(function(r) {
    if (!r || !r.item) return;
    if (r.applies === false) { skipped++; return; }
    var total = r.totalMxn || 0;
    if (total <= 0) return;
    nonZero++;
    var id = r.item.id || '';
    var ct = r.item.costType || '';
    var dk = r.item.driverKey || '';
    var cf = (r.factorResult && r.factorResult.combined != null) ? r.factorResult.combined : 1.0;
    t.info(id + '  [' + ct + ']  driver=' + dk,
           'CF=' + cf.toFixed(3) +
           '  labor=' + (r.laborMxn||0).toFixed(2) +
           '  equip=' + (r.equipMxn||0).toFixed(2) +
           '  other=' + (r.otherMxn||0).toFixed(2) +
           '  TOTAL=' + total.toFixed(2) + ' MXN');
  });
  t.info('items filtered out by APPLIES_TO', skipped + ' items');
  t.info('active items contributing cost', nonZero + ' of ' + items.length);

  // ---- ASSERTIONS on section totals ----
  // Baseline captured 2026-04-23. Tolerance ±0.50 MXN absorbs floating-point.
  var sec = result.sectionTotals || {};
  function secTotal(name) { return (sec[name] && sec[name].total) || 0; }
  function secLabor(name) { return (sec[name] && sec[name].labor) || 0; }

  // BASELINE UPDATE 2026-04-24 (bug #1 fix cascade):
  //   SECTION AC:       14613.38  -> 14744.66  (+131.28)
  //   SECTION INDIRECT: 32088.02  -> 32098.52  (+10.50)
  //   GRAND TOTAL:      567731.52 -> 567873.31 (+141.79)
  // Drivers for AC install cost shifted slightly: AC_CABLE_M dropped 306->234
  // (lower AC-01 labor) but AC_TERMINATION_COUNT and feeder-derived driver
  // values recomputed with the corrected feederLen=65m. Net change is small
  // and positive on AC labor. INDIRECT (IN-01, IN-02) tracks labor+subtotal.
  //
  // BASELINE UPDATE 2026-04-28 (13_CalcInstallCost_15.gs Patch 2 & Patch 3):
  // EST_PROJECT_DAYS no longer a user input — derived from productive labor MH.
  //
  //   Patch 2 (calcInstallCost staged compute): days = ceil(productiveMH / crew / 8)
  //   Patch 3 (applyKwpBenchmarks post-bench re-derivation): days re-derived
  //     after labor-MH benchmarks scale down productive MH. Day-driven items
  //     (SF-02, SF-08, GN-03, GN-04, EQ-01, EQ-05) recomputed in place.
  //
  //   For TESTPROJ-001: productive MH after benchmarks ≈ 392, crew=6
  //     → derived days = ceil(392 / 6 / 8) = 9  (was hard-coded user input 25)
  //
  //   Section deltas:
  //     SAFETY:        129840.00  ->   70320.00  (-59520.00)
  //                    SF-02 23760, SF-08 9720 use 9 days instead of 25
  //     GENERAL SITE:  215352.00  ->  113592.00  (-101760.00)
  //                    GN-03 30240, GN-04 27000 use 9 days instead of 25
  //     EQUIPMENT:     110500.00  ->   43620.00  (-66880.00)
  //                    EQ-01 17820, EQ-05 19800 use 9 days instead of 25
  //     INDIRECT:       32098.52  ->   18165.72  (-13932.80)
  //                    IN-01 3% × (labor+equip) and IN-02 5% × subtotal both
  //                    cascade from the smaller post-day-derivation totals.
  //     GRAND TOTAL:   567873.31  ->  325780.51  (-242092.80, sum of the four)
  //
  // AC, DC, RACKING SYSTEM, CONNECTION sections are unchanged (no day-driven
  // items in those sections; benchmarks scale labor MH but those items don't
  // depend on EST_PROJECT_DAYS).
  t.assert('SECTION AC total',             14744.66,  secTotal('AC'),             0.50);
  t.assert('SECTION DC total',             23634.78,  secTotal('DC'),             0.50);
  t.assert('SECTION RACKING SYSTEM total', 12407.34,  secTotal('RACKING SYSTEM'), 0.50);
  t.assert('SECTION CONNECTION total',     29296.00,  secTotal('CONNECTION'),     0.50);
  t.assert('SECTION SAFETY total',         70320.00,  secTotal('SAFETY'),         0.50);
  t.assert('SECTION GENERAL SITE total',  113592.00,  secTotal('GENERAL SITE'),   0.50);
  t.assert('SECTION EQUIPMENT total',      43620.00,  secTotal('EQUIPMENT'),      0.50);
  t.assert('SECTION INDIRECT total',       18165.72,  secTotal('INDIRECT'),       0.50);

  // Also emit section breakdowns as INFO (for at-a-glance review in results)
  Object.keys(sec).forEach(function(name) {
    var s = sec[name];
    if (!s || (s.total || 0) <= 0) return;
    t.info('SECTION ' + name,
           'labor=' + (s.labor||0).toFixed(2) +
           '  equip=' + (s.equip||0).toFixed(2) +
           '  other=' + (s.other||0).toFixed(2) +
           '  TOTAL=' + (s.total||0).toFixed(2));
  });

  // ---- Grand total assertion ----
  // After applyKwpBenchmarks, the engine stores totals in result.totals (not result.total).
  // We compute ourselves from sectionTotals as the authoritative source.
  var computedGrand = 0;
  Object.keys(sec).forEach(function(name) { computedGrand += (sec[name] && sec[name].total) || 0; });

  t.assert('GRAND TOTAL (sum of sections)', 325780.51, computedGrand, 0.50);
  t.info('GRAND TOTAL', computedGrand.toFixed(2) + ' MXN');

  // ── REGRESSION GUARDS for Patch 2 & Patch 3 (added 2026-04-28) ───────────
  // EST_PROJECT_DAYS is no longer a user input — it must be DERIVED at calc
  // time from productive labor MH, then RE-DERIVED after kWp benchmarks scale
  // labor down. These assertions catch any future change that:
  //   - reads days from INPUT_INSTALL again (would silently use 0 or whatever)
  //   - removes the post-benchmark re-derivation in applyKwpBenchmarks
  //   - breaks the crewDays = crew × days invariant
  //
  // We read derivedDays from any day-driven item's driverQtyVal (the engine
  // sets driverQtyVal = drivers.estProjectDays inside both Stage C of
  // calcInstallCost and the post-benchmark re-derivation in applyKwpBenchmarks).
  // This avoids needing access to the drivers object directly.
  var DAY_KEYS = ['EST_PROJECT_DAYS', 'CREW_DAYS'];
  var dayItem = items.filter(function(r) {
    return r && r.item && r.item.driverKey === 'EST_PROJECT_DAYS' &&
           r.applies !== false && (r.totalMxn || 0) > 0;
  })[0];

  if (!dayItem) {
    t.fail('Patch 2/3 regression: no active EST_PROJECT_DAYS-driven item found',
           'Lib should have at least one day-driven item (SF-02/SF-08/GN-03/GN-04/EQ-01/EQ-05).');
  } else {
    var derivedDays = dayItem.driverQtyVal;

    // Productive MH = sum of mhComputed for items NOT day-driven, NOT INDIRECT.
    // This is the same calculation as Stage A in calcInstallCost and the
    // post-benchmark re-derivation in applyKwpBenchmarks.
    var productiveMH = 0;
    items.forEach(function(r) {
      if (!r || !r.item) return;
      if (r.applies === false) return;
      if (DAY_KEYS.indexOf(r.item.driverKey) !== -1) return;
      if (r.item.section === 'INDIRECT') return;
      productiveMH += (r.mhComputed || 0);
    });

    // crewSize from fixture is 6 (TESTPROJ_001.crewSize). Hardcoded here so
    // the assertion fails loudly if the fixture changes — that would be
    // intentional and the assertion would need to be updated alongside it.
    var crewSize = 6;
    var expectedDays = Math.max(1, Math.ceil(productiveMH / Math.max(crewSize, 1) / 8));

    t.info('Patch 2/3: productive MH (post-benchmark)', productiveMH.toFixed(2));
    t.info('Patch 2/3: expected derived days', String(expectedDays) +
           ' = max(1, ceil(' + productiveMH.toFixed(0) + ' / ' + crewSize + ' / 8))');

    t.assert('Patch 2: EST_PROJECT_DAYS derived from productive MH',
      expectedDays, derivedDays);

    // CREW_DAYS sync invariant. After Patch 3, drivers.crewDays MUST equal
    // crewSize × derivedDays. Read crewDays via a CREW_DAYS-driven item
    // (GN-08 in the standard lib) — same trick as above.
    var crewDaysItem = items.filter(function(r) {
      return r && r.item && r.item.driverKey === 'CREW_DAYS' &&
             r.applies !== false;
    })[0];

    if (crewDaysItem) {
      var crewDaysVal = crewDaysItem.driverQtyVal;
      t.assert('Patch 3: crewDays == crewSize × derivedDays (post-benchmark sync)',
        crewSize * derivedDays, crewDaysVal);
    } else {
      t.info('Patch 3: no active CREW_DAYS item in this fixture',
             'Skipping crewDays sync assertion (GN-08 may be filtered out).');
    }
  }
  // ── end regression guards ────────────────────────────────────────────────

  // ---- Key driver values ----
  // These are what readInstallDrivers computed. If any changes, many line
  // items change downstream -- assert them explicitly so root cause is clear.
  var moduleCount   = inp.panelQty  || 0;
  var inverterCount = invBank.reduce(function(s, i) { return s + i.qty; }, 0);
  var projectDcKwp  = dc.dcKwp || 0;
  var projectAcKw   = dc.acKwTotal || ac.acKwTotal || 0;
  var dcCableM      = (lay.bom && lay.bom.dcCableM)          || 0;
  var acCableFeederM = (lay.bom && lay.bom.mainFeederCableM) || 0;
  var arrayGrossM2  = lay.grossArea || 0;

  t.assert('driver: MODULE_COUNT',          720,     moduleCount);
  t.assert('driver: INVERTER_COUNT',        4,       inverterCount);
  t.assert('driver: PROJECT_DC_KWP',        421.2,   projectDcKwp,       0.01);
  t.assert('driver: PROJECT_AC_KW',         400,     projectAcKw,        0.01);
  t.assert('driver: DC_CABLE_M',            6720,    dcCableM,           0.50);
  t.assert('driver: ARRAY_GROSS_AREA_M2',   1900.8,  arrayGrossM2,       0.10);

  // AC_CABLE_M (feeder portion) info-only -- it's computed inside readInstallDrivers
  // as feeder + per-inverter branches, so what appears in layout.bom is the feeder
  // piece only. The branch AC gets added inside readInstallDrivers.
  t.info('driver: AC_CABLE_M (feeder only from lay.bom)', acCableFeederM.toFixed(1));

  // Per-kWp cost metric (informational)
  if (projectDcKwp > 0) {
    t.info('per kWp DC', (computedGrand / projectDcKwp).toFixed(2) + ' MXN/kWp');
  }
}

// ---------------------------------------------------------------------------
// FIXTURE BUILDERS -- synthesize objects that match TESTPROJ-001 without
// needing to read from input sheets
// ---------------------------------------------------------------------------
function buildTestInputs() {
  return {
    projectName: 'TESTPROJ-001',
    clientName: 'TEST CUSTOMER S.A. de C.V.',
    panelModel: 'LR5-72HTH 585M',
    panelQty: 720,
    panelPowerW: 585,
    inverterBank: [{ label: 'INVERTER TYPE 1:', model: 'SUN2000-100KTL-M2', qty: 4, powerKw: 100, stringsAssigned: 40 }],
    totalInverters: 4,
    totalStrings: 40,
    stringsTotal: 40,
    modsPerString: 18,
    parallelStrings: 1,
    minTemp: -1,   // spec v3 said 0 but engine's `|| -14` fallback mis-fires on 0 (JS falsy); using -1 here. See 98_TestData.gs comment.
    maxTemp: 38,
    avgTemp: 25,
    roofClearanceMm: 90,
    projectType: 'ROOF',
    supplyTransformer: 0,
    tempCoeffOverride: -0.0026,
    dcVdropLimit: 0.015,
    acVdropLimit: 0.020,
    powerFactor: 0.90,
    distCabinet: 0,
    distInverter: 50,
    distAcProt: 15,
    distGrid: 50,
    groundingLen: 2500,
    areaRequired: 0,
    availableSpace: 5000,
    aspectRatio: 1.5,
    invStations: 1,
    arrayBlocks: 1,
    layoutRows: 0, layoutCols: 0, layoutBlocks: 0,
    rowPitch: 2.0, walkwayFactor: 1.20,
    dcSpareFactor: 1.20, acSpareFactor: 1.20,
    feederExtraM: 0, stationCorridorM: 20,
    layoutMidDist: 0, layoutEndDist: 0,
    helio: [], annualProduction: 0,
    secondaryPanels: [],
    panelAreaM2: 2.583,
  };
}

function buildTestPanel() {
  return {
    'PROD_ID': 'PANEL_018',
    'PANEL_BRAND': 'LONGI SOLAR',
    'PANEL_MODEL': 'LR5-72HTH 585M',
    'PANEL_POWER_W': 585,
    'PANEL_VOC_V': 52.36,
    'PANEL_VMP_V': 44.21,
    'PANEL_ISC_A': 14.27,
    'PANEL_IMP_A': 13.24,
    'PANEL_TEMP_PMAX': -0.0029,
    'PANEL_BIFACIAL': 'NO',
    'PANEL_LENGTH': 2278,
    'PANEL_WIDTH': 1134,
    'PANEL_HEIGHT': 35,
    'PANEL_WEIGHT': 27.5,
  };
}

function buildTestInverterBank() {
  // Field names MUST match buildInverterBank() in 02_LoadDB.gs exactly.
  // Getting these wrong = silent mismatch where calc reads undefined and
  // comparisons return false. Verified against 02_LoadDB.gs line 120-161.
  return [{
    id       : 'INV_027',
    brand    : 'HUAWEI',
    model    : 'SUN2000-100KTL-M2',
    topology : 'STRING',
    mdcReady : 'VALID',
    qty             : 4,
    stringsAssigned : 40,
    // AC electrical
    acKw     : 100,
    voltage  : 480,
    phase    : 3,
    // DC voltage limits
    maxDcKw  : 150,
    maxDcV   : 1100,
    mpptVmin : 200,
    mpptVmax : 1000,
    startV   : 200,
    // MPPT structure
    mpptCount       : 10,
    inputsPerMppt   : 2,
    totalDcInputs   : 20,
    // Current limits
    iOpPerMppt  : 30,
    iScPerMppt  : 40,
    iPerInput   : 20,
    iLegacy     : 40,
    rsdCompatible: true,
    priceUsd : 4480,
  }];
}

// ---------------------------------------------------------------------------
// BACKUP / RESTORE of INPUT sheets during Tier 3
// Uses Sheet.copyTo for backup and Range.copyTo for restore so FORMULAS are
// preserved. An earlier version used getValues()/setValues() which silently
// replaced VLOOKUP formulas with their evaluated values on restore.
// ---------------------------------------------------------------------------
var TEST_BACKUP_NAMES = {
  // v2.0.3: INPUT_CFE removed from this map. It has array formulas in
  // rows 21-29 (Capacidad, Distribución, Transmisión, CENACE, Energía B/I/P,
  // SCnMEM, Suministro) that do NOT survive clearContents + copyTo cleanly.
  // INPUT_CFE backup is handled narrowly by Phase 0 itself (input rows 4-17
  // only, never the formula rows). See 99a_TestRunner_Phase0.gs.
  //
  // INPUT_GENERAL kept for back-compat with sheets that still have it;
  // missing live sheets are skipped silently by backupInputs (if(!src)).
  'INPUT_PROJECT': '_TEST_BACKUP_PROJ',
  'INPUT_DESIGN':  '_TEST_BACKUP_DES',
  'INPUT_INSTALL': '_TEST_BACKUP_INST',
  'INPUT_GENERAL': '_TEST_BACKUP_GEN'
};

function backupInputs(ss) {
  // Delete any stale backup sheets from a previous interrupted run
  Object.keys(TEST_BACKUP_NAMES).forEach(function(original) {
    var backupName = TEST_BACKUP_NAMES[original];
    var existing = ss.getSheetByName(backupName);
    if (existing) ss.deleteSheet(existing);
  });

  // Create a fresh duplicate of each input sheet. copyTo preserves formulas,
  // formats, data validation, and merged cells.
  Object.keys(TEST_BACKUP_NAMES).forEach(function(original) {
    var src = ss.getSheetByName(original);
    if (!src) return;
    var copy = src.copyTo(ss);
    copy.setName(TEST_BACKUP_NAMES[original]);
    copy.hideSheet();
  });
}

function restoreInputs(ss) {
  Object.keys(TEST_BACKUP_NAMES).forEach(function(original) {
    var backupName = TEST_BACKUP_NAMES[original];
    var backup = ss.getSheetByName(backupName);
    var dest = ss.getSheetByName(original);
    if (!backup || !dest) return;

    // Clear current content of destination (but keep validation rules + formats)
    dest.clearContents();

    // Copy backup's full used range back. copyTo includes formulas.
    var src = backup.getDataRange();
    var destRange = dest.getRange(1, 1, src.getNumRows(), src.getNumColumns());
    src.copyTo(destRange);

    // Remove the backup sheet
    ss.deleteSheet(backup);
  });
}

function writeTestInputs(ss) {
  var gen = ss.getSheetByName('INPUT_GENERAL');
  var inputs = TESTPROJ_001.inputs;
  var skipped = [];

  // NEW (Track A Phase 2a, 2026-04-24): ensure all three migrated input tabs
  // exist before writing. Writes go through writeInput() which reads coords
  // from INPUT_MAP. INPUT_GENERAL is legacy and keeps its direct A1 writes
  // for back-compat with ProjectCard / RFQ writers not yet migrated.
  try { ensureInputProjectExists(ss); }
  catch (e) { skipped.push('ensureInputProjectExists: ' + (e.message || e).slice(0, 80)); }
  try { ensureInputInstallExists(ss); }
  catch (e) { skipped.push('ensureInputInstallExists: ' + (e.message || e).slice(0, 80)); }
  try { ensureInputDesignExists(ss); }
  catch (e) { skipped.push('ensureInputDesignExists: ' + (e.message || e).slice(0, 80)); }

  if (inputs.project) {
    Object.keys(inputs.project).forEach(function(key) {
      try {
        writeInput(ss, key, inputs.project[key]);
      } catch (e) {
        skipped.push('INPUT_PROJECT:' + key + ': ' + (e.message || e).slice(0, 80));
      }
    });
  }
  if (inputs.install) {
    Object.keys(inputs.install).forEach(function(key) {
      try {
        writeInput(ss, key, inputs.install[key]);
      } catch (e) {
        skipped.push('INPUT_INSTALL:' + key + ': ' + (e.message || e).slice(0, 80));
      }
    });
  }
  // Legacy INPUT_GENERAL writes (keep for ProjectCard / RFQ writers).
  // v2.0.2: guarded — if INPUT_GENERAL has been retired on this sheet,
  // skip the legacy writes silently. New sheets use INPUT_PROJECT only.
  if (gen && inputs.general) {
    Object.keys(inputs.general).forEach(function(cell) {
      try {
        gen.getRange(cell).setValue(inputs.general[cell]);
      } catch (e) {
        skipped.push('INPUT_GENERAL!' + cell + ': ' + (e.message || e).slice(0, 80));
      }
    });
  } else if (!gen) {
    skipped.push('INPUT_GENERAL: sheet retired on this project — legacy writes skipped (v2.0.2+)');
  }
  // NEW design dict: logical keys via writeInput. Legacy A1-refs removed.
  if (inputs.design) {
    Object.keys(inputs.design).forEach(function(key) {
      try {
        writeInput(ss, key, inputs.design[key]);
      } catch (e) {
        skipped.push('INPUT_DESIGN:' + key + ': ' + (e.message || e).slice(0, 80));
      }
    });
  }

  return skipped;
}

// ---------------------------------------------------------------------------
// RESULTS WRITER
// Writes a clean _TEST_RESULTS sheet: header, summary, table.
// ---------------------------------------------------------------------------
function writeResultsSheet(ss, results, elapsedMs) {
  var sheet = ss.getSheetByName(TEST_RESULTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(TEST_RESULTS_SHEET);
  }
  sheet.clear();

  var passCount  = results.filter(function(r) { return r.status === 'PASS';  }).length;
  var failCount  = results.filter(function(r) { return r.status === 'FAIL';  }).length;
  var errorCount = results.filter(function(r) { return r.status === 'ERROR'; }).length;
  var infoCount  = results.filter(function(r) { return r.status === 'INFO';  }).length;

  // Header row 1
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  sheet.getRange('A1').setValue('ARGIA TEST RESULTS \u00B7 ' + now + ' \u00B7 ' + (elapsedMs/1000).toFixed(1) + 's');
  sheet.getRange('A1:F1').merge().setFontWeight('bold').setFontSize(12)
    .setBackground('#0D1B2A').setFontColor('#FFFFFF')
    .setHorizontalAlignment('left').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 28);

  // Summary row 2
  var assertTotal = passCount + failCount + errorCount;
  var summary = passCount + ' passed \u00B7 ' + failCount + ' failed';
  if (errorCount > 0) summary += ' \u00B7 ' + errorCount + ' error';
  if (infoCount > 0)  summary += ' \u00B7 ' + infoCount + ' info';
  summary += ' \u00B7 ' + assertTotal + ' assertions';
  sheet.getRange('A2').setValue(summary);
  sheet.getRange('A2:F2').merge().setFontSize(11)
    .setBackground(failCount + errorCount > 0 ? '#FBE9E9' : '#E8F1ED')
    .setFontColor(failCount + errorCount > 0 ? '#8F2020' : '#0F6E56')
    .setHorizontalAlignment('left').setVerticalAlignment('middle');
  sheet.setRowHeight(2, 22);

  // Column headers row 4
  var hdrRow = 4;
  var headers = ['Suite', 'Assertion', 'Status', 'Expected', 'Actual', 'Note'];
  sheet.getRange(hdrRow, 1, 1, 6).setValues([headers])
    .setFontWeight('bold').setBackground('#F5F5F5')
    .setFontColor('#555555').setFontSize(10);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 380);
  sheet.setColumnWidth(3, 70);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 140);
  sheet.setColumnWidth(6, 240);

  // Body
  if (results.length > 0) {
    var rows = results.map(function(r) {
      var statusCell;
      if      (r.status === 'PASS')  statusCell = '\u2713 PASS';
      else if (r.status === 'FAIL')  statusCell = '\u2717 FAIL';
      else if (r.status === 'ERROR') statusCell = '! ERROR';
      else if (r.status === 'INFO')  statusCell = 'i INFO';
      else statusCell = r.status;
      return [
        r.suite,
        r.label,
        statusCell,
        formatValueForCell(r.expected),
        formatValueForCell(r.actual),
        r.note || ''
      ];
    });
    var startRow = hdrRow + 1;
    sheet.getRange(startRow, 1, rows.length, 6).setValues(rows)
      .setFontSize(10).setVerticalAlignment('top');

    // Conditional formatting: color rows by status
    for (var i = 0; i < rows.length; i++) {
      var status = results[i].status;
      if (status === 'FAIL') {
        sheet.getRange(startRow + i, 1, 1, 6)
          .setBackground('#FBE9E9').setFontColor('#8F2020');
      } else if (status === 'ERROR') {
        sheet.getRange(startRow + i, 1, 1, 6)
          .setBackground('#FFF4E6').setFontColor('#8B5A0C');
      } else if (status === 'INFO') {
        sheet.getRange(startRow + i, 1, 1, 6)
          .setBackground('#F5F5F5').setFontColor('#666666');
      }
    }
    // Status column: bold
    sheet.getRange(startRow, 3, rows.length, 1).setFontWeight('bold');
  }

  sheet.setFrozenRows(hdrRow);
  sheet.activate();
}

function formatValueForCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    // Strip floating garbage: show at most 6 decimals, trim trailing zeros
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 1e6) / 1e6);
  }
  return String(v);
}