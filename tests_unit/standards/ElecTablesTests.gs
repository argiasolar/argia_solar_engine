// =============================================================================
// ARGIA TESTS -- tests_unit/standards/ElecTablesTests.gs
// -----------------------------------------------------------------------------
// PASS 2 MIGRATION: First suite migrated to the new contract-based framework.
//
// SOURCE: Originally lived as `testElecTables(t, ss)` in 99_TestRunner.gs
//         (lines 245-307). Migrated 2026-05-20 as proof of the migration
//         pattern documented in TEST_ARCHITECTURE.
//
// COVERAGE
//   - Roof temperature adders (NOM 001 SEDE Tabla 310-15(b)(3)(c) lookup)
//   - Ampacity temperature correction factor Ft (Tabla 310-15(b)(2)(a))
//   - Adjustment factor Fag for grouped conductors (Tabla 310-15(b)(3)(a))
//   - Next-larger-OCPD lookup (NOM 240.6 standard breaker sizes)
//   - Conductor sizing by ampacity demand
//   - Equipment grounding conductor sizing (Tabla 250-122)
//   - Next-larger-transformer lookup
//   - NOM constants surface: load factors, bifacial factor, max parallel runs
//
// CO-EXISTENCE
//   The legacy `testElecTables` in 99_TestRunner.gs is UNCHANGED and still
//   runs from `runTests()`. This file runs from `runUnitTests()`. Both
//   should report the same passes. Duplication is intentional for Pass 2 --
//   the legacy version gets deleted only after all suites are migrated
//   and the new framework is the verified source of truth (Pass 7).
// =============================================================================


registerTest({
  id      : 'UNIT_STANDARDS_ELEC_TABLES_LOOKUPS',
  group   : 'unit',
  module  : 'standards/elec_tables',
  scenarios: [],
  tags    : ['standards', 'elec', 'nom-001-sede'],
  source  : 'tests_unit/standards/ElecTablesTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT standards/elec_tables: lookups');

    var tbls = readElecTables(ctx.ss);

    // --- Roof temp adder ----------------------------------------------------
    t.assert('getRoofTempAdder(90)  = 22',  22, getRoofTempAdder(90,  tbls));
    t.assert('getRoofTempAdder(13)  = 33',  33, getRoofTempAdder(13,  tbls));
    t.assert('getRoofTempAdder(300) = 17',  17, getRoofTempAdder(300, tbls));

    // --- Temp factor (Ft) ---------------------------------------------------
    t.assert('getTempFactor(60)  = 0.71', 0.71, getTempFactor(60, tbls));
    t.assert('getTempFactor(38)  = 0.91', 0.91, getTempFactor(38, tbls));
    t.assert('getTempFactor(47)  = 0.82', 0.82, getTempFactor(47, tbls));
    t.assert('getTempFactor(10)  = 1.15', 1.15, getTempFactor(10, tbls));

    // --- Grouping factor (Fag) ----------------------------------------------
    t.assert('getGroupingFactor(2)  = 1.00', 1.00, getGroupingFactor(2,  tbls));
    t.assert('getGroupingFactor(3)  = 1.00', 1.00, getGroupingFactor(3,  tbls));
    t.assert('getGroupingFactor(6)  = 0.80', 0.80, getGroupingFactor(6,  tbls));
    t.assert('getGroupingFactor(10) = 0.50', 0.50, getGroupingFactor(10, tbls));

    // --- Next breaker -------------------------------------------------------
    t.assert('nextBreaker(22.30)  = 25',  25,  nextBreaker(22.30,  tbls));
    t.assert('nextBreaker(150.35) = 175', 175, nextBreaker(150.35, tbls));
    // 700 verified against NOM_DB 66_NOM_OCPD (2026-06-09): the ladder is
    // ... 500, 600, 700, 800 ... -- 700A is a standard size (NEC 240.6 / NOM
    // equivalent). The old expectation (800) predates the 700 step.
    t.assert('nextBreaker(601.40) = 700', 700, nextBreaker(601.40, tbls));

    // --- Conductor selection ------------------------------------------------
    var c1 = selectConductor(31.40, tbls);
    t.assert('selectConductor(31.40)  = 10 AWG',    '10',  String(c1.size));
    t.assert('selectConductor(31.40)  ampacity 40', 40,    c1.ampacity);
    var c2 = selectConductor(132.18, tbls);
    t.assert('selectConductor(132.18) = 1 AWG',     '1',   String(c2.size));
    var c3 = selectConductor(330.44, tbls);
    t.assert('selectConductor(330.44) = 350 kcmil', '350', String(c3.size));

    // --- EGC ---------------------------------------------------------------
    var egc1 = getEgcSize(25, tbls);
    t.assert('getEgcSize(25)  = 10 AWG',  '10',  String(egc1.egcSize));
    var egc2 = getEgcSize(175, tbls);
    t.assert('getEgcSize(175) = 6 AWG',   '6',   String(egc2.egcSize));
    var egc3 = getEgcSize(800, tbls);
    t.assert('getEgcSize(800) = 1/0 AWG', '1/0', String(egc3.egcSize));

    // --- Next transformer ---------------------------------------------------
    t.assert('nextTransformer(533.33) = 750', 750, nextTransformer(533.33, tbls));
    t.assert('nextTransformer(500)    = 500', 500, nextTransformer(500,    tbls));
    t.assert('nextTransformer(501)    = 750', 750, nextTransformer(501,    tbls));
  }
});


registerTest({
  id      : 'UNIT_STANDARDS_NOM_CONSTANTS_DEFAULTS',
  group   : 'unit',
  module  : 'standards/nom_constants',
  scenarios: [],
  tags    : ['standards', 'nom', 'constants'],
  source  : 'tests_unit/standards/ElecTablesTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT standards/nom_constants: defaults');

    var nom = loadNomConstants(ctx.ss);
    t.assert('nom.currentFactor1 = 1.25',   1.25,   nom.currentFactor1);
    t.assert('nom.currentFactor2 = 1.5625', 1.5625, nom.currentFactor2);
    t.assertTrue('nom.bifacialFactor exists',
                 typeof nom.bifacialFactor === 'number');
    t.assertTrue('nom.maxParallelRunA exists',
                 typeof nom.maxParallelRunA === 'number');
  }
});
