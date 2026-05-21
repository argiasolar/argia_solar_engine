// =============================================================================
// ARGIA TESTS -- tests_integration/e2e/Testproj001PipelineTests.gs
// -----------------------------------------------------------------------------
// PASS 16 MIGRATION: TESTPROJ-001 end-to-end calc pipeline (Tier 3+3.5+3.6).
//
// SOURCE: testEndToEnd + assertMdcWriterOutputs + testBomDiagnostic +
//         testInstallCostDiagnostic in 99_TestRunner.gs (lines ~395-925).
//         Migrated 2026-05-21 as part of Pass 16.
//
// COVERAGE
//   Largest single integration test in the suite. Backs up INPUT sheets,
//   writes TESTPROJ-001 fixture, runs the full calc pipeline, asserts
//   MDC + BOM + install cost outputs against locked baselines, restores
//   inputs. Three logical layers in sequence (single test for shared
//   expensive setup):
//
//   LAYER 1 (Tier 3) -- assertMdcWriterOutputs (~18 asserts)
//     End-to-end pipeline: loadNomConstants -> readInputs -> lookupPanel
//     -> buildInverterBank -> readElecTables -> calcDC -> calcAC ->
//     calcLayout -> writeMDC. Reads back 18 specific MDC cells (identity,
//     DC math, AC results) and asserts against TESTPROJ_001.expected.
//
//   LAYER 2 (Tier 3.6) -- testBomDiagnostic (~22 asserts + INFO)
//     Asserts on lay.bom engine quantities (DC OCPD units, MC4 pairs,
//     main breaker, conductors, conduits, per-inverter values). Locks
//     geometric quantities (cable meters, EGC meters, area). Calls
//     writeBOM, reads back the BOM sheet, asserts grand total
//     ($194,492.5126) and AC main conduit qty regression guard.
//
//   LAYER 2b (Tier 3.6b) -- BOM sheet cell qtys (~10 asserts, PASS 18)
//     ADDED IN PASS 18: resurrects orphaned testBomLineItems from
//     99_TestRunner.gs (was defined but never called). Asserts 10
//     specific BOM cells (panels=720, inverters=4, DC cable=6720m,
//     etc.) caught Layer 2 baseline math but the writer could still
//     put numbers in the wrong rows -- this layer guards against that.

//   LAYER 3 (Tier 3.5) -- testInstallCostDiagnostic (~14 asserts + INFO)
//     Calls runInstallCost. Locks 8 section totals + grand total
//     ($325,780.51 MXN) + 6 driver values. Includes Patch 2/3 regression
//     guards (EST_PROJECT_DAYS derived from productive MH; crewDays sync).
//
// CLASSIFICATION
//   group=integration. Largest cell surface in any test:
//     - Writes 50+ cells across INPUT_PROJECT/INSTALL/DESIGN/GENERAL
//     - Writes MDC sheet (rows 1-90, cols A-F)
//     - Writes BOM sheet (rows 1-90, cols A-H)
//     - Restores all input sheets via Sheet.copyTo backup
//
// DEPENDENCIES
//   Engine: loadNomConstants, readInputs, lookupPanel, buildInverterBank,
//           readElecTables, calcDC, calcAC, calcLayout, writeMDC, writeBOM,
//           runInstallCost
//   Constants: SH, MDC_COL, MDC_ROW, BOM_ROW (00_Main.gs)
//   Framework: writeTestprojInputs, backupAllInputSheets,
//              restoreAllInputSheets (Pass 15 additions in test/)
//   Fixture: TESTPROJ_001 (98_TestData.gs)
//
// FIRST USE OF PASS 15 HELPERS
//   This test is the first consumer of writeTestprojInputs +
//   backupAllInputSheets + restoreAllInputSheets. If those helpers have
//   any bug, it surfaces here. Pass 15 only verified they parse and don't
//   collide -- this verifies they actually work end-to-end against a live
//   sheet.
//
// SAFETY MODEL
//   - backupAllInputSheets duplicates 4 input tabs via Sheet.copyTo
//     (preserves formulas)
//   - restoreAllInputSheets restores in finally even on assertion failure
//     or pipeline throw
//   - If restore itself throws, test fails LOUDLY -- inputs NOT restored
//     and user must manually re-enter (this matches legacy behavior)
//
// MDC + BOM sheets are LEFT WRITTEN after the test. Same legacy contract
// as Phase 12 (MdcBessSec7Tests): "next real engine run rewrites or clears
// them" -- harmless because they're output, not input.
//
// CO-EXISTENCE
//   Legacy testEndToEnd in 99_TestRunner.gs unchanged. Both run the same
//   ~54 asserts until the legacy deletion pass.
// =============================================================================


registerTest({
  id      : 'INT_E2E_TESTPROJ001_PIPELINE',
  group   : 'integration',
  module  : 'e2e/testproj001',
  scenarios: [],
  tags    : ['e2e', 'pipeline', 'testproj001', 'mdc', 'bom', 'bom-cells',
             'install-cost', 'end-to-end'],
  source  : 'tests_integration/e2e/Testproj001PipelineTests.gs',
  fn: function (t, ctx) {
    t.suite('INT e2e/testproj001: full calc pipeline');

    var ss = ctx.ss;

    // ====================================================================
    // REGRESSION GUARD: SH sheet-existence check
    // Mirrors runArgiaEngine()'s startup check so a missing non-optional
    // sheet fails loudly here. Keep OPTIONAL_SHEETS in sync with the
    // list in 00_Main.gs runArgiaEngine().
    // ====================================================================
    var _SH_OPTIONAL = ['INSTALLATION', '95_INSTALL_DRIVER_MAP',
      '90M_INSTALL_LIB', '91M_INSTALL_FACTORS', '92M_INSTALL_ROLE_RATES',
      '93M_INSTALL_EQUIP_RATES', 'INPUT_GENERAL', 'CFE_OUTPUT'];
    var _shMissing = [];
    Object.keys(SH).forEach(function (key) {
      var name = SH[key];
      if (name === 'LOGS' || name === 'BOM') return;  // engine creates these
      if (_SH_OPTIONAL.indexOf(name) !== -1) return;  // optional
      if (ss.getSheetByName(name) === null) {
        _shMissing.push(key + ' -> ' + name);
      }
    });
    t.assert('runArgiaEngine sheet-existence guard: no missing non-optional sheets',
             0, _shMissing.length);
    if (_shMissing.length > 0) {
      t.info('missing sheets', _shMissing.join(' | '));
    }

    // Required sheets for the pipeline -- skip with clear message if missing
    var requiredSheets = ['INPUT_PROJECT', 'INPUT_DESIGN', 'MDC'];
    for (var i = 0; i < requiredSheets.length; i++) {
      if (ss.getSheetByName(requiredSheets[i]) === null) {
        t.fail('Tier 3 skipped',
               'Required sheet not found: ' + requiredSheets[i]);
        return;
      }
    }

    var backedUp = false;
    try {
      // ====================================================================
      // SETUP: backup current INPUT sheets, write TESTPROJ-001 fixture
      // ====================================================================
      backupAllInputSheets(ss);
      backedUp = true;

      // Write TESTPROJ-001 inputs. Any data-validation rejection is an
      // INFO note, not a failure -- those cells are labels/metadata and
      // don't affect engine math.
      var skipped = writeTestprojInputs(ss);
      skipped.forEach(function (info) {
        t.info('input cell skipped', info);
      });
      SpreadsheetApp.flush();

      // ====================================================================
      // PIPELINE: run the engine calc + write MDC
      // (Direct calls -- runArgiaEngine() shows a UI dialog that breaks
      //  in menu-less test contexts.)
      // ====================================================================
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

      // ====================================================================
      // LAYER 1 (Tier 3): assert MDC writer outputs
      // ====================================================================
      _layer1_assertMdcOutputs(t, ss);

      // ====================================================================
      // LAYER 2 (Tier 3.6): BOM quantities + writeBOM smoke
      // ====================================================================
      _layer2_assertBom(t, ss, inp, panel, invBank, dc, ac, lay);

      // ====================================================================
      // LAYER 2b (Tier 3.6b): BOM sheet cell qtys (Pass 18 addition)
      // Reads back specific BOM rows that Layer 2's writeBOM just wrote.
      // Catches "right math, wrong cell" -- if calcLayout is correct but
      // the writer puts a value in the wrong row, Layer 2 passes (it
      // asserts on lay.bom.*) and Layer 2b fails (it asserts on cells).
      // ====================================================================
      _layer2b_assertBomCells(t, ss);

      // ====================================================================
      // LAYER 3 (Tier 3.5): install cost diagnostic
      // ====================================================================
      _layer3_assertInstallCost(t, ss, inp, invBank, dc, ac, lay);

    } catch (e) {
      t.error('e2e pipeline threw', e);
    } finally {
      // ALWAYS restore inputs, even on crash. If restore itself fails,
      // surface it LOUDLY -- the user needs to manually fix.
      if (backedUp) {
        try {
          restoreAllInputSheets(ss);
          t.info('cleanup', 'INPUT sheets restored from backup');
        } catch (restoreErr) {
          t.fail('RESTORE FAILED',
                 'INPUT sheets NOT restored: ' + restoreErr.message);
        }
      }
    }
  }
});


// ===========================================================================
// LAYER 1 -- MDC writer assertions (file-scope helper, not registered test)
//
// Could move inline into fn:, but at 50+ lines this would clutter the
// registered test body and obscure the three-layer structure. File-scope
// is fine here -- this helper has a distinctive _layer1_ prefix that
// won't collide with anything.
// ===========================================================================

function _layer1_assertMdcOutputs(t, ss) {
  var mdc = ss.getSheetByName('MDC');
  var C = MDC_COL.VALUE;   // col 3
  var R = MDC_ROW;
  var exp = TESTPROJ_001.expected.dc;
  var expAc = TESTPROJ_001.expected.ac;
  var tol = TESTPROJ_001.tolerance;

  // MDC writer formats cells differently by type:
  //   - Numeric cells may include unit suffixes ("25 A", "1010.81 V")
  //       -> parseFloat() strips trailing unit text
  //   - Size cells like "10 AWG", "1/0 AWG", "350 kcmil"
  //       -> first whitespace-delimited token: "10", "1/0", "350"
  //   - Plain text cells: just trim
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

  // -- Identity ----------------------------------------------------------
  t.assert('MDC.projectName',
           'TESTPROJ-001', mdcString(R.PROJECT));
  t.assert('MDC.client',
           'TEST CUSTOMER S.A. de C.V.', mdcString(R.CLIENT));
  t.assert('MDC.moduleModel contains "585M"',
           true, mdcString(R.MODULE).indexOf('585M') !== -1);
  t.assert('MDC.qtyModules',
           720, mdcNumber(R.QTY_MODULES));
  t.assert('MDC.qtyInverters',
           4, mdcNumber(R.QTY_INVERTERS));
  t.assert('MDC.modsPerString',
           18, mdcNumber(R.MODS_PER_STRING));

  // -- DC math results ---------------------------------------------------
  t.assert('MDC.isc',
           exp.isc, mdcNumber(R.ISC), tol['default']);
  t.assert('MDC.iDesign',
           exp.iDesign, mdcNumber(R.I_DESIGN), tol['default']);
  t.assert('MDC.Ft_dc',
           exp.Ft_dc, mdcNumber(R.FT_DC), tol['default']);
  t.assert('MDC.conductorDC',
           exp.conductorDC, mdcSize(R.COND_DC));
  t.assert('MDC.ocpdDC',
           exp.ocpdDC, mdcNumber(R.OCPD_DC));
  t.assert('MDC.vocCold',
           exp.vocColdString, mdcNumber(R.VOC_COLD), tol['mdc']);
  t.assert('MDC.vmpHot',
           exp.vmpHotString, mdcNumber(R.VMP_HOT), tol['mdc']);

  // -- AC results --------------------------------------------------------
  t.assert('MDC.iNomAC',
           expAc.iNomPerInv, mdcNumber(R.I_AC_NOM), tol['default']);
  t.assert('MDC.mainBreaker',
           expAc.mainBreaker, mdcNumber(R.MAIN_BREAKER));
  t.assert('MDC.parallelRuns',
           expAc.parallelRuns, mdcNumber(R.PARALLEL_RUNS));
  t.assert('MDC.condMain',
           expAc.condMain, mdcSize(R.COND_MAIN));
  t.assert('MDC.transformer',
           expAc.transformer, mdcNumber(R.TRANSFORMER));
}


// ===========================================================================
// LAYER 2 -- BOM quantities + writeBOM smoke test
// ===========================================================================

function _layer2_assertBom(t, ss, inp, panel, invBank, dc, ac, lay) {
  if (!lay || !lay.bom) {
    t.fail('lay.bom missing', 'calcLayout did not populate lay.bom');
    return;
  }
  var bom = lay.bom;

  // -- (1) Assertions on lay.bom engine quantities --------------------
  // Locked from TESTPROJ-001 spec. Conductor/conduit sizes are strings
  // in the engine -- coerce with String() before comparing.
  t.assert('bom.dcOcpdUnits',  40,    bom.dcOcpdUnits);
  t.assert('bom.mc4Pairs',     40,    bom.mc4Pairs);
  t.assert('bom.rsdRequired',  true,  bom.rsdRequired);
  t.assert('bom.mainBreakerA', 800,   bom.mainBreakerA);
  t.assert('bom.mainConductor','350', String(bom.mainConductor));
  t.assert('bom.mainEgc',      '1/0', bom.mainEgc);
  t.assert('bom.mainConduit',  '4',   String(bom.mainConduit));
  t.assert('bom.transformer',  750,   bom.transformer);

  var invList = bom.acPerInverterBOM || [];
  t.assert('bom.perInverter count', 1, invList.length);
  var inv0 = invList[0] || {};
  t.assert('bom.perInverter[0].qty',           4,   inv0.qty);
  t.assert('bom.perInverter[0].ocpdA',         175, inv0.ocpdA);
  t.assert('bom.perInverter[0].conductorSize', '1', String(inv0.conductorSize));
  t.assert('bom.perInverter[0].egcSize',       '6', String(inv0.egcSize));

  // -- (2) Computed geometric quantities (baseline 2026-04-24) -------
  // If any change, calcLayout math moved. See legacy 99_TestRunner.gs
  // for the bug #1 fix cascade story (feederExtraM falsy-0 fix).
  t.assert('bom.dcCableM',             6720, bom.dcCableM);
  t.assert('bom.dcGroundingM',         2500, bom.dcGroundingM);
  t.assert('bom.dcConduitM',           84,   bom.dcConduitM);
  t.assert('bom.mainFeederCableM',     234,  bom.mainFeederCableM);
  t.assert('bom.mainEgcM',             78,   bom.mainEgcM);
  t.assert('bom.perInverter[0].cableM', 936, inv0.cableM);
  t.assert('bom.perInverter[0].egcM',   312, inv0.egcM);
  t.assert('bom.areaPass',             true, bom.areaPass);

  // Emit same values as INFO for readability
  t.info('bom.dcCableM',          String(bom.dcCableM));
  t.info('bom.dcGroundingM',      String(bom.dcGroundingM));
  t.info('bom.dcConduitM',        String(bom.dcConduitM));
  t.info('bom.mainFeederCableM',  String(bom.mainFeederCableM));
  t.info('bom.mainEgcM',          String(bom.mainEgcM));
  t.info('bom.perInverter[0].cableM', String(inv0.cableM));
  t.info('bom.perInverter[0].egcM',   String(inv0.egcM));
  t.info('bom.areaRequired',     String(bom.areaRequired));
  t.info('bom.availableSpace',   String(bom.availableSpace));
  t.info('bom.areaPass',         String(bom.areaPass));

  // -- (3) writeBOM smoke test ---------------------------------------
  try {
    writeBOM(ss, inp, panel, invBank, dc, ac, lay);
    SpreadsheetApp.flush();
  } catch (e) {
    t.error('writeBOM threw', e);
    return;
  }

  // Read back BOM and emit content rows as INFO
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
           'A=' + String(r[0] || '')
           + ' | B=' + desc
           + ' | qty=' + String(r[2] || '')
           + ' | unit=' + String(r[3] || ''));
  }
  t.info('BOM rows with content', String(rowsWithContent));
  // Loose row-count range (41-50) catches gross writer breakage without
  // false-failing on cosmetic shifts.
  t.assert('BOM rows with content in [41,50]', true,
           rowsWithContent >= 41 && rowsWithContent <= 50);

  // Grand total via BOM_ROW.GRAND_TOTAL constant
  var grandTotalRowIdx = BOM_ROW.GRAND_TOTAL - 1;
  var row77 = data[grandTotalRowIdx] || [];
  var row77Total = null;
  for (var k = 0; k < row77.length; k++) {
    if (typeof row77[k] === 'number' && row77[k] > 0) {
      row77Total = row77[k];
      break;
    }
  }
  t.info('BOM row ' + BOM_ROW.GRAND_TOTAL + ' grand total',
         row77Total == null ? '(none found -- check template)'
                            : String(row77Total));
  t.assert('BOM grand total (USD)',
           194492.5126, row77Total, 0.01);

  // Regression guard for the AC conduit divisor bug (Patch 1, 2026-04-28).
  // Pre-patch ceil(cableM/3) overcounted ~3x; corrected ceil(cableM/3/3).
  var acConduitRow = data[BOM_ROW.AC_CONDUIT - 1] || [];
  var acConduitQty = acConduitRow[2];   // col C = QTY
  var expectedConduitQty = Math.ceil(lay.bom.mainFeederCableM / 3 / 3);
  t.assert('AC main conduit qty (cableM / 3 phases / 3 m-per-stick)',
           expectedConduitQty, acConduitQty);
}


// ===========================================================================
// LAYER 2b -- BOM sheet cell qtys (Pass 18 addition; was orphaned in legacy)
//
// SOURCE: testBomLineItems in 99_TestRunner.gs (lines 1708-1740).
//         The legacy function was DEFINED but NEVER CALLED from anywhere
//         (third orphaned-coverage resurrection this session, after
//         Phase 1.2 in Pass 4 and testResolveStructure in Pass 10).
//
// COVERAGE
//   10 asserts on specific BOM-sheet QTY cells (column C). Complements
//   Layer 2 which asserts on lay.bom.* (engine math). If calcLayout is
//   right but the WRITER puts numbers in the wrong row, Layer 2 passes
//   and Layer 2b catches it. This is the "right math, wrong cell" guard.
//
// DEPENDENCIES
//   - SH.BOM, BOM_ROW, BOM_COL (00_Main.gs)
//   - BOM sheet already populated by Layer 2's writeBOM call
//
// BASELINES
//   Locked from the legacy file's 2026-04-28 captured run. NOTE: since
//   the legacy function was never called, these baselines have never
//   actually been verified. Pass 18 is the first time they run.
// ===========================================================================

function _layer2b_assertBomCells(t, ss) {
  var sh = ss.getSheetByName(SH.BOM);
  if (!sh) {
    t.fail('Layer 2b skipped', 'BOM sheet not found');
    return;
  }

  // Row -> expected qty in column C (BOM_COL.QTY)
  var locks = [
    { row: BOM_ROW.PANEL_PRIMARY,     qty: 720,  label: 'panels qty' },
    { row: BOM_ROW.INVERTER_PRIMARY,  qty: 4,    label: 'inverter qty' },
    { row: BOM_ROW.STRUCTURE_PRIMARY, qty: 720,  label: 'panel structure qty' },
    { row: BOM_ROW.DC_CABLE,          qty: 6720, label: 'DC cable m' },
    { row: BOM_ROW.DC_GROUNDING,      qty: 2500, label: 'DC grounding m' },
    { row: BOM_ROW.DC_MC4,            qty: 40,   label: 'DC MC4 pairs' },
    { row: BOM_ROW.DC_OCPD,           qty: 40,   label: 'DC OCPD' },
    { row: BOM_ROW.AC_FEEDER,         qty: 234,  label: 'AC feeder cable m' },
    { row: BOM_ROW.AC_EGC,            qty: 78,   label: 'AC main EGC m' },
    { row: BOM_ROW.AC_BREAKER,        qty: 1,    label: 'AC main breaker' }
  ];

  locks.forEach(function (L) {
    var got = sh.getRange(L.row, BOM_COL.QTY).getValue();
    var gotNum = parseFloat(got);
    if (isNaN(gotNum)) {
      t.fail('BOM row ' + L.row + ' qty (' + L.label + ')',
             'cell is non-numeric: ' + JSON.stringify(got));
      return;
    }
    t.assert('BOM row ' + L.row + ' qty (' + L.label + ')',
             L.qty, gotNum);
  });
}


// ===========================================================================
// LAYER 3 -- install cost diagnostic + section/grand-total + Patch 2/3 guards
// ===========================================================================

function _layer3_assertInstallCost(t, ss, inp, invBank, dc, ac, lay) {
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

  // -- Emit line items as INFO (no per-item assertions) ---------------
  var items = result.items || [];
  var nonZero = 0, skippedCount = 0;
  items.forEach(function (r) {
    if (!r || !r.item) return;
    if (r.applies === false) { skippedCount++; return; }
    var total = r.totalMxn || 0;
    if (total <= 0) return;
    nonZero++;
    var id = r.item.id || '';
    var ct = r.item.costType || '';
    var dk = r.item.driverKey || '';
    var cf = (r.factorResult && r.factorResult.combined != null)
              ? r.factorResult.combined : 1.0;
    t.info(id + '  [' + ct + ']  driver=' + dk,
           'CF=' + cf.toFixed(3)
           + '  labor=' + (r.laborMxn || 0).toFixed(2)
           + '  equip=' + (r.equipMxn || 0).toFixed(2)
           + '  other=' + (r.otherMxn || 0).toFixed(2)
           + '  TOTAL=' + total.toFixed(2) + ' MXN');
  });
  t.info('items filtered out by APPLIES_TO', skippedCount + ' items');
  t.info('active items contributing cost',
         nonZero + ' of ' + items.length);

  // -- Section totals (baseline 2026-04-28 post-Patch 2/3) -----------
  var sec = result.sectionTotals || {};
  function secTotal(name) { return (sec[name] && sec[name].total) || 0; }

  t.assert('SECTION AC total',             14744.66,  secTotal('AC'),             0.50);
  t.assert('SECTION DC total',             23634.78,  secTotal('DC'),             0.50);
  t.assert('SECTION RACKING SYSTEM total', 12407.34,  secTotal('RACKING SYSTEM'), 0.50);
  t.assert('SECTION CONNECTION total',     29296.00,  secTotal('CONNECTION'),     0.50);
  t.assert('SECTION SAFETY total',         70320.00,  secTotal('SAFETY'),         0.50);
  t.assert('SECTION GENERAL SITE total',  113592.00,  secTotal('GENERAL SITE'),   0.50);
  t.assert('SECTION EQUIPMENT total',      43620.00,  secTotal('EQUIPMENT'),      0.50);
  t.assert('SECTION INDIRECT total',       18165.72,  secTotal('INDIRECT'),       0.50);

  // Section breakdowns as INFO
  Object.keys(sec).forEach(function (name) {
    var s = sec[name];
    if (!s || (s.total || 0) <= 0) return;
    t.info('SECTION ' + name,
           'labor=' + (s.labor || 0).toFixed(2)
           + '  equip=' + (s.equip || 0).toFixed(2)
           + '  other=' + (s.other || 0).toFixed(2)
           + '  TOTAL=' + (s.total || 0).toFixed(2));
  });

  // -- Grand total -----------------------------------------------------
  var computedGrand = 0;
  Object.keys(sec).forEach(function (name) {
    computedGrand += (sec[name] && sec[name].total) || 0;
  });
  t.assert('GRAND TOTAL (sum of sections)',
           325780.51, computedGrand, 0.50);
  t.info('GRAND TOTAL', computedGrand.toFixed(2) + ' MXN');

  // -- Patch 2/3 regression guards (2026-04-28) ----------------------
  // EST_PROJECT_DAYS no longer a user input -- derived at calc time
  // from productive labor MH, then re-derived after kWp benchmarks
  // scale labor down. These assertions catch regressions in either.
  var DAY_KEYS = ['EST_PROJECT_DAYS', 'CREW_DAYS'];
  var dayItem = items.filter(function (r) {
    return r && r.item && r.item.driverKey === 'EST_PROJECT_DAYS'
        && r.applies !== false && (r.totalMxn || 0) > 0;
  })[0];

  if (!dayItem) {
    t.fail('Patch 2/3 regression: no active EST_PROJECT_DAYS-driven item found',
           'Lib should have at least one day-driven item '
           + '(SF-02/SF-08/GN-03/GN-04/EQ-01/EQ-05).');
  } else {
    var derivedDays = dayItem.driverQtyVal;

    // Productive MH = sum of mhComputed for items NOT day-driven, NOT INDIRECT
    var productiveMH = 0;
    items.forEach(function (r) {
      if (!r || !r.item) return;
      if (r.applies === false) return;
      if (DAY_KEYS.indexOf(r.item.driverKey) !== -1) return;
      if (r.item.section === 'INDIRECT') return;
      productiveMH += (r.mhComputed || 0);
    });

    // crewSize 6 is hardcoded per TESTPROJ_001.crewSize. If the fixture
    // changes, this assertion intentionally fails and needs updating.
    var crewSize = 6;
    var expectedDays = Math.max(1,
      Math.ceil(productiveMH / Math.max(crewSize, 1) / 8));

    t.info('Patch 2/3: productive MH (post-benchmark)',
           productiveMH.toFixed(2));
    t.info('Patch 2/3: expected derived days',
           String(expectedDays) + ' = max(1, ceil('
           + productiveMH.toFixed(0) + ' / ' + crewSize + ' / 8))');

    t.assert('Patch 2: EST_PROJECT_DAYS derived from productive MH',
             expectedDays, derivedDays);

    // CREW_DAYS sync invariant (Patch 3)
    var crewDaysItem = items.filter(function (r) {
      return r && r.item && r.item.driverKey === 'CREW_DAYS'
          && r.applies !== false;
    })[0];

    if (crewDaysItem) {
      var crewDaysVal = crewDaysItem.driverQtyVal;
      t.assert('Patch 3: crewDays == crewSize * derivedDays (post-benchmark)',
               crewSize * derivedDays, crewDaysVal);
    } else {
      t.info('Patch 3: no active CREW_DAYS item in this fixture',
             'Skipping crewDays sync assertion (GN-08 may be filtered out).');
    }
  }

  // -- Key driver values ----------------------------------------------
  var moduleCount   = inp.panelQty || 0;
  var inverterCount = invBank.reduce(function (s, i) { return s + i.qty; }, 0);
  var projectDcKwp  = dc.dcKwp || 0;
  var projectAcKw   = dc.acKwTotal || ac.acKwTotal || 0;
  var dcCableM      = (lay.bom && lay.bom.dcCableM) || 0;
  var acCableFeederM = (lay.bom && lay.bom.mainFeederCableM) || 0;
  var arrayGrossM2  = lay.grossArea || 0;

  t.assert('driver: MODULE_COUNT',        720,    moduleCount);
  t.assert('driver: INVERTER_COUNT',      4,      inverterCount);
  t.assert('driver: PROJECT_DC_KWP',      421.2,  projectDcKwp,    0.01);
  t.assert('driver: PROJECT_AC_KW',       400,    projectAcKw,     0.01);
  t.assert('driver: DC_CABLE_M',          6720,   dcCableM,        0.50);
  t.assert('driver: ARRAY_GROSS_AREA_M2', 1900.8, arrayGrossM2,    0.10);

  t.info('driver: AC_CABLE_M (feeder only from lay.bom)',
         acCableFeederM.toFixed(1));

  // Per-kWp cost metric (informational)
  if (projectDcKwp > 0) {
    t.info('per kWp DC',
           (computedGrand / projectDcKwp).toFixed(2) + ' MXN/kWp');
  }
}
