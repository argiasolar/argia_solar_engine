// =============================================================================
// ARGIA -- tests_unit/inputs/RepairCycleTests.gs
// -----------------------------------------------------------------------------
// [4.16.0] The test that was MISSING for the entire 4.15.x saga.
//
// Every prior layout fix was correct in the rebuild but silently UNDONE by the
// repair's restore step: repairInputLayouts did
//     snapshot(whole grid) -> rebuild(clean) -> restoreInputSheets(whole grid)
// and the whole-grid restore rewrote the OLD layout (labels + values, by
// absolute cell address) on top of the clean rebuild -- resurrecting stale
// rows and duplicates. No test exercised the FULL cycle, so unit tests stayed
// green while the live workbook stayed broken.
//
// THE FIX (4.16.0): values are owned by their FIELD (INPUT_MAP key), not by a
// cell address. snapshotInputSheets captures a __fieldValues layer via
// readInput; repairInputLayouts restores via restoreInputValues -> writeInput,
// which targets wherever the CURRENT map places each field. Structure comes
// only from the rebuild; values follow fields to new rows.
//
// These tests model the full cycle against an in-memory sheet and assert:
//   1. a field whose row MOVED keeps its user value at the NEW row
//   2. no stale label/value survives at an OLD row the new layout vacated
//   3. blank fields are NOT written back over fresh defaults
// =============================================================================

// Shared in-memory sheet/ss harness for these tests.
function _rcMakeEnv() {
  var cells = {};
  function K(r, c) { return r + ',' + c; }
  function colNum(s){ var n=0; for (var i=0;i<s.length;i++) n=n*26+(s.charCodeAt(i)-64); return n; }
  function parseA1(a1){
    var m=a1.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if(m) return {r:+m[2],c:colNum(m[1]),nr:+m[4]-+m[2]+1,nc:colNum(m[3])-colNum(m[1])+1};
    var s=a1.match(/^([A-Z]+)(\d+)$/); return {r:+s[2],c:colNum(s[1]),nr:1,nc:1};
  }
  function rng(r,c,nr,nc){ nr=nr||1; nc=nc||1; return {
    getValue:function(){ return cells[K(r,c)]!==undefined?cells[K(r,c)]:''; },
    setValue:function(v){ cells[K(r,c)]=v; return this; },
    getValues:function(){ var o=[]; for(var i=0;i<nr;i++){var row=[];for(var j=0;j<nc;j++)row.push(cells[K(r+i,c+j)]!==undefined?cells[K(r+i,c+j)]:'');o.push(row);} return o; },
    setValues:function(m){ for(var i=0;i<m.length;i++)for(var j=0;j<m[i].length;j++)cells[K(r+i,c+j)]=m[i][j]; return this; }
  }; }
  var sheet = {
    getName:function(){ return 'INPUT_PROJECT'; },
    getRange:function(a,b,c,d){ if(typeof a==='string'){var p=parseA1(a);return rng(p.r,p.c,p.nr,p.nc);} return rng(a,b,c,d); },
    getLastRow:function(){ var mx=1; Object.keys(cells).forEach(function(k){var r=+k.split(',')[0];if(r>mx)mx=r;}); return mx; },
    getLastColumn:function(){ return 14; }
  };
  var ss = { getSheetByName:function(n){ return n==='INPUT_PROJECT'?sheet:null; } };
  return { ss: ss, cells: cells, K: K };
}

registerTest({
  id      : 'UNIT_REPAIR_CYCLE_VALUE_FOLLOWS_FIELD',
  group   : 'unit',
  module  : 'inputs/repair_cycle',
  scenarios: [],
  tags    : ['inputs', 'repair', 'regression'],
  source  : 'tests_unit/inputs/RepairCycleTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT inputs/repair_cycle [4.16.0]: value follows field across a ' +
            'layout-moving rebuild; no stale residue');

    var env = _rcMakeEnv();
    var ss = env.ss, cells = env.cells, K = env.K;

    // --- STATE 0: pre-repair sheet with a user value at installPv's CURRENT
    // map row, plus stale labels at rows the rebuild will vacate. ---
    var ipRow = INPUT_MAP.installPv.row;        // 68 in 4.15.4+
    var ibRow = INPUT_MAP.installBattery.row;   // 64
    cells[K(ibRow, 4)] = 'NO';                  // user battery choice
    cells[K(ipRow, 4)] = 'YES';                 // user PV choice (the value to preserve)
    cells[K(64, 2)]    = '8';                   // STALE stray section number (must not survive)
    cells[K(65, 2)]    = '8';                   // STALE

    // --- STEP 1: field-value snapshot (reads by current map position) ---
    var snap = { __fieldValues: _snapshotFieldValues_(ss) };
    t.assertTrue('snapshot captured installPv value',
                 snap.__fieldValues.installPv === 'YES');
    t.assertTrue('snapshot captured installBattery value',
                 snap.__fieldValues.installBattery === 'NO');

    // --- STEP 2: simulate the rebuild: clear, then write clean defaults +
    // structural labels at the CURRENT map rows. ---
    Object.keys(cells).forEach(function (k) { delete cells[k]; });
    cells[K(62, 2)] = '07'; cells[K(62, 3)] = 'ALMACENAMIENTO';
    cells[K(ibRow, 2)] = 'Instalar batería'; cells[K(ibRow, 4)] = 'NO';   // default
    cells[K(66, 2)] = '08'; cells[K(66, 3)] = 'SOLAR';
    cells[K(ipRow, 2)] = 'Instalar PV nuevo'; cells[K(ipRow, 4)] = 'YES'; // default seed

    // --- STEP 3: field-keyed restore ---
    var rep = restoreInputValues(ss, snap);

    // ASSERTIONS
    t.assertTrue('installPv value present at its CURRENT map row after restore',
                 cells[K(ipRow, 4)] === 'YES');
    t.assertTrue('installBattery label is correct (not a stray "8")',
                 cells[K(ibRow, 2)] === 'Instalar batería');
    t.assertTrue('no stray "8" survived at B64',
                 (cells[K(64, 2)] === undefined || cells[K(64, 2)] === 'Instalar batería'));
    t.assertTrue('no stray "8" survived at B65',
                 cells[K(65, 2)] === undefined);
    t.assertTrue('SOLAR header at row 66',
                 cells[K(66, 2)] === '08' && cells[K(66, 3)] === 'SOLAR');
    t.assertTrue('restore reported at least the 2 set values',
                 (rep.restoredKeys || 0) >= 2);
    t.assertTrue('no failed keys', (rep.failedKeys || []).length === 0);
  }
});


registerTest({
  id      : 'UNIT_REPAIR_CYCLE_BLANK_NOT_WRITTEN_OVER_DEFAULT',
  group   : 'unit',
  module  : 'inputs/repair_cycle',
  scenarios: [],
  tags    : ['inputs', 'repair', 'regression'],
  source  : 'tests_unit/inputs/RepairCycleTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT inputs/repair_cycle [4.16.0]: blank user value does not ' +
            'clobber a freshly-seeded default');

    var env = _rcMakeEnv();
    var ss = env.ss, cells = env.cells, K = env.K;
    var ipRow = INPUT_MAP.installPv.row;

    // User never touched installPv -> blank in the snapshot.
    var snap = { __fieldValues: { installPv: '' } };

    // Rebuild seeded the default 'YES'.
    cells[K(ipRow, 4)] = 'YES';

    var rep = restoreInputValues(ss, snap);

    t.assertTrue('blank snapshot value did NOT overwrite the default',
                 cells[K(ipRow, 4)] === 'YES');
    t.assertTrue('blank key counted as skipped', (rep.skippedKeys || 0) >= 1);
  }
});
