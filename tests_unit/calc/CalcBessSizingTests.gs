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

    // === TEST 10: library products become candidates =====================
    // BDF-4 contract change: when libraryProducts is non-empty, ladder is
    // NOT synthesized. Library products are the ONLY candidates (with
    // optional stacking for products that opt in). Reason: ladder candidates
    // had $0 CAPEX and always out-ranked real products in the picker, which
    // was misleading. Now that stacking fills the C&I gap, ladder is
    // ladder-fallback-only (used when caller passes no library).
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
    // CUSTOM_MANUAL skipped (capacityKwh = 0), so just the 1 BYD entry,
    // non-stackable (no Stackable=YES) so qty=1 only: 1 candidate.
    t.assert('Library-only: 1 valid product = 1 candidate (no ladder when lib present)',
             1, withLib.candidates.length);
    var libCand = withLib.candidates[0];
    t.assert('Library candidate source = LIBRARY', 'LIBRARY', libCand.source);
    t.assert('Library candidate capacity = 2000', 2000, libCand.capacityKwh);
    t.assert('Non-stackable library product: stackQty = 1', 1, libCand.stackQty);
  }
});


// =============================================================================
// BDF-1 additions: energy-shift savings + coverage flag (Issues 2+3 fix)
// Tagged 'bdf1' so "▶ Run Tests for Current Chunk" picks them up.
// =============================================================================

registerTest({
  id      : 'UNIT_CALC_BESS_SIZING_BDF1',
  group   : 'unit',
  module  : 'calc/bess/sizing',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'sizing', 'bdf1', 'energy-shift', 'coverage'],
  source  : 'tests_unit/calc/CalcBessSizingTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess/sizing: BDF-1 energy-shift + coverage flag');

    var SPEC = {
      minSocPct: 0.05, maxSocPct: 0.95, rtePct: 0.913,
      degradationPct: 0.025, backupReservePct: 0,
      cyclesPerDay: 1.0, puntaWindowHours: 4
    };
    var flatProfile = function(kw, kwh) {
      var months = [];
      for (var i = 0; i < 12; i++) months.push({ kwhPunta: kwh, kwPunta: kw, days: 30 });
      return { months: months, provenance: 'SYNTHESIZED' };
    };

    // === TEST 1: Energy-shift saving is zero when rates not passed =======
    // (preserves backward compat with pre-BDF-1 callers)
    var noShift = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000),
      batterySpec: SPEC,
      demandChargeMxnPerKw: 400, capexMxnPerKwh: 8000,
    });
    var c500 = noShift.candidates[2];  // 500 kWh rung
    t.assert('No tariff -> annualEnergyShiftSavingMxn = 0',
             0, c500.annualEnergyShiftSavingMxn);
    t.assert('No tariff -> annualSavingMxn === annualDemandSavingMxn',
             c500.annualDemandSavingMxn, c500.annualSavingMxn);

    // === TEST 2: Energy-shift saving computes correctly with real rates ==
    // Real CULLIGAN April rates: punta 1.529, base 0.828, RTE 0.913
    // SPEC has 5%/95% SoC and 0.913 RTE (realistic Huawei LFP values).
    // 500 kWh -> usable = 500 × 0.9 × 0.975 = 438.75 kWh
    // monthlyThroughput = 438.75 × 1 × 30.42 × 0.913 = 12,185.6 kWh
    // annualThroughput = 146,227 kWh
    // netShift = 1.529 - (0.828/0.913) = 1.529 - 0.9069 = 0.6221 MXN/kWh
    // annualEnergyShift = 146,227 × 0.6221 = 90,968 MXN
    var withShift = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000),
      batterySpec: SPEC,
      demandChargeMxnPerKw: 400, capexMxnPerKwh: 8000,
      puntaRateMxnPerKwh: 1.529,
      baseRateMxnPerKwh:  0.828,
    });
    var c500s = withShift.candidates[2];
    t.assertNear('500 kWh: annualEnergyShiftSavingMxn ~90,968',
                 90968, c500s.annualEnergyShiftSavingMxn, 50);
    t.assertNear('500 kWh: netShiftValueMxnPerKwh ~0.622',
                 0.6221, c500s.netShiftValueMxnPerKwh, 0.001);

    // === TEST 3: Total saving = demand + shift ===========================
    t.assert('500 kWh: annualSavingMxn = demand + shift',
             c500s.annualDemandSavingMxn + c500s.annualEnergyShiftSavingMxn,
             c500s.annualSavingMxn);

    // === TEST 4: Payback uses TOTAL, not demand-only =====================
    // Demand-only: 432,000 -> payback 9.259; +shift moves it shorter
    var paybackWithShift = c500s.paybackYears;
    t.assertTrue('payback with shift < payback without shift',
                 paybackWithShift < 9.259);

    // === TEST 5: Coverage flag =========================================
    // 100 kWh rung shaves only 21.9 kW vs 90 kW max -> PARTIAL
    var c100 = withShift.candidates[0];
    t.assert('100 kWh: coverageFlag = PARTIAL', 'PARTIAL', c100.coverageFlag);
    // 500 kWh rung shaves the full 90 kW -> FULL
    t.assert('500 kWh: coverageFlag = FULL', 'FULL', c500s.coverageFlag);
    // coverageRatio between 0 and 1
    t.assertNear('500 kWh: coverageRatio = 1.0', 1.0, c500s.coverageRatio, 0.001);
    t.assertNear('100 kWh: coverageRatio = 21.94/90 = 0.2438',
                 0.2438, c100.coverageRatio, 0.005);

    // === TEST 6: Thin tariff differential -> energy-shift may be small/zero ==
    // If punta is barely above base, the RTE losses eat the differential.
    // Example: punta 1.00, base 0.95, RTE 0.913 -> net = 1.00 - 1.040 = negative
    // -> energy-shift clamps to 0 (battery wouldn't arbitrage at a loss).
    var thinDiff = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000),
      batterySpec: SPEC,
      demandChargeMxnPerKw: 400, capexMxnPerKwh: 8000,
      puntaRateMxnPerKwh: 1.00, baseRateMxnPerKwh: 0.95,
    });
    var c500t = thinDiff.candidates[2];
    t.assert('Negative net shift -> annualEnergyShiftSavingMxn clamped to 0',
             0, c500t.annualEnergyShiftSavingMxn);
    t.assertTrue('Negative net shift -> netShiftValueMxnPerKwh < 0 (recorded)',
                 c500t.netShiftValueMxnPerKwh < 0);

    // === TEST 7: New fields ALWAYS present (even when shift = 0) =========
    t.assertTrue('annualSavingMxn always present',
                 typeof c500.annualSavingMxn === 'number');
    t.assertTrue('annualEnergyShiftSavingMxn always present',
                 typeof c500.annualEnergyShiftSavingMxn === 'number');
    t.assertTrue('netShiftValueMxnPerKwh always present',
                 typeof c500.netShiftValueMxnPerKwh === 'number');
    t.assertTrue('coverageFlag always present (string)',
                 typeof c500.coverageFlag === 'string');
    t.assertTrue('coverageRatio always present (number)',
                 typeof c500.coverageRatio === 'number');
  }
});


// =============================================================================
// BDF-2 additions: interconnection-mode-aware sizing.
// Tagged 'bdf2' so "▶ Run Tests for Current Chunk" picks them up.
// =============================================================================

registerTest({
  id      : 'UNIT_CALC_BESS_SIZING_BDF2',
  group   : 'unit',
  module  : 'calc/bess/sizing',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'sizing', 'bdf2', 'interconnection'],
  source  : 'tests_unit/calc/CalcBessSizingTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess/sizing: BDF-2 mode-aware energy-shift');

    var SPEC = {
      minSocPct: 0.05, maxSocPct: 0.95, rtePct: 0.913,
      degradationPct: 0.025, backupReservePct: 0,
      cyclesPerDay: 1.0, puntaWindowHours: 4
    };
    var flatProfile = function(kw, kwh) {
      var months = [];
      for (var i = 0; i < 12; i++) months.push({ kwhPunta: kwh, kwPunta: kw, days: 30 });
      return { months: months, provenance: 'SYNTHESIZED' };
    };

    // === TEST 1: UNKNOWN mode preserves BDF-1 numbers byte-identically ===
    // Backward-compat lock. If anyone "refactors" the mode-aware code and
    // accidentally breaks UNKNOWN, this test catches it before it ships.
    var bdf1 = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
    });
    var bdf2unknown = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
      interconnMode: BESS_INTERCONN_MODE.UNKNOWN,
    });
    t.assert('UNKNOWN mode == omitted mode (annualSavingMxn, c500)',
             bdf1.candidates[2].annualSavingMxn,
             bdf2unknown.candidates[2].annualSavingMxn);
    t.assert('UNKNOWN mode == omitted mode (annualEnergyShiftSavingMxn, c500)',
             bdf1.candidates[2].annualEnergyShiftSavingMxn,
             bdf2unknown.candidates[2].annualEnergyShiftSavingMxn);
    t.assert('UNKNOWN mode == omitted mode (paybackYears, c500)',
             bdf1.candidates[2].paybackYears,
             bdf2unknown.candidates[2].paybackYears);

    // === TEST 2: NET_METERING zeroes the energy-shift saving ============
    // Grid stores surplus at retail for free → battery time-shift collapses.
    var nm = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
      interconnMode: BESS_INTERCONN_MODE.NET_METERING,
      pvAnnualSurplusKwh: 500000,    // doesn't matter, NM ignores it
    });
    var c500nm = nm.candidates[2];
    t.assert('NET_METERING: annualEnergyShiftSavingMxn = 0',
             0, c500nm.annualEnergyShiftSavingMxn);
    t.assert('NET_METERING: annualSavingMxn = annualDemandSavingMxn only',
             c500nm.annualDemandSavingMxn, c500nm.annualSavingMxn);
    t.assert('NET_METERING: solar charge fraction = 0',
             0, c500nm.annualSolarChargedKwh);

    // === TEST 3: NET_BILLING uses (punta − exportPrice/RTE) for solar ===
    // 500 kWh battery: usable 438.75, monthlyThroughput 12,186, annual 146,227
    // Solar charge fraction: min(surplus, throughput). With 500,000 surplus,
    // all 146,227 charge from solar.
    // netShiftFromSolar = 1.529 − (0.8 / 0.913) = 1.529 − 0.876 = 0.653 MXN/kWh
    // annualShiftFromSolar = 146,227 × 0.653 = 95,486 MXN
    var nb = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
      interconnMode: BESS_INTERCONN_MODE.NET_BILLING,
      exportPriceMxnPerKwh: 0.8,
      pvAnnualSurplusKwh: 500000,
    });
    var c500nb = nb.candidates[2];
    t.assertNear('NET_BILLING: netShiftFromSolar ~0.653',
                 0.653, c500nb.netShiftFromSolarMxnPerKwh, 0.005);
    t.assertNear('NET_BILLING: annualShiftFromSolarMxn ~95,486',
                 95486, c500nb.annualShiftFromSolarMxn, 100);
    t.assert('NET_BILLING: annualSolarChargedKwh = annual throughput (surplus > need)',
             Math.round(c500nb.monthlyThroughputKwh * 12),
             Math.round(c500nb.annualSolarChargedKwh));
    t.assert('NET_BILLING: annualGridChargedKwh = 0 when surplus > need',
             0, Math.round(c500nb.annualGridChargedKwh));

    // === TEST 4: NET_BILLING overflow to grid when surplus < need ======
    // Same 500 kWh battery (146,227 kWh annual throughput) but only 50,000
    // kWh surplus → 50,000 from solar at 0.653, 96,227 from grid at BDF-1 rate.
    var nbOverflow = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
      interconnMode: BESS_INTERCONN_MODE.NET_BILLING,
      exportPriceMxnPerKwh: 0.8,
      pvAnnualSurplusKwh: 50000,
    });
    var c500nbo = nbOverflow.candidates[2];
    t.assert('NET_BILLING overflow: annualSolarChargedKwh = 50000',
             50000, Math.round(c500nbo.annualSolarChargedKwh));
    var expectedGridKwh = Math.round(c500nbo.monthlyThroughputKwh * 12 - 50000);
    t.assert('NET_BILLING overflow: annualGridChargedKwh = throughput - 50000',
             expectedGridKwh, Math.round(c500nbo.annualGridChargedKwh));
    // Grid portion uses BDF-1 base-arbitrage rate: 1.529 − 0.828/0.913 = 0.622
    t.assertNear('NET_BILLING overflow: netShiftFromGrid ~0.622',
                 0.622, c500nbo.netShiftFromGridMxnPerKwh, 0.005);

    // === TEST 5: ZERO_EXPORT captures full punta from surplus ===========
    // Curtailed PV is free to capture. Net = puntaRate (1.529).
    // 500 kWh → 146,227 × 1.529 = 223,581 MXN
    var ze = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
      interconnMode: BESS_INTERCONN_MODE.ZERO_EXPORT,
      pvAnnualSurplusKwh: 500000,
    });
    var c500ze = ze.candidates[2];
    t.assertNear('ZERO_EXPORT: netShiftFromSolar = puntaRate = 1.529',
                 1.529, c500ze.netShiftFromSolarMxnPerKwh, 0.001);
    t.assertNear('ZERO_EXPORT: annualShiftFromSolarMxn ~223,581',
                 223581, c500ze.annualShiftFromSolarMxn, 100);

    // === TEST 6: ZERO_EXPORT > NET_BILLING > NET_METERING (same battery) ==
    // For the same hardware and rates, the modes should rank cleanly.
    t.assertTrue('ZERO_EXPORT total saving > NET_BILLING total saving',
                 c500ze.annualSavingMxn > c500nb.annualSavingMxn);
    t.assertTrue('NET_BILLING total saving > NET_METERING total saving',
                 c500nb.annualSavingMxn > c500nm.annualSavingMxn);

    // === TEST 7: PV surplus = 0 → all NET_BILLING/ZERO_EXPORT throughput
    // falls back to grid (and uses BDF-1 base-arbitrage math).
    var zeNoPv = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
      interconnMode: BESS_INTERCONN_MODE.ZERO_EXPORT,
      pvAnnualSurplusKwh: 0,
    });
    var c500zenp = zeNoPv.candidates[2];
    t.assert('ZERO_EXPORT with 0 PV surplus: solar charged = 0',
             0, Math.round(c500zenp.annualSolarChargedKwh));
    t.assert('ZERO_EXPORT with 0 PV surplus: grid charged = full throughput',
             Math.round(c500zenp.monthlyThroughputKwh * 12),
             Math.round(c500zenp.annualGridChargedKwh));
    // Should match BDF-1 numbers (because grid arbitrage is BDF-1 math)
    t.assert('ZERO_EXPORT with 0 PV: annualSavingMxn == BDF-1 baseline',
             bdf1.candidates[2].annualSavingMxn,
             c500zenp.annualSavingMxn);

    // === TEST 8: BDF-2 fields always present on every candidate =========
    var cands = nb.candidates;
    for (var i = 0; i < cands.length; i++) {
      t.assertTrue('candidate ' + i + ' has interconnMode',
                   typeof cands[i].interconnMode === 'string');
      t.assertTrue('candidate ' + i + ' has annualSolarChargedKwh',
                   typeof cands[i].annualSolarChargedKwh === 'number');
      t.assertTrue('candidate ' + i + ' has annualGridChargedKwh',
                   typeof cands[i].annualGridChargedKwh === 'number');
      t.assertTrue('candidate ' + i + ' has netShiftFromSolarMxnPerKwh',
                   typeof cands[i].netShiftFromSolarMxnPerKwh === 'number');
    }
  }
});


// =============================================================================
// BDF-3 additions: min-savings threshold gate.
// Tagged 'bdf3' so "▶ Run Tests for Current Chunk" picks them up.
// =============================================================================

registerTest({
  id      : 'UNIT_CALC_BESS_SIZING_BDF3',
  group   : 'unit',
  module  : 'calc/bess/sizing',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'sizing', 'bdf3', 'threshold'],
  source  : 'tests_unit/calc/CalcBessSizingTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess/sizing: BDF-3 min-savings threshold');

    var SPEC = {
      minSocPct: 0.05, maxSocPct: 0.95, rtePct: 0.913,
      degradationPct: 0.025, backupReservePct: 0,
      cyclesPerDay: 1.0, puntaWindowHours: 4
    };
    var flatProfile = function(kw, kwh) {
      var months = [];
      for (var i = 0; i < 12; i++) months.push({ kwhPunta: kwh, kwPunta: kw, days: 30 });
      return { months: months, provenance: 'SYNTHESIZED' };
    };

    // === TEST 1: threshold=0 (omitted) -> all candidates pass ============
    // Backward-compat lock. Confirms BDF-2 behavior is unchanged when
    // threshold is not passed.
    var noThresh = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
    });
    for (var i = 0; i < noThresh.candidates.length; i++) {
      t.assert('candidate ' + i + ' meetsThreshold = true when no threshold set',
               true, noThresh.candidates[i].meetsThreshold);
    }
    t.assertTrue('recommendation exists when no threshold set',
                 noThresh.recommendation !== null);

    // === TEST 2: threshold met by some, missed by others ================
    // Sweet-spot threshold: above smaller rungs, below largest.
    // Actual ladder savings (verified against engine):
    //   100 kWh:   123,494  (demand cap at 105k + shift 18k)
    //   250 kWh:   308,734
    //   500 kWh:   522,968  (demand caps at 432k; shift keeps growing)
    //   1000 kWh:  613,936
    //   2000 kWh:  795,872
    // Threshold 600,000 -> 1000+kWh candidates pass.
    var midThresh = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
      minAnnualSavingMxn: 600000,
    });
    var c100 = midThresh.candidates[0];
    var c500 = midThresh.candidates[2];
    var c1000 = midThresh.candidates[3];
    var c2000 = midThresh.candidates[4];
    t.assert('100 kWh: meetsThreshold = false (saving < 600k)',
             false, c100.meetsThreshold);
    t.assert('500 kWh: meetsThreshold = false (saving < 600k)',
             false, c500.meetsThreshold);
    t.assert('1000 kWh: meetsThreshold = true', true, c1000.meetsThreshold);
    t.assert('2000 kWh: meetsThreshold = true', true, c2000.meetsThreshold);
    t.assertTrue('1000 kWh saving >= threshold',
                 c1000.annualSavingMxn >= 600000);
    t.assertTrue('500 kWh saving < threshold',
                 c500.annualSavingMxn < 600000);

    // === TEST 3: threshold-aware recommendation ===========================
    // With threshold 600k, eligible = {1000, 2000}. PEAK_SHAVING AUTO picks
    // "most shavedKw, then smallest capacity". Both shave 90 kW (capped),
    // so 1000 kWh wins on capacity tie-break.
    t.assertTrue('recommendation exists when at least one candidate meets',
                 midThresh.recommendation !== null);
    if (midThresh.recommendation) {
      t.assert('threshold-eligible recommendation = 1000 kWh',
               1000, midThresh.recommendation.capacityKwh);
      t.assertTrue('recommended candidate meetsThreshold',
                   midThresh.recommendation.meetsThreshold);
    }

    // === TEST 4: threshold above ALL candidates -> recommendation = null ==
    var highThresh = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(90, 5000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
      minAnnualSavingMxn: 999999999,  // unattainable
    });
    t.assert('recommendation = null when no candidate meets threshold',
             null, highThresh.recommendation);
    // But candidates are still ALL present (just flagged false)
    t.assert('candidates count unchanged even when all fail threshold',
             5, highThresh.candidates.length);
    for (var j = 0; j < highThresh.candidates.length; j++) {
      t.assert('candidate ' + j + ' meetsThreshold = false (all fail)',
               false, highThresh.candidates[j].meetsThreshold);
    }
    // Warning surfaces the verdict + best-below-threshold
    var hasVerdictWarning = false;
    for (var w = 0; w < highThresh.warnings.length; w++) {
      if (highThresh.warnings[w].indexOf('No candidate meets the configured') >= 0) {
        hasVerdictWarning = true;
        break;
      }
    }
    t.assertTrue('warning explains threshold verdict', hasVerdictWarning);

    // === TEST 5: meetsThreshold field always present =====================
    for (var k = 0; k < noThresh.candidates.length; k++) {
      t.assertTrue('candidate ' + k + ' has meetsThreshold field',
                   typeof noThresh.candidates[k].meetsThreshold === 'boolean');
    }
  }
});


// =============================================================================
// BDF-4 additions: stacking support (multi-unit candidates).
// Tagged 'bdf4' so "▶ Run Tests for Current Chunk" picks them up.
// =============================================================================

registerTest({
  id      : 'UNIT_CALC_BESS_SIZING_BDF4',
  group   : 'unit',
  module  : 'calc/bess/sizing',
  scenarios: [],
  tags    : ['unit', 'calc', 'bess', 'sizing', 'bdf4', 'stacking'],
  source  : 'tests_unit/calc/CalcBessSizingTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/bess/sizing: BDF-4 stacking');

    var SPEC = {
      minSocPct: 0.05, maxSocPct: 0.95, rtePct: 0.913,
      degradationPct: 0.025, backupReservePct: 0,
      cyclesPerDay: 1.0, puntaWindowHours: 4
    };
    var flatProfile = function(kw, kwh) {
      var months = [];
      for (var i = 0; i < 12; i++) months.push({ kwhPunta: kwh, kwPunta: kw, days: 30 });
      return { months: months, provenance: 'SYNTHESIZED' };
    };

    // === TEST 1: Non-stackable product produces qty=1 candidate only ====
    var nonStack = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(500, 30000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      libraryProducts: [
        { batteryId: 'NOSTACK_200', capacityKwh: 200, powerKw: 100,
          installedCapexMxn: 2500000,
          stackable: false, maxStackUnits: 1 }
      ]
    });
    t.assert('Non-stackable product: 1 candidate', 1, nonStack.candidates.length);
    t.assert('Non-stackable product: stackQty = 1',
             1, nonStack.candidates[0].stackQty);
    t.assert('Non-stackable: capacity = base capacity',
             200, nonStack.candidates[0].capacityKwh);

    // === TEST 2: Stackable product produces qty=1..max candidates ========
    var stackable = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(500, 30000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      libraryProducts: [
        { batteryId: 'STACK_200', capacityKwh: 200, powerKw: 100,
          installedCapexMxn: 2500000,
          stackable: true, maxStackUnits: 5 }
      ]
    });
    t.assert('Stackable product (max=5): 5 candidates', 5, stackable.candidates.length);
    // Verify scaling at each stack level
    var c1 = stackable.candidates[0];
    var c3 = stackable.candidates[2];
    var c5 = stackable.candidates[4];
    t.assert('qty=1: stackQty = 1', 1, c1.stackQty);
    t.assert('qty=1: capacity = 200', 200, c1.capacityKwh);
    t.assert('qty=1: CAPEX = $2.5M', 2500000, c1.installedCapexMxn);
    t.assert('qty=3: stackQty = 3', 3, c3.stackQty);
    t.assert('qty=3: capacity = 600', 600, c3.capacityKwh);
    t.assert('qty=3: CAPEX = $7.5M', 7500000, c3.installedCapexMxn);
    t.assert('qty=5: capacity = 1000', 1000, c5.capacityKwh);
    t.assert('qty=5: CAPEX = $12.5M (linear scaling)',
             12500000, c5.installedCapexMxn);

    // === TEST 3: Stack labels are human-readable ========================
    var stackable3 = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(500, 30000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      libraryProducts: [
        { batteryId: 'HW_LUNA_241', capacityKwh: 241, powerKw: 108,
          installedCapexMxn: 3200000,
          stackable: true, maxStackUnits: 3 }
      ]
    });
    t.assert('qty=1 label: just product ID',
             'HW_LUNA_241 (241 kWh)', stackable3.candidates[0].label);
    t.assertContains('qty=2 label contains "2 × HW_LUNA_241"',
                     stackable3.candidates[1].label, '2 × HW_LUNA_241');
    t.assertContains('qty=2 label contains stacked capacity (482 kWh)',
                     stackable3.candidates[1].label, '482 kWh');
    t.assertContains('qty=2 label contains stacked power (216 kW)',
                     stackable3.candidates[1].label, '216 kW');

    // === TEST 4: Mixed catalog (stackable + non-stackable) ===============
    var mixed = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(500, 30000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      libraryProducts: [
        { batteryId: 'STACK_100', capacityKwh: 100, powerKw: 50,
          installedCapexMxn: 1300000, stackable: true, maxStackUnits: 3 },
        { batteryId: 'NOSTACK_2000', capacityKwh: 2000, powerKw: 1000,
          installedCapexMxn: 20000000, stackable: false }
      ]
    });
    // 3 stack candidates + 1 non-stack = 4
    t.assert('Mixed catalog: 3 stacks + 1 single = 4 candidates',
             4, mixed.candidates.length);

    // === TEST 5: Stackable=YES with missing Max_Stack_Units treated as
    // not stackable (defensive default).
    var missingMax = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(500, 30000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      libraryProducts: [
        // stackable flag YES but no maxStackUnits - engine must treat as qty=1
        { batteryId: 'BROKEN', capacityKwh: 200, powerKw: 100,
          installedCapexMxn: 2500000,
          stackable: true }  // maxStackUnits intentionally missing
      ]
    });
    // Engine code reads maxStackUnits via "p.maxStackUnits >= 1". Undefined
    // fails that check, so qty stays at 1.
    t.assert('Missing maxStackUnits -> qty=1 only',
             1, missingMax.candidates.length);

    // === TEST 6: Library-empty -> ladder fallback ========================
    // Backward compat with BDF-1/2/3 callers that didn't pass library.
    var noLib = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(500, 30000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      capexMxnPerKwh: 8000,
      // libraryProducts intentionally omitted
    });
    t.assert('No library -> 5 ladder candidates fallback',
             5, noLib.candidates.length);
    t.assert('Ladder candidates have source=LADDER',
             'LADDER', noLib.candidates[0].source);

    // === TEST 7: Stack savings scale ~linearly with qty ==================
    // (subject to demand-shave capping at maxPuntaKw; with 500 kW max and
    // small stacks the cap doesn't bind yet)
    var smallProf = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(500, 30000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
      libraryProducts: [
        { batteryId: 'STACK_50', capacityKwh: 50, powerKw: 25,
          installedCapexMxn: 800000, stackable: true, maxStackUnits: 3 }
      ]
    });
    var s1 = smallProf.candidates[0];   // qty=1: 50 kWh
    var s2 = smallProf.candidates[1];   // qty=2: 100 kWh
    var s3 = smallProf.candidates[2];   // qty=3: 150 kWh
    // shaveCapableKw scales linearly with capacity
    t.assertNear('qty=2 shaveCapableKw = 2× qty=1',
                 2 * s1.shaveCapableKw, s2.shaveCapableKw, 0.1);
    t.assertNear('qty=3 shaveCapableKw = 3× qty=1',
                 3 * s1.shaveCapableKw, s3.shaveCapableKw, 0.1);

    // === TEST 8: Stack metadata propagated to candidate output ===========
    var meta = stackable.candidates[2];  // 3× STACK_200
    t.assert('Stack candidate: baseBatteryId',
             'STACK_200', meta.baseBatteryId);
    t.assert('Stack candidate: baseCapacityKwh = 200',
             200, meta.baseCapacityKwh);
    t.assert('Stack candidate: basePowerKw = 100',
             100, meta.basePowerKw);
    t.assert('Stack candidate: powerKw = qty × basePowerKw',
             300, meta.powerKw);

    // === TEST 9: Stacking respects threshold filter on _pickRecommendation
    var withThresh = calcBessSizing({
      goal: BESS_SIZING_GOAL.PEAK_SHAVING,
      loadProfile: flatProfile(500, 30000), batterySpec: SPEC,
      demandChargeMxnPerKw: 400,
      puntaRateMxnPerKwh: 1.529, baseRateMxnPerKwh: 0.828,
      minAnnualSavingMxn: 200000,    // small enough that some stacks meet
      libraryProducts: [
        { batteryId: 'STACK_50', capacityKwh: 50, powerKw: 25,
          installedCapexMxn: 800000, stackable: true, maxStackUnits: 5 }
      ]
    });
    // Some stack sizes meet the threshold, some don't
    var meetingCount = 0;
    var failingCount = 0;
    for (var i = 0; i < withThresh.candidates.length; i++) {
      if (withThresh.candidates[i].meetsThreshold) meetingCount++;
      else failingCount++;
    }
    t.assertTrue('At least one stack meets threshold', meetingCount > 0);
    t.assertTrue('Recommendation comes from a threshold-meeting stack',
                 withThresh.recommendation != null
                 && withThresh.recommendation.meetsThreshold);
  }
});
