// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/WriteMdcV2CitationBugTests.gs
// -----------------------------------------------------------------------------
// Bug regression tests for v3.7.8 patch B9:
//
//   B9 - writers_v2/WriteMdcV2.js:126,128: §0 GENERALES citations for
//        project name and client name were hardcoded as
//        cellRef('INPUT_GENERAL', 'C5') / 'C6'. INPUT_GENERAL was retired
//        in v2.0.2+ — those fields now live on INPUT_PROJECT (D8, D9).
//        Customer-facing transparency lie: MDC pointed customers at a
//        sheet that no longer exists.
//
//   Fix: citations now use inputLocation('projectName') and
//   inputLocation('clientName'), which resolve via INPUT_MAP — the single
//   source of truth for input cell coordinates.
//
// COVERAGE STRATEGY
//   Contract verification: assert that inputLocation('projectName') and
//   inputLocation('clientName') return the new INPUT_PROJECT coordinates,
//   NOT INPUT_GENERAL. These return values land directly in MDC.F7 / MDC.F8
//   via the patched row() calls in writeMdcV2.
//
//   We deliberately do NOT mock writeMdcV2 end-to-end. The writer has many
//   dependencies (lay.bom.dcCableM, ac.primary.model, ...) that aren't
//   relevant to the B9 bug. Asserting the inputLocation contract proves
//   the citation column gets the right value, and is far more robust.
// =============================================================================


registerTest({
  id      : 'UNIT_WRITERS_V2_MDC_B9_INPUTLOCATION_RESOLVES_CORRECTLY',
  group   : 'unit',
  module  : 'writers_v2/mdc',
  scenarios: [],
  tags    : ['writers_v2', 'mdc', 'bug', 'b9', 'regression', 'inputLocation'],
  source  : 'tests_unit/writers_v2/WriteMdcV2CitationBugTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers_v2/mdc: B9 inputLocation contract for §0 keys');

    var projectLoc = inputLocation('projectName');
    var clientLoc  = inputLocation('clientName');

    // POSITIVE: new coordinates per INPUT_MAP / _MAP_PROJECT
    t.assert('inputLocation("projectName") == INPUT_PROJECT!D8',
      'INPUT_PROJECT!D8', projectLoc);
    t.assert('inputLocation("clientName")  == INPUT_PROJECT!D9',
      'INPUT_PROJECT!D9', clientLoc);

    // NEGATIVE: the retired INPUT_GENERAL sheet must not surface anywhere
    t.assertFalse('projectName citation does not reference INPUT_GENERAL',
      String(projectLoc).indexOf('INPUT_GENERAL') !== -1);
    t.assertFalse('clientName citation does not reference INPUT_GENERAL',
      String(clientLoc).indexOf('INPUT_GENERAL') !== -1);

    // Defense in depth: the field must actually exist (not be the
    // "(unknown key)" sentinel). If someone renames the input key,
    // we want a loud failure here, not silent "(unknown key: X)" text
    // landing in the customer MDC.
    t.assertFalse('projectName key exists in INPUT_MAP',
      String(projectLoc).indexOf('unknown key') !== -1);
    t.assertFalse('clientName key exists in INPUT_MAP',
      String(clientLoc).indexOf('unknown key') !== -1);
  }
});
