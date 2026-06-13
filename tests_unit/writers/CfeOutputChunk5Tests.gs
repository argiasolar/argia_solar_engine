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


// =============================================================================
// TEST [B-1]: screening Óptimo is clamped to the addressable bill, not $92M
// -----------------------------------------------------------------------------
//   The auto-optimize upside is summed from per-strategy monthly ledger
//   estimates and can exceed what the client even pays CFE -- the "$92M Óptimo"
//   artifact. _cfeOutV2_renderConsExpUpside now takes the addressable annual
//   bill (pvOnly.totalCostMxn) and clamps cons/ups to it, with a plain note
//   when the upside was capped. Control: an upside below the bill is untouched
//   and no cap note appears.
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_UPSIDE_CAPPED_AT_ADDRESSABLE_BILL',
  group   : 'unit',
  module  : 'writers/cfe_chunk5',
  scenarios: [],
  tags    : ['writers', 'cfe', 'chunk5', 'regression'],
  source  : 'tests_unit/writers/CfeOutputChunk5Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/cfe_chunk5 [B-1]: Óptimo clamped to addressable bill');

    // Óptimo $92M against a $13M addressable bill -> must clamp to $13M.
    var sh = _mkMockSheet();
    var autoOpt = { conservativeMxn: 13000000, upsideMxn: 92000000, optimalByMonth: [] };
    _cfeOutV2_renderConsExpUpside(sh, 50, autoOpt, 13000000, 'NET_METERING', 13000000);
    var text = _allWrittenText(sh);

    t.assertTrue('impossible 92,000,000 Óptimo is NOT shown',
                 text.indexOf('92,000,000') < 0);
    t.assertTrue('Óptimo clamped to the 13,000,000 addressable bill',
                 text.indexOf('13,000,000') >= 0);
    t.assertTrue('cap is explained (limitado al monto de la factura)',
                 text.indexOf('limitado al monto de la') >= 0);

    // Control: upside below the bill is untouched, and no cap note appears.
    var sh2 = _mkMockSheet();
    var autoOpt2 = { conservativeMxn: 500000, upsideMxn: 650000, optimalByMonth: [] };
    _cfeOutV2_renderConsExpUpside(sh2, 50, autoOpt2, 580000, 'NET_BILLING', 13000000);
    var text2 = _allWrittenText(sh2);
    t.assertTrue('below-bill upside (650,000) shown unchanged',
                 text2.indexOf('650,000') >= 0);
    t.assertTrue('no cap note when nothing was clamped',
                 text2.indexOf('limitado al monto de la') < 0);
  }
});


// =============================================================================
// TEST [B-4]: hourly-idle state renders a LOUD banner, never three silent $0
// tiles or a zero demand-breakdown table.
// -----------------------------------------------------------------------------
//   Root cause (repro'd in Node with live CULLIGAN bill data): the monthly
//   planner's PEAK_SHAVING / SELF_CONSUMPTION_MAX charge only from typical-day
//   PV surplus, and LOAD_SHIFTING arbitrage is gated to NET_BILLING. A
//   partial-offset ZERO_EXPORT site (CULLIGAN) therefore plans ZERO discharge
//   for every strategy -> cons/exp/ups = $0 and a 0-kW breakdown, rendered
//   silently next to Section 2's non-zero monthly BESS savings. These tests
//   lock the loud-banner replacement for both blocks.
// =============================================================================
registerTest({
  id      : 'UNIT_CFE_HOURLY_IDLE_LOUD_BANNER',
  group   : 'unit',
  module  : 'writers/cfe_chunk5',
  scenarios: [],
  tags    : ['writers', 'cfe', 'chunk5', 'regression'],
  source  : 'tests_unit/writers/CfeOutputChunk5Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/cfe_chunk5 [B-4]: hourly-idle loud banner');

    // All-zero (CULLIGAN live state): banner replaces the tiles.
    var sh = _mkMockSheet();
    var autoOpt = { conservativeMxn: 0, upsideMxn: 0, optimalByMonth: [] };
    _cfeOutV2_renderConsExpUpside(sh, 50, autoOpt, 0, 'ZERO_EXPORT', 10110616);
    var text = _allWrittenText(sh);

    t.assertTrue('idle banner is rendered (SIN VALOR BESS DESPACHABLE)',
                 text.indexOf('SIN VALOR BESS DESPACHABLE') >= 0);
    t.assertTrue('banner points the reader to the monthly model (secci\u00f3n 2)',
                 text.indexOf('RECIBO CON PV + BESS') >= 0);
    t.assertTrue('banner names the interconnection mode',
                 text.indexOf('ZERO_EXPORT') >= 0);
    t.assertTrue('no CONSERVADOR tile in idle state',
                 text.indexOf('CONSERVADOR') < 0);
    t.assertTrue('no \u00d3PTIMO tile in idle state',
                 text.indexOf('\u00d3PTIMO\n') < 0);

    // Control: non-zero range renders the three tiles, no idle banner.
    var sh2 = _mkMockSheet();
    var autoOpt2 = { conservativeMxn: 500000, upsideMxn: 650000, optimalByMonth: [] };
    _cfeOutV2_renderConsExpUpside(sh2, 50, autoOpt2, 580000, 'NET_BILLING', 13000000);
    var text2 = _allWrittenText(sh2);
    t.assertTrue('control: CONSERVADOR tile rendered', text2.indexOf('CONSERVADOR') >= 0);
    t.assertTrue('control: no idle banner', text2.indexOf('SIN VALOR BESS DESPACHABLE') < 0);
  }
});


registerTest({
  id      : 'UNIT_CFE_DEMAND_BREAKDOWN_IDLE_OMITTED',
  group   : 'unit',
  module  : 'writers/cfe_chunk5',
  scenarios: [],
  tags    : ['writers', 'cfe', 'chunk5', 'regression'],
  source  : 'tests_unit/writers/CfeOutputChunk5Tests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers/cfe_chunk5 [B-4]: zero demand breakdown is omitted loudly');

    // pvOnly == pvBess (battery idled): omission note, no zero table.
    var flatPeaks = [500,500,500,500,500,500,500,500,500,500,500,500];
    var idleAttr = { attribution: {
      pvOnly: { monthlyPeakPuntaKw: flatPeaks,
                costByBucket: { punta: 100, intermedia: 200, base: 300 } },
      pvBess: { monthlyPeakPuntaKw: flatPeaks,
                costByBucket: { punta: 100, intermedia: 200, base: 300 } }
    }};
    var sh = _mkMockSheet();
    _cfeOutV2_renderDemandChargeBreakdown(sh, 70, idleAttr);
    var text = _allWrittenText(sh);
    t.assertTrue('omission note rendered',
                 text.indexOf('DESGLOSE DE AHORRO BESS omitido') >= 0);
    t.assertTrue('no zero-kW table row in idle state',
                 text.indexOf('Reducci\u00f3n de pico') < 0);

    // Control: real reduction renders the table, no omission note.
    var redAttr = { attribution: {
      pvOnly: { monthlyPeakPuntaKw: [800,800,800,800,800,800,800,800,800,800,800,800],
                costByBucket: { punta: 900000, intermedia: 200, base: 300 } },
      pvBess: { monthlyPeakPuntaKw: [500,500,500,500,500,500,500,500,500,500,500,500],
                costByBucket: { punta: 400000, intermedia: 200, base: 300 } }
    }};
    var sh2 = _mkMockSheet();
    _cfeOutV2_renderDemandChargeBreakdown(sh2, 70, redAttr);
    var text2 = _allWrittenText(sh2);
    t.assertTrue('control: table rendered (Reducci\u00f3n de pico)',
                 text2.indexOf('Reducci\u00f3n de pico') >= 0);
    t.assertTrue('control: 300 kW reduction shown', text2.indexOf('300 kW') >= 0);
    t.assertTrue('control: no omission note',
                 text2.indexOf('DESGLOSE DE AHORRO BESS omitido') < 0);
  }
});
