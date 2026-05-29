// =============================================================================
// ARGIA TESTS -- tests_unit/writers/ResilienceBlockTests.gs
// -----------------------------------------------------------------------------
// CHUNK 7 Session 2 (writer) -- locks _cfeOutV2_renderResilienceBlock.
//
// The block must:
//   - render NOTHING for a project with no reserve / value / warnings
//   - show the reserved-kWh line when a reserve exists
//   - show a peso value WITH its source label when a source was supplied
//   - show "$0 (sin fuente de valor)" when cost>0 but source blank (guard)
//   - ALWAYS carry the "NO es ahorro en el recibo CFE" separation note
//     (the never-blend invariant, made visible)
//   - surface the undersized warning text
//
// COVERAGE (6 tests):
//   1. UNIT_RESILBLK_EMPTY_NOOP
//   2. UNIT_RESILBLK_RESERVE_LINE
//   3. UNIT_RESILBLK_VALUE_WITH_SOURCE
//   4. UNIT_RESILBLK_NO_SOURCE_GUARD
//   5. UNIT_RESILBLK_NEVER_BLEND_NOTE        (invariant)
//   6. UNIT_RESILBLK_UNDERSIZED_WARNING
// =============================================================================

// Recording sheet mock: captures every setValue'd string so tests can assert
// what text the block rendered. Chainable to match the GAS Range API.
function _resilBlkMockSheet() {
  var written = [];
  function range() {
    var self = {
      _val: null,
      breakApart: function () { return self; },
      merge: function () { return self; },
      setValue: function (v) { written.push(String(v)); return self; },
      setBackground: function () { return self; },
      setFontWeight: function () { return self; },
      setFontSize: function () { return self; },
      setFontColor: function () { return self; },
      setFontStyle: function () { return self; },
      setWrap: function () { return self; },
      setHorizontalAlignment: function () { return self; },
      setVerticalAlignment: function () { return self; }
    };
    return self;
  }
  return {
    _written: written,
    getRange: function () { return range(); },
    setRowHeight: function () {},
    getLastRow: function () { return 100; },
    getName: function () { return 'CFE_OUTPUT_v2'; }
  };
}
function _resilBlkAllText(sh) { return sh._written.join(' || '); }


registerTest({
  id: 'UNIT_RESILBLK_EMPTY_NOOP', group: 'unit', module: 'writers/resilience',
  scenarios: [], tags: ['writer', 'resilience', 'chunk7'],
  source: 'tests_unit/writers/ResilienceBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/resilience: no reserve/value/warnings => renders nothing');
    var sh = _resilBlkMockSheet();
    var r = calcResilience({ criticalLoadKw: 0, backupDurationHours: 0, usableKwh: 972 });
    var last = _cfeOutV2_renderResilienceBlock(sh, 50, r);
    t.assert('returns startRow-1 (no rows written)', 49, last);
    t.assert('no text written', 0, sh._written.length);
  }
});

registerTest({
  id: 'UNIT_RESILBLK_RESERVE_LINE', group: 'unit', module: 'writers/resilience',
  scenarios: [], tags: ['writer', 'resilience', 'chunk7'],
  source: 'tests_unit/writers/ResilienceBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/resilience: reserve renders a reserved-kWh line');
    var sh = _resilBlkMockSheet();
    var r = calcResilience({ criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 972 });
    _cfeOutV2_renderResilienceBlock(sh, 50, r);
    var txt = _resilBlkAllText(sh);
    t.assertTrue('header present', txt.indexOf('VALOR DE RESPALDO') >= 0);
    t.assertTrue('reserved kWh shown (400)', txt.indexOf('400 kWh') >= 0);
  }
});

registerTest({
  id: 'UNIT_RESILBLK_VALUE_WITH_SOURCE', group: 'unit', module: 'writers/resilience',
  scenarios: [], tags: ['writer', 'resilience', 'chunk7'],
  source: 'tests_unit/writers/ResilienceBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/resilience: value shown WITH its source label');
    var sh = _resilBlkMockSheet();
    var r = calcResilience({
      criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 972,
      eventsPerYear: 4, eventCostMxn: 500000, eventValueSource: 'CUSTOMER_ESTIMATE'
    });
    _cfeOutV2_renderResilienceBlock(sh, 50, r);
    var txt = _resilBlkAllText(sh);
    t.assertTrue('value 2,000,000 shown', txt.indexOf('2,000,000') >= 0);
    t.assertTrue('source label attached', txt.indexOf('fuente:') >= 0);
    t.assertTrue('customer source noted not-validated', txt.indexOf('no validada') >= 0);
  }
});

registerTest({
  id: 'UNIT_RESILBLK_NO_SOURCE_GUARD', group: 'unit', module: 'writers/resilience',
  scenarios: [], tags: ['writer', 'resilience', 'chunk7', 'invariant'],
  source: 'tests_unit/writers/ResilienceBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/resilience: cost>0 + no source => "$0 (sin fuente)" rendered');
    var sh = _resilBlkMockSheet();
    var r = calcResilience({
      criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 972,
      eventsPerYear: 4, eventCostMxn: 9999999, eventValueSource: ''   // blank
    });
    _cfeOutV2_renderResilienceBlock(sh, 50, r);
    var txt = _resilBlkAllText(sh);
    t.assertTrue('shows $0 sin fuente', txt.indexOf('$0 (sin fuente de valor)') >= 0);
    t.assertTrue('does NOT show the fantasy figure',
                 txt.indexOf('9,999,999') < 0 && txt.indexOf('39,999,996') < 0);
    t.assertTrue('explains guard in note', txt.indexOf('anti-ROI-fantas') >= 0);
  }
});

registerTest({
  id: 'UNIT_RESILBLK_NEVER_BLEND_NOTE', group: 'unit', module: 'writers/resilience',
  scenarios: [], tags: ['writer', 'resilience', 'chunk7', 'invariant'],
  source: 'tests_unit/writers/ResilienceBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/resilience: INVARIANT every render carries the separation note');
    // Whenever the block renders anything, it must state the value is NOT a
    // CFE bill saving -- the never-blend rule, made visible to the customer.
    var cases = [
      calcResilience({ criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 972 }),
      calcResilience({ criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 972,
        eventsPerYear: 4, eventCostMxn: 500000, eventValueSource: 'AUDITED_ESTIMATE' }),
      calcResilience({ criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 972,
        eventsPerYear: 4, eventCostMxn: 500000, eventValueSource: '' })
    ];
    for (var i = 0; i < cases.length; i++) {
      var sh = _resilBlkMockSheet();
      _cfeOutV2_renderResilienceBlock(sh, 50, cases[i]);
      var txt = _resilBlkAllText(sh);
      t.assertTrue('case ' + i + ' header marks it separate from CFE',
                   txt.indexOf('separado del ahorro CFE') >= 0);
      t.assertTrue('case ' + i + ' note says NOT a CFE bill saving',
                   txt.indexOf('NO es ahorro en el recibo CFE') >= 0);
    }
  }
});

registerTest({
  id: 'UNIT_RESILBLK_UNDERSIZED_WARNING', group: 'unit', module: 'writers/resilience',
  scenarios: [], tags: ['writer', 'resilience', 'chunk7'],
  source: 'tests_unit/writers/ResilienceBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/resilience: undersized battery surfaces coverage + warning');
    var sh = _resilBlkMockSheet();
    // need 400, only 300 usable -> 75% coverage, undersized
    var r = calcResilience({ criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 300 });
    _cfeOutV2_renderResilienceBlock(sh, 50, r);
    var txt = _resilBlkAllText(sh);
    t.assertTrue('coverage 75% shown', txt.indexOf('75%') >= 0);
    t.assertTrue('undersize warning surfaced', txt.indexOf('subdimensionada') >= 0);
  }
});
