// =============================================================================
// ARGIA TESTS -- tests_unit/setup/SetupSectionGuardTests.gs
// -----------------------------------------------------------------------------
// CHUNK 7 (hardening) -- locks 00c_SetupSectionGuard.js.
//
// The headline test reproduces the actual DISTANCIAS collision and proves the
// guard would have caught it BEFORE any write -- the thing the mock-based
// setup tests couldn't see.
//
// COVERAGE (9 tests):
//   1. UNIT_SSG_LABEL_WRITES_BLANK
//   2. UNIT_SSG_LABEL_MATCHED_NOOP          (idempotent re-run)
//   3. UNIT_SSG_LABEL_COLLISION_THROWS      (the core protection)
//   4. UNIT_SSG_LABEL_COLLISION_SKIP_MODE   (report, don't throw)
//   5. UNIT_SSG_VALUE_WRITES_BLANK
//   6. UNIT_SSG_VALUE_NEVER_OVERWRITES
//   7. UNIT_SSG_PREFLIGHT_PASSES_EMPTY
//   8. UNIT_SSG_PREFLIGHT_CATCHES_DISTANCIAS  (the real incident, replayed)
//   9. UNIT_SSG_PREFLIGHT_ALLOWS_IDEMPOTENT_RERUN
// =============================================================================

// Minimal sheet mock: a cell store keyed "row,col".
function _ssgMockSheet(seed) {
  var cells = {};
  if (seed) for (var k in seed) if (seed.hasOwnProperty(k)) cells[k] = seed[k];
  return {
    _cells: cells,
    getRange: function (r, c) {
      var key = r + ',' + c;
      var self = {
        getValue: function () { return cells[key] != null ? cells[key] : ''; },
        setValue: function (v) { cells[key] = v; return self; }
      };
      return self;
    }
  };
}

registerTest({
  id: 'UNIT_SSG_LABEL_WRITES_BLANK', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('UNIT setup/guard: label written into a blank cell');
    var sh = _ssgMockSheet();
    var res = writeSectionLabel(sh, 58, 2, 'Carga crítica (kW)');
    t.assert('result written', 'written', res);
    t.assert('cell holds label', 'Carga crítica (kW)', sh._cells['58,2']);
  }
});

registerTest({
  id: 'UNIT_SSG_LABEL_MATCHED_NOOP', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('UNIT setup/guard: re-writing the SAME label is a safe no-op');
    var sh = _ssgMockSheet({ '58,2': 'Carga crítica (kW)' });
    var res = writeSectionLabel(sh, 58, 2, 'Carga crítica (kW)');
    t.assert('result matched', 'matched', res);
  }
});

registerTest({
  id: 'UNIT_SSG_LABEL_COLLISION_THROWS', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7', 'invariant'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('UNIT setup/guard: writing OVER different content THROWS (core protection)');
    // The DISTANCIAS cell already says "Voltaje bus DC:"; we try to write a
    // resilience label over it. MUST throw, MUST NOT overwrite.
    var sh = _ssgMockSheet({ '44,2': 'Voltaje bus DC:' });
    var threw = false;
    try {
      writeSectionLabel(sh, 44, 2, 'Eventos por año');
    } catch (e) {
      threw = true;
      t.assertTrue('error names the collision', e.message.indexOf('COLLISION') >= 0);
      t.assertTrue('error shows existing content', e.message.indexOf('Voltaje bus DC') >= 0);
    }
    t.assertTrue('it threw', threw);
    t.assert('cell NOT overwritten', 'Voltaje bus DC:', sh._cells['44,2']);
  }
});

registerTest({
  id: 'UNIT_SSG_LABEL_COLLISION_SKIP_MODE', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('UNIT setup/guard: skip-mode reports collision without throwing');
    var sh = _ssgMockSheet({ '44,2': 'Voltaje bus DC:' });
    var ctx = { collisions: [], onCollision: 'skip' };
    var res = writeSectionLabel(sh, 44, 2, 'Eventos por año', ctx);
    t.assert('result collision', 'collision', res);
    t.assert('recorded one collision', 1, ctx.collisions.length);
    t.assert('cell untouched', 'Voltaje bus DC:', sh._cells['44,2']);
  }
});

registerTest({
  id: 'UNIT_SSG_VALUE_WRITES_BLANK', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('UNIT setup/guard: value written into a blank cell');
    var sh = _ssgMockSheet();
    var res = writeSectionValue(sh, 58, 3, 0);
    t.assert('written', 'written', res);
    t.assert('cell is 0', 0, sh._cells['58,3']);
  }
});

registerTest({
  id: 'UNIT_SSG_VALUE_NEVER_OVERWRITES', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('UNIT setup/guard: value never overwrites a designer entry');
    var sh = _ssgMockSheet({ '58,3': 250 });   // designer set 250
    var res = writeSectionValue(sh, 58, 3, 0);
    t.assert('skipped', 'skipped', res);
    t.assert('designer value preserved', 250, sh._cells['58,3']);
  }
});

registerTest({
  id: 'UNIT_SSG_PREFLIGHT_PASSES_EMPTY', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('UNIT setup/guard: pre-flight passes when target rows are empty');
    var sh = _ssgMockSheet();
    var rows = [
      { row: 58, label: 'Carga crítica (kW)' },
      { row: 59, label: 'Duración de respaldo (h)' }
    ];
    var res = guardSectionRowsEmpty(sh, 2, rows);
    t.assertTrue('ok', res.ok === true);
    t.assert('no collisions', 0, res.collisions.length);
  }
});

registerTest({
  id: 'UNIT_SSG_PREFLIGHT_CATCHES_DISTANCIAS', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7', 'regression'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('UNIT setup/guard: REPLAY the DISTANCIAS incident -- pre-flight catches it');
    // The exact state that caused the mangle: rows 42-46 hold the DISTANCIAS
    // section labels. A resilience setup aimed at those rows MUST abort.
    var sh = _ssgMockSheet({
      '42,2': '6. DISTANCIAS Y UBICACIÓN FÍSICA',
      '44,2': 'Voltaje bus DC:',
      '45,2': 'Voltaje AC sistema:',
      '46,2': 'Distancia batería ↔ tablero:'
    });
    var rows = [
      { row: 42, label: '6. RESILIENCIA / RESPALDO' },
      { row: 44, label: 'Eventos por año' },
      { row: 45, label: 'Costo por evento (MXN)' },
      { row: 46, label: 'Fuente del valor' }
    ];
    var threw = false;
    try {
      guardSectionRowsEmpty(sh, 2, rows);   // default onCollision: throw
    } catch (e) {
      threw = true;
      t.assertTrue('error is a pre-flight collision', e.message.indexOf('PRE-FLIGHT COLLISION') >= 0);
    }
    t.assertTrue('the incident would have been caught BEFORE any write', threw);
    // And in skip-mode, all four collisions are reported.
    var res = guardSectionRowsEmpty(sh, 2, rows, { onCollision: 'skip' });
    t.assertTrue('not ok', res.ok === false);
    t.assert('all 4 collisions reported', 4, res.collisions.length);
  }
});

registerTest({
  id: 'UNIT_SSG_PREFLIGHT_ALLOWS_IDEMPOTENT_RERUN', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('UNIT setup/guard: pre-flight allows a clean re-run (cells already hold OUR labels)');
    // Running the SAME setup twice must not be a collision -- the cells hold
    // exactly the labels we intend, so it's idempotent.
    var sh = _ssgMockSheet({
      '58,2': 'Carga crítica (kW)',
      '59,2': 'Duración de respaldo (h)'
    });
    var rows = [
      { row: 58, label: 'Carga crítica (kW)' },
      { row: 59, label: 'Duración de respaldo (h)' }
    ];
    var res = guardSectionRowsEmpty(sh, 2, rows);
    t.assertTrue('clean re-run passes', res.ok === true);
  }
});


// =============================================================================
// Integration: the RETROFITTED setup functions themselves abort on collision
// =============================================================================
function _ssgFullMockSs(sheetName, seed) {
  var cells = {};
  if (seed) for (var k in seed) if (seed.hasOwnProperty(k)) cells[k] = seed[k];
  var sheet = {
    _cells: cells,
    getRange: function (r, c) {
      var key = r + ',' + c;
      var self = {
        getValue: function () { return cells[key] != null ? cells[key] : ''; },
        setValue: function (v) { cells[key] = v; return self; },
        setFontWeight: function () { return self; },
        setFontStyle: function () { return self; },
        setFontSize: function () { return self; },
        setFontColor: function () { return self; },
        setWrap: function () { return self; },
        setBackground: function () { return self; },
        merge: function () { return self; },
        setDataValidation: function () { return self; }
      };
      return self;
    }
  };
  return { getSheetByName: function (n) { return n === sheetName ? sheet : null; }, _sheet: sheet };
}

registerTest({
  id: 'INT_SSG_RESILIENCE_SETUP_ABORTS_ON_COLLISION', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7', 'integration'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('INT setup/guard: setupInputBessResilienceSection ABORTS if rows occupied');
    // Seed the resilience target rows (57-62) with foreign content.
    var ss = _ssgFullMockSs('INPUT_BESS', {
      '58,2': 'Algo más que ya estaba aquí'   // collision at CRITICAL_LOAD_KW row
    });
    var threw = false;
    try {
      setupInputBessResilienceSection(ss);
    } catch (e) {
      threw = true;
      t.assertTrue('aborted with collision error',
                   e.message.indexOf('COLLISION') >= 0);
    }
    t.assertTrue('setup aborted instead of clobbering', threw);
    // The foreign content must be intact (not overwritten).
    t.assert('foreign cell preserved', 'Algo más que ya estaba aquí', ss._sheet._cells['58,2']);
  }
});

registerTest({
  id: 'INT_SSG_RESILIENCE_SETUP_WORKS_ON_EMPTY', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7', 'integration'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('INT setup/guard: setupInputBessResilienceSection writes cleanly on empty rows');
    var ss = _ssgFullMockSs('INPUT_BESS', {});   // all blank
    var ret = setupInputBessResilienceSection(ss);
    t.assertTrue('created the section', ret.created.length >= 5);
    t.assert('critical load label written', 'Carga crítica (kW)', ss._sheet._cells['58,2']);
    t.assert('critical load default 0', 0, ss._sheet._cells['58,3']);
  }
});

registerTest({
  id: 'INT_SSG_SOLAR_SETUP_ABORTS_ON_COLLISION', group: 'unit', module: 'setup/guard',
  scenarios: [], tags: ['setup', 'guard', 'chunk7', 'integration'],
  source: 'tests_unit/setup/SetupSectionGuardTests.gs',
  fn: function (t) {
    t.suite('INT setup/guard: setupInputProjectPvSection ABORTS if rows occupied');
    var ss = _ssgFullMockSs('INPUT_PROJECT', {
      '68,2': 'Otra sección existente'   // [4.15.4] collision at INSTALL_PV row (moved 66->68)
    });
    var threw = false;
    try {
      setupInputProjectPvSection(ss);
    } catch (e) {
      threw = true;
    }
    t.assertTrue('SOLAR setup aborted on collision', threw);
    t.assert('foreign cell preserved', 'Otra sección existente', ss._sheet._cells['68,2']);
  }
});
