// =============================================================================
// ARGIA TESTS -- tests_unit/calc/BaasEconomicsTests.gs
// -----------------------------------------------------------------------------
// CHUNK 6 -- BaaS Economics Engine
//
// Locks calcBaasEconomics (30_CalcBaasEconomics.js) against the REAL
// proposal numbers (Draexlmaier financiero, 2026-03) plus the IRR solver,
// negotiable range, and tax-benefit conditionality.
//
// FIXTURE: Draexlmaier financiero (verified to the peso for Yr-1)
//   Yr-1 bill sin  = 59,424,421
//   Yr-1 bill con  = 44,110,369
//   Yr-1 lease     = 10,844,217
//   Yr-1 tax       =  1,566,923  (0.30 × 52,230,767 solar capex / 10 yrs)
//   Yr-1 net       =  6,036,758  (= 15,314,052 - 10,844,217 - 0 + 1,566,923)
//   bill escalation = 7.0%/yr, lease escalation = 4.0%/yr
//
// COVERAGE (9 tests):
//   1. UNIT_BAAS_YEAR1_MATCHES_PROPOSAL       -- Yr-1 row reproduces PDF to the peso
//   2. UNIT_BAAS_CON_IS_DERIVED               -- con = sin - ahorro (not independently escalated)
//   3. UNIT_BAAS_ESCALATIONS                  -- bill 7%, lease 4%, savings own rate
//   4. UNIT_BAAS_TAX_ONLY_FINANCIERO_AND_USABLE -- tax conditional + disclaimer flag
//   5. UNIT_BAAS_TAX_STOPS_AFTER_AMORT        -- tax benefit = 0 after amort years
//   6. UNIT_BAAS_IRR_SOLVER                   -- min lease achieves target IRR
//   7. UNIT_BAAS_NEGOTIABLE_RANGE             -- min < max, ceiling = customer breakeven
//   8. UNIT_BAAS_RANGE_INVALID_WHEN_NO_DEAL   -- min > max flagged invalid
//   9. UNIT_BAAS_PURO_NO_TAX                  -- PURO lease never has tax benefit
// =============================================================================

function _baasDraexFixture(overrides) {
  var f = {
    leaseTermYears:        15,
    leaseType:             'FINANCIERO',
    paymentEscalationPct:  0.04,
    billEscalationPct:     0.07,
    savingsEscalationPct:  0.04091,
    year1BillWithoutMxn:   59424421,
    year1BillWithMxn:      44110369,
    leasePaymentYear1Mxn:  10844217,
    omCostMxnPerYear:      0,
    taxBenefitRate:        0.30,
    taxAmortYears:         10,
    solarCapexMxn:         52230766.67,
    customerCanUseTaxBenefit: true,
    capexMxn:              0   // not needed when lease is given
  };
  if (overrides) for (var k in overrides) if (overrides.hasOwnProperty(k)) f[k] = overrides[k];
  return f;
}


registerTest({
  id      : 'UNIT_BAAS_YEAR1_MATCHES_PROPOSAL',
  group   : 'unit',
  module  : 'calc/baas',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6'],
  source  : 'tests_unit/calc/BaasEconomicsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/baas: Yr-1 reproduces the Draexlmaier proposal to the peso');

    var r = calcBaasEconomics(_baasDraexFixture());
    var y1 = r.projection[0];

    t.assertNear('Yr-1 billSin = 59,424,421',     59424421, y1.billSin, 1);
    t.assertNear('Yr-1 billCon = 44,110,369',     44110369, y1.billCon, 1);
    t.assertNear('Yr-1 ahorroRecibo = 15,314,052', 15314052, y1.ahorroRecibo, 1);
    t.assertNear('Yr-1 lease = 10,844,217',        10844217, y1.lease, 1);
    t.assertNear('Yr-1 taxBenefit = 1,566,923',     1566923, y1.taxBenefit, 1);
    t.assertNear('Yr-1 ahorroNeto = 6,036,758',     6036758, y1.ahorroNeto, 2);
    t.assertNear('Yr-1 net % = 10.2%',                 0.102, y1.ahorroNetoPct, 0.001);
  }
});


registerTest({
  id      : 'UNIT_BAAS_CON_IS_DERIVED',
  group   : 'unit',
  module  : 'calc/baas',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6'],
  source  : 'tests_unit/calc/BaasEconomicsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/baas: con bill is derived (sin - ahorro), every year');

    var r = calcBaasEconomics(_baasDraexFixture());
    for (var i = 0; i < r.projection.length; i++) {
      var p = r.projection[i];
      t.assertNear('yr' + (i+1) + ' con == sin - ahorro',
                   p.billSin - p.ahorroRecibo, p.billCon, 0.01);
    }
  }
});


registerTest({
  id      : 'UNIT_BAAS_ESCALATIONS',
  group   : 'unit',
  module  : 'calc/baas',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6'],
  source  : 'tests_unit/calc/BaasEconomicsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/baas: bill escalates 7%, lease escalates 4%, savings at own rate');

    var r = calcBaasEconomics(_baasDraexFixture());
    var p = r.projection;
    // Bill sin: 7%/yr
    t.assertNear('billSin yr2/yr1 = 1.07', 1.07, p[1].billSin / p[0].billSin, 0.0001);
    // Lease: 4%/yr
    t.assertNear('lease yr2/yr1 = 1.04', 1.04, p[1].lease / p[0].lease, 0.0001);
    // Savings: the configured savingsEsc (4.091%)
    t.assertNear('ahorro yr2/yr1 = 1.04091', 1.04091,
                 p[1].ahorroRecibo / p[0].ahorroRecibo, 0.0001);
  }
});


registerTest({
  id      : 'UNIT_BAAS_TAX_ONLY_FINANCIERO_AND_USABLE',
  group   : 'unit',
  module  : 'calc/baas',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6', 'tax'],
  source  : 'tests_unit/calc/BaasEconomicsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/baas: tax benefit only when FINANCIERO AND customer can use it');

    // Financiero + can use -> tax applies
    var rYes = calcBaasEconomics(_baasDraexFixture({ customerCanUseTaxBenefit: true }));
    t.assertTrue('taxApplies true (financiero + usable)', rYes.taxApplies === true);
    t.assertTrue('Yr-1 tax > 0', rYes.projection[0].taxBenefit > 0);

    // Financiero + CANNOT use -> no tax (customer lacks taxable profit)
    var rNo = calcBaasEconomics(_baasDraexFixture({ customerCanUseTaxBenefit: false }));
    t.assertTrue('taxApplies false (cannot utilize)', rNo.taxApplies === false);
    t.assert('Yr-1 tax = 0 when not usable', 0, rNo.projection[0].taxBenefit);

    // The net savings must drop by exactly the tax benefit when it's removed
    var dropped = rYes.projection[0].ahorroNeto - rNo.projection[0].ahorroNeto;
    t.assertNear('removing tax drops Yr-1 net by the tax amount',
                 rYes.projection[0].taxBenefit, dropped, 1);
  }
});


registerTest({
  id      : 'UNIT_BAAS_TAX_STOPS_AFTER_AMORT',
  group   : 'unit',
  module  : 'calc/baas',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6', 'tax'],
  source  : 'tests_unit/calc/BaasEconomicsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/baas: tax benefit stops after amortization years');

    var r = calcBaasEconomics(_baasDraexFixture({ taxAmortYears: 10 }));
    // Years 1-10 have tax, years 11-15 do not (matches the PDF: tax column
    // empty from year 11).
    t.assertTrue('yr10 has tax',  r.projection[9].taxBenefit > 0);
    t.assert('yr11 tax = 0', 0,   r.projection[10].taxBenefit);
    t.assert('yr15 tax = 0', 0,   r.projection[14].taxBenefit);
  }
});


registerTest({
  id      : 'UNIT_BAAS_IRR_SOLVER',
  group   : 'unit',
  module  : 'calc/baas',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6', 'irr'],
  source  : 'tests_unit/calc/BaasEconomicsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/baas: min-lease solver achieves the target IRR');

    // Give CAPEX, no explicit lease -> solver finds min lease for target IRR.
    var r = calcBaasEconomics({
      leaseTermYears: 15, leaseType: 'FINANCIERO',
      paymentEscalationPct: 0.04, billEscalationPct: 0.07,
      savingsEscalationPct: 0.04,
      year1BillWithoutMxn: 59424421, year1BillWithMxn: 44110369,
      capexMxn: 90000000,                 // 90M total install
      omCostMxnPerYear: 1000000,
      replacementReserveMxnPerYear: 500000,
      targetIrr: 0.15, discountRate: 0.12,
      customerCanUseTaxBenefit: false
      // leasePaymentYear1Mxn omitted -> solved
    });

    // Re-run with the solved lease as an explicit input and confirm ARGIA's
    // IRR comes out at the target (within tolerance).
    var solvedLease = r.leasePaymentYear1Mxn;
    t.assertTrue('solver returned a positive lease', solvedLease > 0);

    var check = calcBaasEconomics({
      leaseTermYears: 15, leaseType: 'FINANCIERO',
      paymentEscalationPct: 0.04, billEscalationPct: 0.07,
      savingsEscalationPct: 0.04,
      year1BillWithoutMxn: 59424421, year1BillWithMxn: 44110369,
      capexMxn: 90000000,
      omCostMxnPerYear: 1000000,
      replacementReserveMxnPerYear: 500000,
      targetIrr: 0.15, discountRate: 0.12,
      customerCanUseTaxBenefit: false,
      leasePaymentYear1Mxn: solvedLease
    });
    t.assertNear('ARGIA IRR at solved lease == target 15%',
                 0.15, check.argiaIrr, 0.005);
  }
});


registerTest({
  id      : 'UNIT_BAAS_NEGOTIABLE_RANGE',
  group   : 'unit',
  module  : 'calc/baas',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6'],
  source  : 'tests_unit/calc/BaasEconomicsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/baas: negotiable range = [IRR floor, customer breakeven ceiling]');

    var r = calcBaasEconomics({
      leaseTermYears: 15, leaseType: 'FINANCIERO',
      paymentEscalationPct: 0.04, billEscalationPct: 0.07,
      savingsEscalationPct: 0.04,
      year1BillWithoutMxn: 59424421, year1BillWithMxn: 44110369,  // 15.3M Yr-1 savings
      capexMxn: 90000000,
      omCostMxnPerYear: 1000000,
      replacementReserveMxnPerYear: 500000,
      targetIrr: 0.15, discountRate: 0.12,
      customerCanUseTaxBenefit: false
    });

    var rng = r.negotiableRange;
    t.assertTrue('min lease > 0', rng.minLeaseY1Mxn > 0);
    // Ceiling = customer breakeven = Yr-1 bill savings - om + tax
    //         = 15,314,052 - 1,000,000 (om) + 0 (no tax, can't use) = 14,314,052
    t.assertNear('max lease = customer breakeven (savings - om)',
                 14314052, rng.maxLeaseY1Mxn, 1);
    t.assertTrue('range valid (min <= max)', rng.valid === true);
    t.assertTrue('min < max (real negotiating room)',
                 rng.minLeaseY1Mxn < rng.maxLeaseY1Mxn);
  }
});


registerTest({
  id      : 'UNIT_BAAS_RANGE_INVALID_WHEN_NO_DEAL',
  group   : 'unit',
  module  : 'calc/baas',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6'],
  source  : 'tests_unit/calc/BaasEconomicsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/baas: range flagged invalid when IRR floor exceeds customer ceiling');

    // Huge CAPEX vs tiny savings -> ARGIA's IRR floor exceeds what the
    // customer can bear -> no viable deal.
    var r = calcBaasEconomics({
      leaseTermYears: 15, leaseType: 'FINANCIERO',
      paymentEscalationPct: 0.04, billEscalationPct: 0.07,
      savingsEscalationPct: 0.04,
      year1BillWithoutMxn: 10000000, year1BillWithMxn: 9500000,  // only 500k Yr-1 savings
      capexMxn: 200000000,                                        // 200M install
      omCostMxnPerYear: 1000000,
      replacementReserveMxnPerYear: 500000,
      targetIrr: 0.15, discountRate: 0.12,
      customerCanUseTaxBenefit: false
    });
    t.assertTrue('range invalid (min > max, no viable deal)',
                 r.negotiableRange.valid === false);
  }
});


registerTest({
  id      : 'UNIT_BAAS_PURO_NO_TAX',
  group   : 'unit',
  module  : 'calc/baas',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6', 'tax'],
  source  : 'tests_unit/calc/BaasEconomicsTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/baas: PURO lease never carries a tax benefit');

    // Even with customerCanUseTaxBenefit true + solar capex, PURO = no tax.
    var r = calcBaasEconomics(_baasDraexFixture({
      leaseType: 'PURO',
      customerCanUseTaxBenefit: true,
      inpcEscalationPct: 0.05
    }));
    t.assertTrue('taxApplies false for PURO', r.taxApplies === false);
    t.assert('Yr-1 tax = 0 for PURO', 0, r.projection[0].taxBenefit);
    // PURO escalates the lease at INPC (5%), not the fixed 4%
    t.assertNear('PURO lease escalates at INPC 5%', 1.05,
                 r.projection[1].lease / r.projection[0].lease, 0.0001);
  }
});
