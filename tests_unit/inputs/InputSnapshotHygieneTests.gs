// =============================================================================
// ARGIA -- tests_unit/inputs/InputSnapshotHygieneTests.gs
// -----------------------------------------------------------------------------
// [4.15.0 test-hygiene] Locks the three guarantees behind "exact same
// situation before and after running tests":
//
//   1. snapshotInputSheets SANITIZES rich objects (CellImage logos) so the
//      restore's bulk setValues can never throw "Service error: Spreadsheets"
//      and fall back to the slow per-cell path (the chronic per-E2E fallback
//      observed in LOGS since 4.14.3).
//   2. argiaDiffLayoutFingerprints (pure) detects exactly the observed
//      failure mode -- merge wipe + styling loss -- and reports it readably.
//   3. restoreInputSheets ends by RE-ASSERTING logos on every restored tab,
//      because logos are template chrome that the snapshot deliberately
//      drops, never round-tripped data.
// =============================================================================

registerTest({
  id      : 'UNIT_SNAPSHOT_SANITIZES_RICH_OBJECTS',
  group   : 'unit',
  module  : 'inputs/snapshot_hygiene',
  scenarios: [],
  tags    : ['inputs', 'snapshot', 'regression'],
  source  : 'tests_unit/inputs/InputSnapshotHygieneTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT inputs/snapshot_hygiene: rich objects sanitized at snapshot time');

    var theDate = new Date(2026, 5, 12);
    var fakeCellImage = { toString: function(){ return 'CellImage'; },
                          getUrl:   function(){ return 'data:...'; } };
    var values = [
      ['', fakeCellImage, 'INPUT DESIGN'],
      ['Tipo de proyecto *', 'ROOF', theDate],
      [42, '', 'default: ROOF']
    ];
    var formulas = [['', '', ''], ['', '', ''], ['', '', '']];

    var mockSheet = {
      getLastRow:    function(){ return 3; },
      getLastColumn: function(){ return 3; },
      getRange: function(){ return {
        getFormulas: function(){ return formulas; },
        getValues:   function(){ return values; }
      }; }
    };
    var mockSs = {
      getSheetByName: function(name){
        return name === 'INPUT_DESIGN' ? mockSheet : null;
      }
    };

    var snap = snapshotInputSheets(mockSs);
    var v = snap.INPUT_DESIGN.values;

    t.assertTrue('CellImage object sanitized to empty string', v[0][1] === '');
    t.assertTrue('plain string survives', v[0][2] === 'INPUT DESIGN');
    t.assertTrue('number survives', v[2][0] === 42);
    t.assertTrue('Date survives untouched (legitimate cell value)',
                 v[1][2] instanceof Date
                 && v[1][2].getTime() === theDate.getTime());
  }
});


registerTest({
  id      : 'UNIT_LAYOUT_FINGERPRINT_DIFF_PURE',
  group   : 'unit',
  module  : 'inputs/snapshot_hygiene',
  scenarios: [],
  tags    : ['inputs', 'layout', 'regression'],
  source  : 'tests_unit/inputs/InputSnapshotHygieneTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT inputs/snapshot_hygiene: layout fingerprint diff');

    var good = {
      INPUT_DESIGN:  { merges: 25, frozenR: 0, frozenC: 0, titleWeight: 'bold' },
      INPUT_PROJECT: { merges: 12, frozenR: 0, frozenC: 0, titleWeight: 'bold' }
    };

    // Identical -> no drift.
    var same = JSON.parse(JSON.stringify(good));
    t.assertTrue('identical fingerprints -> zero drift',
                 argiaDiffLayoutFingerprints(good, same).length === 0);

    // The OBSERVED failure mode: merges wiped + title styling lost.
    var broken = JSON.parse(JSON.stringify(good));
    broken.INPUT_DESIGN.merges = 0;
    broken.INPUT_DESIGN.titleWeight = 'normal';
    var drift = argiaDiffLayoutFingerprints(good, broken);
    t.assertTrue('two drifted fields reported', drift.length === 2);
    t.assertTrue('merge wipe named readably (25 -> 0)',
                 drift.join('|').indexOf('INPUT_DESIGN.merges: 25 -> 0') >= 0);
    t.assertTrue('styling loss named readably',
                 drift.join('|').indexOf('INPUT_DESIGN.titleWeight: bold -> normal') >= 0);

    // A tab vanishing is drift too.
    var missing = { INPUT_DESIGN: good.INPUT_DESIGN };
    var drift2 = argiaDiffLayoutFingerprints(good, missing);
    t.assertTrue('missing tab -> one drift line', drift2.length === 1);
    t.assertTrue('missing tab named',
                 drift2[0].indexOf('INPUT_PROJECT') >= 0);
  }
});


registerTest({
  id      : 'UNIT_RESTORE_REASSERTS_LOGOS',
  group   : 'unit',
  module  : 'inputs/snapshot_hygiene',
  scenarios: [],
  tags    : ['inputs', 'snapshot', 'logo', 'regression'],
  source  : 'tests_unit/inputs/InputSnapshotHygieneTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT inputs/snapshot_hygiene: restore re-asserts logos');

    // Override the real logo inserter with a counter; ALWAYS restore it.
    var realInsert = (typeof _insertArgiaLogo === 'function')
                     ? _insertArgiaLogo : null;
    var calls = [];
    _insertArgiaLogo = function (sh, row, col) {
      calls.push(sh.__name + '@' + row + ',' + col);
    };

    try {
      function mkTab(name) {
        return {
          __name: name,
          getRange: function(){ return {
            setValues: function(){ return this; }
          }; }
        };
      }
      var tabs = { INPUT_DESIGN: mkTab('INPUT_DESIGN'),
                   INPUT_BESS:   mkTab('INPUT_BESS') };
      var mockSs = { getSheetByName: function(n){ return tabs[n] || null; } };

      var snap = {
        INPUT_DESIGN: { rows: 1, cols: 1, formulas: [['']], values: [['x']] },
        INPUT_BESS:   { rows: 1, cols: 1, formulas: [['']], values: [['y']] }
      };
      var rep = restoreInputSheets(mockSs, snap);

      t.assertTrue('both restored tabs got a logo re-assert', calls.length === 2);
      t.assertTrue('logo re-asserted at B2 of INPUT_DESIGN',
                   calls.join('|').indexOf('INPUT_DESIGN@2,2') >= 0);
      t.assertTrue('report carries logosReasserted',
                   rep.logosReasserted && rep.logosReasserted.length === 2);
    } finally {
      if (realInsert) _insertArgiaLogo = realInsert;
    }
  }
});
