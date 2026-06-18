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
