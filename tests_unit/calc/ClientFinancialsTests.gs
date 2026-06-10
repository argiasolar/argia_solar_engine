// =============================================================================
// ARGIA TESTS -- tests_unit/calc/ClientFinancialsTests.gs
// -----------------------------------------------------------------------------
// [Track B P0] Locks calcClientFinancials -- the pure calc core of the client
// financial story (cash ROI/payback/NPV/IRR, LCOE, CO2, 3-way scenarios).
//
// TEST 1 uses deliberately clean numbers so every expectation is HAND-
// COMPUTABLE (no escalation, no O&M, discount 0): the exactness anchor.
// TEST 2 exercises escalation + O&M + interpolated payback with a precise
// hand-computed fraction. TEST 3 covers edges (no payback in term, free
// system, junk coercion, BaaS array padding). TEST 4 pins the proposal-PDF
// convention (Draexlmaier year-1 savings).
// =============================================================================

registerTest({
  id      : 'UNIT_CALC_CLIENT_FINANCIALS_CORE',
  group   : 'unit',
  module  : 'calc/client_financials',
  scenarios: [],
  tags    : ['calc', 'financials', 'trackb', 'roi', 'lcoe', 'co2'],
  source  : 'tests_unit/calc/ClientFinancialsTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/client_financials: calcClientFinancials');

    // =====================================================================
    // TEST 1 -- clean numbers, all hand-computable
    //   capex 10M; bill 12M -> 10M (savings 2M flat); term 15; disc 0;
    //   energy 1,000,000 kWh flat; co2 0.435.
    // =====================================================================
    var r1 = calcClientFinancials({
      analysisTermYears: 15, billEscalationPct: 0, savingsEscalationPct: 0,
      discountRate: 0,
      capexMxn: 10000000, omCostMxnPerYear: 0, replacementReserveMxnPerYear: 0,
      year1BillWithoutMxn: 12000000, year1BillWithMxn: 10000000,
      demandChargeSavingMxnYear1: 500000,
      annualEnergyKwhYear1: 1000000, panelDegradationPct: 0,
      co2FactorTonPerMwh: 0.435,
    });

    t.assert('T1 headline savings = 2M',        2000000, r1.headline.year1SavingsMxn);
    t.assertNear('T1 savings % of bill = 1/6',  1/6,     r1.headline.savingsPctOfBill, 1e-9);
    t.assert('T1 demand-charge headline 500k',  500000,  r1.headline.demandChargeSavingMxnYear1);
    t.assertNear('T1 demand % of savings 25%',  0.25,    r1.headline.demandChargePctOfSavings, 1e-9);
    t.assert('T1 term total net = 30M',         30000000, r1.headline.termTotalNetMxn);
    t.assert('T1 term-end position = 20M',      20000000, r1.headline.termEndPositionMxn);

    t.assertNear('T1 simple payback = 5.0 yr',      5.0, r1.cash.simplePaybackYears, 1e-9);
    t.assertNear('T1 discounted payback = 5.0 yr',  5.0, r1.cash.discountedPaybackYears, 1e-9);
    t.assertNear('T1 ROI over term = 200%',         2.0, r1.cash.roiPctOverTerm, 1e-9);
    t.assertNear('T1 NPV at disc 0 = 20M',     20000000, r1.cash.npvMxn, 1e-3);
    // IRR of [-10M, 2M x15]: annuity factor 5 at 15y -> r ~= 18.4%
    t.assertNear('T1 IRR ~= 18.4%', 0.1842, r1.cash.irr, 0.002);

    // LCOE at disc 0: 10M / 15M kWh = 0.6667
    t.assertNear('T1 LCOE = 0.6667 MXN/kWh', 10000000 / 15000000, r1.lcoe.mxnPerKwh, 1e-9);
    t.assert('T1 lifetime energy = 15M kWh', 15000000, r1.lcoe.lifetimeEnergyKwh);

    // CO2: 1000 MWh x 0.435 = 435 t/yr; x15 = 6525 t
    t.assertNear('T1 CO2 yr-1 = 435 t',   435,   r1.co2.year1Tons, 1e-9);
    t.assertNear('T1 CO2 term = 6525 t',  6525,  r1.co2.termTons, 1e-6);
    t.assertNear('T1 cars = 435/4.6',     435 / 4.6,      r1.co2.carsEquivalent, 1e-6);
    t.assertNear('T1 trees = 435000/21.8', 435000 / 21.8, r1.co2.treesEquivalent, 1e-3);

    // Scenarios: do-nothing y15 cum = 12M x 15 = 180M; cash y15 = +20M
    t.assert('T1 scenarios has 15 rows', 15, r1.scenarios.length);
    t.assertNear('T1 do-nothing y15 = 180M', 180000000,
                 r1.scenarios[14].doNothingCumulativeSpendMxn, 1e-3);
    t.assertNear('T1 cash y15 position = +20M', 20000000,
                 r1.scenarios[14].cashCumulativePositionMxn, 1e-3);
    t.assertTrue('T1 no BaaS row when not passed',
                 !('baasCumulativeNetMxn' in r1.scenarios[0]));

    // =====================================================================
    // TEST 2 -- escalation + O&M + interpolated payback
    //   capex 5M; savings1 1M @ +10%/yr; om 100k; term 10.
    //   nets: 0.9, 1.0, 1.11, 1.231, 1.3641 ... (M)
    //   cums: -4.1, -3.1, -1.99, -0.759, +0.6051
    //   payback = 4 + 0.759/1.3641 = 4.556411...
    // =====================================================================
    var r2 = calcClientFinancials({
      analysisTermYears: 10, savingsEscalationPct: 0.10, discountRate: 0.08,
      capexMxn: 5000000, omCostMxnPerYear: 100000,
      year1BillWithoutMxn: 6000000, year1BillWithMxn: 5000000,
    });
    t.assertNear('T2 y1 net = 900k',  900000,  r2.cash.years[0].netSavingsMxn, 1e-6);
    t.assertNear('T2 y3 net = 1.11M', 1110000, r2.cash.years[2].netSavingsMxn, 1e-6);
    t.assertNear('T2 y4 cum = -759k', -759000, r2.cash.years[3].cumulativePositionMxn, 1e-6);
    t.assertNear('T2 interpolated payback = 4.5564 yr',
                 4 + 759000 / 1364100, r2.cash.simplePaybackYears, 1e-6);
    // discounted payback must be later than simple when disc > 0
    t.assertTrue('T2 discounted payback > simple payback',
                 r2.cash.discountedPaybackYears > r2.cash.simplePaybackYears);
    // NPV > 0 here, so IRR must exceed the discount rate
    t.assertTrue('T2 NPV positive', r2.cash.npvMxn > 0);
    t.assertTrue('T2 IRR > discount rate', r2.cash.irr > 0.08);

    // =====================================================================
    // TEST 3 -- edges
    // =====================================================================
    // 3a: never pays back in term
    var r3a = calcClientFinancials({
      analysisTermYears: 15, savingsEscalationPct: 0, discountRate: 0.10,
      capexMxn: 100000000,
      year1BillWithoutMxn: 2000000, year1BillWithMxn: 1000000,
    });
    t.assert('T3a simple payback null (never)',     null, r3a.cash.simplePaybackYears);
    t.assert('T3a discounted payback null (never)', null, r3a.cash.discountedPaybackYears);
    t.assertTrue('T3a NPV negative', r3a.cash.npvMxn < 0);
    t.assertNear('T3a ROI = (15M-100M)/100M = -85%', -0.85, r3a.cash.roiPctOverTerm, 1e-9);

    // 3b: free system -> instant payback, ROI guard
    var r3b = calcClientFinancials({
      analysisTermYears: 5, capexMxn: 0,
      year1BillWithoutMxn: 1000000, year1BillWithMxn: 800000,
    });
    t.assert('T3b free system: payback 0',     0, r3b.cash.simplePaybackYears);
    t.assert('T3b free system: disc payback 0', 0, r3b.cash.discountedPaybackYears);
    t.assert('T3b ROI guard at capex 0',        0, r3b.cash.roiPctOverTerm);

    // 3c: junk inputs coerce to defaults, never NaN
    var r3c = calcClientFinancials({
      analysisTermYears: 'x', capexMxn: 'junk',
      year1BillWithoutMxn: null, year1BillWithMxn: undefined,
      annualEnergyKwhYear1: 'NaN',
    });
    t.assertTrue('T3c no NaN in headline', isFinite(r3c.headline.year1SavingsMxn));
    t.assertTrue('T3c no NaN in LCOE',     isFinite(r3c.lcoe.mxnPerKwh));
    t.assert('T3c junk term -> default 15', 15, r3c.headline.termYears);

    // 3d: BaaS array shorter than term -> padded with 0 (cum flat)
    var r3d = calcClientFinancials({
      analysisTermYears: 5, capexMxn: 1000000,
      year1BillWithoutMxn: 2000000, year1BillWithMxn: 1500000,
      baasNetSavingsByYear: [100000, 100000, 100000],
    });
    t.assert('T3d BaaS cum y3 = 300k', 300000, r3d.scenarios[2].baasCumulativeNetMxn);
    t.assert('T3d BaaS cum y5 flat (padded 0)', 300000, r3d.scenarios[4].baasCumulativeNetMxn);

    // =====================================================================
    // TEST 4 -- proposal-PDF convention pin (Draexlmaier year 1)
    //   59,424,421 - 44,110,369 = 15,314,052 (matches the PDF table)
    // =====================================================================
    var r4 = calcClientFinancials({
      year1BillWithoutMxn: 59424421, year1BillWithMxn: 44110369,
    });
    t.assert('T4 Draexlmaier yr-1 savings = 15,314,052',
             15314052, r4.headline.year1SavingsMxn);
  }
});
