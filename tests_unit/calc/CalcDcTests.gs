// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcDcTests.gs
// -----------------------------------------------------------------------------
// PASS 3 MIGRATION: DC calculation suite.
//
// SOURCE: Originally lived as the first half of `testCalcModules(t, ss)` in
//         99_TestRunner.gs (lines 308-356, the "Tier 2 -- calcDC" suite).
//         Migrated 2026-05-21 as part of Pass 3.
//
// COVERAGE
//   calcDC() against TESTPROJ_001 fixture: bifacial flag, currents (Isc, Isc125,
//   iDesign per string and total), ambient/temperature corrections (roofAdder,
//   Ft, Fag), DC conductor and OCPD selection, EGC, voltage calcs (Vstring,
//   vdropDC, Voc cold, Vmp hot), conduit selection.
//
// CLASSIFICATION
//   group=unit because the behavior under test (calcDC) is pure. Two sheet
//   reads (loadNomConstants, readElecTables) provide lookup-table setup
//   only -- they don't influence what's being verified. Per the test
//   taxonomy: unit = pure behavior + setup-only sheet access; integration
//   = sheet mutations or assertions over sheet state.
//
// DEPENDENCIES
//   - TESTPROJ_001 fixture (test/TestProjects.gs)
//   - tdBuildTestInputs, tdBuildTestPanel, tdBuildTestInverterBank
//     (test/TestFixtures.gs -- Pass 15 framework helpers; the legacy
//     buildTest* functions in 99_TestRunner.gs were removed in Pass 23)
//     ^^^ When 99_TestRunner.gs is deleted in Pass 7, these helpers MUST be
//     moved into test/TestData.gs first or the new tests will break.
//   - calcDC (04_CalcDC.gs)
//   - loadNomConstants (02_LoadDB.gs)
//   - readElecTables (03_ElecTables.gs)
//
// CO-EXISTENCE
//   The legacy testCalcModules in 99_TestRunner.gs is UNCHANGED. Both run
//   side by side until Pass 7. After this migration, the TESTPROJ_001 DC
//   asserts execute twice per full run (once via legacy runTests, once
//   via runUnitTests) -- intentional during transition.
// =============================================================================


registerTest({
  id      : 'UNIT_CALC_DC_TESTPROJ001',
  group   : 'unit',
  module  : 'calc/dc',
  scenarios: [],   // TESTPROJ_001 used directly; scenario plumbing comes in Pass 4
  tags    : ['calc', 'dc', 'testproj001'],
  source  : 'tests_unit/calc/CalcDcTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/dc: TESTPROJ_001');

    var exp = TESTPROJ_001.expected;
    var tol = TESTPROJ_001.tolerance;

    // Synthetic inputs -- repeatable regardless of INPUT_DESIGN state.
    var inp     = tdBuildTestInputs();
    var panel   = tdBuildTestPanel();
    var invBank = tdBuildTestInverterBank();
    var nom     = loadNomConstants(ctx.ss);
    var tbls    = readElecTables(ctx.ss);

    var dc;
    try {
      dc = calcDC(inp, panel, invBank, nom, tbls);
    } catch (e) {
      t.error('calcDC threw', e);
      return;
    }

    // Currents ---------------------------------------------------------------
    t.assert('bifFactor',     exp.dc.bifFactor,     dc.bifFactor,     tol['default']);
    t.assert('bifacial flag', exp.dc.bifacial,      dc.bifacial);
    t.assert('isc',           exp.dc.isc,           dc.isc,           tol['default']);
    t.assert('isc125',        exp.dc.isc125,        dc.isc125,        tol['default']);
    t.assert('iDesignPerStr', exp.dc.iDesignPerStr, dc.iDesignPerStr, tol['default']);
    t.assert('iDesign total', exp.dc.iDesign,       dc.iDesign,       tol['default']);

    // Temperature / ambient --------------------------------------------------
    t.assert('roofAdder',  exp.dc.roofAdder,  dc.roofAdder);
    t.assert('ambientDC',  exp.dc.ambientDC,  dc.ambientDC);
    t.assert('ambientAvg', exp.dc.ambientAvg, dc.ambientAvg);
    t.assert('Ft_dc',      exp.dc.Ft_dc,      dc.Ft_dc, tol['default']);
    t.assert('Fag_dc',     exp.dc.Fag_dc,     dc.Fag_dc, tol['default']);

    // Conductor + OCPD -------------------------------------------------------
    t.assert('ampReqDC',      exp.dc.ampReqDC,      dc.ampReqDC,         tol['loose']);
    t.assert('conductorDC',   exp.dc.conductorDC,   String(dc.conductorDC));
    t.assert('areaConDC',     exp.dc.areaConDC,     dc.areaConDC,        tol['default']);
    t.assert('ocpdDC',        exp.dc.ocpdDC,        dc.ocpdDC);
    t.assert('moduleMaxFuse', exp.dc.moduleMaxFuse, dc.moduleMaxFuse);
    t.assert('ocpdDCPass (expected false = AUDIT-FLAG)',
             exp.dc.ocpdDCPass, dc.ocpdDCPass);
    t.assert('egcDC',         exp.dc.egcDC,         String(dc.egcDC));

    // Voltage drops + conduit ------------------------------------------------
    t.assert('vString',       exp.dc.vString,       dc.vString,        tol['default']);
    t.assert('dcLength',      exp.dc.dcLength,      dc.dcLength,       tol['default']);
    t.assert('vdropDC',       exp.dc.vdropDC,       dc.vdropDC,        tol['vdrop']);
    t.assert('vdropDCPass',   exp.dc.vdropDCPass,   dc.vdropDCPass);
    t.assert('conduitDC',     exp.dc.conduitDC,     String(dc.conduitDC));

    // Voc cold / Vmp hot -----------------------------------------------------
    t.assert('vocColdPerMod',       exp.dc.vocColdPerMod,  dc.vocColdPerMod,  tol['default']);
    t.assert('vocColdString',       exp.dc.vocColdString,  dc.vocColdString,  tol['loose']);
    t.assert('dc01Pass (Voc cold)', exp.dc.dc01Pass,       dc.dc01Pass);
    t.assert('vmpHotString',        exp.dc.vmpHotString,   dc.vmpHotString,   tol['loose']);
    t.assert('dc02Pass (Vmp hot)',  exp.dc.dc02Pass,       dc.dc02Pass);
  }
});
