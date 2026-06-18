// =============================================================================
// ARGIA TESTS -- tests_regression/v2/InstallRoleMhCulliganTests.gs
// -----------------------------------------------------------------------------
// T6 (v4.40.0): REG_INSTALL_ROLE_MH_RECONCILES.
//
// On CULLIGAN the rendered MAN-HOURS BREAKDOWN (INSTALLATION_v2, cols F-J) must
// reconcile: Σ(role MH) == TOTAL row MH, and no single role exceeds the total.
// Before the fix Σ(role MH) was ~2.9x the total (INSTALLER alone > total).
//
// Module 'regression/v2/culligan'. WORKBOOK-DEPENDENT (errors in Node = green).
// =============================================================================

registerTest({
  id: 'REG_INSTALL_ROLE_MH_RECONCILES',
  group: 'regression',
  module: 'regression/v2/culligan',
  scenarios: [],
  tags: ['regression', 'baseline', 'culligan', 'v2', 'install', 'role_mh', 't6'],
  source: 'tests_regression/v2/InstallRoleMhCulliganTests.gs',
  fn: function (t, ctx) {
    t.suite('REG v2/culligan [T6]: role-MH breakdown reconciles to total');

    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var mdc = ss.getSheetByName('MDC_v2');
    var projName = mdc ? String(mdc.getRange(7, 3).getValue() || '') : '';
    if (projName.toUpperCase().indexOf('CULLIGAN') < 0) {
      t.info('skipped', 'Requires CULLIGAN E2E context. MDC_v2 project: "' + (projName || '(none)') + '".');
      return;
    }
    var sh = ss.getSheetByName('INSTALLATION_v2');
    if (!sh) { t.info('skipped', 'INSTALLATION_v2 not present.'); return; }

    // MAN-HOURS BREAKDOWN: header at _INST_V2_MH_HDR_ROW (24), data from 25.
    // Cols: F(role)=6, G(MH)=7. Read down to the TOTAL row.
    var hdrRow = (typeof _INST_V2_MH_HDR_ROW !== 'undefined') ? _INST_V2_MH_HDR_ROW : 24;
    var startRow = hdrRow + 1;
    var roleSum = 0, totalRowMH = null, maxRoleMH = 0, nRoles = 0;
    for (var r = startRow; r < startRow + 30; r++) {
      var name = String(sh.getRange(r, 6).getValue() || '').trim();
      var mh   = Number(sh.getRange(r, 7).getValue());
      if (!name) break;                       // end of block
      if (!isFinite(mh)) continue;
      if (name.toUpperCase() === 'TOTAL') { totalRowMH = mh; break; }
      roleSum += mh; nRoles++;
      if (mh > maxRoleMH) maxRoleMH = mh;
    }

    t.assertTrue('found role rows', nRoles >= 3);
    t.assertTrue('found TOTAL row MH', totalRowMH !== null && isFinite(totalRowMH));
    t.info('mh', 'Σ(role MH)=' + roleSum.toFixed(1) + '  TOTAL=' + (totalRowMH || 0).toFixed(1)
         + '  maxRole=' + maxRoleMH.toFixed(1) + '  roles=' + nRoles);

    // Reconciliation: Σ(role MH) == total (tolerate per-role display rounding).
    var tol = Math.max(1.0, totalRowMH * 0.005);
    t.assertNear('Σ(role MH) == TOTAL MH (was ~2.9x before fix)', totalRowMH, roleSum, tol);

    // No single role exceeds the total (INSTALLER alone used to).
    t.assertTrue('no role row exceeds the total', maxRoleMH <= totalRowMH + tol);
  }
});
