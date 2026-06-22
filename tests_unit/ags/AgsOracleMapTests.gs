// =============================================================================
// ARGIA TESTS -- tests_unit/ags/AgsOracleMapTests.gs
// -----------------------------------------------------------------------------
// AGS conformance track -- Task A3a. Locks the AGS-802 §5.2 oracle map and the
// §5.3 hard-block list (37_AgsOracleMap.js). PURE -- no workbook.
//
// COVERAGE (2 tests):
//   1. UNIT_AGS_ORACLE_MAP        -- §5.2 output->chapter->oracle map integrity
//   2. UNIT_AGS_HARD_BLOCK_LIST   -- §5.3 list + human-gate / engine-block split
// =============================================================================

registerTest({
  id      : 'UNIT_AGS_ORACLE_MAP',
  group   : 'unit',
  module  : 'ags/oracle_map',
  scenarios: [],
  tags    : ['ags', 'oracle', 'a3a', '802'],
  source  : 'tests_unit/ags/AgsOracleMapTests.gs',
  fn      : function (t) {
    t.suite('UNIT ags/oracle_map: AGS-802 §5.2 output -> chapter -> oracle');

    var map = agsOracleMap();
    t.assert('oracle map has 18 rows', 18, map.length);

    // Every row is fully traceable (R1/R6): output + chapter + oracle present.
    var complete = map.every(function (r) {
      return r.output && /^AGS-\d{3}$/.test(r.chapter) && r.oracle;
    });
    t.assertTrue('every row has output + AGS-xxx chapter + oracle', complete);

    // Key chapters across the nine parts are mapped.
    ['AGS-101', 'AGS-205', 'AGS-207', 'AGS-302', 'AGS-602', 'AGS-701'].forEach(function (ch) {
      var hit = map.some(function (r) { return r.chapter === ch; });
      t.assertTrue('chapter mapped: ' + ch, hit);
    });

    // Lookup by output text.
    t.assert('agsOracleFor(memoria) -> AGS-205', 'AGS-205', (agsOracleFor('memoria') || {}).chapter);
    t.assert('agsOracleFor(bankability) -> AGS-207', 'AGS-207', (agsOracleFor('bankability') || {}).chapter);
    t.assertTrue('agsOracleFor(unknown) -> null', agsOracleFor('no-such-output') === null);

    // Accessor returns a copy (mutating the result must not corrupt the source).
    map.pop();
    t.assert('agsOracleMap() returns a fresh copy', 18, agsOracleMap().length);
  }
});


registerTest({
  id      : 'UNIT_AGS_HARD_BLOCK_LIST',
  group   : 'unit',
  module  : 'ags/oracle_map',
  scenarios: [],
  tags    : ['ags', 'hardblock', 'a3a', '802'],
  source  : 'tests_unit/ags/AgsOracleMapTests.gs',
  fn      : function (t) {
    t.suite('UNIT ags/oracle_map: AGS-802 §5.3 hard-block list');

    var list = agsHardBlockList();
    t.assert('hard-block list has 12 items', 12, list.length);

    // Every item is well-formed with a valid category.
    var cats = { 'life-safety': 1, 'legal': 1, 'bankability': 1, 'data': 1, 'quality': 1, 'edition-lock': 1 };
    var wellFormed = list.every(function (b) {
      return b.ref && b.condition && cats[b.category] && typeof b.humanGate === 'boolean';
    });
    t.assertTrue('every item: ref + condition + valid category + humanGate flag', wellFormed);

    // Human gates = exactly the five A3a surfaces; engine blocks = the rest.
    var human = agsHumanGates().map(function (b) { return b.ref; }).sort().join(',');
    t.assert('human gates are DRO/UVIE/H-point/HSE/Cat-1',
             'AGS-206,AGS-402,AGS-501,AGS-601,AGS-602', human);
    t.assert('5 human gates', 5, agsHumanGates().length);
    t.assert('engine-evaluable blocks = total - human', list.length - 5, agsEngineHardBlocks().length);

    // The two partitions are disjoint and cover the whole list.
    t.assert('human + engine == total', list.length,
             agsHumanGates().length + agsEngineHardBlocks().length);

    // UL 9540A item is the time-gated, engine-evaluable, edition-lock block.
    var ul = list.filter(function (b) { return b.timeGated === true; });
    t.assert('exactly one time-gated block (UL 9540A)', 1, ul.length);
    t.assert('time-gated block is edition-lock', 'edition-lock', ul[0].category);
    t.assertFalse('UL 9540A is engine-evaluable (not a human gate)', ul[0].humanGate);

    // AGS-207 bankability block is flagged as dependent on A4 (not yet wired).
    var b207 = list.filter(function (b) { return b.ref === 'AGS-207'; })[0];
    t.assert('AGS-207 depends on A4', 'A4', b207.dependsOn);
  }
});
