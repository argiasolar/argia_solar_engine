// =============================================================================
// ARGIA TESTS -- tests_regression/v2/ProvenanceCulliganTests.gs
// T11 (v4.47.0): after a CULLIGAN run, the CLIENT_FINANCIALS_v2 headline cells
// carry provenance notes. WORKBOOK-DEPENDENT (Node error = green).
// =============================================================================

registerTest({
  id: 'REG_PROVENANCE_CULLIGAN',
  group: 'regression', module: 'regression/v2/culligan',
  scenarios: [], tags: ['regression', 'culligan', 'v2', 'provenance', 't11'],
  source: 'tests_regression/v2/ProvenanceCulliganTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T11]: financials headline cells carry provenance notes');

    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped', 'Requires CULLIGAN E2E context. MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }
    var sh = ss.getSheetByName('CLIENT_FINANCIALS_v2');
    t.assertTrue('CLIENT_FINANCIALS_v2 present', !!sh);
    if (!sh) return;

    // kpiRow = 6; payback @ +3 (r9), VPN @ +6 (r12), LCOE @ +8 (r14); value col 4.
    var payNote  = String(sh.getRange(9, 4).getNote()  || '');
    var vpnNote  = String(sh.getRange(12, 4).getNote() || '');
    var lcoeNote = String(sh.getRange(14, 4).getNote() || '');

    t.assertContains('payback cell has provenance', payNote, 'TRAZABILIDAD: Recuperacion simple');
    t.assertContains('VPN cell has provenance label', vpnNote, 'TRAZABILIDAD: VPN');
    t.assertContains('VPN note carries derivation', vpnNote, 'Calculo:');
    t.assertContains('VPN note carries sources', vpnNote, 'Fuente:');
    t.assertContains('VPN note carries engine version', vpnNote, 'Motor v');
    t.assertContains('LCOE cell has provenance', lcoeNote, 'TRAZABILIDAD: LCOE');
  }
});

registerTest({
  id: 'REG_PROVENANCE_CFE_OUTPUT_CULLIGAN',
  group: 'regression', module: 'regression/v2/culligan',
  scenarios: [], tags: ['regression', 'culligan', 'v2', 'provenance', 'cfe', 't11'],
  source: 'tests_regression/v2/ProvenanceCulliganTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T11b]: CFE_OUTPUT headline tiles carry provenance');

    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped', 'Requires CULLIGAN E2E context. MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }
    var sh = ss.getSheetByName('CFE_OUTPUT_v2');
    t.assertTrue('CFE_OUTPUT_v2 present', !!sh);
    if (!sh) return;

    // KPI_HEADLINE = row 10; tiles at cols 2 / 7 / 12.
    var n2  = String(sh.getRange(10, 2).getNote()  || '');
    var n7  = String(sh.getRange(10, 7).getNote()  || '');
    var n12 = String(sh.getRange(10, 12).getNote() || '');

    t.assertContains('SIN PV tile provenance', n2, 'TRAZABILIDAD: Recibo anual SIN PV');
    t.assertContains('SIN PV source cited', n2, 'BESS_SIMULATION!D12');
    t.assertContains('CON PV tile provenance', n7, 'TRAZABILIDAD: Recibo anual CON PV');
    t.assertContains('CON PV source cited', n7, 'BESS_SIMULATION!D14');
    t.assertContains('CON PV+BESS tile provenance', n12, 'TRAZABILIDAD: Recibo anual CON PV + BESS');
    t.assertContains('CON PV+BESS source cited', n12, 'BESS_SIMULATION!D18');
    t.assertContains('tile note carries engine version', n2, 'Motor v');
  }
});
