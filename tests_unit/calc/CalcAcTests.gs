// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcAcTests.gs
// -----------------------------------------------------------------------------
// PASS 3 MIGRATION: AC calculation suite.
//
// SOURCE: Originally lived as the second half of `testCalcModules(t, ss)` in
//         99_TestRunner.gs (lines 357-394, the "Tier 2 -- calcAC" suite).
//         Migrated 2026-05-21 as part of Pass 3.
//
// COVERAGE
//   calcAC() against TESTPROJ_001 fixture: per-inverter currents and OCPD,
//   temperature corrections (Ft_ac, Fag_ac), conductor + EGC selection,
//   voltage drops, main breaker and feeder sizing, transformer sizing.
//
// CLASSIFICATION
//   group=unit (same rationale as CalcDcTests.gs).
//
// DEPENDENCIES
//   - calcAC requires the output of calcDC as an argument, so this test
//     also calls calcDC. If calcDC is broken, this test will also fail --
//     correct behavior. Separation from UNIT_CALC_DC_TESTPROJ001 lets
//     each failure mode be diagnosed independently.
//   - TESTPROJ_001 (test/TestProjects.gs)
//   - tdBuildTestInputs, tdBuildTestPanel, tdBuildTestInverterBank
//     (test/TestFixtures.gs -- Pass 15 framework helpers; the legacy
//     buildTest* functions in 99_TestRunner.gs were removed in Pass 23)
//     (99_TestRunner.gs -- see migration note in CalcDcTests.gs)
//   - calcDC (04_CalcDC.gs), calcAC (05_CalcAC.gs)
//   - loadNomConstants (02_LoadDB.gs), readElecTables (03_ElecTables.gs)
// =============================================================================


registerTest({
  id      : 'UNIT_CALC_AC_TESTPROJ001',
  group   : 'unit',
  module  : 'calc/ac',
  scenarios: [],
  tags    : ['calc', 'ac', 'testproj001'],
  source  : 'tests_unit/calc/CalcAcTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/ac: TESTPROJ_001');

    var exp = TESTPROJ_001.expected;
    var tol = TESTPROJ_001.tolerance;

    var inp     = tdBuildTestInputs();
    var panel   = tdBuildTestPanel();
    var invBank = tdBuildTestInverterBank();
    var nom     = loadNomConstants(ctx.ss);
    var tbls    = readElecTables(ctx.ss);

    // calcAC requires calcDC's output. If calcDC throws, surface it and exit.
    var dc;
    try {
      dc = calcDC(inp, panel, invBank, nom, tbls);
    } catch (e) {
      t.error('calcDC (prereq for calcAC) threw', e);
      return;
    }

    var ac;
    try {
      ac = calcAC(inp, panel, invBank, nom, tbls, dc);
    } catch (e) {
      t.error('calcAC threw', e);
      return;
    }

    // Per-inverter -----------------------------------------------------------
    t.assert('ambientAC',         exp.ac.ambientAC,         ac.ambientAC);
    t.assert('iNom per inv',      exp.ac.iNomPerInv,        ac.perInverter[0].iNom,     tol['default']);
    t.assert('ocpdReq per inv',   exp.ac.ocpdReqPerInv,     ac.perInverter[0].ocpdReq,  tol['default']);
    t.assert('ocpd per inv',      exp.ac.ocpdPerInv,        ac.perInverter[0].ocpd);
    t.assert('Ft_ac',             exp.ac.Ft_ac,             ac.perInverter[0].Ft_ac,    tol['default']);
    t.assert('Fag_ac',            exp.ac.Fag_ac,            ac.perInverter[0].Fag_ac,   tol['default']);
    t.assert('ampReq per inv',    exp.ac.ampReqPerInv,      ac.perInverter[0].ampReqAC, tol['loose']);
    t.assert('conductor per inv', exp.ac.conductorPerInv,   String(ac.perInverter[0].conductor));
    t.assert('egc per inv',       exp.ac.egcPerInv,         String(ac.perInverter[0].egc));
    t.assert('acLenInv',          exp.ac.acLenInv,          ac.perInverter[0].acLenInv);
    t.assert('vdropAC per inv',   exp.ac.vdropACPerInv,     ac.perInverter[0].vdropAC,  tol['vdrop']);
    t.assert('conduit per inv',   exp.ac.conduitPerInv,     String(ac.perInverter[0].conduit));

    // Main / feeder ----------------------------------------------------------
    t.assert('iTotalAC',          exp.ac.iTotalAC,          ac.iTotalAC,                tol['default']);
    t.assert('mainBreaker',       exp.ac.mainBreaker,       ac.mainBreaker);
    t.assert('parallelRuns',      exp.ac.parallelRuns,      ac.parallelRuns);
    t.assert('iPerRun',           exp.ac.iPerRun,           ac.iPerRun,                 tol['default']);
    t.assert('Fag_main',          exp.ac.Fag_main,          ac.Fag_main,                tol['default']);
    t.assert('ampReqMain',        exp.ac.ampReqMain,        ac.ampReqMain,              tol['loose']);
    t.assert('condMain',          exp.ac.condMain,          String(ac.condMain));
    t.assert('egcMain',           exp.ac.egcMain,           String(ac.egcMain));
    t.assert('feederLen',         exp.ac.feederLen,         ac.feederLen);
    t.assert('vdropFeeder',       exp.ac.vdropFeeder,       ac.vdropFeeder,             tol['vdrop']);
    t.assert('vdropFeederPass',   exp.ac.vdropFeederPass,   ac.vdropFeederPass);
    t.assert('conduitMain',       exp.ac.conduitMain,       String(ac.conduitMain));

    // Transformer ------------------------------------------------------------
    t.assert('apparentPower',     exp.ac.apparentPower,     ac.apparentPower,           tol['default']);
    t.assert('transformer',       exp.ac.transformer,       ac.transformer);
    t.assert('transformerPass',   exp.ac.transformerPass,   ac.transformerPass);
  }
});
