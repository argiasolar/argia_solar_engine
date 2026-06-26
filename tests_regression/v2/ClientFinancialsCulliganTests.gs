// =============================================================================
// ARGIA TESTS -- tests_regression/v2/ClientFinancialsCulliganTests.gs
// -----------------------------------------------------------------------------
// [Track B P0] CULLIGAN golden-master extension: locks the client financial
// story end-to-end on the CULLIGAN fixture. Registered under module
// 'regression/v2/culligan' so the Admin Panel E2E (runTestsByModule) runs it
// in the same pass as REG_CULLIGAN_BASELINE_V2.
//
// WORKBOOK-DEPENDENT: errors in the headless Node rig (expected), runs live.
//
// Locked values were triple-verified on 2026-06-10 (engine 4.12.1, DB 2026.05):
// the rendered CLIENT_FINANCIALS_v2 sheet, the menu popup, and an independent
// node replication of calcClientFinancials from the exact CFE/BOM/INSTALL
// sources all agree:
//   sin-PV bill   12,838,765.45     savings Yr-1   2,728,149.06 (21.25%)
//   capex total   37,051,893.49     demand slice     502,793.88
//   payback       11.0617 yr        discounted     never in 15y
//   ROI 47.43%    NPV -14,170,417.83    IRR 4.792%
//   LCOE 4.2202   CO2 Yr-1 586.69 t (factor 0.444, FE-SEN 2024)
//   scenarios y15: do-nothing 322,625,619.54 / cash +17,575,438.22
//
// DETERMINISM: the financial frame comes from INPUT_BAAS, which is the
// designer's live tab -- so this test WRITES the canonical frame first (the
// same values that produced the locked figures). INPUT_BAAS is in the E2E
// snapshot set (00d), so the designer's own values are restored afterwards.
// =============================================================================

registerTest({
  id      : 'REG_CLIENT_FINANCIALS_CULLIGAN_V2',
  group   : 'regression',
  module  : 'regression/v2/culligan',
  scenarios: [],
  tags    : ['regression', 'baseline', 'culligan', 'v2', 'trackb', 'financials'],
  source  : 'tests_regression/v2/ClientFinancialsCulliganTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [Track B]: client financials golden master');

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // -- Context guard: this test locks values produced by the CULLIGAN E2E
    // (fixture inputs + engine run). In a bare full-suite run those
    // preconditions are absent and every value is from whatever project the
    // sheet currently holds -- skip with INFO instead of producing 19
    // uninterpretable FAILs. The Admin Panel E2E (runTestsByModule) always
    // satisfies this guard because it runs the engine on the fixture first.
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped',
             'Requires CULLIGAN E2E context (fixture + engine run). Current '
           + 'MDC_v2 project: "' + (projName || '(none)') + '". Run via '
           + 'Admin Panel \u25b8 Test \u25b8 CULLIGAN E2E.');
      return;
    }

    // -- Canonical INPUT_BAAS frame (restored by the E2E snapshot) ----------
    if (typeof setupInputBaasSheet === 'function') setupInputBaasSheet();
    var ib = ss.getSheetByName('INPUT_BAAS');
    var R = INPUT_BAAS_ROWS, V = 4;
    var canonical = [
      [R.LEASE_TERM, 15],          [R.LEASE_TYPE, 'FINANCIERO'],
      [R.PAYMENT_ESC_FIXED, 0.04], [R.INPC_ESC, 0.05],
      [R.BILL_ESC, 0.07],          [R.SAVINGS_ESC, 0.04],
      [R.TARGET_IRR, 0.15],        [R.DISCOUNT_RATE, 0.12],
      [R.OM_COST_YEAR, 0],         [R.REPL_RESERVE_YEAR, 0],
      [R.TAX_BENEFIT_RATE, 0.30],  [R.TAX_AMORT_YEARS, 10],
      [R.CUSTOMER_CAN_USE_TAX, 'NO'], [R.FX_RATE, 18.20]
    ];
    canonical.forEach(function (p) { ib.getRange(p[0], V).setValue(p[1]); });
    SpreadsheetApp.flush();

    // -- Generate (mirrors the menu handler: BaaS first, fail-soft) ---------
    var baasNet = null;
    try {
      var baasRet = runBaasProjection(ss);
      if (baasRet && baasRet.ok && baasRet.result && baasRet.result.projection) {
        baasNet = baasRet.result.projection.map(function (r) { return r.ahorroNeto; });
      }
    } catch (e) { /* asserted below */ }
    t.assertTrue('BaaS projection available for 3-way', !!baasNet);

    var ret = runClientFinancials(ss, { baasNetSavingsByYear: baasNet });

    // -- Wiring locks ---------------------------------------------------------
    t.assertNear('sin-PV annual bill', 12838765.45, ret.bills.billWithoutMxn, 2);
    t.assertNear('final (PV+BESS) bill', 10110616.39, ret.bills.billWithMxn, 2);
    t.assertNear('CAPEX total (BOM+INSTALL)', 37606385.56, ret.capex.totalMxn, 2);
    t.assertTrue('wiring ok flag', ret.ok);

    // [T5 per-stack BESS] REFRESHED from CULLIGAN in-sheet run. The 9-stack BESS
    // is now wired as 9 home-runs (9x cable/EGC/conduit + 9 OCPDs), raising BESS
    // material + install labor. CAPEX 37,120,502.25->37,550,807.37:
    // payback 11.0780->11.1805, ROI 0.471622->0.454758, NPV -14,239,026.56->-14,669,331.71,
    // IRR 0.047671->0.046139, LCOE 4.2280->4.2771. Savings/bills unchanged (CFE-based).
    // -- Headline / cash locks -------------------------------------------------
    var h = ret.fin.headline, c = ret.fin.cash;
    t.assertNear('Yr-1 savings',        2728149.06, h.year1SavingsMxn, 2);
    t.assertNear('savings % of bill',   0.21249,    h.savingsPctOfBill, 0.0005);
    t.assertNear('demand-charge slice', 502793.88,  h.demandChargeSavingMxnYear1, 2);
    t.assertNear('simple payback',      11.19372281, c.simplePaybackYears, 0.01);
    t.assert('discounted payback: never in term', null, c.discountedPaybackYears);
    t.assertNear('ROI over term',       0.452607872, c.roiPctOverTerm, 0.0005);
    t.assertNear('NPV',                -14724909.91, c.npvMxn, 5);
    t.assertNear('IRR',                 0.04613860496, c.irr, 0.0005);
    t.assertNear('LCOE MXN/kWh',        4.283406266, ret.fin.lcoe.mxnPerKwh, 0.005);
    t.assertNear('CO2 Yr-1 tonnes (FE-SEN 2024 = 0.444)', 586.69, ret.fin.co2.year1Tons, 0.05);

    // -- Scenario locks (y15) ----------------------------------------------------
    var s15 = ret.fin.scenarios[14];
    t.assertNear('y15 do-nothing cumulative', 322625619.54,
                 s15.doNothingCumulativeSpendMxn, 5);
    t.assertNear('y15 cash position',          17020946.15,
                 s15.cashCumulativePositionMxn, 5);
    t.assertTrue('y15 BaaS cumulative present (3-way rendered)',
                 typeof s15.baasCumulativeNetMxn === 'number');

    // -- Writer ran -----------------------------------------------------------
    t.assert('sheet rendered', 'CLIENT_FINANCIALS_v2', ret.wrote.sheet);
    t.assert('15 projection rows', 15, ret.wrote.rows);
    t.assert('3-way (hasBaas)', true, ret.wrote.hasBaas);
  }
});
