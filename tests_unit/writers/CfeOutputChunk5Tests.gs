// =============================================================================
// ARGIA TESTS -- tests_unit/writers/CfeOutputChunk5Tests.gs
// -----------------------------------------------------------------------------
// CHUNK 5 -- Session 3
//
// Locks the Chunk 5 writer additions in WriteCfeOutputV2_Chunk5.js:
//   - the tier banner + disclaimer (the LOCKED non-guarantee invariant)
//   - the Conservative/Expected/Upside summary
//   - the wide-divergence explanation
//
// COVERAGE (7 tests):
//   1. UNIT_CFE_PROPOSAL_TIER_REQUIRES_DISCLAIMER   -- PROPOSAL banner MUST
//        contain the non-guarantee + 15-min-interval text. THE INVARIANT.
//   2. UNIT_CFE_SCREENING_TIER_NOT_CUSTOMER_FACING  -- SCREENING says internal-only
//   3. UNIT_CFE_BANKABLE_TIER_LABEL                 -- BANKABLE says validated
//   4. UNIT_CFE_CONS_EXP_UPSIDE_WRITES_THREE_TILES  -- 3 numbers present
//   5. UNIT_CFE_WIDE_DIVERGENCE_EXPLAINED           -- $0..$14M gets a note
//   6. UNIT_CFE_NARROW_RANGE_NO_NOTE                -- normal range = no note
//   7. UNIT_CFE_DEMAND_BREAKDOWN_FROM_ATTRIBUTION   -- kW + MXN from hourlySim
// =============================================================================


// Minimal mock sheet that records every setValue so tests can inspect text.
function _mkMockSheet() {
  var writes = [];   // { row, col, value }
  function mkRange(row, col) {
    var self = {
      _row: row, _col: col,
      merge:    function () { return self; },
      breakApart: function () { return self; },
      setValue: function (v) { writes.push({ row: row, col: col, value: String(v) }); return self; },
      setBackground: function () { return self; },
      setFontColor: function () { return self; },
      setFontSize: function () { return self; },
      setFontWeight: function () { return self; },
      setFontStyle: function () { return self; },
      setWrap: function () { return self; },
      setVerticalAlignment: function () { return self; },
      setHorizontalAlignment: function () { return self; },
      setRichTextValue: function (v) { writes.push({ row: row, col: col, value: '[rich]' }); return self; },
    };
    return self;
  }
  return {
    _writes: writes,
    getRange: function (row, col) { return mkRange(row, col); },
    setRowHeight: function () {},
  };
}

function _allWrittenText(sh) {
  return sh._writes.map(function (w) { return w.value; }).join(' || ');
}


registerTest({
  id      : 'UNIT_CFE_PROPOSAL_TIER_REQUIRES_DISCLAIMER',
  group   : 'unit',
  module  : 'writers/cfe_chunk5',
  scenarios: [],
  tags    : ['writers', 'cfe', 'chunk5', 'disclaimer', 'invariant'],
  source  : 'tests_unit/writers/CfeOutputChunk5Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/cfe_chunk5: PROPOSAL tier MUST carry the non-guarantee disclaimer');

    var sh = _mkMockSheet();
    _cfeOutV2_renderTierBanner(sh, 4, 'PROPOSAL');
    var text = _allWrittenText(sh);

    // THE LOCKED INVARIANT. Both phrases must be present.
    t.assertTrue('PROPOSAL banner says "no garantizados" (not guaranteed)',
                 text.indexOf('no garantizados') >= 0);
    t.assertTrue('PROPOSAL banner says "intervalos de 15 minutos" (interval data)',
                 text.indexOf('intervalos de 15 minutos') >= 0);
    t.assertTrue('PROPOSAL banner says "bancable" (bankable validation)',
                 text.toLowerCase().indexOf('bancable') >= 0);
  }
});


registerTest({
  id      : 'UNIT_CFE_SCREENING_TIER_NOT_CUSTOMER_FACING',
  group   : 'unit',
  module  : 'writers/cfe_chunk5',
  scenarios: [],
  tags    : ['writers', 'cfe', 'chunk5', 'disclaimer'],
  source  : 'tests_unit/writers/CfeOutputChunk5Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/cfe_chunk5: SCREENING tier marked internal-only');

    var sh = _mkMockSheet();
    _cfeOutV2_renderTierBanner(sh, 4, 'SCREENING');
    var text = _allWrittenText(sh);
    t.assertTrue('SCREENING says "solo para análisis interno"',
                 text.indexOf('an\u00e1lisis interno') >= 0);
    t.assertTrue('SCREENING warns against client use',
                 text.toLowerCase().indexOf('no usar en propuestas') >= 0);
  }
});


registerTest({
  id      : 'UNIT_CFE_BANKABLE_TIER_LABEL',
  group   : 'unit',
  module  : 'writers/cfe_chunk5',
  scenarios: [],
  tags    : ['writers', 'cfe', 'chunk5'],
  source  : 'tests_unit/writers/CfeOutputChunk5Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/cfe_chunk5: BANKABLE tier marked validated');

    var sh = _mkMockSheet();
    _cfeOutV2_renderTierBanner(sh, 4, 'BANKABLE');
    var text = _allWrittenText(sh);
    t.assertTrue('BANKABLE mentions 15-min interval validation',
                 text.indexOf('INTERVALOS DE 15 MINUTOS') >= 0);
    t.assertTrue('BANKABLE says apto para propuesta bancable',
                 text.toLowerCase().indexOf('apto para') >= 0);
  }
});


registerTest({
  id      : 'UNIT_CFE_CONS_EXP_UPSIDE_WRITES_THREE_TILES',
  group   : 'unit',
  module  : 'writers/cfe_chunk5',
  scenarios: [],
  tags    : ['writers', 'cfe', 'chunk5'],
  source  : 'tests_unit/writers/CfeOutputChunk5Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/cfe_chunk5: Cons/Exp/Upside writes three labelled tiles');

    var sh = _mkMockSheet();
    var autoOpt = {
      conservativeMxn: 500000,
      upsideMxn:       650000,
      optimalByMonth:  ['PS','PS','LS','LS','LS','LS','LS','LS','LS','PS','PS','PS']
    };
    _cfeOutV2_renderConsExpUpside(sh, 50, autoOpt, 580000, 'NET_BILLING');
    var text = _allWrittenText(sh);

    t.assertTrue('has CONSERVADOR tile', text.indexOf('CONSERVADOR') >= 0);
    t.assertTrue('has ESPERADO tile',     text.indexOf('ESPERADO') >= 0);
    t.assertTrue('has ÓPTIMO tile',        text.indexOf('PTIMO') >= 0);  // ÓPTIMO (accent-safe)
    t.assertTrue('shows conservative value 500,000', text.indexOf('500,000') >= 0);
    t.assertTrue('shows expected value 580,000',      text.indexOf('580,000') >= 0);
    t.assertTrue('shows upside value 650,000',        text.indexOf('650,000') >= 0);
  }
});


registerTest({
  id      : 'UNIT_CFE_WIDE_DIVERGENCE_EXPLAINED',
  group   : 'unit',
  module  : 'writers/cfe_chunk5',
  scenarios: [],
  tags    : ['writers', 'cfe', 'chunk5'],
  source  : 'tests_unit/writers/CfeOutputChunk5Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/cfe_chunk5: wide Cons/Upside divergence gets an explanation');

    // Conservative ~0, Upside material -> the PV-poor archetype.
    var sh = _mkMockSheet();
    var autoOpt = { conservativeMxn: 0, upsideMxn: 14000000, optimalByMonth: [] };
    _cfeOutV2_renderConsExpUpside(sh, 50, autoOpt, 12000000, 'NET_BILLING');
    var text = _allWrittenText(sh);

    t.assertTrue('explains the wide range (poco excedente solar)',
                 text.indexOf('poco excedente solar') >= 0);
    t.assertTrue('mentions load-shifting / arbitraje',
                 text.toLowerCase().indexOf('arbitraje') >= 0);
    t.assertTrue('NET_BILLING present -> says site HAS it',
                 text.indexOf('este sitio tiene') >= 0);

    // Same divergence but NOT NET_BILLING -> warns it's unreachable
    var sh2 = _mkMockSheet();
    _cfeOutV2_renderConsExpUpside(sh2, 50, autoOpt, 12000000, 'NET_METERING');
    var text2 = _allWrittenText(sh2);
    t.assertTrue('NET_METERING -> warns optimo not reachable',
                 text2.indexOf('NO tiene configurada') >= 0);
  }
});


registerTest({
  id      : 'UNIT_CFE_NARROW_RANGE_NO_NOTE',
  group   : 'unit',
  module  : 'writers/cfe_chunk5',
  scenarios: [],
  tags    : ['writers', 'cfe', 'chunk5'],
  source  : 'tests_unit/writers/CfeOutputChunk5Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/cfe_chunk5: narrow range writes NO explanation note');

    var sh = _mkMockSheet();
    var autoOpt = { conservativeMxn: 500000, upsideMxn: 560000, optimalByMonth: [] };
    _cfeOutV2_renderConsExpUpside(sh, 50, autoOpt, 530000, 'NET_BILLING');
    var text = _allWrittenText(sh);
    // upside (560k) < 3x conservative (500k) and conservative not near-zero
    t.assertTrue('no wide-divergence note for a normal range',
                 text.indexOf('poco excedente solar') < 0);
  }
});


registerTest({
  id      : 'UNIT_CFE_DEMAND_BREAKDOWN_FROM_ATTRIBUTION',
  group   : 'unit',
  module  : 'writers/cfe_chunk5',
  scenarios: [],
  tags    : ['writers', 'cfe', 'chunk5'],
  source  : 'tests_unit/writers/CfeOutputChunk5Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/cfe_chunk5: demand-charge breakdown reads hourlySim.attribution');

    var sh = _mkMockSheet();
    var hourlySim = {
      attribution: {
        pvOnly: {
          monthlyPeakPuntaKw: [300,300,300,300,300,300,300,300,300,300,300,300],
          costByBucket: { base: 100000, intermedia: 200000, punta: 500000 }
        },
        pvBess: {
          monthlyPeakPuntaKw: [180,180,180,180,180,180,180,180,180,180,180,180],
          costByBucket: { base: 100000, intermedia: 180000, punta: 350000 }
        }
      }
    };
    _cfeOutV2_renderDemandChargeBreakdown(sh, 60, hourlySim);
    var text = _allWrittenText(sh);

    // peak reduction = 300 - 180 = 120 kW
    t.assertTrue('shows 120 kW peak reduction', text.indexOf('120 kW') >= 0);
    // punta avoided = 500000 - 350000 = 150,000
    t.assertTrue('shows 150,000 punta savings', text.indexOf('150,000') >= 0);
    // intermedia avoided = 200000 - 180000 = 20,000
    t.assertTrue('shows 20,000 intermedia savings', text.indexOf('20,000') >= 0);
  }
});
