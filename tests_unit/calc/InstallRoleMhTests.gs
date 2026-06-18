// =============================================================================
// ARGIA TESTS -- tests_unit/calc/InstallRoleMhTests.gs
// -----------------------------------------------------------------------------
// T6 (v4.40.0): role man-hours reconciliation (13_CalcInstallCost.js).
//
// The MAN-HOURS BREAKDOWN must satisfy Σ(role MH) == Σ(item MH) == total. The
// bug: applyKwpBenchmarks scaled item MH but left roleAgg stale, so the
// breakdown inflated ~2.9x. _icBuildRoleAgg rebuilds from the FINAL items.
//
// PURE -- no workbook (covers the "one other fixture" reconciliation generally).
// =============================================================================

registerTest({
  id: 'UNIT_INSTALL_ROLE_MH_RECONCILES',
  group: 'unit', module: 'calc/install_role_mh',
  scenarios: [], tags: ['calc', 'install', 'role_mh', 'reconcile', 't6'],
  source: 'tests_unit/calc/InstallRoleMhTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/install: _icBuildRoleAgg reconciles to total MH');

    function mk(role, mh, cost) {
      return { item: { laborRole: role }, mhComputed: mh, laborMxn: cost,
               roleRateVal: mh > 0 ? cost / mh : 0 };
    }

    // A mixed fixture: multiple roles, a 0-cost task-MH role (QAQC), and a
    // role-less equipment line that must NOT appear in the breakdown.
    var items = [
      mk('INSTALLER', 172.8, 17280), mk('INSTALLER', 156.54, 15654), mk('INSTALLER', 164.26, 16426),
      mk('HELPER', 85.3, 6824), mk('ELECTRICIAN', 100.3, 10030),
      mk('HSE_COORDINATOR', 144.0, 21600), mk('QAQC_TECH', 2.2, 0),
      mk('COMMISSIONING_TECH', 19.6, 3533),
      { item: { laborRole: null }, mhComputed: 0, laborMxn: 0, roleRateVal: 0 }  // equipment, no role
    ];

    var totalMH = items.reduce(function (s, r) { return s + r.mhComputed; }, 0);
    var ra = _icBuildRoleAgg(items);
    var sumRoleMH = 0; for (var k in ra) sumRoleMH += ra[k].mh;

    t.assertNear('Σ(role MH) == Σ(item MH)', totalMH, sumRoleMH, 0.01);
    t.assertTrue('QAQC (MH>0, cost 0) IS counted', !!ra.QAQC_TECH && ra.QAQC_TECH.mh === 2.2);
    t.assertTrue('role-less equipment line is NOT a role row', !ra['null'] && !ra['']);
    t.assertTrue('INSTALLER (493.6) <= total (' + totalMH.toFixed(1) + ')', ra.INSTALLER.mh <= totalMH + 1e-9);

    // The bug scenario: a stale breakdown built BEFORE scaling, then items scaled.
    // Rebuilding from the scaled items must reconcile (the fix); the stale copy
    // would not.
    var stale = _icBuildRoleAgg(items);                 // pre-scale snapshot
    items.forEach(function (r) { r.mhComputed *= 0.36; r.laborMxn *= 0.36; });
    var scaledTotal = items.reduce(function (s, r) { return s + r.mhComputed; }, 0);
    var staleSum = 0; for (var s1 in stale) staleSum += stale[s1].mh;
    t.assertTrue('stale breakdown does NOT reconcile (the bug)', Math.abs(staleSum - scaledTotal) > 1);

    var rebuilt = _icBuildRoleAgg(items);               // the fix
    var rebuiltSum = 0; for (var s2 in rebuilt) rebuiltSum += rebuilt[s2].mh;
    t.assertNear('rebuilt breakdown reconciles to scaled total', scaledTotal, rebuiltSum, 0.01);
  }
});
