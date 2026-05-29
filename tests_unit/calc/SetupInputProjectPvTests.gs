// =============================================================================
// ARGIA TESTS -- tests_unit/calc/SetupInputProjectPvTests.gs
// -----------------------------------------------------------------------------
// CHUNK 7 Session 1 -- desync guard + idempotency for the SOLAR-section setup.
//
// The setup script (01d) and the input map (02c) both reference the same
// INPUT_PROJECT cells. If a future edit moves a row in one but not the
// other, the engine would read a different cell than the setup wrote --
// silent data corruption. These tests assert they stay aligned, and that
// the setup never overwrites a designer's existing value.
//
// COVERAGE (4 tests):
//   1. UNIT_PV_SETUP_ROWS_MATCH_INPUT_MAP   -- 01d rows == 02c map rows
//   2. UNIT_PV_SETUP_WRITES_BLANK_CELLS     -- blank cell gets the default
//   3. UNIT_PV_SETUP_NEVER_OVERWRITES       -- existing value is preserved
//   4. UNIT_PV_SETUP_IS_IDEMPOTENT          -- second run = all skipped
// =============================================================================

// Mock INPUT_PROJECT sheet that records writes and serves seeded values.
function _pvSetupMockSheet(seed) {
  seed = seed || {};
  var cells = {};   // "row,col" -> value
  for (var k in seed) if (seed.hasOwnProperty(k)) cells[k] = seed[k];
  function range(r, c) {
    var key = r + ',' + c;
    var self = {
      getValue: function () { return cells[key] != null ? cells[key] : ''; },
      setValue: function (v) { cells[key] = v; return self; },
      setFontWeight: function () { return self; },
      setDataValidation: function () { return self; }
    };
    return self;
  }
  return {
    _cells: cells,
    getRange: function (r, c) { return range(r, c); }
  };
}

function _pvSetupMockSs(sheet) {
  return { getSheetByName: function (n) { return n === 'INPUT_PROJECT' ? sheet : null; } };
}


registerTest({
  id: 'UNIT_PV_SETUP_ROWS_MATCH_INPUT_MAP', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7', 'setup', 'invariant'],
  source: 'tests_unit/calc/SetupInputProjectPvTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: setup-script rows MUST match input-map rows (desync guard)');

    // INPUT_PROJECT_PV_ROWS is defined in 01d; INPUT_MAP / getInputMapEntry
    // exposes the map rows. We compare the four value-cell rows.
    var setupRows = INPUT_PROJECT_PV_ROWS;

    // Pull the map rows. The map is keyed by field name; we read the row for
    // each. (getInputMapEntry is the engine's accessor; if unavailable in the
    // harness we read the raw map object.)
    function mapRow(field) {
      if (typeof getInputMapEntry === 'function') {
        var e = getInputMapEntry(field);
        return e ? e.row : null;
      }
      // Fallback: the harness exposes the merged map as INPUT_MAP.
      return (typeof INPUT_MAP !== 'undefined' && INPUT_MAP[field])
        ? INPUT_MAP[field].row : null;
    }

    t.assert('installPv row aligns',        setupRows.INSTALL_PV,      mapRow('installPv'));
    t.assert('hasExistingPv row aligns',     setupRows.HAS_EXISTING_PV, mapRow('hasExistingPv'));
    t.assert('existingPvKwp row aligns',     setupRows.EXISTING_PV_KWP, mapRow('existingPvKwp'));
    t.assert('existingPvAnnualKwh row aligns', setupRows.EXISTING_PV_KWH, mapRow('existingPvAnnualKwh'));
  }
});


registerTest({
  id: 'UNIT_PV_SETUP_WRITES_BLANK_CELLS', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7', 'setup'],
  source: 'tests_unit/calc/SetupInputProjectPvTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: setup writes defaults into blank cells');

    var sheet = _pvSetupMockSheet();   // all blank
    var ret = setupInputProjectPvSection(_pvSetupMockSs(sheet));
    var R = INPUT_PROJECT_PV_ROWS;

    t.assert('installPv default YES',  'YES', sheet._cells[R.INSTALL_PV + ',4']);
    t.assert('hasExistingPv default NO', 'NO', sheet._cells[R.HAS_EXISTING_PV + ',4']);
    t.assert('existingPvKwp default 0',    0,  sheet._cells[R.EXISTING_PV_KWP + ',4']);
    t.assertTrue('reports created', ret.created.length >= 4);
  }
});


registerTest({
  id: 'UNIT_PV_SETUP_NEVER_OVERWRITES', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7', 'setup'],
  source: 'tests_unit/calc/SetupInputProjectPvTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: setup NEVER overwrites a designer value');

    var R = INPUT_PROJECT_PV_ROWS;
    // Designer already set installPv = NO (battery-only project).
    var sheet = _pvSetupMockSheet({ });
    sheet._cells[R.INSTALL_PV + ',4'] = 'NO';

    var ret = setupInputProjectPvSection(_pvSetupMockSs(sheet));

    t.assert('installPv stays NO (not clobbered)', 'NO', sheet._cells[R.INSTALL_PV + ',4']);
    t.assertTrue('installPv reported skipped',
                 ret.skipped.indexOf('Instalar PV nuevo') >= 0);
  }
});


registerTest({
  id: 'UNIT_PV_SETUP_IS_IDEMPOTENT', group: 'unit', module: 'calc/pv',
  scenarios: [], tags: ['calc', 'pv', 'chunk7', 'setup'],
  source: 'tests_unit/calc/SetupInputProjectPvTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/pv: setup is idempotent (second run writes no defaults)');

    var sheet = _pvSetupMockSheet();
    setupInputProjectPvSection(_pvSetupMockSs(sheet));   // first run fills
    var ret2 = setupInputProjectPvSection(_pvSetupMockSs(sheet));   // second run

    t.assert('second run creates nothing new', 0, ret2.created.length);
    t.assertTrue('second run skips all value rows', ret2.skipped.length >= 4);
  }
});
