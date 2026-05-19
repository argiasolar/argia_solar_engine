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

  try { addPhase5Tests(t, ss); }
  catch (e) { t.error('Phase5 aborted', e); }
  
  try { addPhase6Tests(t, ss); }
  catch (e) { t.error('Phase6 aborted', e); }

  try { addPhase7Tests(t, ss); }
  catch (e) { t.error('Phase7 aborted', e); }

  try { addPhase8Tests(t, ss); }
  catch (e) { t.error('Phase8 aborted', e); }
  
  try { addPhase9Tests(t, ss); }
  catch (e) { t.error('Phase9 aborted', e); }

  try { addPhase9bTests(t, ss); }
  catch (e) { t.error('Phase9b aborted', e); }
  // -------------------------------------------------------------------------
  // Tier 10 -- Phase 4 BESS_SIMULATION formula-sheet regression
  // Verifies the BESS_SIMULATION sheet against a JS oracle, per month.
  // -------------------------------------------------------------------------
  try { addPhase4Tests(t, ss); }
  catch (e) { t.error('Phase4 aborted', e); }

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


// #############################################################################
// CONSOLIDATED TEST SUITES
// Merged here 2026-05-19 (repo reset). Formerly separate files:
//   99_MoreTests.js, 99b/99c/99d/99e/99f/99g_TestRunner_*.js
// #############################################################################


// ===== from 99_MoreTests.js ===============================================

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1.5 -- VALIDATION RULES
//
// Builds synthetic inp/panel/invBank objects, runs runValidation, asserts
// that the right rule code shows up in result.criticals / .majors / .warnings.
//
// Pattern: each test mutates one or two fields of a baseline object and
// confirms the targeted rule fires. We don't assert that *only* that rule
// fires (some mutations cascade -- e.g. high panelQty triggers DC-10 AND
// STR-00). The point is to catch regressions where a rule stops firing
// when it should.
//
// Note: runValidation calls engineLog() for every rule fire, so this suite
// adds ~150 lines to the LOGS sheet. Live with it -- Apps Script trims old
// log rows automatically when LOGS gets long.
// ─────────────────────────────────────────────────────────────────────────────
function testValidationRules(t, ss) {
  t.suite('Tier 1.5 -- validation rules');

  // ---- Baseline fixtures ---------------------------------------------------
  // Mirror TESTPROJ-001 enough that runValidation runs cleanly. NOT meant
  // to be the same as buildTestInputs() in 99_TestRunner.gs -- this fixture
  // is shaped for the validator's needs (helio array, inverterBank, etc.)
  // rather than the calc functions'.

  function _baseInp() {
    var helio = [];
    for (var i = 0; i < 12; i++) helio.push({ grid: 1000 + i * 50 });
    return {
      projectName: 'TESTPROJ-001',
      clientName:  'TEST CUSTOMER',
      panelModel:  'LR5-72HTH 585M',
      panelQty:    720,
      modsPerString: 18,
      stringsTotal:  40,
      parallelStrings: 1,
      minTemp: -1, maxTemp: 38, avgTemp: 25,
      dcVdropLimit: 0.015, acVdropLimit: 0.020,
      powerFactor: 0.90,
      helio: helio,
      inverterBank: [],   // filled in by run-time mutator from invBank
    };
  }

  function _basePanel() {
    return {
      'PANEL_VOC_V': 52.36, 'PANEL_VMP_V': 44.21,
      'PANEL_ISC_A': 14.27, 'PANEL_TEMP_PMAX': -0.0029,
      'PANEL_POWER_W': 585
    };
  }

  function _baseInvBank() {
    return [{
      model: 'SUN2000-100KTL-M2',
      qty: 4, stringsAssigned: 40,
      acKw: 100, voltage: 480,
      maxDcV: 1100, mpptVmin: 200, mpptVmax: 1000,
      totalDcInputs: 20,
      topology: 'STRING', mdcReady: 'VALID'
    }];
  }

  // Real NOM constants from the active workbook. Hard limits like dcAcHard
  // come from here -- using the live values means our tests stay aligned
  // with whatever NOM_DB says, instead of hardcoding numbers that drift.
  var nom;
  try { nom = loadNomConstants(ss); }
  catch (e) { t.error('Tier 1.5 setup', e); return; }

  // ---- Helper: run validation and assert rule firings ---------------------
  function check(label, mutator, expect) {
    var inp = _baseInp();
    var panel = _basePanel();
    var invBank = _baseInvBank();
    inp.inverterBank = invBank;   // validator iterates this
    if (mutator) mutator({ inp: inp, panel: panel, invBank: invBank, nom: nom });

    var r;
    try { r = runValidation(ss, inp, panel, invBank, nom); }
    catch (e) { t.error('VAL [' + label + '] threw', e); return; }

    function has(arr, code) {
      return arr.some(function(x) { return x.rule === code; });
    }

    (expect.criticals || []).forEach(function(code) {
      t.assertTrue('VAL [' + label + '] CRIT ' + code, has(r.criticals, code));
    });
    (expect.majors || []).forEach(function(code) {
      t.assertTrue('VAL [' + label + '] MAJOR ' + code, has(r.majors, code));
    });
    (expect.warnings || []).forEach(function(code) {
      t.assertTrue('VAL [' + label + '] WARN ' + code, has(r.warnings, code));
    });
  }

  // ---- GROUP 1: input completeness ---------------------------------------
  check('empty projectName',
    function(o) { o.inp.projectName = ''; },
    { majors: ['INP-01'] });

  check('empty clientName',
    function(o) { o.inp.clientName = ''; },
    { majors: ['INP-02'] });

  check('empty panelModel',
    function(o) { o.inp.panelModel = ''; },
    { criticals: ['INP-03'] });

  check('panelQty zero',
    function(o) { o.inp.panelQty = 0; },
    { criticals: ['INP-04'] });

  check('modsPerString zero',
    function(o) { o.inp.modsPerString = 0; },
    { criticals: ['INP-05'] });

  check('no inverters',
    function(o) { o.inp.inverterBank = []; o.invBank.length = 0; },
    { criticals: ['INP-06'] });

  check('both temps zero (likely unentered)',
    function(o) { o.inp.minTemp = 0; o.inp.maxTemp = 0; },
    { majors: ['INP-07'] });

  check('min temp >= max temp',
    function(o) { o.inp.minTemp = 50; o.inp.maxTemp = 38; },
    { criticals: ['INP-08'] });

  // ---- GROUP 2: panel data completeness ----------------------------------
  check('panel Voc zero',
    function(o) { o.panel['PANEL_VOC_V'] = 0; },
    { criticals: ['PNL-01'] });

  check('panel Vmp zero',
    function(o) { o.panel['PANEL_VMP_V'] = 0; },
    { criticals: ['PNL-02'] });

  check('panel Isc zero',
    function(o) { o.panel['PANEL_ISC_A'] = 0; },
    { criticals: ['PNL-03'] });

  check('panel temp coeff positive (sign error)',
    function(o) { o.panel['PANEL_TEMP_PMAX'] = 0.001; },
    { majors: ['PNL-04'] });

  check('panel power zero',
    function(o) { o.panel['PANEL_POWER_W'] = 0; },
    { criticals: ['PNL-05'] });

  // ---- GROUP 3: inverter data completeness -------------------------------
  check('inverter maxDcV zero',
    function(o) { o.invBank[0].maxDcV = 0; },
    { criticals: ['INV-01'] });

  check('inverter mpptVmin zero',
    function(o) { o.invBank[0].mpptVmin = 0; },
    { criticals: ['INV-02'] });

  check('inverter mpptVmin >= mpptVmax',
    function(o) { o.invBank[0].mpptVmin = 1100; o.invBank[0].mpptVmax = 1000; },
    { criticals: ['INV-03'] });

  check('inverter qty zero',
    function(o) { o.invBank[0].qty = 0; },
    { criticals: ['INV-06'] });

  check('strings assigned > available DC inputs',
    function(o) { o.invBank[0].stringsAssigned = 200; },  // 200 > 20 inputs * 4 inv = 80
    { criticals: ['STR-02'] });

  check('inverter optimizer topology fires warning',
    function(o) { o.invBank[0].topology = 'OPTIMIZER'; },
    { warnings: ['INV-08'] });

  // ---- GROUP 4: voltage range pre-check ----------------------------------
  // At minTemp=-1, vocPerMod = 56.31. maxDcV=1100. 56.31 * 22 = 1238.8 > 1100
  // so DC-01 fires when modsPerString=22.
  check('DC-01: too many mods/string (Voc cold > Vmax)',
    function(o) { o.inp.modsPerString = 22; },
    { criticals: ['DC-01'] });

  // ---- GROUP 5: DC/AC ratio ----------------------------------------------
  // panelQty 2500 * 585W = 1462.5 kWp / 400 kWac = 3.66 -- way above any
  // sane dcAcHard. Will also cascade to STR-00 (mods derived from strings
  // doesn't match) -- we only assert DC-10.
  check('DC-10: ratio exceeds hard max',
    function(o) { o.inp.panelQty = 2500; },
    { criticals: ['DC-10'] });

  // ---- GROUP 6: string count consistency ---------------------------------
  // stringsTotal=50 but only 40 assigned to the inverter -> STR-00 major.
  check('STR-00: stringsTotal != sum of assigned',
    function(o) { o.inp.stringsTotal = 50; },
    { majors: ['STR-00'] });

  // ---- GROUP 7: helioscope production ------------------------------------
  check('HEL-01: helio incomplete (< 12 months)',
    function(o) { o.inp.helio = [{ grid: 100 }]; },
    { majors: ['HEL-01'] });

  // ---- GROUP 8: design limits --------------------------------------------
  // 0.10 = 10% DC vdrop is well above any sane NOM hard cap (typically 0.02-0.03).
  check('LIM-01: dcVdropLimit > NOM hard',
    function(o) { o.inp.dcVdropLimit = 0.10; },
    { criticals: ['LIM-01'] });

  // 0.20 = 20% AC vdrop similarly.
  check('LIM-02: acVdropLimit > NOM hard',
    function(o) { o.inp.acVdropLimit = 0.20; },
    { criticals: ['LIM-02'] });

  check('LIM-03: powerFactor out of range',
    function(o) { o.inp.powerFactor = 0.5; },
    { majors: ['LIM-03'] });
}


// ─────────────────────────────────────────────────────────────────────────────
// TIER 3.7 -- PROJECT CARD writer
//
// Verifies the Phase A rewrite of readPcInputs_() reads INPUT_PROJECT cells
// correctly via INPUT_MAP, and that writeProjectCard renders the expected
// header / business case rows.
//
// Runs after writeMDC + writeBOM + runInstallCost have populated their
// sheets, so PC's downstream readBomSubtotals_/readInstallTotal_ have data.
// ─────────────────────────────────────────────────────────────────────────────
function testProjectCardSmoke(t, ss, inp, panel, invBank, dc) {
  t.suite('Tier 3.7 -- project card');

  // ---- 1. readPcInputs_ shape and fixture-derived values ------------------
  var pcInp;
  try { pcInp = readPcInputs_(ss); }
  catch (e) { t.error('readPcInputs_ threw', e); return; }

  // Fields the fixture explicitly writes (deterministic):
  t.assert('PC.projectNumber',  'ARG-TEST-001', pcInp.projectNumber);
  t.assert('PC.marginPct',      0.15,           pcInp.marginPct,    0.001);
  t.assert('PC.paymentDays',    14,             pcInp.paymentDays);

  // Field the fixture does NOT write (sellingPriceUsdPerWp). readPcInputs_'s
  // n() helper coerces blank to 0. This locks the new default-handling logic.
  t.assert('PC.sellingPriceWpUsd defaults to 0',
    0, pcInp.sellingPriceWpUsd);

  // Validation envelope: 9 categories, each a {min, max} pair.
  t.assertTrue('PC.validation has TOTAL',
    pcInp.validation && !!pcInp.validation['TOTAL']);
  t.assertTrue('PC.validation Solar panels min > 0',
    pcInp.validation['Solar panels'] && pcInp.validation['Solar panels'].min > 0);
  t.assertTrue('PC.validation Solar panels max > min',
    pcInp.validation['Solar panels'].max > pcInp.validation['Solar panels'].min);

  // ---- 2. writeProjectCard runs -------------------------------------------
  try {
    writeProjectCard(ss, inp, panel, invBank, dc);
    SpreadsheetApp.flush();
  } catch (e) {
    t.error('writeProjectCard threw', e);
    return;
  }

  // ---- 3. PROJECT_CARD sheet content --------------------------------------
  var pc = ss.getSheetByName('PROJECT_CARD');
  if (!pc) {
    t.fail('PROJECT_CARD sheet not found', 'after writeProjectCard');
    return;
  }

  // B1 = title bar. D1 = projectNumber. Rows 4/5 = customer/project name.
  // (BUSINESS CASE header at row 3, then Customer/Project name/Location at 4/5/6.)
  t.assert('PC sheet B1 title',
    'PROJECT CARD', String(pc.getRange(1, 2).getValue()));
  t.assert('PC sheet D1 projectNumber',
    'ARG-TEST-001', String(pc.getRange(1, 4).getValue()));
  t.assert('PC sheet C4 clientName',
    'TEST CUSTOMER S.A. de C.V.', String(pc.getRange(4, 3).getValue()));
  t.assert('PC sheet C5 projectName',
    'TESTPROJ-001', String(pc.getRange(5, 3).getValue()));
}


// ─────────────────────────────────────────────────────────────────────────────
// TIER 3.8 -- RFQ writer
//
// Calls writeRfqSheet_() directly for each of the 5 categories, mirroring
// what runWriteAllRFQs() does internally. Bypasses the UI dialog wrapper
// so the test stays headless. Verifies each sheet exists, has reasonable
// row count, and has at least the expected number of items pulled from BOM.
//
// Depends on testBomDiagnostic having populated the BOM sheet earlier in
// the same testEndToEnd run.
// ─────────────────────────────────────────────────────────────────────────────
function testRfqSmoke(t, ss, inp, panel, invBank) {
  t.suite('Tier 3.8 -- RFQs');

  if (!ss.getSheetByName(SH.BOM)) {
    t.fail('Tier 3.8 skipped', 'BOM sheet not present');
    return;
  }

  // RFQ writer expects inp.projectManager populated. Mirror runWriteAllRFQs's
  // chain. If readPcInputs_ fails here for any reason, fall through to the
  // designer/bizManager fields, then a hardcoded last-resort.
  try {
    var pcIn = readPcInputs_(ss);
    inp.projectManager = pcIn.projectManager || inp.designer || inp.bizManager || 'TEST PM';
  } catch (e) {
    inp.projectManager = inp.designer || inp.bizManager || 'TEST PM';
  }

  // 5 categories. Match the row ranges and codes from runWriteAllRFQs.
  // expectMin = lower bound on number of items pulled for this category from
  // TESTPROJ-001 BOM. Loose -- anything <= the actual count works.
  var cases = [
    {
      sheet: RFQ_SHEETS.PANELES,    title: 'Paneles Solares',     code: 'PAN',
      start: BOM_ROW.PANEL_PRIMARY, end: BOM_ROW.SUBTOTAL_PANELS - 1,
      ccy: 'USD', expectMinItems: 1
    },
    {
      sheet: RFQ_SHEETS.INVERSORES, title: 'Inversores',          code: 'INV',
      start: BOM_ROW.INVERTER_PRIMARY, end: BOM_ROW.SUBTOTAL_INVERTERS - 1,
      ccy: 'USD', expectMinItems: 1
    },
    {
      sheet: RFQ_SHEETS.ESTRUCTURA, title: 'Estructura',          code: 'STR',
      start: BOM_ROW.STRUCTURE_PRIMARY, end: BOM_ROW.STRUCTURE_INVERTER,
      ccy: 'MXN', expectMinItems: 1
    },
    {
      // ELECTRICO is special -- it's DC + AC concatenated.
      sheet: RFQ_SHEETS.ELECTRICO,  title: 'Electrico BOS',       code: 'ELEC',
      ccy: 'MXN', expectMinItems: 5,
      special: 'elec'
    },
    {
      sheet: RFQ_SHEETS.MONITOREO,  title: 'Monitoreo',           code: 'MON',
      start: BOM_ROW.MON_DATALOGGER, end: BOM_ROW.MON_THERMOGRAPHY,
      ccy: 'MXN', expectMinItems: 1
    },
  ];

  cases.forEach(function(c) {
    var items;
    if (c.special === 'elec') {
      var dcItems = readBomItems_(ss, BOM_ROW.DC_CABLE,  BOM_ROW.SUBTOTAL_DC - 1);
      var acItems = readBomItems_(ss, BOM_ROW.AC_FEEDER, BOM_ROW.SUBTOTAL_TRANSFORMER - 1);
      items = dcItems.concat(acItems);
    } else {
      items = readBomItems_(ss, c.start, c.end);
    }

    t.assertTrue('RFQ ' + c.sheet + ' BOM items >= ' + c.expectMinItems,
      items.length >= c.expectMinItems);

    try {
      // Empty cert/notes objects -- cosmetic in the RFQ output, irrelevant
      // to whether the sheet got written. We're testing the writer mechanics,
      // not the cert text.
      writeRfqSheet_(ss, c.sheet, inp, c.title, c.code, items, {}, '', c.ccy);
    } catch (e) {
      t.error('writeRfqSheet_ ' + c.sheet, e);
      return;
    }

    var rfq = ss.getSheetByName(c.sheet);
    t.assertTrue('RFQ ' + c.sheet + ' sheet exists', rfq !== null);
    if (!rfq) return;

    // Each RFQ has metadata block (~5 rows) + headers + items + supplier
    // response section (~10 rows) + footer. Sane minimum is around 15.
    t.assertTrue('RFQ ' + c.sheet + ' has > 15 rows of content',
      rfq.getLastRow() > 15);

    // Title bar at row 1 should mention the category.
    var titleCell = String(rfq.getRange(1, 1).getValue() || '');
    t.assertTrue('RFQ ' + c.sheet + ' title contains "REQUEST FOR QUOTATION"',
      titleCell.indexOf('REQUEST FOR QUOTATION') !== -1);
  });

  SpreadsheetApp.flush();
}


// ─────────────────────────────────────────────────────────────────────────────
// TIER 3.5b -- INSTALL COST line items
//
// Locks the totals of 6 representative line items as a regression check.
// These items each represent a different cost type (productivity-driven
// labor, day-derived labor, indirect %, equipment) and a different section.
// If any of them drifts, the failing assertion tells you EXACTLY which
// dimension of the install cost calc moved.
//
// Baseline values captured 2026-04-28 from the green test run.
// ─────────────────────────────────────────────────────────────────────────────
function testInstallCostLineItems(t, ss, items) {
  t.suite('Tier 3.5b -- install cost line items');

  function findItem(id) {
    return items.filter(function(r) {
      return r && r.item && r.item.id === id;
    })[0];
  }

  // Each lock pins a TOTAL_MXN for one line item. Tolerance 0.50 MXN
  // matches the section assertions.
  var locks = [
    { id: 'AC-01', total:  2346.69, label: 'AC cable productivity' },
    { id: 'DC-01', total:  8424.00, label: 'DC modules productivity' },
    { id: 'DC-03', total:  4545.21, label: 'DC cable productivity' },
    { id: 'RK-01', total: 10516.72, label: 'Racking modules' },
    { id: 'SF-02', total: 23760.00, label: 'Safety days (Patch 3 derived)' },
    { id: 'IN-02', total: 15380.74, label: 'Indirect % of subtotal' },
  ];

  locks.forEach(function(L) {
    var item = findItem(L.id);
    if (!item) {
      t.fail('LineItem ' + L.id, 'not found in result.items (item filtered out or lib changed)');
      return;
    }
    t.assert('LineItem ' + L.id + ' (' + L.label + ') TOTAL',
      L.total, item.totalMxn || 0, 0.50);
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// TIER 3.6b -- BOM cell qtys
//
// Locks specific BOM-sheet QTY cells (column C) for the main line items.
// Complements the existing Tier 3.6 lay.bom.* assertions: if calcLayout
// math is right but the writer puts numbers in the wrong row, those tier 3.6
// tests pass and the BOM is still wrong. These tests catch that.
//
// Baseline values captured 2026-04-28 from the green test run.
// ─────────────────────────────────────────────────────────────────────────────
function testBomLineItems(t, ss) {
  t.suite('Tier 3.6b -- BOM cell qtys');

  var sh = ss.getSheetByName(SH.BOM);
  if (!sh) {
    t.fail('Tier 3.6b skipped', 'BOM sheet not found');
    return;
  }

  // Row -> expected qty in column C (BOM_COL.QTY).
  var locks = [
    { row: BOM_ROW.PANEL_PRIMARY,    qty: 720,  label: 'panels qty' },
    { row: BOM_ROW.INVERTER_PRIMARY, qty: 4,    label: 'inverter qty' },
    { row: BOM_ROW.STRUCTURE_PRIMARY, qty: 720, label: 'panel structure qty' },
    { row: BOM_ROW.DC_CABLE,         qty: 6720, label: 'DC cable m' },
    { row: BOM_ROW.DC_GROUNDING,     qty: 2500, label: 'DC grounding m' },
    { row: BOM_ROW.DC_MC4,           qty: 40,   label: 'DC MC4 pairs' },
    { row: BOM_ROW.DC_OCPD,          qty: 40,   label: 'DC OCPD' },
    { row: BOM_ROW.AC_FEEDER,        qty: 234,  label: 'AC feeder cable m' },
    { row: BOM_ROW.AC_EGC,           qty: 78,   label: 'AC main EGC m' },
    { row: BOM_ROW.AC_BREAKER,       qty: 1,    label: 'AC main breaker' },
  ];

  locks.forEach(function(L) {
    var got = sh.getRange(L.row, BOM_COL.QTY).getValue();
    var gotNum = parseFloat(got);
    if (isNaN(gotNum)) {
      t.fail('BOM row ' + L.row + ' qty (' + L.label + ')',
        'cell is non-numeric: ' + JSON.stringify(got));
      return;
    }
    t.assert('BOM row ' + L.row + ' qty (' + L.label + ')', L.qty, gotNum);
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Tier 1.6 — resolveStructure() unit tests (synthetic DB)
// ─────────────────────────────────────────────────────────────────────────────
// Pure-function tests of the structure resolver. No live workbook needed —
// builds a synthetic DB inline so we can exercise edge cases (collisions,
// legacy free-text, malformed dropdown text) deterministically.
//
// Why this lives in 99a, not 99: it depends on 08_WriteBOM.gs being loaded
// (resolveStructure() is defined there). 99a runs after 99 so this is fine.
// ─────────────────────────────────────────────────────────────────────────────
function testResolveStructure(t) {
  t.suite('Tier 1.6 -- resolveStructure unit');

  // Synthetic DB shaped like loadStructureDb output. STR_COL_ID/BRAND/MODEL/
  // PRICE indices match the live DB (0/1/2/12).
  function row(id, brand, model, priceUsd) {
    var r = new Array(20);
    for (var i = 0; i < 20; i++) r[i] = '';
    r[0]  = id;
    r[1]  = brand;
    r[2]  = model;
    r[12] = priceUsd;
    return { _raw: r };
  }
  var db = [
    row('STR_001', 'ALUMINEX',  'CARPORT ALU',     45),
    row('STR_008', 'S-5',       'STRUCTURE KR18',  18),
    row('STR_018', 'UNIRAC',    'COPLANAR',        12),
    row('STR_007', 'RALUX',     'RIEL COPLANAR',   16),
    // Synthetic collision: same model name across two brands.
    row('STR_099', 'BRAND_A',   'GENERIC RAIL',    20),
    row('STR_100', 'BRAND_B',   'GENERIC RAIL',    25),
  ];

  // ---- Path 1: canonical "BRAND — MODEL — STR_ID" ------------------------
  var r1 = resolveStructure(db, 'S-5 — STRUCTURE KR18 — STR_008');
  t.assert('canonical: strId',   'STR_008',         r1 ? r1.strId    : null);
  t.assert('canonical: brand',   'S-5',             r1 ? r1.brand    : null);
  t.assert('canonical: model',   'STRUCTURE KR18',  r1 ? r1.model    : null);
  t.assert('canonical: price',   18,                r1 ? r1.priceUsd : null);

  // STR_ID-tail wins even if the brand/model in the prefix is wrong.
  // Defensive: handles the case where a user manually edited C15 and the
  // model/brand text drifted but the trailing ID is still good.
  var r2 = resolveStructure(db, 'WRONG BRAND — WRONG MODEL — STR_001');
  t.assert('tail-wins: strId',    'STR_001',     r2 ? r2.strId : null);
  t.assert('tail-wins: brand',    'ALUMINEX',    r2 ? r2.brand : null);

  // ---- Path 2: brand+model 2-part split ----------------------------------
  var r3 = resolveStructure(db, 'UNIRAC — COPLANAR');
  t.assert('2-part: strId',       'STR_018',     r3 ? r3.strId : null);

  // Disambiguates collisions correctly via brand
  var r4a = resolveStructure(db, 'BRAND_A — GENERIC RAIL');
  var r4b = resolveStructure(db, 'BRAND_B — GENERIC RAIL');
  t.assert('collision A: strId',  'STR_099',     r4a ? r4a.strId : null);
  t.assert('collision B: strId',  'STR_100',     r4b ? r4b.strId : null);

  // ---- Path 3: legacy free-text (model only) -----------------------------
  // Preserves projects whose C15 has not been re-picked from the new dropdown.
  var r5 = resolveStructure(db, 'STRUCTURE KR18');
  t.assert('legacy: strId',       'STR_008',     r5 ? r5.strId : null);

  // Case insensitive
  var r6 = resolveStructure(db, 'structure kr18');
  t.assert('legacy lowercase',    'STR_008',     r6 ? r6.strId : null);

  // Legacy free-text with collision: returns first match in DB order. This is
  // the inherent limitation of model-only matching and the reason for the new
  // dropdown — the test pins behaviour so future refactors don't change it.
  var r7 = resolveStructure(db, 'GENERIC RAIL');
  t.assert('legacy collision (first match)', 'STR_099', r7 ? r7.strId : null);

  // ---- Failure cases ------------------------------------------------------
  t.assert('null input',          null,  resolveStructure(db, null));
  t.assert('empty string',        null,  resolveStructure(db, ''));
  t.assert('whitespace only',     null,  resolveStructure(db, '   '));
  t.assert('no match',            null,  resolveStructure(db, 'NONEXISTENT BRAND — FOO — STR_999'));
  t.assert('empty DB',            null,  resolveStructure([], 'S-5 — STRUCTURE KR18 — STR_008'));
}


// ===== from 99b_TestRunner_Phase1.js ======================================

// ---------------------------------------------------------------------------
// PUBLIC ENTRY POINT
// ---------------------------------------------------------------------------
function addPhase1Tests(t, ss) {
  testCalcCfeBillWithPvAvailable(t);
  testCalcCfeBillBaselineUnchanged(t);
  testCalcCfeBillScenarios(t);
}

// ---------------------------------------------------------------------------
// SUITE 1: AVAILABILITY
// Confirms the new functions and constants exist. Cheap fail-fast — if this
// fails, suite 2 and 3 would crash with cryptic errors.
// ---------------------------------------------------------------------------
function testCalcCfeBillWithPvAvailable(t) {
  t.suite('Phase1: calcCfeBillWithPv availability');

  t.assertTrue('calcCfeBillWithPv function defined',
               typeof calcCfeBillWithPv === 'function');
  t.assertTrue('calcCfeBillWithPvAnnual function defined',
               typeof calcCfeBillWithPvAnnual === 'function');
  t.assertTrue('CFE_MODE constants defined',
               typeof CFE_MODE === 'object' && CFE_MODE !== null);
  if (typeof CFE_MODE === 'object' && CFE_MODE !== null) {
    t.assert('CFE_MODE.MEDICION_NETA',    'MEDICION_NETA',    CFE_MODE.MEDICION_NETA);
    t.assert('CFE_MODE.FACTURACION_NETA', 'FACTURACION_NETA', CFE_MODE.FACTURACION_NETA);
    t.assert('CFE_MODE.SIN_EXPORTACION',  'SIN_EXPORTACION',  CFE_MODE.SIN_EXPORTACION);
  }
}

// ---------------------------------------------------------------------------
// SUITE 2: BASELINE UNCHANGED
// v2.1.0 adds capability but must NOT change existing v2.0.4 behavior.
// This suite proves the no-PV path is byte-identical to v2.0.4.
// ---------------------------------------------------------------------------
function testCalcCfeBillBaselineUnchanged(t) {
  t.suite('Phase1: baseline unchanged from v2.0.4');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p1_buildSynth001JanInputObject();

  // Direct call to v2.0.4 calcCfeBill — must still match v2.0.4 lock
  var direct = calcCfeBill(inp, snap.frozenTariffs);
  t.assert('calcCfeBill(no PV) Jan still matches v2.0.4 lock',
           snap.janBillFrozen, direct.total, snap.janBillFrozenTol);

  // Wrapper with no PV (undefined) must equal direct call exactly
  var noPv = calcCfeBillWithPv(inp, snap.frozenTariffs, undefined);
  t.assert('calcCfeBillWithPv(inp, tar, undefined) == calcCfeBill(inp, tar)',
           direct.total, noPv.total, 0.0001);

  // Wrapper with monthlyKwh=0 must also equal direct
  var zeroPv = calcCfeBillWithPv(inp, snap.frozenTariffs, { monthlyKwh: 0 });
  t.assert('calcCfeBillWithPv with monthlyKwh=0 == no-PV path',
           direct.total, zeroPv.total, 0.0001);
}

// ---------------------------------------------------------------------------
// SUITE 3: SCENARIOS
// Three interconnection modes against locked targets.
// ---------------------------------------------------------------------------
function testCalcCfeBillScenarios(t) {
  t.suite('Phase1: interconnection-mode scenarios');

  var snap      = TESTPROJ_SYNTH_001.expected.snapshot;
  var scenarios = TESTPROJ_SYNTH_001.scenarios;
  var inp       = _p1_buildSynth001JanInputObject();
  var tol       = snap.pvScenarioTol;

  if (!scenarios) {
    t.fail('scenarios block exists', 'TESTPROJ_SYNTH_001.scenarios is missing');
    return;
  }

  // Loop through all three scenarios
  ['NM', 'FN', 'SE'].forEach(function(key) {
    var scn = scenarios[key];
    if (!scn) {
      t.fail('scenario ' + key + ' exists', 'missing from fixture');
      return;
    }

    var result;
    try {
      result = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv);
    } catch (e) {
      t.fail('scenario ' + key + ' runs without error', String(e));
      return;
    }

    // Jan bill assertion
    t.assert(key + ': Jan bill (' + scn.label.slice(0, 40) + ')',
             scn.expected.janBill, result.total, tol);

    // Per-scenario extras
    if (scn.expected.janSelfKwh != null) {
      t.assert(key + ': selfConsumedKwh',
               scn.expected.janSelfKwh, result.selfConsumedKwh, 0.01);
    }
    if (scn.expected.janExportKwh != null) {
      t.assert(key + ': exportedKwh',
               scn.expected.janExportKwh, result.exportedKwh, 0.01);
    }
    if (scn.expected.janCredit != null) {
      t.assert(key + ': exportCredit',
               scn.expected.janCredit, result.exportCredit, 0.01);
    }

    // Annual = 12 × Jan (synthetic identity)
    var monthlyInputs = _p1_buildSynth001AllMonthsInputArray();
    var annual = calcCfeBillWithPvAnnual(monthlyInputs, snap.frozenTariffs, scn.pv);
    t.assert(key + ': annual = 12 × Jan',
             scn.expected.annualBill, annual, tol * 12);
  });

  // Algebraic sanity: FN.total + FN.credit ≈ SE.total
  // (same self-consumption, same load, only differ by whether export pays back)
  try {
    var fn = calcCfeBillWithPv(inp, snap.frozenTariffs, scenarios.FN.pv);
    var se = calcCfeBillWithPv(inp, snap.frozenTariffs, scenarios.SE.pv);
    t.assert('algebraic: FN.total + FN.credit == SE.total',
             se.total, fn.total + fn.exportCredit, 0.01);
  } catch (e) {
    t.fail('algebraic sanity', String(e));
  }

  // Edge case: unknown mode must throw
  var threw = false;
  try {
    calcCfeBillWithPv(inp, snap.frozenTariffs, {
      monthlyKwh: 25000, interconnectionMode: 'NOT_A_MODE',
    });
  } catch (e) { threw = true; }
  t.assertTrue('unknown mode throws', threw);

  // Edge case: out-of-range self-consumption must throw
  var threwPct = false;
  try {
    calcCfeBillWithPv(inp, snap.frozenTariffs, {
      monthlyKwh: 25000,
      interconnectionMode: CFE_MODE.FACTURACION_NETA,
      selfConsumptionPct: 1.5,
    });
  } catch (e) { threwPct = true; }
  t.assertTrue('out-of-range selfConsumptionPct throws', threwPct);
}

// ---------------------------------------------------------------------------
// Helpers (Phase 1 owns its own copy of these to keep phases decoupled).
// Function names prefixed _p1_ to avoid collision with Phase 0's identically-
// purposed helpers — Apps Script files share a global namespace, so two
// functions with the same name in different files create an unpredictable
// last-loaded-wins situation.
// ---------------------------------------------------------------------------
function _p1_buildSynth001JanInputObject() {
  var m = TESTPROJ_SYNTH_001.inputs.cfe.monthly;
  return {
    kWhBase:       m.kWhBase[0],
    kWhIntermedia: m.kWhIntermedia[0],
    kWhPunta:      m.kWhPunta[0],
    kWBase:        m.kWBase[0],
    kWIntermedia:  m.kWIntermedia[0],
    kWPunta:       m.kWPunta[0],
    kWMaxAnoMovil: m.kWMaxAnoMovil[0],
    kVArh:         m.kVArh[0],
    tarifa:          'GDMTH',
    dap:             0,
    bajaTension2pct: false,
  };
}

function _p1_buildSynth001AllMonthsInputArray() {
  var m = TESTPROJ_SYNTH_001.inputs.cfe.monthly;
  var arr = [];
  for (var i = 0; i < 12; i++) {
    arr.push({
      kWhBase:       m.kWhBase[i],
      kWhIntermedia: m.kWhIntermedia[i],
      kWhPunta:      m.kWhPunta[i],
      kWBase:        m.kWBase[i],
      kWIntermedia:  m.kWIntermedia[i],
      kWPunta:       m.kWPunta[i],
      kWMaxAnoMovil: m.kWMaxAnoMovil[i],
      kVArh:         m.kVArh[i],
      tarifa:          'GDMTH',
      dap:             0,
      bajaTension2pct: false,
    });
  }
  return arr;
}


// ===== from 99c_TestRunner_Phase2.js ======================================

function addPhase12Tests(t, ss) {
  testFpThresholdBackwardCompat(t);
  testFpThresholdSweep(t);
  testFpThresholdPvIntegration(t);
}

// ---------------------------------------------------------------------------
// SUITE 1: BACKWARD COMPATIBILITY
// v2.1.2 must NOT change any existing v2.0.4 / v2.1.0 baseline behavior.
// ---------------------------------------------------------------------------
function testFpThresholdBackwardCompat(t) {
  t.suite('Phase1.2: PF threshold backward compatibility');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p12_buildSynth001JanInputObject();

  // Default behavior (no options) must match v2.0.4 lock
  var rDefault = calcCfeBill(inp, snap.frozenTariffs);
  t.assert('calcCfeBill(inp, tar) with no options matches v2.0.4 lock',
           snap.janBillFrozen, rDefault.total, snap.janBillFrozenTol);

  // Explicit fpThreshold=0.90 must equal default
  var r090 = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: 0.90 });
  t.assert('calcCfeBill(inp, tar, {fpThreshold:0.90}) equals default',
           rDefault.total, r090.total, 0.0001);

  // Empty options object must equal default
  var rEmpty = calcCfeBill(inp, snap.frozenTariffs, {});
  t.assert('calcCfeBill(inp, tar, {}) equals default',
           rDefault.total, rEmpty.total, 0.0001);

  // Annual wrapper with no options
  var monthlyInputs = _p12_buildSynth001AllMonthsInputArray();
  var annualDefault = calcCfeBillAnnual(monthlyInputs, snap.frozenTariffs);
  t.assert('calcCfeBillAnnual(no options) matches v2.0.4 lock',
           snap.annualBillFrozen, annualDefault, snap.annualBillFrozenTol);
}

// ---------------------------------------------------------------------------
// SUITE 2: PF THRESHOLD PARAMETER SWEEP
// Three scenarios (T=0.90, 0.95, 0.97) all with SYNTH-001 base inputs.
// Tests the configurable threshold against Python-derived lock targets.
// ---------------------------------------------------------------------------
function testFpThresholdSweep(t) {
  t.suite('Phase1.2: PF threshold parameter sweep');

  var snap      = TESTPROJ_SYNTH_001.expected.snapshot;
  var scenarios = TESTPROJ_SYNTH_001.fpThresholdScenarios;
  var inp       = _p12_buildSynth001JanInputObject();

  if (!scenarios) {
    t.fail('fpThresholdScenarios exists',
           'TESTPROJ_SYNTH_001.fpThresholdScenarios is missing');
    return;
  }

  // Tolerance for FP-related assertions
  var TOL = 0.10;
  var ANNUAL_TOL = 1.2;

  ['T_090', 'T_095', 'T_097'].forEach(function(key) {
    var scn = scenarios[key];
    if (!scn) {
      t.fail('scenario ' + key + ' exists', 'missing from fixture');
      return;
    }

    var result;
    try {
      result = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: scn.fpThreshold });
    } catch (e) {
      t.fail('scenario ' + key + ' runs without error', String(e));
      return;
    }

    var labelShort = key + ' (T=' + scn.fpThreshold + ')';
    t.assert(labelShort + ': Jan bill total',
             scn.expected.janBill, result.total, TOL);
    t.assert(labelShort + ': Cargo FP',
             scn.expected.cargoFp, result.cargoFp, TOL);

    // Annual = 12 × Jan (synthetic identity)
    var monthlyInputs = _p12_buildSynth001AllMonthsInputArray();
    var annual = calcCfeBillAnnual(monthlyInputs, snap.frozenTariffs,
                                    { fpThreshold: scn.fpThreshold });
    t.assert(labelShort + ': annual = 12 × Jan',
             scn.expected.annual, annual, ANNUAL_TOL);
  });

  // Sanity: T=0.95 bill > T=0.90 bill (penalty kicks in)
  var r090 = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: 0.90 });
  var r095 = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: 0.95 });
  var r097 = calcCfeBill(inp, snap.frozenTariffs, { fpThreshold: 0.97 });
  t.assertTrue('monotonic: T=0.95 bill > T=0.90 bill',
               r095.total > r090.total);
  t.assertTrue('monotonic: T=0.97 bill > T=0.95 bill',
               r097.total > r095.total);
}

// ---------------------------------------------------------------------------
// SUITE 3: PV PATH FORWARDS OPTIONS
// calcCfeBillWithPv should forward options.fpThreshold to its internal
// calcCfeBill call. Verify by comparing FN scenario at T=0.90 vs T=0.95.
// ---------------------------------------------------------------------------
function testFpThresholdPvIntegration(t) {
  t.suite('Phase1.2: PV path forwards fpThreshold');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var scn  = TESTPROJ_SYNTH_001.scenarios && TESTPROJ_SYNTH_001.scenarios.FN;
  if (!scn) {
    t.fail('scenarios.FN exists', 'missing from fixture');
    return;
  }
  var inp = _p12_buildSynth001JanInputObject();

  // Default (no options) — must match Phase 1 FN lock
  var fnDefault = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv);
  t.assert('FN with no options matches Phase 1 lock',
           snap.janBillFNFrozen, fnDefault.total, snap.pvScenarioTol);

  // T=0.95 — bill should be HIGHER (PF penalty kicks in)
  var fn095 = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv,
                                 { fpThreshold: 0.95 });
  t.assertTrue('FN at T=0.95 bill > FN at T=0.90 (penalty applied)',
               fn095.total > fnDefault.total);

  // T=0.97 — even higher
  var fn097 = calcCfeBillWithPv(inp, snap.frozenTariffs, scn.pv,
                                 { fpThreshold: 0.97 });
  t.assertTrue('FN at T=0.97 bill > FN at T=0.95',
               fn097.total > fn095.total);
}

// ---------------------------------------------------------------------------
// Helpers — Phase 1.2 owns its own copies to keep phases decoupled.
// Function names prefixed _p12_ to avoid collision with Phase 0/1 helpers.
// ---------------------------------------------------------------------------
function _p12_buildSynth001JanInputObject() {
  var m = TESTPROJ_SYNTH_001.inputs.cfe.monthly;
  return {
    kWhBase:       m.kWhBase[0],
    kWhIntermedia: m.kWhIntermedia[0],
    kWhPunta:      m.kWhPunta[0],
    kWBase:        m.kWBase[0],
    kWIntermedia:  m.kWIntermedia[0],
    kWPunta:       m.kWPunta[0],
    kWMaxAnoMovil: m.kWMaxAnoMovil[0],
    kVArh:         m.kVArh[0],
    tarifa:          'GDMTH',
    dap:             0,
    bajaTension2pct: false,
  };
}

function _p12_buildSynth001AllMonthsInputArray() {
  var m = TESTPROJ_SYNTH_001.inputs.cfe.monthly;
  var arr = [];
  for (var i = 0; i < 12; i++) {
    arr.push({
      kWhBase:       m.kWhBase[i],
      kWhIntermedia: m.kWhIntermedia[i],
      kWhPunta:      m.kWhPunta[i],
      kWBase:        m.kWBase[i],
      kWIntermedia:  m.kWIntermedia[i],
      kWPunta:       m.kWPunta[i],
      kWMaxAnoMovil: m.kWMaxAnoMovil[i],
      kVArh:         m.kVArh[i],
      tarifa:          'GDMTH',
      dap:             0,
      bajaTension2pct: false,
    });
  }
  return arr;
}


// ===== from 99d_TestRunner_Phase1_4.js ====================================

function addPhase14Tests(t, ss) {
  testPhase14ModeDefaults(t);
  testPhase14IntermediaOnly(t);
  testPhase14FpThresholdInPvPath(t);
}

// ---------------------------------------------------------------------------
// SUITE 1: MODE-AWARE SELF_PCT DEFAULTS
// Verifies the ISBLANK semantics per mode.
// ---------------------------------------------------------------------------
function testPhase14ModeDefaults(t) {
  t.suite('Phase1.4: mode-aware self_pct defaults');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p14_buildSynth001JanInputObject();

  // NM: selfPct always 1.0 regardless of input
  var nmBlank = calcCfeBillWithPv(inp, snap.frozenTariffs, {
    monthlyKwh: 25000, interconnectionMode: 'MEDICION_NETA'
  });
  t.assert('NM with blank selfPct → forced 100%',
           1.0, nmBlank.selfConsumptionPctUsed, 0.0001);

  // SE with blank: defaults 100%
  var seBlank = calcCfeBillWithPv(inp, snap.frozenTariffs, {
    monthlyKwh: 25000, interconnectionMode: 'SIN_EXPORTACION'
  });
  t.assert('SE with blank selfPct → defaults 100% (v2.1.4 NEW)',
           1.0, seBlank.selfConsumptionPctUsed, 0.0001);

  // SE with explicit 0.70
  var seExplicit = calcCfeBillWithPv(inp, snap.frozenTariffs, {
    monthlyKwh: 25000, interconnectionMode: 'SIN_EXPORTACION',
    selfConsumptionPct: 0.70
  });
  t.assert('SE with explicit selfPct=0.70 → uses 0.70',
           0.70, seExplicit.selfConsumptionPctUsed, 0.0001);

  // FN with blank: defaults 70%
  var fnBlank = calcCfeBillWithPv(inp, snap.frozenTariffs, {
    monthlyKwh: 25000, interconnectionMode: 'FACTURACION_NETA',
    exportPriceMxnPerKwh: 0.80
  });
  t.assert('FN with blank selfPct → defaults 70% (industry standard)',
           0.70, fnBlank.selfConsumptionPctUsed, 0.0001);

  // FN with explicit 0.70
  var fnExplicit = calcCfeBillWithPv(inp, snap.frozenTariffs, {
    monthlyKwh: 25000, interconnectionMode: 'FACTURACION_NETA',
    exportPriceMxnPerKwh: 0.80, selfConsumptionPct: 0.70
  });
  t.assert('FN with explicit selfPct=0.70 → uses 0.70',
           0.70, fnExplicit.selfConsumptionPctUsed, 0.0001);

  // FN with blank and FN with explicit 0.70 produce identical results
  t.assert('FN blank == FN explicit(0.70) total',
           fnBlank.total, fnExplicit.total, 0.01);
}

// ---------------------------------------------------------------------------
// SUITE 2: INTERMEDIA-ONLY CASCADE FOR SE/FN
// Verifies the new v2.1.4 cascade semantics:
//   - Only kWhIntermedia is reduced by PV
//   - kWhBase and kWhPunta remain unchanged
// ---------------------------------------------------------------------------
function testPhase14IntermediaOnly(t) {
  t.suite('Phase1.4: intermedia-only cascade for SE/FN');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p14_buildSynth001JanInputObject();
  var TOL  = 0.10;

  // Get lock targets from fixture
  var sce = TESTPROJ_SYNTH_001.scenarios;

  // FN at explicit 0.70 → matches v2.1.4 lock 82,377.81
  var fnResult = calcCfeBillWithPv(inp, snap.frozenTariffs, sce.FN.pv);
  t.assert('FN explicit Jan bill matches v2.1.4 lock',
           sce.FN.expected.janBill, fnResult.total, TOL);

  // SE at explicit 0.70 → matches v2.1.4 lock 88,377.81
  var seResult = calcCfeBillWithPv(inp, snap.frozenTariffs, sce.SE.pv);
  t.assert('SE explicit Jan bill matches v2.1.4 lock',
           sce.SE.expected.janBill, seResult.total, TOL);

  // SE default (100%) is LOWER than SE explicit (70%) — more displacement
  var seDefaultResult = calcCfeBillWithPv(inp, snap.frozenTariffs, sce.SE_default.pv);
  t.assert('SE_default Jan bill matches v2.1.4 lock',
           sce.SE_default.expected.janBill, seDefaultResult.total, TOL);
  t.assertTrue('SE_default < SE_explicit (more PV at 100% vs 70%)',
               seDefaultResult.total < seResult.total);

  // FN bill (with credit) < SE bill (no credit) at same self_pct
  t.assertTrue('FN total < SE total at same self_pct (export credit)',
               fnResult.total < seResult.total);

  // SE pre-export equals SE total (no credit applied)
  t.assert('SE billPreExport == SE total',
           seResult.billPreExport, seResult.total, 0.01);

  // FN exported kWh = monthlyKwh - selfConsumed (intermedia bound)
  t.assert('FN selfConsumed = MIN(kWhIntermedia, selfPct × monthlyKwh)',
           Math.min(inp.kWhIntermedia, 0.70 * 25000),
           fnResult.selfConsumedKwh, 0.01);
  t.assert('FN exported = monthlyKwh - selfConsumed',
           25000 - fnResult.selfConsumedKwh,
           fnResult.exportedKwh, 0.01);
}

// ---------------------------------------------------------------------------
// SUITE 3: FP THRESHOLD PROPAGATES THROUGH PV PATH
// Verifies that options.fpThreshold flows from calcCfeBillWithPv to
// the inner calcCfeBill, affecting Cargo FP in all three modes.
// ---------------------------------------------------------------------------
function testPhase14FpThresholdInPvPath(t) {
  t.suite('Phase1.4: FP threshold through PV path');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p14_buildSynth001JanInputObject();
  var sce = TESTPROJ_SYNTH_001.scenarios;

  // For each mode, threshold=0.95 should produce HIGHER bill than 0.90
  // (penalty bites when PV reduces kWh enough to drop PF below 0.95)
  ['NM', 'FN', 'SE'].forEach(function(modeName) {
    var pv = sce[modeName].pv;
    var t090 = calcCfeBillWithPv(inp, snap.frozenTariffs, pv, { fpThreshold: 0.90 });
    var t095 = calcCfeBillWithPv(inp, snap.frozenTariffs, pv, { fpThreshold: 0.95 });
    t.assertTrue(modeName + ': T=0.95 total > T=0.90 total (penalty applied)',
                 t095.total > t090.total);
  });
}

// ---------------------------------------------------------------------------
// Helpers — phase 1.4 owns its own copy.
// ---------------------------------------------------------------------------
function _p14_buildSynth001JanInputObject() {
  var m = TESTPROJ_SYNTH_001.inputs.cfe.monthly;
  return {
    kWhBase:       m.kWhBase[0],
    kWhIntermedia: m.kWhIntermedia[0],
    kWhPunta:      m.kWhPunta[0],
    kWBase:        m.kWBase[0],
    kWIntermedia:  m.kWIntermedia[0],
    kWPunta:       m.kWPunta[0],
    kWMaxAnoMovil: m.kWMaxAnoMovil[0],
    kVArh:         m.kVArh[0],
    tarifa:          'GDMTH',
    dap:             0,
    bajaTension2pct: false,
  };
}


// ===== from 99e_TestRunner_phase2.js ======================================

function addPhase2Tests(t, ss) {
  testPhase2Availability(t);
  testPhase2StrategyB(t);
  testPhase2DisabledPaths(t);
  testPhase2Validation(t);
}

// ---------------------------------------------------------------------------
// SUITE 1: AVAILABILITY
// ---------------------------------------------------------------------------
function testPhase2Availability(t) {
  t.suite('Phase2: BESS function availability');

  t.assert('calcBessImpact function defined',
           'function', typeof calcBessImpact);
  t.assert('calcBessImpactAnnual function defined',
           'function', typeof calcBessImpactAnnual);
  t.assert('BESS_STRATEGY constants defined',
           'object', typeof BESS_STRATEGY);
  t.assert('BESS_STRATEGY.SELF_CONSUMPTION_MAX value',
           'SELF_CONSUMPTION_MAX', BESS_STRATEGY.SELF_CONSUMPTION_MAX);
}

// ---------------------------------------------------------------------------
// SUITE 2: STRATEGY B MATH — three modes × multiple assertions
// ---------------------------------------------------------------------------
function testPhase2StrategyB(t) {
  t.suite('Phase2: Strategy B math vs Python locks');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p2_buildSynth001JanInputObject();
  var bs = TESTPROJ_SYNTH_001.bessScenarios;
  var TOL = 0.10;

  // FN-mode scenario
  var fnExp = bs.BESS_FN_70.expected;
  var fnRes = calcBessImpact(inp, snap.frozenTariffs, bs.BESS_FN_70.pv, bs.BESS_FN_70.bess);
  t.assert('FN: bessUsableCapacityKwh',     fnExp.bessUsableCapacityKwh,     fnRes.bessUsableCapacityKwh, 0.01);
  t.assert('FN: bessMonthlyThroughputKwh',  fnExp.bessMonthlyThroughputKwh,  fnRes.bessMonthlyThroughputKwh, 0.01);
  t.assert('FN: pvExportedKwh',             fnExp.pvExportedKwh,             fnRes.pvExportedKwh, 0.01);
  t.assert('FN: pvCapturedByBessKwh',       fnExp.pvCapturedByBessKwh,       fnRes.pvCapturedByBessKwh, 0.01);
  t.assert('FN: blendedAvoidedTariff',      fnExp.blendedAvoidedTariffMxnPerKwh, fnRes.blendedAvoidedTariffMxnPerKwh, 0.0001);
  t.assert('FN: pvCaptureValueMxn',         fnExp.pvCaptureValueMxn,         fnRes.pvCaptureValueMxn, TOL);
  t.assert('FN: billAfterPv',               fnExp.billAfterPv,               fnRes.billAfterPv, TOL);
  t.assert('FN: billAfterPvAndBess',        fnExp.billAfterPvAndBess,        fnRes.billAfterPvAndBess, TOL);
  t.assert('FN: strategyUsed',              'SELF_CONSUMPTION_MAX',          fnRes.strategyUsed);
  t.assert('FN: bessEnabled true',          true,                            fnRes.bessEnabled);

  // SE-mode scenario
  var seExp = bs.BESS_SE.expected;
  var seRes = calcBessImpact(inp, snap.frozenTariffs, bs.BESS_SE.pv, bs.BESS_SE.bess);
  t.assert('SE: pvCapturedByBessKwh',       seExp.pvCapturedByBessKwh,       seRes.pvCapturedByBessKwh, 0.01);
  t.assert('SE: pvCaptureValueMxn',         seExp.pvCaptureValueMxn,         seRes.pvCaptureValueMxn, TOL);
  t.assert('SE: billAfterPvAndBess',        seExp.billAfterPvAndBess,        seRes.billAfterPvAndBess, TOL);
  t.assertTrue('SE savings > FN savings (no export credit subtracted)',
               seRes.pvCaptureValueMxn > fnRes.pvCaptureValueMxn);

  // NM-mode scenario (no exported energy)
  var nmExp = bs.BESS_NM.expected;
  var nmRes = calcBessImpact(inp, snap.frozenTariffs, bs.BESS_NM.pv, bs.BESS_NM.bess);
  t.assert('NM: pvExportedKwh = 0',         nmExp.pvExportedKwh,             nmRes.pvExportedKwh, 0.01);
  t.assert('NM: pvCapturedByBessKwh = 0',   nmExp.pvCapturedByBessKwh,       nmRes.pvCapturedByBessKwh, 0.01);
  t.assert('NM: pvCaptureValueMxn = 0',     nmExp.pvCaptureValueMxn,         nmRes.pvCaptureValueMxn, 0.01);
  t.assert('NM: billAfterPvAndBess = billAfterPv (no BESS effect)',
           nmExp.billAfterPvAndBess,        nmRes.billAfterPvAndBess, TOL);

  // Annual aggregation
  var monthlyInputs = [];
  var DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (var i = 0; i < 12; i++) {
    monthlyInputs.push(Object.assign({}, inp, { daysInMonth: DAYS[i] }));
  }
  var annual = calcBessImpactAnnual(monthlyInputs, snap.frozenTariffs,
                                     bs.BESS_FN_70.pv, bs.BESS_FN_70.bess);
  t.assert('FN: annualBillAfterPvAndBess (varying days)',
           fnExp.annualBillAfterPvAndBess, annual, TOL * 12);
}

// ---------------------------------------------------------------------------
// SUITE 3: DISABLED PATHS — null bess, zero capacity, etc.
// ---------------------------------------------------------------------------
function testPhase2DisabledPaths(t) {
  t.suite('Phase2: BESS disabled paths');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p2_buildSynth001JanInputObject();
  var bs = TESTPROJ_SYNTH_001.bessScenarios;
  var TOL = 0.10;

  // Null bess
  var nullRes = calcBessImpact(inp, snap.frozenTariffs, bs.BESS_NULL.pv, bs.BESS_NULL.bess);
  t.assert('Null bess: bessEnabled false',  false, nullRes.bessEnabled);
  t.assert('Null bess: billAfterPvAndBess = billAfterPv',
           bs.BESS_NULL.expected.billAfterPv, nullRes.billAfterPvAndBess, TOL);
  t.assert('Null bess: pvCaptureValueMxn = 0',  0, nullRes.pvCaptureValueMxn, 0.01);

  // Zero capacity
  var zeroRes = calcBessImpact(inp, snap.frozenTariffs,
                                bs.BESS_ZERO_CAPACITY.pv, bs.BESS_ZERO_CAPACITY.bess);
  t.assert('Zero cap: bessEnabled false',  false, zeroRes.bessEnabled);
  t.assert('Zero cap: billAfterPvAndBess = billAfterPv',
           bs.BESS_ZERO_CAPACITY.expected.billAfterPvAndBess, zeroRes.billAfterPvAndBess, TOL);
}

// ---------------------------------------------------------------------------
// SUITE 4: VALIDATION — bad inputs throw
// ---------------------------------------------------------------------------
function testPhase2Validation(t) {
  t.suite('Phase2: BESS input validation');

  var snap = TESTPROJ_SYNTH_001.expected.snapshot;
  var inp  = _p2_buildSynth001JanInputObject();
  var pvFn = TESTPROJ_SYNTH_001.bessScenarios.BESS_FN_70.pv;
  var bessOk = TESTPROJ_SYNTH_001.bessScenarios.BESS_FN_70.bess;

  // Unsupported strategy throws
  var threw = false;
  try {
    calcBessImpact(inp, snap.frozenTariffs, pvFn,
                   Object.assign({}, bessOk, { strategy: 'PEAK_SHAVING' }));
  } catch (e) { threw = true; }
  t.assertTrue('Unsupported strategy (PEAK_SHAVING) throws', threw);

  // Out-of-range minSocPct throws
  threw = false;
  try {
    calcBessImpact(inp, snap.frozenTariffs, pvFn,
                   Object.assign({}, bessOk, { minSocPct: 1.5 }));
  } catch (e) { threw = true; }
  t.assertTrue('minSocPct > 1 throws', threw);

  // maxSoc <= minSoc throws
  threw = false;
  try {
    calcBessImpact(inp, snap.frozenTariffs, pvFn,
                   Object.assign({}, bessOk, { minSocPct: 0.9, maxSocPct: 0.1 }));
  } catch (e) { threw = true; }
  t.assertTrue('maxSocPct <= minSocPct throws', threw);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _p2_buildSynth001JanInputObject() {
  var m = TESTPROJ_SYNTH_001.inputs.cfe.monthly;
  return {
    kWhBase:       m.kWhBase[0],
    kWhIntermedia: m.kWhIntermedia[0],
    kWhPunta:      m.kWhPunta[0],
    kWBase:        m.kWBase[0],
    kWIntermedia:  m.kWIntermedia[0],
    kWPunta:       m.kWPunta[0],
    kWMaxAnoMovil: m.kWMaxAnoMovil[0],
    kVArh:         m.kVArh[0],
    tarifa:          'GDMTH',
    dap:             0,
    bajaTension2pct: false,
  };
}


// ===== from 99f_TestRunner_Phase3.js ======================================

function addPhase3Tests(t, ss) {
  testPhase3Availability(t);
  testPhase3PeakShavingMath(t);
  testPhase3Ratchet(t);
  testPhase3Provenance(t);
  testPhase3DisabledAndValidation(t);
}

// ---------------------------------------------------------------------------
// SUITE 1: AVAILABILITY
// ---------------------------------------------------------------------------
function testPhase3Availability(t) {
  t.suite('Phase3: PEAK_SHAVING availability');

  t.assert('calcPeakShavingImpact defined',
           'function', typeof calcPeakShavingImpact);
  t.assert('_bessUsableKwh helper defined',
           'function', typeof _bessUsableKwh);
  t.assert('BESS_STRATEGY.PEAK_SHAVING enabled',
           'PEAK_SHAVING', BESS_STRATEGY.PEAK_SHAVING);
  // HYBRID must remain undefined — deferred to v2.4.0.
  t.assert('BESS_STRATEGY.HYBRID NOT enabled (deferred v2.4.0)',
           'undefined', typeof BESS_STRATEGY.HYBRID);
}

// ---------------------------------------------------------------------------
// SUITE 2: PEAK_SHAVING MATH — normal run, three savings tiers
// ---------------------------------------------------------------------------
function testPhase3PeakShavingMath(t) {
  t.suite('Phase3: PEAK_SHAVING math vs locks (TESTPROJ_PEAK_001)');

  var fx  = TESTPROJ_PEAK_001;
  var exp = fx.expected;
  var res = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, fx.bess);
  var TOL = 0.10;

  t.assert('strategyUsed = PEAK_SHAVING',
           'PEAK_SHAVING', res.strategyUsed);
  t.assert('bessEnabled true', true, res.bessEnabled);
  t.assert('usableKwh',          exp.usableKwh,        res.usableKwh,        0.01);
  t.assert('shaveKw',            exp.shaveKw,          res.shaveKw,          0.01);
  t.assert('dmaxPuntaUsed',      exp.dmaxPuntaUsed,    res.dmaxPuntaUsed,    0.01);
  t.assert('postBessPuntaKw',    exp.postBessPuntaKw,  res.postBessPuntaKw,  0.01);

  // Tier 1 — verifiable
  t.assert('Capacidad saving Year-1',
           exp.capacidadSavingYear1,    res.capacidadSavingYear1,    TOL);
  t.assert('Distribucion saving Year-1 (0 — intermedia is monthly max)',
           exp.distribucionSavingYear1, res.distribucionSavingYear1, TOL);
  t.assert('Verifiable saving Year-1',
           exp.verifiableSavingYear1,   res.verifiableSavingYear1,   TOL);

  // Tier 2 — estimated
  t.assert('Energy shifted kWh',
           exp.energyShiftedKwh,        res.energyShiftedKwh,        TOL);
  t.assert('Variable saving (estimated)',
           exp.variableSavingEstimated, res.variableSavingEstimated, TOL);

  t.assert('Total saving Year-1 (verifiable + variable)',
           exp.totalSavingYear1,        res.totalSavingYear1,        TOL);
  t.assert('baselineBill',
           exp.baselineBill,            res.baselineBill,            TOL);
  t.assert('billAfterPeakShavingYear1 = baseline - totalYear1',
           exp.baselineBill - exp.totalSavingYear1,
           res.billAfterPeakShavingYear1, TOL);
}

// ---------------------------------------------------------------------------
// SUITE 3: RATCHET — Year-1 vs steady-state
// ---------------------------------------------------------------------------
function testPhase3Ratchet(t) {
  t.suite('Phase3: ratchet (Year-1 vs steady-state)');

  var fx  = TESTPROJ_PEAK_001;
  var exp = fx.expected;
  var res = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, fx.bess);
  var TOL = 0.10;

  t.assert('Capacidad saving steady-state',
           exp.capacidadSavingSteady,  res.capacidadSavingSteady,  TOL);
  t.assert('Verifiable saving steady-state',
           exp.verifiableSavingSteady, res.verifiableSavingSteady, TOL);
  t.assert('Ratchet delta (steady - year1)',
           exp.ratchetDelta,
           res.verifiableSavingSteady - res.verifiableSavingYear1, TOL);

  // The ratchet MUST bite in this fixture — steady strictly exceeds Year-1.
  // If this fails, the fixture no longer exercises the ratchet (regression).
  t.assertTrue('Ratchet bites: steady saving > Year-1 saving',
               res.verifiableSavingSteady > res.verifiableSavingYear1);
  // Year-1 is the conservative headline — never larger than steady.
  t.assertTrue('Year-1 headline <= steady-state (conservative)',
               res.verifiableSavingYear1 <= res.verifiableSavingSteady);
}

// ---------------------------------------------------------------------------
// SUITE 4: PROVENANCE + DISCLAIMERS
// ---------------------------------------------------------------------------
function testPhase3Provenance(t) {
  t.suite('Phase3: demand provenance + disclaimers');

  var fx = TESTPROJ_PEAK_001;

  // Normal run — kWPunta present → measured, no loud disclaimer.
  var measured = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, fx.bess);
  t.assert('Measured provenance (kWPunta in INPUT_CFE)',
           'measured(INPUT_CFE)', measured.demandProvenance);
  t.assertFalse('No synthesized-demand disclaimer on measured path',
                measured.synthesizedDemandDisclaimer);

  // Tier 2 disclaimer is ALWAYS true — Variable is structurally estimated.
  t.assertTrue('Estimated-tier disclaimer always present',
               measured.estimatedTierDisclaimer);

  // Synthesis last-resort — kWPunta removed → loud disclaimer fires.
  var noDemand = Object.assign({}, fx.janInput, { kWPunta: 0 });
  var synth = calcPeakShavingImpact(noDemand, fx.frozenTariffs, fx.bess);
  t.assert('Synthesized provenance when no demand data',
           'synthesized(no demand data)', synth.demandProvenance);
  t.assertTrue('Loud synthesized-demand disclaimer fires',
               synth.synthesizedDemandDisclaimer);

  // Override path — explicit dmaxPuntaOverride wins over INPUT_CFE kWPunta.
  var ovBess = Object.assign({}, fx.bess, { dmaxPuntaOverride: 366 });
  var ov = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, ovBess);
  t.assert('Override provenance',
           'measured(override)', ov.demandProvenance);
  t.assert('Override dmaxPuntaUsed honored',
           366, ov.dmaxPuntaUsed, 0.01);

  // Option-1 guard: synthesized estimate must NEVER silently replace a
  // metered kWPunta. With kWPunta present, provenance must be measured.
  t.assertFalse('Synthesis does NOT run when metered kWPunta exists',
                measured.synthesizedDemandDisclaimer);
}

// ---------------------------------------------------------------------------
// SUITE 5: DISABLED + VALIDATION PATHS
// ---------------------------------------------------------------------------
function testPhase3DisabledAndValidation(t) {
  t.suite('Phase3: disabled + validation paths');

  var fx = TESTPROJ_PEAK_001;
  var TOL = 0.10;

  // Null bess → no-op, returns baseline.
  var nullRes = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, null);
  t.assertFalse('Null bess: bessEnabled false', nullRes.bessEnabled);
  t.assert('Null bess: billAfter = baseline',
           nullRes.baselineBill, nullRes.billAfterPeakShavingYear1, TOL);
  t.assert('Null bess: verifiable saving 0',
           0, nullRes.verifiableSavingYear1, 0.01);

  // Zero capacity → no-op.
  var zeroBess = Object.assign({}, fx.bess, { capacityKwh: 0 });
  var zeroRes = calcPeakShavingImpact(fx.janInput, fx.frozenTariffs, zeroBess);
  t.assertFalse('Zero capacity: bessEnabled false', zeroRes.bessEnabled);
  t.assert('Zero capacity: total saving 0',
           0, zeroRes.totalSavingYear1, 0.01);

  // Invalid SoC window throws.
  var threw = false;
  try {
    calcPeakShavingImpact(fx.janInput, fx.frozenTariffs,
      Object.assign({}, fx.bess, { minSocPct: 0.9, maxSocPct: 0.1 }));
  } catch (e) { threw = true; }
  t.assertTrue('maxSocPct <= minSocPct throws', threw);

  // Out-of-range rtePct throws.
  threw = false;
  try {
    calcPeakShavingImpact(fx.janInput, fx.frozenTariffs,
      Object.assign({}, fx.bess, { rtePct: 1.5 }));
  } catch (e) { threw = true; }
  t.assertTrue('rtePct > 1 throws', threw);

  // Missing puntaWindowHours throws.
  threw = false;
  try {
    calcPeakShavingImpact(fx.janInput, fx.frozenTariffs,
      Object.assign({}, fx.bess, { puntaWindowHours: 0 }));
  } catch (e) { threw = true; }
  t.assertTrue('puntaWindowHours <= 0 throws', threw);
}


// ===== from 99g_TestRunner_Phase4.js ======================================

function addPhase4Tests(t, ss) {
  t.suite('Phase4: BESS_SIMULATION sheet formulas');

  if (!ss) {
    t.info('Phase4 skipped', 'no spreadsheet context');
    return;
  }
  var required = ['INPUT_CFE', 'INPUT_BESS', 'INPUT_PROJECT', 'INPUT_DESIGN',
                  'CFE_SIMULATION', 'BESS_SIMULATION'];
  for (var i = 0; i < required.length; i++) {
    if (!ss.getSheetByName(required[i])) {
      t.fail('Phase4: required sheet missing — ' + required[i]);
      return;
    }
  }

  var snap = null;
  try {
    snap = _p4_snapshotInputs(ss);
    _p4_writeFixture(ss);
    SpreadsheetApp.flush();                 // force CFE_SIM + BESS_SIM recalc

    _p4_testNoErrorCells(t, ss);
    _p4_testBatteryInvariants(t, ss);
    _p4_testReconciliations(t, ss);
    _p4_testWaterfallAddsUp(t, ss);
    _p4_testSelectionAware(t, ss);
    _p4_testJsOracleCrossCheck(t, ss);

  } catch (e) {
    t.error('Phase4 aborted', e);
  } finally {
    if (snap) {
      try {
        _p4_restoreInputs(ss, snap);
        SpreadsheetApp.flush();
        t.info('Phase4 cleanup', 'input sheets restored to pre-test state');
      } catch (e2) {
        t.fail('Phase4 CLEANUP FAILED — restore your inputs manually: ' + e2.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SNAPSHOT / RESTORE — protect the user's real project data.
// We snapshot the full used range of each input sheet (values + formulas).
// ---------------------------------------------------------------------------
function _p4_snapshotInputs(ss) {
  var names = ['INPUT_CFE', 'INPUT_BESS', 'INPUT_PROJECT', 'INPUT_DESIGN'];
  var snap = {};
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    var r = Math.max(sh.getLastRow(), 1);
    var c = Math.max(sh.getLastColumn(), 1);
    snap[names[i]] = {
      rows: r, cols: c,
      formulas: sh.getRange(1, 1, r, c).getFormulas(),
      values:   sh.getRange(1, 1, r, c).getValues(),
    };
  }
  return snap;
}

function _p4_restoreInputs(ss, snap) {
  var names = ['INPUT_CFE', 'INPUT_BESS', 'INPUT_PROJECT', 'INPUT_DESIGN'];
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    var s = snap[names[i]];
    var rng = sh.getRange(1, 1, s.rows, s.cols);
    // Restore formulas where present, else values (mirrors writeTestInputs
    // discipline — a formula cell must get its formula back, not its value).
    var out = [];
    for (var r = 0; r < s.rows; r++) {
      var row = [];
      for (var c = 0; c < s.cols; c++) {
        var f = s.formulas[r][c];
        row.push(f !== '' ? f : s.values[r][c]);
      }
      out.push(row);
    }
    rng.setValues(out);
  }
}

// ---------------------------------------------------------------------------
// WRITE FIXTURE — put TESTPROJ_PEAK_001 into the real input sheets.
//   INPUT_CFE   : 12 months of identical demand/energy = the fixture's Jan
//   INPUT_BESS  : battery specs + PEAK_SHAVING strategy + section-4 fields
//   INPUT_PROJECT: battery toggle D64 = YES
// The fixture is the SAME TESTPROJ_PEAK_001 used by Phase 3, so the two
// suites are checking the identical scenario from two angles (JS / sheet).
// ---------------------------------------------------------------------------
function _p4_writeFixture(ss) {
  var fx  = TESTPROJ_PEAK_001;
  var jan = fx.janInput;
  var b   = fx.bess;

  // ---- INPUT_PROJECT: battery ON ----
  ss.getSheetByName('INPUT_PROJECT').getRange('D64').setValue('YES');

  // ---- INPUT_CFE: 12 identical months in C..N ----
  // Rows (per the live sheet): 10 kWh base, 11 kWh inter, 12 kWh punta,
  // 13 kW base, 14 kW inter, 15 kW punta, 17 kVArh.
  var cfe = ss.getSheetByName('INPUT_CFE');
  var rowMap = [
    { row: 10, val: jan.kWhBase },
    { row: 11, val: jan.kWhIntermedia },
    { row: 12, val: jan.kWhPunta },
    { row: 13, val: jan.kWBase },
    { row: 14, val: jan.kWIntermedia },
    { row: 15, val: jan.kWPunta },
    { row: 17, val: jan.kVArh },
  ];
  for (var i = 0; i < rowMap.length; i++) {
    var twelve = [];
    for (var m = 0; m < 12; m++) twelve.push(rowMap[i].val);
    cfe.getRange(rowMap[i].row, 3, 1, 12).setValues([twelve]);
  }

  // ---- INPUT_BESS: battery specs + PEAK_SHAVING ----
  var ib = ss.getSheetByName('INPUT_BESS');
  ib.getRange('C6').setValue('CUSTOM_MANUAL');   // manual battery
  ib.getRange('C7').setValue('PEAK_SHAVING');    // strategy
  ib.getRange('C10').setValue(b.capacityKwh);    // capacidad nominal kWh
  ib.getRange('C11').setValue(b.powerKw);        // potencia kW
  ib.getRange('C12').setValue(b.minSocPct);      // min SoC
  ib.getRange('C13').setValue(b.maxSocPct);      // max SoC
  ib.getRange('C14').setValue(b.rtePct);         // RTE
  ib.getRange('C15').setValue(b.cyclesPerDay);   // ciclos/dia
  ib.getRange('C16').setValue(b.degradationPct); // degradacion
  // Section 4 (v2.3.0): F.C. + punta hours.
  ib.getRange('C23').setValue(b.loadFactorFC);   // F.C.
  ib.getRange('C24').setValue(2);                // horas punta verano
  ib.getRange('C25').setValue(b.puntaWindowHours); // horas punta invierno

  // ---- INPUT_DESIGN: fixed solar profile, all 12 months ----
  // CFE_SIMULATION subtracts Helioscope solar (INPUT_DESIGN col G, the
  // "GRID kWh" column, rows 34-45) before computing kWMaxAnoMovil (C18).
  // Real Helioscope data varies by month -> C18 varies -> the test would
  // run against uncontrolled input and the JS-oracle cross-check could not
  // be apples-to-apples (this was the v2.3.2-v2.3.4 Phase 4 failure).
  //
  // Fix: write a FIXED solar value for all 12 months -> C18 depends only on
  // days-in-month + the constant load factor = fully deterministic.
  //
  // The value 120000 is deliberate, NOT zero: zero solar pushes C18 so high
  // that 0.7*C18 (the ratchet floor) exceeds the punta demand, so shaving
  // produces 0 Capacidad saving every month — a degenerate test that passes
  // while verifying nothing. 120000 kWh/month keeps C18 ~230, so the ratchet
  // floor sits below the punta and peak-shaving produces a real, non-zero
  // saving the test actually exercises.
  //
  // snapshot/restore covers INPUT_DESIGN, so the user's real Helioscope data
  // is put back afterward.
  var ds = ss.getSheetByName('INPUT_DESIGN');
  var solarFixed = [];
  for (var z = 0; z < 12; z++) solarFixed.push([120000]); // rows 34-45, col G
  ds.getRange(34, 7, 12, 1).setValues(solarFixed);        // col G = "GRID kWh"
}

// ---------------------------------------------------------------------------
// TEST 1 — no error cells. After recalc, BESS_SIMULATION must contain no
// #DIV/0! / #REF! / #VALUE! / #ERROR! / #N/A in the data region.
// ---------------------------------------------------------------------------
function _p4_testNoErrorCells(t, ss) {
  var sh = ss.getSheetByName('BESS_SIMULATION');
  var data = sh.getRange(5, 2, 40, 14).getValues();   // rows 5-44, cols B-O
  var errs = ['#DIV/0!', '#REF!', '#VALUE!', '#ERROR!', '#N/A', '#NAME?', '#NUM!'];
  var found = [];
  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      var v = data[r][c];
      if (typeof v === 'string' && errs.indexOf(v) >= 0) {
        found.push('row ' + (r + 5) + ' col ' + (c + 2) + ' = ' + v);
      }
    }
  }
  t.assertTrue('BESS_SIMULATION has no error cells' +
               (found.length ? ' — FOUND: ' + found.join('; ') : ''),
               found.length === 0);
}

// ---------------------------------------------------------------------------
// TEST 2 — battery-physics invariants. These involve NO tariffs, so they
// are locked to exact fixture values. If these drift, the battery math in
// the sheet formulas (rows 26-27, 36-38) is wrong.
// ---------------------------------------------------------------------------
function _p4_testBatteryInvariants(t, ss) {
  var fx = TESTPROJ_PEAK_001, exp = fx.expected;
  var sh = ss.getSheetByName('BESS_SIMULATION');

  // Calc-detail row 36 — usable kWh.
  var usable = _p4_num(sh.getRange(36, 4).getValue());
  t.assert('Sheet usableKwh (row 36) = fixture lock',
           exp.usableKwh, _p4_round(usable, 3), 0.02);

  // Month row 26 — shave kW. Fixture is winter (puntaWindowHours = 4); the
  // sheet's Jan column (C) is a winter month -> uses C25.
  var shaveJan = _p4_num(sh.getRange(26, 3).getValue());
  t.assert('Sheet shaveKw (C26, winter) = fixture lock',
           exp.shaveKw, _p4_round(shaveJan, 2), 0.05);

  // Month row 27 — Dmax punta con BESS.
  var postJan = _p4_num(sh.getRange(27, 3).getValue());
  t.assert('Sheet postBessPuntaKw (C27) = fixture lock',
           exp.postBessPuntaKw, _p4_round(postJan, 2), 0.05);
}

// ---------------------------------------------------------------------------
// TEST 3 — RECONCILIATIONS. The BESS_SIMULATION saving cell must equal the
// same formula recomputed from CFE_SIMULATION's OWN cells. Tariff-independent:
// if a tariff changes, CFE_SIMULATION changes and both sides move together.
// This catches a wrong formula, not a price change.
// ---------------------------------------------------------------------------
function _p4_testReconciliations(t, ss) {
  var bs = ss.getSheetByName('BESS_SIMULATION');
  var cf = ss.getSheetByName('CFE_SIMULATION');

  // ---- Capacidad reconciliation, January (col C) ----
  // expected = MAX(0, (CFE!C21 - MAX(C27, 0.7*CFE!C18)) * (CFE!C23/CFE!C18))
  var cf_C21 = _p4_num(cf.getRange('C21').getValue());  // Demanda Facturable
  var cf_C18 = _p4_num(cf.getRange('C18').getValue());  // kWMaxAnoMovil
  var cf_C23 = _p4_num(cf.getRange('C23').getValue());  // Capacidad charge
  var bs_C27 = _p4_num(bs.getRange('C27').getValue());  // post-BESS punta
  var capRate = cf_C18 !== 0 ? cf_C23 / cf_C18 : 0;
  var dfAfter = Math.max(bs_C27, 0.7 * cf_C18);
  var expCap  = Math.max(0, (cf_C21 - dfAfter) * capRate);
  var sheetCap = _p4_num(bs.getRange('C30').getValue());
  t.assert('Capacidad C30 reconciles with CFE_SIMULATION cells',
           _p4_round(expCap, 2), _p4_round(sheetCap, 2), 0.5);

  // ---- Distribución reconciliation, January ----
  var cf_C15 = _p4_num(cf.getRange('C15').getValue());
  var cf_C16 = _p4_num(cf.getRange('C16').getValue());
  var cf_C17 = _p4_num(cf.getRange('C17').getValue());
  var cf_C24 = _p4_num(cf.getRange('C24').getValue());
  var maxBefore = Math.max(cf_C15, cf_C16, cf_C17);
  var maxAfter  = Math.max(cf_C15, cf_C16, bs_C27);
  var distDenom = Math.min(maxBefore, cf_C18);
  var distRate  = distDenom !== 0 ? cf_C24 / distDenom : 0;
  var expDist = Math.max(0,
    (Math.min(maxBefore, cf_C18) - Math.min(maxAfter, cf_C18)) * distRate);
  var sheetDist = _p4_num(bs.getRange('C31').getValue());
  t.assert('Distribución C31 reconciles with CFE_SIMULATION cells',
           _p4_round(expDist, 2), _p4_round(sheetDist, 2), 0.5);

  // ---- annual totals (column O) reconcile with the 12 month cells ----
  var capMonths = bs.getRange(30, 3, 1, 12).getValues()[0];
  var capSum = 0;
  for (var i = 0; i < 12; i++) capSum += _p4_num(capMonths[i]);
  var capAnnual = _p4_num(bs.getRange(30, 15).getValue());   // O30
  t.assert('Capacidad annual O30 = sum of 12 months',
           _p4_round(capSum, 2), _p4_round(capAnnual, 2), 0.5);
}

// ---------------------------------------------------------------------------
// TEST 4 — the waterfall arithmetic. D18 (final) must equal D14+D15+D16+D17.
// Pure arithmetic, no tariffs.
// ---------------------------------------------------------------------------
function _p4_testWaterfallAddsUp(t, ss) {
  var bs = ss.getSheetByName('BESS_SIMULATION');
  var d14 = _p4_num(bs.getRange('D14').getValue());
  var d15 = _p4_num(bs.getRange('D15').getValue());
  var d16 = _p4_num(bs.getRange('D16').getValue());
  var d17 = _p4_num(bs.getRange('D17').getValue());
  var d18 = _p4_num(bs.getRange('D18').getValue());
  t.assert('Waterfall final D18 = D14+D15+D16+D17',
           _p4_round(d14 + d15 + d16 + d17, 2), _p4_round(d18, 2), 0.5);

  // Base (D12) must be the largest bar; final (D18) must not exceed base.
  var d12 = _p4_num(bs.getRange('D12').getValue());
  t.assertTrue('Waterfall: final bill D18 <= base bill D12', d18 <= d12 + 0.5);
}

// ---------------------------------------------------------------------------
// TEST 5 — selection-aware behaviour. Toggle NO -> BESS rows 0. Toggle YES
// -> BESS rows non-zero. Restores toggle to YES at the end (fixture state).
// ---------------------------------------------------------------------------
function _p4_testSelectionAware(t, ss) {
  var ip = ss.getSheetByName('INPUT_PROJECT');
  var bs = ss.getSheetByName('BESS_SIMULATION');

  // toggle OFF
  ip.getRange('D64').setValue('NO');
  SpreadsheetApp.flush();
  var capOff = _p4_num(bs.getRange('D15').getValue());
  var modeOff = String(bs.getRange('D6').getValue());
  t.assert('Toggle NO -> BESS Capacidad step D15 = 0', 0, _p4_round(capOff, 2), 0.01);
  t.assertTrue('Toggle NO -> mode banner says Solo PV',
               modeOff.indexOf('Solo PV') >= 0);

  // toggle ON
  ip.getRange('D64').setValue('YES');
  SpreadsheetApp.flush();
  var capOn = _p4_num(bs.getRange('D15').getValue());
  t.assertTrue('Toggle YES -> BESS Capacidad step D15 non-zero', Math.abs(capOn) > 0);
}

// ---------------------------------------------------------------------------
// TEST 6 — JS-ORACLE cross-check (corrected, v2.3.3).
//
// CFE_SIMULATION recomputes kWMaxAñoMovil (C18) by formula from the 12 months
// of energy — it is NOT the fixture's fixed kWMaxAnoMovil. So the JS oracle
// must be fed the SHEET'S recomputed C18 (and the sheet's effective kW punta),
// not the raw fixture value, or the two answer different questions.
//
// This version also DUMPS the real CFE_SIMULATION / BESS_SIMULATION cells as
// INFO rows, so every run shows the actual numbers — making any future
// discrepancy diagnosable from the results sheet alone.
// ---------------------------------------------------------------------------
function _p4_testJsOracleCrossCheck(t, ss) {
  var fx = TESTPROJ_PEAK_001;
  var bs = ss.getSheetByName('BESS_SIMULATION');
  var cf = ss.getSheetByName('CFE_SIMULATION');

  // ---- DIAGNOSTIC DUMP — ALL 12 MONTHS of the cells the Capacidad math
  // depends on. One INFO row per month: the CFE_SIMULATION inputs and the
  // BESS_SIMULATION outputs side by side, so any month's discrepancy is
  // fully visible in the results sheet without reverse-engineering.
  var monthLbl = ['Ene','Feb','Mar','Abr','May','Jun',
                  'Jul','Ago','Sep','Oct','Nov','Dic'];
  for (var dm = 0; dm < 12; dm++) {
    var dc = String.fromCharCode(67 + dm);          // C..N
    var line =
      monthLbl[dm] + ' (' + dc + '): ' +
      'C17punta=' + cf.getRange(dc + '17').getValue() + ' ' +
      'C18kWMax=' + cf.getRange(dc + '18').getValue() + ' ' +
      'C20dias=' + cf.getRange(dc + '20').getValue() + ' ' +
      'C21DemF=' + cf.getRange(dc + '21').getValue() + ' ' +
      'C23Cap=' + cf.getRange(dc + '23').getValue() + ' | ' +
      'C26shave=' + bs.getRange(dc + '26').getValue() + ' ' +
      'C27post=' + bs.getRange(dc + '27').getValue() + ' ' +
      'C30capSav=' + bs.getRange(dc + '30').getValue();
    t.info('Phase4 dump 12mo', line);
  }
  t.info('Phase4 dump 12mo', 'BESS O30 capAnnual = ' + bs.getRange(30, 15).getValue());

  // ---- Cross-check: run the JS oracle per month on the SHEET'S OWN values.
  // For each month, read CFE_SIMULATION's recomputed kWMaxAñoMovil and kW
  // punta, build the JS input from those, and assert the sheet's Capacidad
  // saving for that month equals the JS oracle's. Same kWMaxAñoMovil on both
  // sides -> a true apples-to-apples check.
  var jsCapAnnual = 0, sheetCapAnnual = 0, mismatch = [];
  for (var m = 0; m < 12; m++) {
    var col = String.fromCharCode(67 + m);                 // C..N

    var sheetC17 = _p4_num(cf.getRange(col + '17').getValue());  // kW punta
    var sheetC18 = _p4_num(cf.getRange(col + '18').getValue());  // kWMaxAñoMovil
    var sheetC23 = _p4_num(cf.getRange(col + '23').getValue());  // Capacidad chg
    var capRate  = sheetC18 !== 0 ? sheetC23 / sheetC18 : 0;

    // JS input = fixture, but kWMaxAnoMovil and kWPunta from the SHEET.
    var jin = {};
    for (var k in fx.janInput) jin[k] = fx.janInput[k];
    jin.kWMaxAnoMovil = sheetC18;
    jin.kWPunta       = sheetC17;
    var tar = {};
    for (var k2 in fx.frozenTariffs) tar[k2] = fx.frozenTariffs[k2];
    tar.capacidad = capRate;                               // sheet's eff. rate

    // The BESS_SIMULATION row-26 formula picks the punta window per month:
    // winter (INPUT_BESS C25) for cols C,D,M,N (COLUMN()<=4 or >=13),
    // summer (INPUT_BESS C24) for the rest. The JS oracle must use the SAME
    // window for that month or it computes a different shave (this was the
    // v2.3.2-v2.3.4 summer mismatch). Mirror the sheet rule exactly.
    var colNum = 3 + m;                                    // C=3 .. N=14
    var isWinterCol = (colNum <= 4 || colNum >= 13);
    var bess = {};
    for (var k3 in fx.bess) bess[k3] = fx.bess[k3];
    bess.puntaWindowHours = isWinterCol ? 4 : 2;            // C25 / C24

    var r = calcPeakShavingImpact(jin, tar, bess);
    var jsCap    = r.capacidadSavingYear1;
    var sheetCap = _p4_num(bs.getRange(30, 3 + m).getValue());

    jsCapAnnual    += jsCap;
    sheetCapAnnual += sheetCap;

    // per-month tolerance: 1 peso or 2%, whichever larger
    var tolM = Math.max(1, Math.abs(jsCap) * 0.02);
    if (Math.abs(jsCap - sheetCap) > tolM) {
      mismatch.push(col + ': JS=' + jsCap.toFixed(2) +
                    ' sheet=' + sheetCap.toFixed(2));
    }
  }

  t.info('Phase4 cross-check',
         'JS annual=' + jsCapAnnual.toFixed(2) +
         '  sheet annual=' + sheetCapAnnual.toFixed(2));

  // Per-month agreement is the real assertion — it localises any drift.
  t.assertTrue('JS oracle vs sheet: every month Capacidad agrees' +
               (mismatch.length ? ' — MISMATCH: ' + mismatch.join(' | ') : ''),
               mismatch.length === 0);

  // Annual agreement (redundant but gives a clean headline number).
  var tolA = Math.max(1, Math.abs(jsCapAnnual) * 0.02);
  t.assert('JS oracle vs sheet: annual Capacidad agrees',
           _p4_round(jsCapAnnual, 0), _p4_round(sheetCapAnnual, 0), tolA);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function _p4_num(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v == null) return 0;
  var n = parseFloat(String(v).replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
}
function _p4_round(n, d) {
  var f = Math.pow(10, d || 0);
  return Math.round(n * f) / f;
}