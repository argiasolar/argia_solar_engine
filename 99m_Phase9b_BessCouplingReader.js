// =============================================================================
// ARGIA ENGINE -- Phase 9b test suite: bessCoupling reader (Increment 4b-1-test)
// Paste this function into 99_TestRunner.gs, and add the call
//   try { addPhase9bTests(t, ss); } catch (e) { t.error('Phase9b aborted', e); }
// right after the addPhase9Tests block in runTests().
//
// SCOPE: closes the gap Phase 9 left open. Phase 9 tests calcBessCircuit with
// a PASSED-IN coupling value; it never touches the real sheet. Phase 9b checks
// the reader path two ways:
//   PART A -- resolveBessCoupling() unit test: covers blank / unknown / case /
//             whitespace. These CANNOT be written into C17 (it has a strict
//             data-validation dropdown -- DC_COUPLED / AC_COUPLED only), so the
//             fallback logic is tested directly on the pure helper.
//   PART B -- LIVE cell: writes the dropdown-VALID values into INPUT_DESIGN!C17
//             and reads them back through readInputs(). Confirms the map points
//             at the right cell and readInputs() exposes inp.bessCoupling.
//
// NOTE: an earlier version of this suite tried to write 'SOMETHING_ELSE' into
// C17 and Google Sheets rejected it (data-validation). That was a test bug --
// the cell is correctly locked down. The fallback path is real defensive code
// and is now tested via resolveBessCoupling() where junk input is valid.
//
// SAFETY: snapshots C17, writes only dropdown-valid values, ALWAYS restores in
// a finally block -- never leaves the user's INPUT_DESIGN modified.
// =============================================================================

function addPhase9bTests(t, ss) {
  t.suite('Phase9b: bessCoupling reader');

  // === PART A: resolveBessCoupling() pure-logic unit tests ===============
  // Run first -- no sheet I/O, cannot fail on environment.
  t.assert('resolveBessCoupling function defined',
           'function', typeof resolveBessCoupling);
  t.assert('resolve("AC_COUPLED") -> AC_COUPLED',
           'AC_COUPLED', resolveBessCoupling('AC_COUPLED'));
  t.assert('resolve("DC_COUPLED") -> DC_COUPLED',
           'DC_COUPLED', resolveBessCoupling('DC_COUPLED'));
  t.assert('resolve("") blank -> DC_COUPLED default',
           'DC_COUPLED', resolveBessCoupling(''));
  t.assert('resolve(null) -> DC_COUPLED default',
           'DC_COUPLED', resolveBessCoupling(null));
  t.assert('resolve("SOMETHING_ELSE") unknown -> DC_COUPLED default',
           'DC_COUPLED', resolveBessCoupling('SOMETHING_ELSE'));
  t.assert('resolve("  ac_coupled  ") case+space tolerant -> AC_COUPLED',
           'AC_COUPLED', resolveBessCoupling('  ac_coupled  '));

  // === PART B: live INPUT_DESIGN!C17 round-trip ==========================
  var shDesign = ss.getSheetByName('INPUT_DESIGN');
  if (!shDesign) {
    t.error('Phase9b setup', new Error('INPUT_DESIGN sheet missing'));
    return;
  }

  // map points at the right cell
  var m = INPUT_MAP.bessCoupling;
  t.assertTrue('INPUT_MAP.bessCoupling entry exists', !!m);
  if (m) {
    t.assert('bessCoupling mapped sheet = INPUT_DESIGN', 'INPUT_DESIGN', m.sheet);
    t.assert('bessCoupling mapped row = 17', 17, m.row);
    t.assert('bessCoupling mapped col = 3',  3,  m.col);
  }

  // snapshot C17 so we can restore it no matter what
  var snapC17 = shDesign.getRange(17, 3).getValue();

  function setC17(v) {
    shDesign.getRange(17, 3).setValue(v);
    SpreadsheetApp.flush();
  }

  try {
    // Only dropdown-VALID values are written here -- C17 has data validation.
    setC17('AC_COUPLED');
    t.assert('C17=AC_COUPLED -> inp.bessCoupling',
             'AC_COUPLED', readInputs(ss).bessCoupling);

    setC17('DC_COUPLED');
    t.assert('C17=DC_COUPLED -> inp.bessCoupling',
             'DC_COUPLED', readInputs(ss).bessCoupling);

  } finally {
    // ALWAYS restore C17 to its pre-test value
    shDesign.getRange(17, 3).setValue(snapC17);
    SpreadsheetApp.flush();
    t.info('Phase9b cleanup', 'INPUT_DESIGN!C17 restored to pre-test state');
  }
}