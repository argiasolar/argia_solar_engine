// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/BessLayoutContractTests.gs
// -----------------------------------------------------------------------------
// [A2c] Locks the WELL-FORMEDNESS of the INPUT_BESS map entries (_MAP_BESS +
// _MAP_BESS_S6 via INPUT_MAP). The INPUT_BESS tab is rendered and read from
// these entries, so structural defects here become silent layout/read bugs:
// two keys writing the same cell, a dropdown seeded with a value its own
// list rejects, sections whose row ranges interleave, etc.
//
// Deliberately GENERIC: asserts structural invariants, not specific row
// numbers, so legitimate map growth (new fields, new sections) passes while
// genuine defects (collisions, invalid seeds, overlapping sections) fail.
//
// Pure map inspection -- no sheet access, runs headless.
// =============================================================================

registerTest({
  id      : 'REG_INPUT_MAP_BESS_LAYOUT_CONTRACT',
  group   : 'regression',
  module  : 'inputs/map',
  scenarios: [],
  tags    : ['inputs', 'map', 'bess', 'a2', 'layout', 'contract'],
  source  : 'tests_regression/inputs/BessLayoutContractTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/map [A2c]: INPUT_BESS layout contract');

    var keys = Object.keys(INPUT_MAP).filter(function (k) {
      return INPUT_MAP[k].sheet === 'INPUT_BESS' || INPUT_MAP[k].sheet === SH.INPUT_BESS;
    });
    t.assertTrue('INPUT_BESS has map entries (got ' + keys.length + ')',
                 keys.length >= 30);

    // -- 1. col-C tab: every entry's value cell is col 3 ---------------------
    var offCol = keys.filter(function (k) { return INPUT_MAP[k].col !== 3; });
    t.assert('all INPUT_BESS entries are col 3 (col-C). Offenders: ['
             + offCol.join(', ') + ']', 0, offCol.length);

    // -- 2. no cell collisions: row+col unique across the tab ----------------
    var seen = {}, collisions = [];
    keys.forEach(function (k) {
      var cell = INPUT_MAP[k].row + ',' + INPUT_MAP[k].col;
      if (seen[cell]) collisions.push(k + ' vs ' + seen[cell] + ' @ R' + cell);
      else seen[cell] = k;
    });
    t.assert('no two keys share a cell. Collisions: [' + collisions.join('; ') + ']',
             0, collisions.length);

    // -- 3. every entry has a non-empty label + known type -------------------
    var KNOWN_TYPES = ['number', 'percent', 'dropdown', 'text', 'date', 'flag'];
    var badLabel = [], badType = [];
    keys.forEach(function (k) {
      var m = INPUT_MAP[k];
      if (!m.label || !String(m.label).trim()) badLabel.push(k);
      if (KNOWN_TYPES.indexOf(m.type) < 0) badType.push(k + ':' + m.type);
    });
    t.assert('all labels non-empty. Missing: [' + badLabel.join(', ') + ']',
             0, badLabel.length);
    t.assert('all types known to _applyTypeValidation. Unknown: ['
             + badType.join(', ') + ']', 0, badType.length);

    // -- 4. dropdown integrity: list present; seed/default inside the list ---
    var ddBad = [];
    keys.forEach(function (k) {
      var m = INPUT_MAP[k];
      if (m.type !== 'dropdown') return;
      if (!m.dropdown || !m.dropdown.length) { ddBad.push(k + ': no list'); return; }
      if (m.hasOwnProperty('seed') && m.seed !== ''
          && m.dropdown.indexOf(m.seed) < 0) {
        ddBad.push(k + ': seed "' + m.seed + '" not in list');
      }
      if (m.default !== '' && m.dropdown.indexOf(m.default) < 0) {
        ddBad.push(k + ': default "' + m.default + '" not in list');
      }
    });
    t.assert('dropdown seeds/defaults valid. Defects: [' + ddBad.join('; ') + ']',
             0, ddBad.length);

    // -- 5. numeric defaults are numbers --------------------------------------
    var numBad = [];
    keys.forEach(function (k) {
      var m = INPUT_MAP[k];
      if ((m.type === 'number' || m.type === 'percent')
          && m.hasOwnProperty('default')
          && typeof m.default !== 'number') {
        numBad.push(k + ': default ' + JSON.stringify(m.default));
      }
    });
    t.assert('numeric defaults are numbers. Defects: [' + numBad.join('; ') + ']',
             0, numBad.length);

    // -- 6. sections occupy DISJOINT row ranges -------------------------------
    // Sort sections by their min row; each section's max row must be below
    // the next section's min row (interleaved sections = rendering chaos).
    var secRange = {};
    keys.forEach(function (k) {
      var m = INPUT_MAP[k], s = m.section || '(none)';
      if (!secRange[s]) secRange[s] = { min: m.row, max: m.row };
      if (m.row < secRange[s].min) secRange[s].min = m.row;
      if (m.row > secRange[s].max) secRange[s].max = m.row;
    });
    var ordered = Object.keys(secRange).sort(function (a, b) {
      return secRange[a].min - secRange[b].min;
    });
    var overlaps = [];
    for (var i = 1; i < ordered.length; i++) {
      var prev = ordered[i - 1], cur = ordered[i];
      if (secRange[prev].max >= secRange[cur].min) {
        overlaps.push(prev + ' [' + secRange[prev].min + '-' + secRange[prev].max
          + '] overlaps ' + cur + ' [' + secRange[cur].min + '-' + secRange[cur].max + ']');
      }
    }
    t.assert('section row ranges disjoint. Overlaps: [' + overlaps.join('; ') + ']',
             0, overlaps.length);
    t.assertTrue('multiple sections present (got ' + ordered.length + ')',
                 ordered.length >= 6);
  }
});
