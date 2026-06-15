// =============================================================================
// ARGIA -- tests_unit/calc/BessGridChargeDecisionTests.gs
// -----------------------------------------------------------------------------
// [4.17.0] Unit tests for _bessGridChargeDecision -- the PURE grid-charge gate
// extracted from the executor's doChargeGrid (20_CalcHourlySimulation.js).
//
// Before this extraction the executor gate was reachable ONLY through the full
// hourly sim, which is workbook-dependent (the INT_BDF5 tests ERROR in Node).
// So the executor's grid-charge gate -- the SECOND of the two gate sites
// option #1 must change -- had no offline coverage. Now it does.
//
// These lock the CURRENT (gated) behavior. The [OPTION_1_FLIPS] case is the
// one the un-gate will change (ZERO_EXPORT should be allowed when the economic
// edge is positive).
// =============================================================================

registerTest({
  id      : 'UNIT_BESS_GRID_CHARGE_DECISION',
  group   : 'unit',
  module  : 'calc/bess_gridcharge',
  scenarios: [],
  tags    : ['bess', 'dispatch', 'executor', 'option1'],
  source  : 'tests_unit/calc/BessGridChargeDecisionTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_gridcharge [4.17.0]: pure grid-charge gate decision');

    var profitable = { interconnMode: 'NET_BILLING', ratePunta: 1.6, rateBase: 0.86,
                       rte: 0.9, batterySoc: 100, maxSocKwh: 2000, batteryPowerKw: 972 };

    // NET_BILLING + positive edge + room -> allow, charge = min(room, power).
    var d1 = _bessGridChargeDecision(profitable);
    t.assertTrue('NET_BILLING profitable -> allow', d1.allow === true);
    t.assert('charge = min(room 1900, power 972)', 972, d1.chargeKwh);

    // [4.18.0 UN-GATED] ZERO_EXPORT, otherwise identical -> now ALLOWED.
    // Grid-charging is import (consumption), legal under any interconnection
    // mode; only the economic edge gates it now.
    var ze = {}; for (var k in profitable) ze[k] = profitable[k];
    ze.interconnMode = 'ZERO_EXPORT';
    var d2 = _bessGridChargeDecision(ze);
    t.assertTrue('[4.18.0] ZERO_EXPORT now allowed (interconn does not gate)',
                 d2.allow === true);
    t.assert('[4.18.0] ZERO_EXPORT charges same as NET_BILLING', 972, d2.chargeKwh);

    // Economic gate: ratePunta*rte <= rateBase -> blocked even under NET_BILLING
    // (this must hold AFTER option #1 too -- the economic gate is NOT removed).
    var noEdge = {}; for (var k2 in profitable) noEdge[k2] = profitable[k2];
    noEdge.ratePunta = 0.9;  // 0.9*0.9=0.81 < 0.86 rateBase
    var d3 = _bessGridChargeDecision(noEdge);
    t.assertTrue('no positive edge -> blocked (economic gate stays)', d3.allow === false);

    // Full battery -> no room -> blocked regardless of mode/economics.
    var full = {}; for (var k3 in profitable) full[k3] = profitable[k3];
    full.batterySoc = 2000;  // == maxSocKwh
    var d4 = _bessGridChargeDecision(full);
    t.assertTrue('no room -> blocked', d4.allow === false);

    // Room smaller than power -> charge limited by room.
    var tight = {}; for (var k4 in profitable) tight[k4] = profitable[k4];
    tight.batterySoc = 1800;  // room = 200
    var d5 = _bessGridChargeDecision(tight);
    t.assert('charge limited by room (200 < power 972)', 200, d5.chargeKwh);
  }
});
