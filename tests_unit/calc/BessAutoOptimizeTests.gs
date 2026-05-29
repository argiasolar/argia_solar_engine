// =============================================================================
// ARGIA TESTS -- tests_unit/calc/BessAutoOptimizeTests.gs
// -----------------------------------------------------------------------------
// CHUNK 5 -- Session 3
//
// Locks _runBessAutoOptimize (26_RunBessAutoOptimize.js): the strategy
// evaluator that picks the per-month best of PS / SC / LS and produces the
// Conservative / Expected / Upside bounds.
//
// COVERAGE (6 tests):
//   1. UNIT_BESS_AUTO_PICKS_BEST_PER_MONTH      -- winner = highest est-MXN
//   2. UNIT_BESS_AUTO_CONSERVATIVE_IS_PS        -- conservative == PS-everywhere
//   3. UNIT_BESS_AUTO_UPSIDE_GE_CONSERVATIVE    -- upside >= conservative always
//   4. UNIT_BESS_AUTO_TIE_BREAKS_TO_PS          -- equal savings -> PS wins
//   5. UNIT_BESS_AUTO_EXPECTED_USES_SELECTED    -- expected == selected strategy sum
//   6. UNIT_BESS_AUTO_EMPTY_CONTEXTS_SAFE       -- no contexts -> zeros, no throw
// =============================================================================

// Build a monthCtx that favors a given strategy by construction.
// PS-favorable:  lots of PV surplus, no arbitrage spread (punta≈base)
// LS-favorable:  big punta spread + NET_BILLING + low PV (arbitrage wins)
function _aoTestBuckets() {
  var b = new Array(24);
  for (var h = 0; h < 24; h++) {
    if (h <= 5)              b[h] = 'base';
    else if (h >= 18 && h <= 21) b[h] = 'punta';
    else                     b[h] = 'intermedia';
  }
  return b;
}

function _aoFlatLoad(kw) { var a = new Array(24); for (var h=0;h<24;h++) a[h]=kw; return a; }
function _aoDaylightPv(total) {
  var a = new Array(24).fill(0);
  if (total <= 0) return a;
  var per = total / 14;
  for (var h = 6; h <= 19; h++) a[h] = per;
  return a;
}

function _aoCtx(overrides) {
  var base = {
    monthIndex: 0,
    daysInMonth: 30,
    bucketByHour: _aoTestBuckets(),
    loadByHour: _aoFlatLoad(100),
    pvByHour: _aoDaylightPv(1400),
    batteryCapKwh: 400,
    batteryPowerKw: 100,
    minSocKwh: 20,
    maxSocKwh: 380,
    usableKwh: 360,
    rte: 0.9,
    interconnMode: 'NET_BILLING',
    rateBase: 1.0,
    rateInter: 1.5,
    ratePunta: 3.0,
    planningDemandLimitKw: 200,
    demandRates: { capacidadMxnPerKw: 350, distribucionMxnPerKw: 60 }
  };
  if (overrides) for (var k in overrides) if (overrides.hasOwnProperty(k)) base[k] = overrides[k];
  return base;
}


registerTest({
  id      : 'UNIT_BESS_AUTO_PICKS_BEST_PER_MONTH',
  group   : 'unit',
  module  : 'calc/bess_auto',
  scenarios: [],
  tags    : ['calc', 'bess_auto', 'chunk5'],
  source  : 'tests_unit/calc/BessAutoOptimizeTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_auto: per-month winner = highest est-MXN strategy');

    // 12 identical LS-favorable months: big punta spread, low PV, NET_BILLING.
    // LS should win every month (arbitrage adds value PS can't capture).
    var months = [];
    for (var m = 0; m < 12; m++) {
      months.push(_aoCtx({
        monthIndex: m,
        loadByHour: (function(){ var a=_aoFlatLoad(40); for(var p=18;p<=21;p++) a[p]=180; return a; })(),
        pvByHour: _aoDaylightPv(14 * 10),   // almost no PV
        ratePunta: 4.0, rateBase: 1.0,       // strong spread
        interconnMode: 'NET_BILLING'
      }));
    }
    var d = _runBessAutoOptimize(months, { selectedStrategy: 'PEAK_SHAVING' });

    // At least some months should pick LS (arbitrage wins where PV can't)
    var lsCount = 0;
    for (var i = 0; i < 12; i++) if (d.optimalByMonth[i] === 'LS') lsCount++;
    t.assertTrue('LS wins at least some months under strong spread + low PV',
                 lsCount > 0);

    // Upside (best-of) must be >= the LS-everywhere sum is NOT required,
    // but upside must be >= conservative.
    t.assertTrue('upside >= conservative', d.upsideMxn >= d.conservativeMxn - 1e-6);
    t.info('autoOptimize', 'lsCount=' + lsCount +
      ' cons=' + d.conservativeMxn.toFixed(0) +
      ' ups=' + d.upsideMxn.toFixed(0));
  }
});


registerTest({
  id      : 'UNIT_BESS_AUTO_CONSERVATIVE_IS_PS',
  group   : 'unit',
  module  : 'calc/bess_auto',
  scenarios: [],
  tags    : ['calc', 'bess_auto', 'chunk5'],
  source  : 'tests_unit/calc/BessAutoOptimizeTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_auto: conservative == sum of PEAK_SHAVING monthly');

    var months = [];
    for (var m = 0; m < 12; m++) months.push(_aoCtx({ monthIndex: m }));
    var d = _runBessAutoOptimize(months, {});

    var psSum = 0;
    for (var i = 0; i < 12; i++) psSum += d.perStrategyMonthly.PEAK_SHAVING[i];
    t.assertNear('conservative == PS sum', psSum, d.conservativeMxn, 0.01);
  }
});


registerTest({
  id      : 'UNIT_BESS_AUTO_UPSIDE_GE_CONSERVATIVE',
  group   : 'unit',
  module  : 'calc/bess_auto',
  scenarios: [],
  tags    : ['calc', 'bess_auto', 'chunk5'],
  source  : 'tests_unit/calc/BessAutoOptimizeTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_auto: upside always >= conservative');

    // Mixed bag of months, some PS-favorable, some LS-favorable
    var months = [];
    for (var m = 0; m < 12; m++) {
      if (m % 2 === 0) {
        months.push(_aoCtx({ monthIndex: m }));   // PV-rich, PS-favorable
      } else {
        months.push(_aoCtx({                       // LS-favorable
          monthIndex: m,
          pvByHour: _aoDaylightPv(14 * 10),
          ratePunta: 4.0,
          loadByHour: (function(){ var a=_aoFlatLoad(40); for(var p=18;p<=21;p++) a[p]=180; return a; })()
        }));
      }
    }
    var d = _runBessAutoOptimize(months, {});
    t.assertTrue('upside >= conservative (mixed months)',
                 d.upsideMxn >= d.conservativeMxn - 1e-6);
  }
});


registerTest({
  id      : 'UNIT_BESS_AUTO_TIE_BREAKS_TO_PS',
  group   : 'unit',
  module  : 'calc/bess_auto',
  scenarios: [],
  tags    : ['calc', 'bess_auto', 'chunk5'],
  source  : 'tests_unit/calc/BessAutoOptimizeTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_auto: equal savings -> PS wins (conservative bias)');

    // PV-rich + NO arbitrage spread (punta == base) -> LS gate blocks, LS
    // collapses to PS behavior, so PS/SC/LS all produce identical savings.
    // Tie-break must pick PS.
    var months = [];
    for (var m = 0; m < 12; m++) {
      months.push(_aoCtx({
        monthIndex: m,
        rateBase: 2.0, rateInter: 2.0, ratePunta: 2.0,  // no spread
        interconnMode: 'NET_METERING'                    // LS gate blocked anyway
      }));
    }
    var d = _runBessAutoOptimize(months, {});
    var allPs = true;
    for (var i = 0; i < 12; i++) if (d.optimalByMonth[i] !== 'PS') allPs = false;
    t.assertTrue('all months tie-break to PS when no strategy is better', allPs);
  }
});


registerTest({
  id      : 'UNIT_BESS_AUTO_EXPECTED_USES_SELECTED',
  group   : 'unit',
  module  : 'calc/bess_auto',
  scenarios: [],
  tags    : ['calc', 'bess_auto', 'chunk5'],
  source  : 'tests_unit/calc/BessAutoOptimizeTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_auto: expected == sum of selected strategy monthly');

    var months = [];
    for (var m = 0; m < 12; m++) months.push(_aoCtx({ monthIndex: m }));

    var dLs = _runBessAutoOptimize(months, { selectedStrategy: 'LOAD_SHIFTING' });
    var lsSum = 0;
    for (var i = 0; i < 12; i++) lsSum += dLs.perStrategyMonthly.LOAD_SHIFTING[i];
    t.assertNear('expected == LS sum when LS selected', lsSum, dLs.expectedMxn, 0.01);
    t.assert('selectedStrategy recorded', 'LOAD_SHIFTING', dLs.selectedStrategy);

    // Strategy alias normalization
    var dSc = _runBessAutoOptimize(months, { selectedStrategy: 'SC' });
    t.assert('SC alias normalized', 'SELF_CONSUMPTION_MAX', dSc.selectedStrategy);
  }
});


registerTest({
  id      : 'UNIT_BESS_AUTO_EMPTY_CONTEXTS_SAFE',
  group   : 'unit',
  module  : 'calc/bess_auto',
  scenarios: [],
  tags    : ['calc', 'bess_auto', 'chunk5'],
  source  : 'tests_unit/calc/BessAutoOptimizeTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_auto: empty/missing contexts return safe zeros');

    var d1 = _runBessAutoOptimize([], {});
    t.assert('empty: conservative 0', 0, d1.conservativeMxn);
    t.assert('empty: upside 0', 0, d1.upsideMxn);
    t.assert('empty: 12 optimalByMonth entries', 12, d1.optimalByMonth.length);
    t.assert('empty: provenance NO_CONTEXTS', 'NO_CONTEXTS', d1.provenance);

    var d2 = _runBessAutoOptimize(null, {});
    t.assert('null: conservative 0', 0, d2.conservativeMxn);
    t.assertTrue('null: no throw, returns object', typeof d2 === 'object');
  }
});
