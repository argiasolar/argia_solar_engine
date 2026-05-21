// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcBessSizingTests.gs
// -----------------------------------------------------------------------------
// PASS 8 MIGRATION: calcBessSizing engine.
//
// SOURCE: addPhase7Tests in 99j_Phase7_CalcBessSizing.gs (whole-file suite).
//         Migrated 2026-05-21 as part of Pass 8.
//
// COVERAGE
//   calcBessSizing() against hand-derived reference values:
//     - Function and constants exist
//     - Empty load profile throws
//     - PEAK_SHAVING AUTO produces correct candidate physics
//     - PEAK_SHAVING recommends smallest full-shave rung
//     - Demand-saving and payback math
//     - MAX_ROI picks lowest finite payback
//     - BLACKOUT_COVERAGE returns honest "not sizeable"
//     - Provenance + warnings (SYNTHESIZED vs METERED)
//     - Worst-month sizing (handles single-month spikes)
//     - Library products become extra candidates
//
// HAND-DERIVED REFERENCE
//   batterySpec: minSoc .10 maxSoc .90 rte .90 deg .025 backup 0 cycles 1.0
//   puntaWindowHours 4
//   usableFrac = (.90-.10) * (1-.025) * (1-0) = 0.78
//   per candidate: usableKwh = cap * 0.78 ; shaveCapableKw = usableKwh / 4
//     100 kWh -> usable  78,    shaveCapable 19.50
//     250 kWh -> usable 195,    shaveCapable 48.75
//     500 kWh -> usable 390,    shaveCapable 97.50
//    1000 kWh -> usable 780,    shaveCapable 195.0
//    2000 kWh -> usable 1560,   shaveCapable 390.0
//   site maxPuntaKw = 90  -> AUTO shavedKw = min(shaveCapable, 90)
//   => smallest rung that fully shaves 90 kW is 500 kWh (recommendation).
//
// CLASSIFICATION
//   group=unit. Pure function, no sheet I/O. All fixtures are inline.
//
// DEPENDENCIES
//   - calcBessSizing (17_CalcBessSizing.gs)
//   - BESS_SIZING_GOAL constants (17_CalcBessSizing.gs)
//
// CO-EXISTENCE
//   99j_Phase7_CalcBessSizing.gs is unchanged and still runs from legacy
//   runTests(). Both run the same 28 asserts until 99j is deleted in
//   the deletion pass (after all migrations complete).
// =============================================================================


registerTest({
  id      : 'UNIT_CALC_BESS_SIZING',
  group   : 'unit',
  module  : 'calc/bess_sizing',
  scenarios: [],
  tags    : ['calc', 'bess', 'sizing', 'peak-shaving', 'max-roi'],
  source  : 'tests_unit/calc/CalcBessSizingTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess_sizing: calcBessSizing engine');

    // -- Shared fixtures ---------------------------------------------------
    var SPEC = {
      minSocPct: 0.10, maxSocPct: 0.90, rtePct: 0.90,
      degradationPct: 0.025, backupReservePct: 0.0,
      cyclesPerDay: 1.0, puntaWindowHours: 4.0
    };

    // 12 identical months, TESTPROJ-style flat profile
    function flatProfile(kwPunta, kwhPunta, provenance) {
      var months = [];
      for (var i = 0; i < 12; i++) {
        months.push({ kwhPunta: kwhPunta, kwPunta: kwPunta, days: 30 });
      }
      return { months: months, provenance: provenance || 'SYNTHESIZED' };
    }

    // === TEST 1: function + constants exist ==============================
    t.assert('calcBessSizing function defined',
             'function', typeof calcBessSizing);
    t.assert('BESS_SIZING_GOAL defined',
             'object', typeof BESS_SIZING_GOAL);
    t.assert('BESS_SIZING_GOAL.PEAK_SHAVING value',
             'PEAK_SHAVING', BESS_SIZING_GOAL.PEAK_SHAVING);

    // === TEST 2: empty profile throws ====================================
    t.assertThrows('Empty load profile -> throws', function () {
      calcBessSizing({ goal: 'PEAK_SHAVING', loadProfile: { months: [] } });
    });

    // === TEST 3: PEAK_SHAVING AUTO -> candidate physics correct ==========
    var r = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000),
      batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      capexMxnPerKwh: 8000     // 8000 MXN/kWh installed
    });
    t.assertTrue('PEAK_SHAVING -> sizeable true', r.sizeable);
    t.assert('5 ladder candidates produced', 5, r.candidates.length);

    // candidate[0] = 100 kWh rung
    var c100 = r.candidates[0];
    t.assert('100 kWh: capacityKwh',     100,   c100.capacityKwh);
    t.assert('100 kWh: usableKwh',        78,   c100.usableKwh,       0.001);
    t.assert('100 kWh: shaveCapableKw',  19.50, c100.shaveCapableKw,  0.001);
    t.assert('100 kWh: shavedKw (AUTO)', 19.50, c100.shavedKw,        0.001);

    // candidate[2] = 500 kWh rung (first that fully shaves 90 kW)
    var c500 = r.candidates[2];
    t.assert('500 kWh: usableKwh',       390,   c500.usableKwh,       0.001);
    t.assert('500 kWh: shaveCapableKw',  97.50, c500.shaveCapableKw,  0.001);
    t.assert('500 kWh: shavedKw (AUTO, capped at 90)',
             90, c500.shavedKw, 0.001);

    // === TEST 4: PEAK_SHAVING picks smallest full-shave rung =============
    t.assertTrue('PEAK_SHAVING -> recommendation exists',
                 r.recommendation !== null);
    if (r.recommendation) {
      t.assert('PEAK_SHAVING recommends 500 kWh (smallest full shave)',
               500, r.recommendation.capacityKwh);
      t.assert('Recommended shavedKw = 90',
               90, r.recommendation.shavedKw, 0.001);
    }

    // === TEST 5: demand-saving + payback math ===========================
    // 500 kWh: shavedKw 90 -> 90 * 400 * 12 = 432,000 MXN/yr
    // CAPEX 500 * 8000 = 4,000,000 -> payback 4M / 432k = 9.259 yr
    if (r.recommendation) {
      t.assert('500 kWh: annualDemandSavingMxn',
               432000, r.recommendation.annualDemandSavingMxn, 0.01);
      t.assert('500 kWh: installedCapexMxn',
               4000000, r.recommendation.installedCapexMxn, 0.01);
      t.assert('500 kWh: paybackYears',
               9.259259, r.recommendation.paybackYears, 0.0001);
    }

    // === TEST 6: MAX_ROI picks lowest finite payback ====================
    // All rungs that shave >0 kW: payback = (cap*8000) / (shavedKw*400*12)
    //  100 kWh: 19.5 kW shaved, payback 8.547
    //  250 kWh: 48.75 kW shaved, payback 8.547
    //  500 kWh: 90 kW shaved (capped), payback 9.259
    // 1000 kWh: 90 kW shaved (capped), payback 18.52
    // => lowest is 8.547 (100 kWh, first in candidate order)
    var roi = calcBessSizing({
      goal: BESS_SIZING_GOAL.MAX_ROI,
      loadProfile: flatProfile(90, 5000),
      batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      capexMxnPerKwh: 8000
    });
    t.assertTrue('MAX_ROI -> recommendation exists',
                 roi.recommendation !== null);
    if (roi.recommendation) {
      t.assert('MAX_ROI: best payback ~8.547 yr',
               8.547009, roi.recommendation.paybackYears, 0.0001);
    }

    // === TEST 7: BLACKOUT_COVERAGE -> honest "not sizeable" =============
    var bo = calcBessSizing({
      goal: BESS_SIZING_GOAL.BLACKOUT_COVERAGE,
      loadProfile: flatProfile(90, 5000),
      batterySpec: SPEC
    });
    t.assertFalse('BLACKOUT_COVERAGE -> sizeable false', bo.sizeable);
    t.assertTrue('BLACKOUT_COVERAGE -> gives a reason',
                 typeof bo.reason === 'string' && bo.reason.length > 0);
    t.assert('BLACKOUT_COVERAGE -> no candidates', 0, bo.candidates.length);

    // === TEST 8: provenance + warnings ===================================
    // SYNTHESIZED must raise best-case + exceedance warnings (>=2)
    t.assert('SYNTHESIZED provenance carried through',
             'SYNTHESIZED', r.provenance);
    t.assertTrue('SYNTHESIZED -> at least 2 warnings (best-case + exceedance)',
                 r.warnings.length >= 2);

    var metered = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000, 'METERED'),
      batterySpec: SPEC,
      demandChargeMxnPerKw: 400, capexMxnPerKwh: 8000
    });
    t.assert('METERED provenance carried through',
             'METERED', metered.provenance);

    // === TEST 9: worst-month sizing (not average) =======================
    // Single-month 200 kW spike must drive sizing
    var spiky = flatProfile(90, 5000);
    spiky.months[6] = { kwhPunta: 9000, kwPunta: 200, days: 31 };
    var rs = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: spiky, batterySpec: SPEC,
      demandChargeMxnPerKw: 400, capexMxnPerKwh: 8000
    });
    t.assert('Spiky profile -> siteSummary.maxMonthlyPuntaKw = 200',
             200, rs.siteSummary.maxMonthlyPuntaKw);
    // 200 kW needs shaveCapable >= 200 -> usable >= 800 -> cap >= 1025.6
    // 1000 kWh gives shaveCapable 195 (too small). 2000 kWh is the next rung.
    if (rs.recommendation) {
      t.assert('Spiky profile recommends 2000 kWh (covers 200 kW spike)',
               2000, rs.recommendation.capacityKwh);
    }

    // === TEST 10: library products become extra candidates ==============
    var withLib = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000),
      batterySpec: SPEC,
      demandChargeMxnPerKw: 400, capexMxnPerKwh: 8000,
      libraryProducts: [
        { batteryId: 'CUSTOM_MANUAL', capacityKwh: 0, powerKw: 0 },  // skipped
        { batteryId: 'BYD_2MWH', capacityKwh: 2000, powerKw: 1000,
          installedCapexMxn: 12000000 }
      ]
    });
    // 5 ladder rungs + 1 valid library product (CUSTOM_MANUAL skipped) = 6
    t.assert('Library: 5 ladder + 1 valid product = 6 candidates',
             6, withLib.candidates.length);
    var libCand = withLib.candidates[withLib.candidates.length - 1];
    t.assert('Library candidate source = LIBRARY', 'LIBRARY', libCand.source);
    t.assert('Library candidate capacity = 2000', 2000, libCand.capacityKwh);
  }
});
