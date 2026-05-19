// =============================================================================
// ARGIA ENGINE -- Phase 11 test suite: MDC §7 BESS row constants (Increment 4b-3a)
// Paste this function into 99_TestRunner.gs, and add the call
//   try { addPhase11Tests(t, ss); } catch (e) { t.error('Phase11 aborted', e); }
// right after the addPhase10Tests block in runTests().
//
// SCOPE: Increment 4b-3a added the MDC §7 BESS section to the template:
//   - MDC_ROW constants SEC7_HEADER..BESS_NOM_CITE (rows 100-110)
//   - the §7 header in 02e_InputSetup.js sectionHeaders list
//   - extended the CF status range and F-G mute range to row 110
//
// This phase verifies the CONSTANTS are correct and internally consistent --
// that is what 4b-3a actually changed. It does NOT rebuild the MDC template
// (setupMDCTemplate is destructive and refuses on populated tabs). The 02e
// range/header edits are exercised on the next genuine template rebuild, and
// 4b-3b's writer test will confirm the rows are reachable in practice.
//
// No spreadsheet mutation -- pure constant checks, safe to run anytime.
// =============================================================================

function addPhase11Tests(t, ss) {
  t.suite('Phase11: MDC §7 BESS row constants');

  // -- the §7 constants must all be defined --------------------------------
  var sec7Keys = [
    'SEC7_HEADER', 'BESS_MODEL', 'BESS_CAPACITY', 'BESS_POWER',
    'BESS_USABLE', 'BESS_COUPLING', 'BESS_CIRC_STAT', 'BESS_CIRC_RUN1',
    'BESS_CIRC_RUN2', 'BESS_BUSBAR', 'BESS_NOM_CITE',
  ];
  var allDefined = true;
  for (var i = 0; i < sec7Keys.length; i++) {
    if (typeof MDC_ROW[sec7Keys[i]] !== 'number') allDefined = false;
  }
  t.assertTrue('all 11 §7 MDC_ROW constants are defined numbers', allDefined);

  // -- §7 sits BELOW the footer (no overlap with LEGEND / TIMESTAMP) -------
  t.assertTrue('SEC7_HEADER below TIMESTAMP',
               MDC_ROW.SEC7_HEADER > MDC_ROW.TIMESTAMP);

  // -- §7 rows are contiguous and ascending -------------------------------
  var ordered = sec7Keys.map(function (k) { return MDC_ROW[k]; });
  var contiguous = true;
  for (var j = 1; j < ordered.length; j++) {
    if (ordered[j] !== ordered[j - 1] + 1) contiguous = false;
  }
  t.assertTrue('§7 rows are contiguous (100..110)', contiguous);
  t.assert('§7 first row = 100',  100, MDC_ROW.SEC7_HEADER);
  t.assert('§7 last row  = 110',  110, MDC_ROW.BESS_NOM_CITE);

  // -- §7 is inside the MDC writer's clear range (rows 6-120) -------------
  t.assertTrue('BESS_NOM_CITE within writer clear-range (<=120)',
               MDC_ROW.BESS_NOM_CITE <= 120);

  // -- no §7 row collides with ANY other MDC_ROW value --------------------
  var nonSec7 = [];
  for (var key in MDC_ROW) {
    if (sec7Keys.indexOf(key) < 0) nonSec7.push(MDC_ROW[key]);
  }
  var collision = false;
  for (var a = 0; a < ordered.length; a++) {
    if (nonSec7.indexOf(ordered[a]) >= 0) collision = true;
  }
  t.assertFalse('no §7 row collides with an existing MDC_ROW', collision);

  // -- the whole MDC_ROW map is still collision-free ----------------------
  var allRows = [];
  for (var k2 in MDC_ROW) { allRows.push(MDC_ROW[k2]); }
  var dupCount = 0;
  for (var d = 0; d < allRows.length; d++) {
    if (allRows.indexOf(allRows[d]) !== d) dupCount++;
  }
  t.assert('MDC_ROW map has zero duplicate row numbers', 0, dupCount);
}