// =============================================================================
// ARGIA TESTS -- tests_unit/calc/BessWearCostTests.gs
// -----------------------------------------------------------------------------
// CHUNK 5 -- Session 2
//
// Locks the formula and edge cases of calcBessWearCostMxnPerKwh
// (25_CalcBessWearCost.js).
//
// Contract reference: docs/CHUNK_5_ROADMAP.md §"Session 2"
//
// COVERAGE (5 tests):
//   1. UNIT_BESS_WEAR_TYPICAL_HW_LUNA_2MWH    -- known catalog row produces sane number
//   2. UNIT_BESS_WEAR_FORMULA_LOCK            -- formula matches hand-computed value
//   3. UNIT_BESS_WEAR_INSUFFICIENT_INPUT      -- null + provenance on missing fields
//   4. UNIT_BESS_WEAR_SANITY_CLAMPS           -- malformed inputs clamp to valid ranges
//   5. UNIT_BESS_WEAR_CATALOG_ROW_HELPER      -- _wearCostInputFromCatalogRow translates correctly
// =============================================================================


// Helper -- typical HW_LUNA_2MWH from the catalog
function _wearLuna2MWH() {
  return {
    capexMxn:          20000000,    // 20M MXN
    capacityKwh:       2032,         // nominal
    minSocPct:         0.05,
    maxSocPct:         0.95,         // 90% SoC window
    cycleLifeAt100Dod: 6000,
    residualValuePct:  0.05,         // 5%
    degradationPct:    0.02,         // 2%/yr
    warrantyYears:     10
  };
}


registerTest({
  id      : 'UNIT_BESS_WEAR_TYPICAL_HW_LUNA_2MWH',
  group   : 'unit',
  module  : 'calc/bess_wear',
  scenarios: [],
  tags    : ['calc', 'bess_wear', 'chunk5'],
  source  : 'tests_unit/calc/BessWearCostTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_wear: typical HW_LUNA_2MWH catalog row');

    var r = calcBessWearCostMxnPerKwh(_wearLuna2MWH());

    t.assert('provenance OK', 'OK', r.provenance);
    t.assertTrue('wearCost positive', r.wearCostMxnPerKwh > 0);
    // Sanity bounds: 20M MXN, 2032 kWh × 0.9 = 1829 kWh usable per cycle,
    // × 6000 cycles = 10.97M kWh lifetime throughput.
    // 20M × 0.95 / 10.97M = ~1.73 MXN/kWh -- before midpoint degradation.
    // With midpoint degradation factor ~0.95 (2% × 5 yrs), avg usable
    // ~1737 kWh/cycle, lifetime ~10.42M kWh, wear ~1.82 MXN/kWh.
    t.assertTrue('wearCost in plausible LFP range (1.5..2.5 MXN/kWh)',
                 r.wearCostMxnPerKwh >= 1.5 && r.wearCostMxnPerKwh <= 2.5);
    t.assertTrue('components recorded', r.components.throughputLifetimeKwh > 0);

    t.info('wearCost', 'HW_LUNA_2MWH -> ' + r.wearCostMxnPerKwh.toFixed(3) + ' MXN/kWh'
       + ' (throughput=' + Math.round(r.components.throughputLifetimeKwh) + ' kWh)');
  }
});


registerTest({
  id      : 'UNIT_BESS_WEAR_FORMULA_LOCK',
  group   : 'unit',
  module  : 'calc/bess_wear',
  scenarios: [],
  tags    : ['calc', 'bess_wear', 'chunk5'],
  source  : 'tests_unit/calc/BessWearCostTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_wear: formula matches hand-computed value');

    // Construct a simple case with NO degradation so the math is exact:
    //   capex=1,000,000; capacity=100 kWh; socWindow=0.9 -> usable=90;
    //   cycles=1000; residual=0.10; degradation=0
    // Expected:
    //   throughput = 1000 × 90 = 90,000 kWh
    //   amortized  = 1,000,000 × 0.90 = 900,000
    //   wearCost   = 900,000 / 90,000 = 10 MXN/kWh exactly
    var r = calcBessWearCostMxnPerKwh({
      capexMxn:          1000000,
      capacityKwh:       100,
      minSocPct:         0.05,
      maxSocPct:         0.95,
      cycleLifeAt100Dod: 1000,
      residualValuePct:  0.10,
      degradationPct:    0,
      warrantyYears:     10
    });
    t.assert('provenance OK', 'OK', r.provenance);
    t.assertNear('wear cost = 10.0 MXN/kWh (no degradation)', 10.0, r.wearCostMxnPerKwh, 1e-9);
    t.assertNear('throughput = 90,000 kWh', 90000, r.components.throughputLifetimeKwh, 1e-6);
  }
});


registerTest({
  id      : 'UNIT_BESS_WEAR_INSUFFICIENT_INPUT',
  group   : 'unit',
  module  : 'calc/bess_wear',
  scenarios: [],
  tags    : ['calc', 'bess_wear', 'chunk5'],
  source  : 'tests_unit/calc/BessWearCostTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_wear: insufficient input returns null (NOT zero/NaN)');

    // Missing CAPEX
    var r1 = calcBessWearCostMxnPerKwh({
      capacityKwh: 100, cycleLifeAt100Dod: 6000
    });
    t.assertTrue('null when CAPEX missing', r1.wearCostMxnPerKwh === null);
    t.assert('provenance INSUFFICIENT_CAPEX', 'INSUFFICIENT_CAPEX', r1.provenance);

    // Missing capacity
    var r2 = calcBessWearCostMxnPerKwh({
      capexMxn: 1000000, cycleLifeAt100Dod: 6000
    });
    t.assertTrue('null when capacity missing', r2.wearCostMxnPerKwh === null);
    t.assert('provenance INSUFFICIENT_CAPACITY', 'INSUFFICIENT_CAPACITY', r2.provenance);

    // Missing cycle life
    var r3 = calcBessWearCostMxnPerKwh({
      capexMxn: 1000000, capacityKwh: 100
    });
    t.assertTrue('null when cycle life missing', r3.wearCostMxnPerKwh === null);
    t.assert('provenance INSUFFICIENT_CYCLE_LIFE', 'INSUFFICIENT_CYCLE_LIFE', r3.provenance);

    // NaN inputs
    var r4 = calcBessWearCostMxnPerKwh({
      capexMxn: NaN, capacityKwh: 100, cycleLifeAt100Dod: 6000
    });
    t.assertTrue('null on NaN CAPEX', r4.wearCostMxnPerKwh === null);

    // Invalid SoC window (max <= min)
    var r5 = calcBessWearCostMxnPerKwh({
      capexMxn: 1000000, capacityKwh: 100,
      minSocPct: 0.9, maxSocPct: 0.5,
      cycleLifeAt100Dod: 6000
    });
    t.assertTrue('null on inverted SoC window', r5.wearCostMxnPerKwh === null);
    t.assert('provenance INVALID_SOC_WINDOW', 'INVALID_SOC_WINDOW', r5.provenance);
  }
});


registerTest({
  id      : 'UNIT_BESS_WEAR_SANITY_CLAMPS',
  group   : 'unit',
  module  : 'calc/bess_wear',
  scenarios: [],
  tags    : ['calc', 'bess_wear', 'chunk5'],
  source  : 'tests_unit/calc/BessWearCostTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_wear: malformed inputs clamp to valid ranges');

    // residualValuePct > 0.5 should clamp to 0.5
    var r1 = calcBessWearCostMxnPerKwh({
      capexMxn: 1000000, capacityKwh: 100,
      minSocPct: 0.05, maxSocPct: 0.95,
      cycleLifeAt100Dod: 1000,
      residualValuePct: 0.99,
      degradationPct: 0
    });
    t.assert('provenance OK', 'OK', r1.provenance);
    t.assertNear('residualValuePct clamped to 0.50', 0.5,
                 r1.components.residualValuePct, 1e-9);

    // residualValuePct < 0 should clamp to 0
    var r2 = calcBessWearCostMxnPerKwh({
      capexMxn: 1000000, capacityKwh: 100,
      cycleLifeAt100Dod: 1000,
      residualValuePct: -0.10,
      degradationPct: 0
    });
    t.assertNear('residualValuePct clamped to 0', 0,
                 r2.components.residualValuePct, 1e-9);

    // No NaN ever
    var r3 = calcBessWearCostMxnPerKwh({
      capexMxn: 1000000, capacityKwh: 100,
      cycleLifeAt100Dod: 1000,
      degradationPct: 999  // absurd
    });
    t.assertTrue('finite wearCost on absurd degradation', isFinite(r3.wearCostMxnPerKwh));
  }
});


registerTest({
  id      : 'UNIT_BESS_WEAR_CATALOG_ROW_HELPER',
  group   : 'unit',
  module  : 'calc/bess_wear',
  scenarios: [],
  tags    : ['calc', 'bess_wear', 'chunk5'],
  source  : 'tests_unit/calc/BessWearCostTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_wear: _wearCostInputFromCatalogRow translates header-keyed rows');

    // Synthetic header-keyed row (as produced by getAllBatteryProducts)
    var catalogRow = {
      Battery_ID:              'HW_LUNA_2MWH',
      Nominal_Capacity_kWh:    2032,
      Usable_Capacity_kWh:     1828.8,
      'Min_SOC_%':             0.05,
      'Max_SOC_%':             0.95,
      Cycle_Life_Cycles:       6000,
      Warranty_Years:          10,
      'Annual_Degradation_%':  0.02,
      Residual_Value_Pct:      0.05,
      Installed_CAPEX_MXN:     20000000
    };
    var input = _wearCostInputFromCatalogRow(catalogRow);
    t.assert('capexMxn translated',          20000000, input.capexMxn);
    t.assert('capacityKwh translated',       2032,     input.capacityKwh);
    t.assertNear('minSocPct translated',     0.05,     input.minSocPct, 1e-9);
    t.assertNear('maxSocPct translated',     0.95,     input.maxSocPct, 1e-9);
    t.assert('cycleLifeAt100Dod translated', 6000,     input.cycleLifeAt100Dod);
    t.assertNear('residualValuePct translated', 0.05,  input.residualValuePct, 1e-9);
    t.assertNear('degradationPct translated', 0.02,    input.degradationPct, 1e-9);
    t.assert('warrantyYears translated',     10,       input.warrantyYears);

    // Verify the chain end-to-end: catalog row -> wear cost
    var r = calcBessWearCostMxnPerKwh(input);
    t.assert('end-to-end provenance OK', 'OK', r.provenance);
    t.assertTrue('end-to-end wearCost > 0', r.wearCostMxnPerKwh > 0);

    // Null input -> null output (defensive)
    t.assertTrue('null row -> null', _wearCostInputFromCatalogRow(null) === null);
  }
});
