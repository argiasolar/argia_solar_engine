// =============================================================================
// ARGIA ENGINE -- Phase 7 test suite: calcBessSizing()
// Paste this function into 99_TestRunner.gs, and add the call
//   try { addPhase7Tests(t, ss); } catch (e) { t.error('Phase7 aborted', e); }
// right after the addPhase6Tests block in runTests().
//
// SCOPE: calcBessSizing() — the battery sizing engine. PURE unit tests:
//   no spreadsheet I/O, no tariffs. All expected values hand-derived below.
//
// HAND-DERIVED REFERENCE (batterySpec: minSoc .10 maxSoc .90 rte .90
//                          deg .025 backup 0 cycles 1.0 window 4h):
//   usableFrac = (.90-.10) * (1-.025) * (1-0) = 0.78
//   per candidate: usableKwh = cap * 0.78 ; shaveCapableKw = usableKwh / 4
//     100 kWh -> usable  78 , shaveCapable 19.50
//     250 kWh -> usable 195 , shaveCapable 48.75
//     500 kWh -> usable 390 , shaveCapable 97.50
//    1000 kWh -> usable 780 , shaveCapable 195.0
//    2000 kWh -> usable 1560, shaveCapable 390.0
//   site maxPuntaKw = 90  -> AUTO shavedKw = min(shaveCapable, 90)
//     100->19.50  250->48.75  500->90  1000->90  2000->90
//   => smallest rung that fully shaves 90 kW is 500 kWh (the recommendation).
// =============================================================================

function addPhase7Tests(t, ss) {
  t.suite('Phase7: calcBessSizing engine');

  // -- Shared fixtures ------------------------------------------------------
  var SPEC = {
    minSocPct: 0.10, maxSocPct: 0.90, rtePct: 0.90,
    degradationPct: 0.025, backupReservePct: 0.0,
    cyclesPerDay: 1.0, puntaWindowHours: 4.0,
  };
  // 12 identical months, punta 90 kW / 5000 kWh — TESTPROJ-style flat profile.
  function flatProfile(kwPunta, kwhPunta, provenance) {
    var months = [];
    for (var i = 0; i < 12; i++) {
      months.push({ kwhPunta: kwhPunta, kwPunta: kwPunta, days: 30 });
    }
    return { months: months, provenance: provenance || 'SYNTHESIZED' };
  }

  // === TEST 1: function + constants exist ================================
  t.assert('calcBessSizing function defined',
           'function', typeof calcBessSizing);
  t.assert('BESS_SIZING_GOAL defined',
           'object', typeof BESS_SIZING_GOAL);
  t.assert('BESS_SIZING_GOAL.PEAK_SHAVING value',
           'PEAK_SHAVING', BESS_SIZING_GOAL.PEAK_SHAVING);

  // === TEST 2: empty profile throws ======================================
  var threw = false;
  try { calcBessSizing({ goal: 'PEAK_SHAVING', loadProfile: { months: [] } }); }
  catch (e) { threw = true; }
  t.assertTrue('Empty load profile -> throws', threw);

  // === TEST 3: PEAK_SHAVING AUTO -> candidate physics are correct ========
  var r = calcBessSizing({
    goal: BESS_SIZING_GOAL.PEAK_SHAVING,
    loadProfile: flatProfile(90, 5000),
    batterySpec: SPEC,
    demandChargeMxnPerKw: 400,
    capexMxnPerKwh: 8000,          // 8000 MXN/kWh installed
  });
  t.assertTrue('PEAK_SHAVING -> sizeable true', r.sizeable);
  t.assert('5 ladder candidates produced', 5, r.candidates.length);

  // candidate[0] is the 100 kWh ladder rung
  var c100 = r.candidates[0];
  t.assert('100 kWh: capacityKwh',     100,   c100.capacityKwh);
  t.assert('100 kWh: usableKwh',       78,    c100.usableKwh,       0.001);
  t.assert('100 kWh: shaveCapableKw',  19.50, c100.shaveCapableKw,  0.001);
  t.assert('100 kWh: shavedKw (AUTO)', 19.50, c100.shavedKw,        0.001);

  // candidate[2] is the 500 kWh rung — first that fully shaves 90 kW
  var c500 = r.candidates[2];
  t.assert('500 kWh: usableKwh',       390,   c500.usableKwh,       0.001);
  t.assert('500 kWh: shaveCapableKw',  97.50, c500.shaveCapableKw,  0.001);
  t.assert('500 kWh: shavedKw (AUTO, capped at 90)', 90, c500.shavedKw, 0.001);

  // === TEST 4: PEAK_SHAVING recommendation = smallest full-shave rung =====
  // 500/1000/2000 all shave 90 kW; picker tie-breaks on smallest capacity.
  t.assertTrue('PEAK_SHAVING -> recommendation exists', r.recommendation !== null);
  if (r.recommendation) {
    t.assert('PEAK_SHAVING recommends 500 kWh (smallest full shave)',
             500, r.recommendation.capacityKwh);
    t.assert('Recommended shavedKw = 90', 90, r.recommendation.shavedKw, 0.001);
  }

  // === TEST 5: demand-saving + payback math ==============================
  // 500 kWh: shavedKw 90 -> annual saving 90 * 400 * 12 = 432,000 MXN
  //          CAPEX 500 * 8000 = 4,000,000 -> payback 4,000,000/432,000 = 9.259 yr
  if (r.recommendation) {
    t.assert('500 kWh: annualDemandSavingMxn',
             432000, r.recommendation.annualDemandSavingMxn, 0.01);
    t.assert('500 kWh: installedCapexMxn',
             4000000, r.recommendation.installedCapexMxn, 0.01);
    t.assert('500 kWh: paybackYears',
             9.259259, r.recommendation.paybackYears, 0.0001);
  }

  // === TEST 6: MAX_ROI picks the lowest finite payback ===================
  // All rungs that shave >0 kW: payback = (cap*8000) / (shavedKw*400*12).
  //   100 kWh: cap 800k, save 19.5*4800=93,600 -> payback 8.547
  //   250 kWh: cap 2.0M, save 48.75*4800=234,000 -> payback 8.547
  //   500 kWh: cap 4.0M, save 432,000 -> payback 9.259
  //  1000 kWh: cap 8.0M, save 432,000 -> payback 18.52
  // => lowest payback is 8.547 (100 kWh, the first such in candidate order).
  var roi = calcBessSizing({
    goal: BESS_SIZING_GOAL.MAX_ROI,
    loadProfile: flatProfile(90, 5000),
    batterySpec: SPEC,
    demandChargeMxnPerKw: 400,
    capexMxnPerKwh: 8000,
  });
  t.assertTrue('MAX_ROI -> recommendation exists', roi.recommendation !== null);
  if (roi.recommendation) {
    t.assert('MAX_ROI: best payback ~8.547 yr',
             8.547009, roi.recommendation.paybackYears, 0.0001);
  }

  // === TEST 7: BLACKOUT_COVERAGE -> honest "not sizeable" ================
  var bo = calcBessSizing({
    goal: BESS_SIZING_GOAL.BLACKOUT_COVERAGE,
    loadProfile: flatProfile(90, 5000),
    batterySpec: SPEC,
  });
  t.assertFalse('BLACKOUT_COVERAGE -> sizeable false', bo.sizeable);
  t.assertTrue('BLACKOUT_COVERAGE -> gives a reason',
               typeof bo.reason === 'string' && bo.reason.length > 0);
  t.assert('BLACKOUT_COVERAGE -> no candidates', 0, bo.candidates.length);

  // === TEST 8: provenance + warnings =====================================
  // SYNTHESIZED profile must raise the best-case + exceedance warnings.
  t.assert('SYNTHESIZED provenance carried through',
           'SYNTHESIZED', r.provenance);
  t.assertTrue('SYNTHESIZED -> at least 2 warnings (best-case + exceedance)',
               r.warnings.length >= 2);

  var metered = calcBessSizing({
    goal: BESS_SIZING_GOAL.PEAK_SHAVING,
    loadProfile: flatProfile(90, 5000, 'METERED'),
    batterySpec: SPEC,
    demandChargeMxnPerKw: 400, capexMxnPerKwh: 8000,
  });
  t.assert('METERED provenance carried through', 'METERED', metered.provenance);

  // === TEST 9: worst-month sizing (not average) ==========================
  // Profile with one 200 kW spike month -> engine must size to 200, not avg.
  var spiky = flatProfile(90, 5000);
  spiky.months[6] = { kwhPunta: 9000, kwPunta: 200, days: 31 };  // July spike
  var rs = calcBessSizing({
    goal: BESS_SIZING_GOAL.PEAK_SHAVING,
    loadProfile: spiky, batterySpec: SPEC,
    demandChargeMxnPerKw: 400, capexMxnPerKwh: 8000,
  });
  t.assert('Spiky profile -> siteSummary.maxMonthlyPuntaKw = 200',
           200, rs.siteSummary.maxMonthlyPuntaKw);
  // 200 kW needs shaveCapable >= 200 -> usable >= 800 -> cap >= 1025.6;
  // smallest ladder rung that covers is 2000 kWh (1000 gives shaveCapable 195).
  if (rs.recommendation) {
    t.assert('Spiky profile recommends 2000 kWh (covers 200 kW spike)',
             2000, rs.recommendation.capacityKwh);
  }

  // === TEST 10: library products become extra candidates =================
  var withLib = calcBessSizing({
    goal: BESS_SIZING_GOAL.PEAK_SHAVING,
    loadProfile: flatProfile(90, 5000),
    batterySpec: SPEC,
    demandChargeMxnPerKw: 400, capexMxnPerKwh: 8000,
    libraryProducts: [
      { batteryId: 'CUSTOM_MANUAL', capacityKwh: 0, powerKw: 0 },   // skipped
      { batteryId: 'BYD_2MWH', capacityKwh: 2000, powerKw: 1000,
        installedCapexMxn: 12000000 },
    ],
  });
  // 5 ladder rungs + 1 valid library product (CUSTOM skipped) = 6
  t.assert('Library: 5 ladder + 1 valid product = 6 candidates',
           6, withLib.candidates.length);
  var libCand = withLib.candidates[withLib.candidates.length - 1];
  t.assert('Library candidate source = LIBRARY', 'LIBRARY', libCand.source);
  t.assert('Library candidate capacity = 2000', 2000, libCand.capacityKwh);
}