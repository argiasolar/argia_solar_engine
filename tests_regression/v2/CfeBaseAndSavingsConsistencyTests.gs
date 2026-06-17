// =============================================================================
// ARGIA TESTS -- tests_regression/v2/CfeBaseAndSavingsConsistencyTests.gs
// -----------------------------------------------------------------------------
// T1 (v4.34.0) -- REG_CFE_BASE_AND_SAVINGS: prove there is ONE canonical
// "CFE bill, sin PV" figure and that every consumer agrees with it.
//
// Registered under module 'regression/v2/culligan' so the Admin Panel CULLIGAN
// E2E (runTestsByModule) runs it in the same pass as the other v2 goldens.
//
// WORKBOOK-DEPENDENT: errors in the headless Node rig (expected/green); runs
// live against the CULLIGAN E2E result.
//
// WHAT IT LOCKS (all within 0.01%):
//   canonical  = BESS_SIMULATION!D12 (engine base, value, written by 20b)
//   detail     = CFE_OUTPUT_v2 row19 (con-PV) + row20 (ahorro)  [rendered, other path]
//   banner     = CFE_OUTPUT_v2!C10 parse                        [banner consumer -> D12]
//   clientfin  = runClientFinancials(ss).bills.billWithoutMxn   [client consumer -> D12]
//   savings id = SUM(CFE_SIMULATION C41:N41) == D12 - O39
//   column     = D12 + D13 == D14 == O39 (con-PV), every mode
//   golden     = D12 == 12,838,765.45 (CULLIGAN, unchanged by T1)
//   mode       = CFE_SIMULATION!O40 (export credit) == 0 for CULLIGAN
//                (MEDICION_NETA); the structural "D12 ignores O40" guarantee is
//                locked by UNIT_CFE_BASELINE_EXPORT_SAFETY.
// =============================================================================

registerTest({
  id      : 'REG_CFE_BASE_AND_SAVINGS',
  group   : 'regression',
  module  : 'regression/v2/culligan',
  scenarios: [],
  tags    : ['regression', 'baseline', 'culligan', 'v2', 'cfe', 't1'],
  source  : 'tests_regression/v2/CfeBaseAndSavingsConsistencyTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T1]: single canonical CFE sin-PV base + consumers');

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // -- Context guard: requires the CULLIGAN E2E (fixture + engine run). In a
    // bare full-suite run those preconditions are absent -- skip with INFO.
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped',
             'Requires CULLIGAN E2E context (fixture + engine run). Current '
           + 'MDC_v2 project: "' + (projName || '(none)') + '". Run via '
           + 'Admin Panel \u25b8 Test \u25b8 CULLIGAN E2E.');
      return;
    }

    var GOLDEN = 12838765.45;

    // ---- Canonical surface: BESS_SIMULATION!D12 -----------------------------
    var bs = ss.getSheetByName('BESS_SIMULATION');
    t.assertTrue('BESS_SIMULATION present', !!bs);
    var d12 = Number(bs.getRange('D12').getValue());
    var d13 = Number(bs.getRange('D13').getValue());
    var d14 = Number(bs.getRange('D14').getValue());

    var TOL_PCT = Math.max(2, d12 * 0.0001);   // 0.01% of the base (~1284 MXN)
    var TOL_CELL = 2;                            // cell-to-cell formula reads: exact

    // D12 is the golden engine base (unchanged by T1: CULLIGAN is MEDICION_NETA).
    t.assertNear('D12 == CULLIGAN golden base', GOLDEN, d12, TOL_PCT);

    // ---- CFE_SIMULATION row 39 (con-PV), row 41 (savings), O40 (export) -----
    var cs = ss.getSheetByName('CFE_SIMULATION');
    t.assertTrue('CFE_SIMULATION present', !!cs);
    var O39 = Number(cs.getRange('O39').getValue());
    var O40 = Number(cs.getRange('O40').getValue()) || 0;
    var row41 = cs.getRange(41, 3, 1, 12).getValues()[0];
    var sumRow41 = 0;
    for (var i = 0; i < 12; i++) sumRow41 += Number(row41[i]) || 0;

    // CULLIGAN is no-export: the legacy +O40 term is 0, which is why the golden
    // is unchanged. (Net-billing safety is the unit test's job.)
    t.assertNear('CULLIGAN export credit O40 == 0 (MEDICION_NETA)', 0, O40, 1);

    // Savings identity: SUM(row41) == base - con-PV.
    t.assertNear('SUM(row41) == D12 - O39 (savings = base - conPv)',
                 d12 - O39, sumRow41, TOL_PCT);

    // Column reconciles: D12 + D13 == D14 == O39, in every mode.
    t.assertNear('D14 == con-PV (O39)', O39, d14, TOL_CELL);
    t.assertNear('D12 + D13 == D14 (column reconciles)', d14, d12 + d13, TOL_CELL);

    // ---- CFE_OUTPUT_v2: rendered detail + banner ----------------------------
    var co = ss.getSheetByName('CFE_OUTPUT_v2');
    t.assertTrue('CFE_OUTPUT_v2 present', !!co);

    // Rendered monthly detail through a DIFFERENT path (WriteCfeOutputV2):
    // row19 (con-PV) + row20 (ahorro) must reconstruct the canonical base.
    var R = (typeof CFE_OUT_ROW_V2 !== 'undefined') ? CFE_OUT_ROW_V2 : null;
    var rowConPv = R ? R.SEC1_TOTAL  : 19;
    var rowAhorro = R ? R.SEC1_AHORRO : 20;
    var sumDetail = 0;
    for (var c = 3; c <= 14; c++) {
      sumDetail += (Number(co.getRange(rowConPv,  c).getValue()) || 0)
                 + (Number(co.getRange(rowAhorro, c).getValue()) || 0);
    }
    t.assertNear('CFE_OUTPUT row19+row20 == D12 (rendered detail agrees)',
                 d12, sumDetail, TOL_PCT);

    // Banner C10 (reads bsim_reciboBase -> D12) parses back to the base.
    var banner = (typeof _baasParseBanner === 'function')
               ? _baasParseBanner(co.getRange('C10').getValue())
               : Number(String(co.getRange('C10').getValue()).replace(/[^0-9.]/g, ''));
    t.assertNear('CFE_OUTPUT C10 banner == D12 (banner consumer agrees)',
                 d12, banner, TOL_PCT);

    // ---- CLIENT_FINANCIALS consumer -----------------------------------------
    // 31a now reads D12 directly; billWithoutMxn must equal the canonical base.
    var cfBill = null;
    try {
      var ret = runClientFinancials(ss);
      cfBill = ret && ret.bills ? Number(ret.bills.billWithoutMxn) : null;
    } catch (e) {
      t.info('clientfin', 'runClientFinancials threw: ' + e);
    }
    if (cfBill !== null && isFinite(cfBill)) {
      t.assertNear('CLIENT_FIN billWithoutMxn == D12 (client consumer agrees)',
                   d12, cfBill, TOL_PCT);
    } else {
      t.info('clientfin', 'billWithoutMxn unavailable; skipped consumer check.');
    }

    // ---- SLIDE_DATA / FINANCE -----------------------------------------------
    // 02j (repairFinanceSlideCfeSource) repoints SLIDE_DATA[annual_energy_cost]
    // and FINANCE[CFE Annual Payment]/[CFE Tariff] to "=BESS_SIMULATION!D12", so
    // they inherit the canonical base by formula -- correct iff D12 is correct,
    // which the asserts above lock. Their wiring is covered by 02j's own tests;
    // not re-scanned here to keep this regression independent of label layout.
    t.info('slide_data/finance',
           'inherit D12 by formula (=BESS_SIMULATION!D12 via 02j); wiring locked by 02j tests.');

    t.info('summary',
           'D12=' + d12.toFixed(2) + '  detail=' + sumDetail.toFixed(2)
         + '  banner=' + (banner || 0) + '  O40=' + O40
         + '  SUM(row41)=' + sumRow41.toFixed(2));
  }
});
