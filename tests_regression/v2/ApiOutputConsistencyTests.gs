// =============================================================================
// ARGIA TESTS -- tests_regression/v2/ApiOutputConsistencyTests.gs
// -----------------------------------------------------------------------------
// T2 (v4.35.0): REG_API_OUTPUT -- prove API_OUTPUT mirrors its canonical owners
// and that the safe SLIDE_DATA repoints resolve through API_OUTPUT.
//
// Module 'regression/v2/culligan' so it runs in the CULLIGAN E2E pass.
// WORKBOOK-DEPENDENT: errors in the headless Node rig (expected/green).
//
// LOCKS (within 0.01% where numeric):
//   API_OUTPUT.cfe_bill_sin_pv_mxn   == BESS_SIMULATION!D12  (== golden 12,838,765.45)
//   API_OUTPUT.cfe_bill_con_pv_mxn   == BESS_SIMULATION!D14
//   API_OUTPUT.cfe_bill_con_bess_mxn == BESS_SIMULATION!D18
//   API_OUTPUT.pv_only_savings_year1 == D12 - D14
//   API_OUTPUT.capex_cost_mxn        == runClientFinancials.capex.totalMxn
//   API_OUTPUT.offer_price_mxn       == PROJECT_CARD_v2 sell TOTAL  (and != cost)
//   API_OUTPUT.full_system_savings   == fin.headline.year1SavingsMxn
//   API_OUTPUT.npv/irr/lcoe/co2      == fin.*
//   API_OUTPUT.system_kwp_dc         == MDC_v2!C15 ; module_qty == MDC_v2!C11
//   SLIDE_DATA.annual_energy_cost (resolved) == cfe_bill_sin_pv_mxn
//   SLIDE_DATA.system_kwp (resolved)         == system_kwp_dc  (no longer #REF!)
// =============================================================================

registerTest({
  id      : 'REG_API_OUTPUT',
  group   : 'regression',
  module  : 'regression/v2/culligan',
  scenarios: [],
  tags    : ['regression', 'baseline', 'culligan', 'v2', 'api_output', 't2'],
  source  : 'tests_regression/v2/ApiOutputConsistencyTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T2]: API_OUTPUT mirrors canonical owners');

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Context guard (same as the other v2 goldens).
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped',
             'Requires CULLIGAN E2E context (fixture + engine run). Current '
           + 'MDC_v2 project: "' + (projName || '(none)') + '". Run via '
           + 'Admin Panel \u25b8 Test \u25b8 CULLIGAN E2E.');
      return;
    }

    // Run client financials -- this writes API_OUTPUT + the safe SLIDE repoints.
    var ret = runClientFinancials(ss);
    t.assertTrue('runClientFinancials ok', !!(ret && ret.fin));

    // Read API_OUTPUT into a key -> value map.
    var sh = ss.getSheetByName('API_OUTPUT');
    t.assertTrue('API_OUTPUT sheet present', !!sh);
    if (!sh) return;
    var data = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
    var api = {};
    for (var i = 1; i < data.length; i++) { api[String(data[i][0])] = data[i][1]; }

    function n(x) { var v = Number(x); return isFinite(v) ? v : NaN; }
    var GOLDEN = 12838765.45;
    var TOL = Math.max(2, GOLDEN * 0.0001);   // 0.01%

    // ---- CFE three-way == BESS_SIMULATION owners (T1) -----------------------
    var bs = ss.getSheetByName('BESS_SIMULATION');
    var d12 = n(bs.getRange('D12').getValue());
    var d14 = n(bs.getRange('D14').getValue());
    var d18 = n(bs.getRange('D18').getValue());
    t.assertNear('cfe_bill_sin_pv_mxn == D12',   d12, n(api['cfe_bill_sin_pv_mxn']),   TOL);
    t.assertNear('cfe_bill_sin_pv_mxn == golden', GOLDEN, n(api['cfe_bill_sin_pv_mxn']), TOL);
    t.assertNear('cfe_bill_con_pv_mxn == D14',   d14, n(api['cfe_bill_con_pv_mxn']),   TOL);
    t.assertNear('cfe_bill_con_bess_mxn == D18', d18, n(api['cfe_bill_con_bess_mxn']), TOL);
    t.assertNear('pv_only_savings == D12 - D14', d12 - d14, n(api['pv_only_savings_year1_mxn']), TOL);

    // ---- CAPEX: cost owner, sell owner, and they differ (anti-fork) ---------
    t.assertNear('capex_cost_mxn == capex.totalMxn',
                 n(ret.capex.totalMxn), n(api['capex_cost_mxn']), TOL);
    var pcRow = (typeof PC_ROW !== 'undefined' && PC_ROW.COST_TOTAL) ? PC_ROW.COST_TOTAL : 40;
    var pcCol = (typeof PC_COL !== 'undefined' && PC_COL.MXN_SALES)  ? PC_COL.MXN_SALES  : 9;
    var pc = ss.getSheetByName('PROJECT_CARD_v2');
    var sell = pc ? n(pc.getRange(pcRow, pcCol).getValue()) : NaN;
    t.assertNear('offer_price_mxn == PROJECT_CARD sell TOTAL', sell, n(api['offer_price_mxn']),
                 Math.max(2, sell * 0.0001));
    t.assertTrue('cost basis != sell basis (margin present)',
                 Math.abs(n(api['capex_cost_mxn']) - n(api['offer_price_mxn'])) > 1);

    // ---- Financials == CLIENT_FIN return ------------------------------------
    t.assertNear('full_system_savings == fin.year1Savings',
                 n(ret.fin.headline.year1SavingsMxn), n(api['full_system_savings_year1_mxn']), TOL);
    t.assertNear('npv_mxn == fin.cash.npvMxn',
                 n(ret.fin.cash.npvMxn), n(api['npv_mxn']), Math.max(5, Math.abs(n(ret.fin.cash.npvMxn)) * 0.0001));
    if (ret.fin.cash.irr != null) {
      t.assertNear('irr == fin.cash.irr', n(ret.fin.cash.irr), n(api['irr']), 0.0005);
    }
    t.assertNear('lcoe == fin.lcoe.mxnPerKwh', n(ret.fin.lcoe.mxnPerKwh), n(api['lcoe_mxn_per_kwh']), 0.01);
    t.assertNear('co2_tons_year1 == fin.co2.year1Tons', n(ret.fin.co2.year1Tons), n(api['co2_tons_year1']), 0.5);

    // ---- Size == MDC_v2 owners ----------------------------------------------
    t.assertNear('system_kwp_dc == MDC_v2!C15', n(mdc.getRange('C15').getValue()), n(api['system_kwp_dc']), 0.5);
    t.assertNear('module_qty == MDC_v2!C11',    n(mdc.getRange('C11').getValue()), n(api['module_qty']), 0.5);

    // ---- Generation present (solar MWh, not consumption) --------------------
    t.assertTrue('annual_generation_mwh > 0', n(api['annual_generation_mwh']) > 0);

    // ---- SLIDE_DATA safe repoints resolve through API_OUTPUT ----------------
    var sd = ss.getSheetByName('SLIDE_DATA');
    if (sd) {
      var lastRow = sd.getLastRow();
      var labels = sd.getRange(1, 1, lastRow, 1).getValues();
      function slideVal(key) {
        for (var r = 0; r < labels.length; r++) {
          if (String(labels[r][0]).trim() === key) return n(sd.getRange(r + 1, 2).getValue());
        }
        return NaN;
      }
      t.assertNear('SLIDE annual_energy_cost resolves == sin-PV base',
                   n(api['cfe_bill_sin_pv_mxn']), slideVal('annual_energy_cost'), TOL);
      var sKwp = slideVal('system_kwp');
      t.assertTrue('SLIDE system_kwp no longer #REF! (numeric)', isFinite(sKwp));
      t.assertNear('SLIDE system_kwp resolves == system_kwp_dc',
                   n(api['system_kwp_dc']), sKwp, 0.5);
    } else {
      t.info('slide_data', 'SLIDE_DATA absent; repoint check skipped.');
    }

    t.info('summary', 'API_OUTPUT rows=' + (data.length - 1)
         + '  sinPV=' + n(api['cfe_bill_sin_pv_mxn']).toFixed(2)
         + '  cost=' + n(api['capex_cost_mxn']).toFixed(0)
         + '  sell=' + n(api['offer_price_mxn']).toFixed(0)
         + '  genMWh=' + n(api['annual_generation_mwh']).toFixed(1));
  }
});
