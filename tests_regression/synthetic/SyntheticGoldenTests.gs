// =============================================================================
// tests_regression/synthetic/SyntheticGoldenTests.gs
// T12 (chunk c) — LIVE regression: reads the _SYNTH_CAPTURE sheet (written by
// Synthetic Test Mode) and asserts each present fixture column against its
// LOCKED structural goldens, plus the cross-fixture monotonic scaling check.
//
// Read-only. Workbook-dependent: with no spreadsheet context (Node self-test)
// it skips cleanly. Run it from the real workbook via Setup > Run ALL Tests,
// AFTER running SYNTH_500 / 600 / 650 from Synthetic Test Mode (they accumulate
// into _SYNTH_CAPTURE, so all three columns can be present together).
//
// The comparison LOGIC lives in compareSyntheticGoldens /
// compareSyntheticGoldensMonotonic (SyntheticFixtures.gs) and is unit-tested in
// Node (UNIT_SYNTHETIC_GOLDENS_COMPARE); this test only applies it to the live
// capture sheet.
// =============================================================================

registerTest({
  id: 'REG_SYNTHETIC_GOLDENS',
  group: 'regression', module: 'regression/synthetic',
  scenarios: [], tags: ['regression', 'synthetic', 'goldens', 'read-only', 't12c'],
  source: 'tests_regression/synthetic/SyntheticGoldenTests.gs',
  fn: function (t, ctx) {
    t.suite('REG regression/synthetic: locked structural goldens from _SYNTH_CAPTURE');

    var ss = ctx && ctx.ss;
    if (!ss) { t.info('skipped', 'no spreadsheet context (run from the ARGIA menu)'); return; }

    var sh = ss.getSheetByName('_SYNTH_CAPTURE');
    if (!sh) {
      t.info('skipped', '_SYNTH_CAPTURE absent -- run Synthetic Test Mode first');
      return;
    }

    var data = sh.getDataRange().getValues();
    if (!data || data.length < 2) { t.info('skipped', '_SYNTH_CAPTURE is empty'); return; }

    // Header row: ['capture_key', 'SYNTH_500', 'SYNTH_600', ...]
    var header = data[0];
    var idCols = {};
    for (var c = 1; c < header.length; c++) {
      var h = String(header[c] || '').trim();
      if (h) idCols[h] = c;
    }

    // Build {id: {capture_key: value}} from the rows.
    var capById = {};
    Object.keys(idCols).forEach(function (id) { capById[id] = {}; });
    for (var r = 1; r < data.length; r++) {
      var key = String(data[r][0] || '').trim();
      if (!key) continue;
      Object.keys(idCols).forEach(function (id) { capById[id][key] = data[r][idCols[id]]; });
    }

    // Per-fixture goldens (only for columns actually captured).
    var anyPresent = false;
    ['SYNTH_500', 'SYNTH_600', 'SYNTH_650'].forEach(function (id) {
      if (!capById[id]) {
        t.info(id, 'not captured -- run it from Synthetic Test Mode to include it');
        return;
      }
      anyPresent = true;
      var notes = compareSyntheticGoldens(SYNTHETIC_FIXTURES[id], capById[id]);
      t.assert(id + ' structural goldens (failures)', 0, notes.length);
      notes.forEach(function (n) { t.info(id + ' golden FAIL', n); });
    });

    if (!anyPresent) {
      t.info('skipped', 'no SYNTH_* columns in _SYNTH_CAPTURE');
      return;
    }

    // Cross-fixture monotonic scaling (only fires when all three present).
    var mono = compareSyntheticGoldensMonotonic(capById);
    t.assert('monotonic 500<600<650 (failures)', 0, mono.length);
    mono.forEach(function (n) { t.info('monotonic FAIL', n); });
  }
});
