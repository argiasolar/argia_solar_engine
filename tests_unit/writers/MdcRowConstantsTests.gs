// =============================================================================
// ARGIA TESTS -- tests_unit/writers/MdcRowConstantsTests.gs
// -----------------------------------------------------------------------------
// PASS 5 MIGRATION: MDC §7 BESS row constants suite.
//
// SOURCE: Originally lived as addPhase11Tests in
//         99o_Phase11_MCDBessRowConstants.gs (whole-file suite).
//         Migrated 2026-05-21 as part of Pass 5.
//
// COVERAGE
//   Verifies the MDC_ROW row-index map for §7 BESS:
//     - All 11 §7 constants (SEC7_HEADER..BESS_NOM_CITE) are defined numbers
//     - §7 sits below the existing TIMESTAMP footer (no overlap)
//     - §7 rows are contiguous (100..110)
//     - §7 stays within the MDC writer's clear-range (<=120)
//     - No §7 row collides with any other MDC_ROW value
//     - The whole MDC_ROW map is collision-free
//
// CLASSIFICATION
//   group=unit. Pure constant checks against the MDC_ROW global. No I/O.
//
// DEPENDENCIES
//   - MDC_ROW (07_WriteMDC.gs)
//
// PLACEMENT NOTE
//   These tests live in tests_unit/writers/ because MDC_ROW is owned by
//   the MDC writer (07_WriteMDC.gs). When the MDC writer integration tests
//   migrate (Pass 6+), they'll be neighbors at tests_integration/writers/.
//
// CO-EXISTENCE
//   99o_Phase11_MCDBessRowConstants.gs is unchanged and still runs from
//   legacy runTests(). Deleted in Pass 7 along with the rest of 99h-99u.
// =============================================================================


registerTest({
  id      : 'UNIT_WRITERS_MDC_ROW_CONSTANTS',
  group   : 'unit',
  module  : 'writers/mdc',
  scenarios: [],
  tags    : ['writers', 'mdc', 'constants', 'bess'],
  source  : 'tests_unit/writers/MdcRowConstantsTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers/mdc: §7 row constants');

    // === The §7 constants must all be defined =============================
    var sec7Keys = [
      'SEC7_HEADER', 'BESS_MODEL', 'BESS_CAPACITY', 'BESS_POWER',
      'BESS_USABLE', 'BESS_COUPLING', 'BESS_CIRC_STAT', 'BESS_CIRC_RUN1',
      'BESS_CIRC_RUN2', 'BESS_BUSBAR', 'BESS_NOM_CITE'
    ];
    var allDefined = true;
    for (var i = 0; i < sec7Keys.length; i++) {
      if (typeof MDC_ROW[sec7Keys[i]] !== 'number') allDefined = false;
    }
    t.assertTrue('all 11 §7 MDC_ROW constants are defined numbers', allDefined);

    // === §7 sits below the footer (no overlap with LEGEND/TIMESTAMP) ======
    t.assertTrue('SEC7_HEADER below TIMESTAMP',
                 MDC_ROW.SEC7_HEADER > MDC_ROW.TIMESTAMP);

    // === §7 rows are contiguous and ascending ==============================
    var ordered = sec7Keys.map(function (k) { return MDC_ROW[k]; });
    var contiguous = true;
    for (var j = 1; j < ordered.length; j++) {
      if (ordered[j] !== ordered[j - 1] + 1) contiguous = false;
    }
    t.assertTrue('§7 rows are contiguous (100..110)', contiguous);
    t.assert('§7 first row = 100', 100, MDC_ROW.SEC7_HEADER);
    t.assert('§7 last row  = 110', 110, MDC_ROW.BESS_NOM_CITE);

    // === §7 is inside the MDC writer's clear range (rows 6-120) ===========
    t.assertTrue('BESS_NOM_CITE within writer clear-range (<=120)',
                 MDC_ROW.BESS_NOM_CITE <= 120);

    // === No §7 row collides with any other MDC_ROW value ==================
    var nonSec7 = [];
    for (var key in MDC_ROW) {
      if (sec7Keys.indexOf(key) < 0) nonSec7.push(MDC_ROW[key]);
    }
    var collision = false;
    for (var a = 0; a < ordered.length; a++) {
      if (nonSec7.indexOf(ordered[a]) >= 0) collision = true;
    }
    t.assertFalse('no §7 row collides with an existing MDC_ROW', collision);

    // === The whole MDC_ROW map is still collision-free ====================
    var allRows = [];
    for (var k2 in MDC_ROW) { allRows.push(MDC_ROW[k2]); }
    var dupCount = 0;
    for (var d = 0; d < allRows.length; d++) {
      if (allRows.indexOf(allRows[d]) !== d) dupCount++;
    }
    t.assert('MDC_ROW map has zero duplicate row numbers', 0, dupCount);
  }
});
