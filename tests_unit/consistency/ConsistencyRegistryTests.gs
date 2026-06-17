// =============================================================================
// ARGIA TESTS -- tests_unit/consistency/ConsistencyRegistryTests.gs
// -----------------------------------------------------------------------------
// T3 (v4.37.0): registry-driven cross-tab guard (09d_ConsistencyGuard.js).
//
// PURE unit tests (mock spreadsheet, no live workbook):
//   1. UNIT_CONS_REGISTRY_WELLFORMED -- SHARED_FIGURE_REGISTRY is structurally
//      valid (unique keys, >=1 source, known kinds, numeric tolRel)
//   2. UNIT_CONS_PARTITION           -- enforced forks fail; pending (T5) forks
//      are reported but don't fail
//   3. UNIT_CONS_READERS             -- _consReadSource dispatches every kind
//   4. UNIT_CONS_DELIBERATE_FORK     -- a forked consumer flips the guard red;
//      the healthy version stays green (the DONE-WHEN proof)
// =============================================================================


// -- tiny grid-backed mock spreadsheet ----------------------------------------
function _crSheet(grid) {  // grid: array of rows; cell [r-1][c-1] (1-indexed A1)
  function colNum(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
  function a1(s) { var m = String(s).match(/^([A-Z]+)(\d+)$/); return { r: +m[2], c: colNum(m[1]) }; }
  return {
    getLastRow: function () { return grid.length; },
    getRange: function (a, b, h, w) {
      if (typeof a === 'string') {
        var p = a1(a);
        return { getValue: function () { var row = grid[p.r - 1] || []; return row[p.c - 1]; } };
      }
      return {
        getValue: function () { var row = grid[a - 1] || []; return row[b - 1]; },
        getValues: function () {
          var out = [];
          for (var i = 0; i < (h || 1); i++) {
            var row = grid[(a - 1) + i] || [], rr = [];
            for (var j = 0; j < (w || 1); j++) rr.push(row[(b - 1) + j]);
            out.push(rr);
          }
          return out;
        }
      };
    }
  };
}
function _crMockSs(sheets) { return { getSheetByName: function (n) { return sheets[n] || null; } }; }

// CULLIGAN-ish healthy mock for the cfe_bill_sin_pv figure.
function _crHealthySheets(slideSinPv) {
  var bess = []; bess[11] = []; bess[11][3] = 12838765.45;   // D12 (row12,col4)
  bess[13] = []; bess[13][3] = 10910746;                      // D14
  bess[17] = []; bess[17][3] = 10110616.39;                   // D18
  return {
    'BESS_SIMULATION': _crSheet(bess),
    'SLIDE_DATA': _crSheet([['key', 'value'], ['annual_energy_cost', slideSinPv]]),
    'API_OUTPUT': _crSheet([['key', 'value'], ['cfe_bill_sin_pv_mxn', 12838765.45]]),
    'CFE_OUTPUT_v2': _crSheet((function () {
      var g = []; g[9] = []; g[9][1] = 'RECIBO ANUAL SIN PV\n$12,838,765';  // B10
      g[18] = [];  // row19 con-PV C:N
      for (var c = 2; c <= 13; c++) g[18][c] = 909228.83;                  // ~10.91M/12
      return g;
    })())
  };
}

var _CR_MINI_REGISTRY = [
  { key: 'cfe_bill_sin_pv', label: 'CFE bill - sin PV', tolRel: 0.001, enforced: true,
    sources: [
      { name: 'BESS_SIMULATION!D12', kind: 'cell',   sheet: 'BESS_SIMULATION', a1: 'D12' },
      { name: 'CFE_OUTPUT_v2!B10',   kind: 'banner', sheet: 'CFE_OUTPUT_v2',   a1: 'B10' },
      { name: 'SLIDE annual_energy_cost', kind: 'slide', key: 'annual_energy_cost' },
      { name: 'API cfe_bill_sin_pv_mxn',  kind: 'api',   key: 'cfe_bill_sin_pv_mxn' }
    ] }
];


registerTest({
  id: 'UNIT_CONS_REGISTRY_WELLFORMED', group: 'unit', module: 'consistency/registry',
  scenarios: [], tags: ['consistency', 'guard', 'registry', 't3'],
  source: 'tests_unit/consistency/ConsistencyRegistryTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT consistency/registry: SHARED_FIGURE_REGISTRY well-formed');

    var reg = SHARED_FIGURE_REGISTRY;
    t.assertTrue('registry non-empty', reg.length >= 8);

    var KINDS = { cell: 1, api: 1, slide: 1, banner: 1, rowsum: 1, diff: 1, cellstr: 1 };
    var seen = {}, enforcedCount = 0;
    reg.forEach(function (f) {
      t.assertTrue(f.key + ': unique key', !seen[f.key]); seen[f.key] = 1;
      t.assertTrue(f.key + ': has label', typeof f.label === 'string' && f.label.length > 0);
      t.assertTrue(f.key + ': tolRel numeric', typeof f.tolRel === 'number');
      t.assertTrue(f.key + ': has sources', (f.sources || []).length >= 1);
      f.sources.forEach(function (s) {
        t.assertTrue(f.key + '/' + s.name + ': known kind ' + s.kind, !!KINDS[s.kind]);
        if (s.kind === 'diff') {
          t.assertTrue(f.key + ': diff has A+B', !!s.sheet && !!s.a1 && !!s.sheetB && !!s.a1B);
        }
      });
      if (f.enforced !== false) enforcedCount++;
    });
    t.assertTrue('>=8 enforced figures', enforcedCount >= 8);
    // The dual-CAPEX anti-fork: cost and sell are separate figures.
    t.assertTrue('capex_cost present', seen['capex_cost'] === 1);
    t.assertTrue('offer_price present', seen['offer_price'] === 1);
  }
});


registerTest({
  id: 'UNIT_CONS_PARTITION', group: 'unit', module: 'consistency/registry',
  scenarios: [], tags: ['consistency', 'guard', 'registry', 't3'],
  source: 'tests_unit/consistency/ConsistencyRegistryTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT consistency/registry: enforced vs pending partition');

    var reg = [
      { key: 'enforced_fig', enforced: true },
      { key: 'pending_fig',  enforced: false, pendingTask: 'T5' }
    ];
    var viols = [
      { type: 'fork', key: 'enforced_fig' },
      { type: 'fork', key: 'pending_fig' }
    ];
    var p = partitionConsistencyViolations(viols, reg);
    t.assert('1 hard (enforced)', 1, p.hard.length);
    t.assert('1 known (pending)', 1, p.known.length);
    t.assert('hard is the enforced one', 'enforced_fig', p.hard[0].key);
    t.assert('known is the pending one', 'pending_fig', p.known[0].key);

    // No registry entry -> treated as enforced (safe default).
    var p2 = partitionConsistencyViolations([{ type: 'fork', key: 'unknown' }], reg);
    t.assert('unknown key -> hard', 1, p2.hard.length);
  }
});


registerTest({
  id: 'UNIT_CONS_READERS', group: 'unit', module: 'consistency/registry',
  scenarios: [], tags: ['consistency', 'guard', 'readers', 't3'],
  source: 'tests_unit/consistency/ConsistencyRegistryTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT consistency/registry: _consReadSource kind dispatch');

    var ss = _crMockSs(_crHealthySheets(12838765.45));

    var cell = _consReadSource(ss, { name: 'd12', kind: 'cell', sheet: 'BESS_SIMULATION', a1: 'D12' });
    t.assertNear('cell read', 12838765.45, cell.value, 0.01);

    var api = _consReadSource(ss, { name: 'api', kind: 'api', key: 'cfe_bill_sin_pv_mxn' });
    t.assertNear('api read', 12838765.45, api.value, 0.01);

    var slide = _consReadSource(ss, { name: 'sl', kind: 'slide', key: 'annual_energy_cost' });
    t.assertNear('slide read', 12838765.45, slide.value, 0.01);

    var banner = _consReadSource(ss, { name: 'bn', kind: 'banner', sheet: 'CFE_OUTPUT_v2', a1: 'B10' });
    t.assertNear('banner parse $12,838,765', 12838765, banner.value, 1);

    var rowsum = _consReadSource(ss, { name: 'rs', kind: 'rowsum', sheet: 'CFE_OUTPUT_v2', row: 19 });
    t.assertNear('rowsum con-PV ~10.91M', 10910745.96, rowsum.value, 1);

    var diff = _consReadSource(ss, { name: 'df', kind: 'diff',
      sheet: 'BESS_SIMULATION', a1: 'D12', sheetB: 'BESS_SIMULATION', a1B: 'D14' });
    t.assertNear('diff D12-D14', 1928019.45, diff.value, 0.01);

    var miss = _consReadSource(ss, { name: 'm', kind: 'cell', sheet: 'NOPE', a1: 'A1' });
    t.assertTrue('missing sheet -> NaN, no throw', isNaN(miss.value));

    var str = _consReadSource(ss, { name: 's', kind: 'cellstr', sheet: 'BESS_SIMULATION', a1: 'D12' });
    t.assertTrue('cellstr -> NaN (numeric guard skips strings)', isNaN(str.value));
  }
});


registerTest({
  id: 'UNIT_CONS_DELIBERATE_FORK', group: 'unit', module: 'consistency/registry',
  scenarios: [], tags: ['consistency', 'guard', 'fork', 't3'],
  source: 'tests_unit/consistency/ConsistencyRegistryTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT consistency/registry: deliberate fork flips red (DONE-WHEN)');

    // HEALTHY: all four sin-PV sources agree -> no fork.
    var healthy = resolveRegistryReadings(_crMockSs(_crHealthySheets(12838765.45)), _CR_MINI_REGISTRY);
    var okRes = checkConsistency(healthy, {});
    var okSplit = partitionConsistencyViolations(okRes.violations, _CR_MINI_REGISTRY);
    t.assert('healthy: 0 hard violations', 0, okSplit.hard.length);
    t.assert('healthy: 1 figure checked', 1, okRes.checked);

    // FORKED: SLIDE_DATA disagrees by ~22% -> enforced fork -> RED.
    var forked = resolveRegistryReadings(_crMockSs(_crHealthySheets(9999999)), _CR_MINI_REGISTRY);
    var forkRes = checkConsistency(forked, {});
    var forkSplit = partitionConsistencyViolations(forkRes.violations, _CR_MINI_REGISTRY);
    t.assert('forked: 1 hard violation', 1, forkSplit.hard.length);
    t.assert('forked: it is the sin-PV figure', 'cfe_bill_sin_pv', forkSplit.hard[0].key);
    t.assert('forked: violation type fork', 'fork', forkSplit.hard[0].type);
  }
});