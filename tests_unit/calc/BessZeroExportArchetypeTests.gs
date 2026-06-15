// =============================================================================
// ARGIA -- tests_unit/calc/BessZeroExportArchetypeTests.gs
// -----------------------------------------------------------------------------
// [4.17.0] Synthetic ZERO_EXPORT dispatch fixtures -- the test foundation for
// "option #1" (un-gating battery grid-charging from NET_BILLING).
//
// WHY THESE EXIST: every pre-existing planner test used NET_BILLING or
// NET_METERING. There was ZERO synthetic coverage of ZERO_EXPORT -- the exact
// interconnection mode that option #1 targets and that CULLIGAN (a real
// solar-RICH workbook) cannot exercise (its PV already fills the battery, so
// grid-charge is ~0 regardless of the gate). Without these, the un-gate is
// untestable except on a live workbook.
//
// THE FOUR ARCHETYPES (from docs/CHUNK_5_MECHANISM_PAPER.md Part IV):
//   A  ZERO_EXPORT, solar-poor, LOW base load   -> the LS "sweet spot"
//   B  ZERO_EXPORT, solar-rich (CULLIGAN-like)   -> PV fills battery anyway
//   C  ZERO_EXPORT, solar-poor, HIGH base load   -> P1 ceiling bites
//   D  NET_BILLING, solar-poor, LOW base (CONTROL)-> gate already fires today
//
// A and D are IDENTICAL except interconnMode. Today A is blocked (gridCharge=0,
// discharge=0 -> $0 savings -- the CULLIGAN pathology) while D works
// (gridCharge=360, discharge=324). That side-by-side is the proof that the
// NET_BILLING clause is the ONLY thing standing between ZERO_EXPORT and the
// value NET_BILLING already captures.
//
// >>> THESE FIXTURES LOCK THE *CURRENT* (GATED) BEHAVIOR. <<<
// Assertions that option #1 will intentionally flip are tagged
// [OPTION_1_FLIPS]. When the un-gate lands, exactly those assertions change --
// the test diff IS the behavior change, fully visible and reviewable. Nothing
// else should move.
// =============================================================================

// --- local synthetic builders (mirror PlanMonthlyBessScheduleTests helpers) --
function _zeBuckets() {
  var b = new Array(24);
  for (var h = 0; h < 24; h++) {
    if (h <= 5) b[h] = 'base';
    else if (h >= 18 && h <= 21) b[h] = 'punta';
    else b[h] = 'intermedia';
  }
  return b;
}
function _zeFlat(kw) { var a = new Array(24); for (var h = 0; h < 24; h++) a[h] = kw; return a; }
function _zePv(totalKwhDay) {
  var a = new Array(24).fill(0);
  if (totalKwhDay <= 0) return a;
  var per = totalKwhDay / 14;
  for (var h = 6; h <= 19; h++) a[h] = per;
  return a;
}
function _zeMkCtx(overrides) {
  var base = {
    monthIndex: 5, daysInMonth: 30, bucketByHour: _zeBuckets(),
    loadByHour: _zeFlat(100), pvByHour: _zePv(1400),
    batteryCapKwh: 400, batteryPowerKw: 100,
    minSocKwh: 20, maxSocKwh: 380, usableKwh: 360, rte: 0.9,
    interconnMode: 'NET_BILLING',
    rateBase: 1.0, rateInter: 1.5, ratePunta: 3.0,
    planningDemandLimitKw: 100
  };
  if (overrides) for (var k in overrides) if (overrides.hasOwnProperty(k)) base[k] = overrides[k];
  return base;
}
function _zeSum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }


registerTest({
  id      : 'UNIT_BESS_ZE_ARCHETYPE_A_SOLAR_POOR_LOW_BASE',
  group   : 'unit',
  module  : 'calc/bess_plan_ze',
  scenarios: [],
  tags    : ['bess', 'dispatch', 'zero_export', 'option1'],
  source  : 'tests_unit/calc/BessZeroExportArchetypeTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_plan_ze [4.17.0] A: ZERO_EXPORT solar-poor low-base');

    var c = _zeMkCtx({ interconnMode: 'ZERO_EXPORT',
                       loadByHour: _zeFlat(40), pvByHour: _zePv(14 * 10) });
    var ls = _planMonthlyBessSchedule(c, 'LOAD_SHIFTING');

    // [4.18.0 UN-GATED] The ZERO_EXPORT clause is removed, so this archetype
    // now grid-charges a realistic single daily cycle and discharges in punta
    // -- IDENTICAL to archetype D (NET_BILLING control), which differs only by
    // interconnMode. This is the heart of option #1: ZERO_EXPORT sites finally
    // capture the same arbitrage value NET_BILLING sites always could. The
    // CULLIGAN $0 pathology is resolved.
    t.assert('[4.18.0] LS grid charge (un-gated, full cycle)',
             360, Math.round(_zeSum(ls.gridChargeByHour)));
    t.assert('[4.18.0] LS discharge (un-gated, punta)',
             324, Math.round(_zeSum(ls.dischargeByHour)));

    // A now MATCHES the NET_BILLING control D (identical except interconnMode).
    var d = _zeMkCtx({ interconnMode: 'NET_BILLING',
                       loadByHour: _zeFlat(40), pvByHour: _zePv(14 * 10) });
    var lsD = _planMonthlyBessSchedule(d, 'LOAD_SHIFTING');
    t.assert('A grid charge == D grid charge (interconn no longer matters)',
             Math.round(_zeSum(lsD.gridChargeByHour)),
             Math.round(_zeSum(ls.gridChargeByHour)));
    t.assert('A discharge == D discharge',
             Math.round(_zeSum(lsD.dischargeByHour)),
             Math.round(_zeSum(ls.dischargeByHour)));

    // LS now genuinely differs from PS (the whole point -- PS can't grid-charge).
    var ps = _planMonthlyBessSchedule(c, 'PEAK_SHAVING');
    t.assertTrue('[4.18.0] LS now out-discharges PS (grid-funded cycle)',
                 _zeSum(ls.dischargeByHour) > _zeSum(ps.dischargeByHour));
  }
});


registerTest({
  id      : 'UNIT_BESS_ZE_ARCHETYPE_B_SOLAR_RICH',
  group   : 'unit',
  module  : 'calc/bess_plan_ze',
  scenarios: [],
  tags    : ['bess', 'dispatch', 'zero_export', 'option1'],
  source  : 'tests_unit/calc/BessZeroExportArchetypeTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_plan_ze [4.17.0] B: ZERO_EXPORT solar-rich (CULLIGAN-like)');

    var c = _zeMkCtx({ interconnMode: 'ZERO_EXPORT',
                       loadByHour: _zeFlat(60), pvByHour: _zePv(14 * 200) });
    var ls = _planMonthlyBessSchedule(c, 'LOAD_SHIFTING');

    // Solar-rich: PV surplus alone fills the battery, so the battery cycles
    // (discharge ~ full usable) WITHOUT needing grid charge. This is why
    // CULLIGAN "works" on discharge but shows 0 grid charge -- and it should
    // be ~UNCHANGED by option #1 (no grid charge needed when PV suffices).
    t.assertTrue('solar-rich LS discharges (PV-funded)',
                 _zeSum(ls.dischargeByHour) > 0);
    t.assert('solar-rich LS grid charge ~ 0 (PV suffices; stable across option #1)',
             0, Math.round(_zeSum(ls.gridChargeByHour)));

    // PV charge present.
    t.assertTrue('solar-rich LS captures PV', _zeSum(ls.chargeByHour) > 0);
  }
});


registerTest({
  id      : 'UNIT_BESS_ZE_ARCHETYPE_C_SOLAR_POOR_HIGH_BASE',
  group   : 'unit',
  module  : 'calc/bess_plan_ze',
  scenarios: [],
  tags    : ['bess', 'dispatch', 'zero_export', 'option1'],
  source  : 'tests_unit/calc/BessZeroExportArchetypeTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_plan_ze [4.17.0] C: ZERO_EXPORT solar-poor high-base (ceiling bites)');

    // Base load 95 kW vs planning limit 100 kW -> only 5 kW/base-hour headroom.
    // Even AFTER option #1, the P1 demand ceiling must constrain grid charge so
    // the battery cannot manufacture a new peak. This archetype proves the
    // safety mechanism survives the un-gate.
    var c = _zeMkCtx({ interconnMode: 'ZERO_EXPORT',
                       loadByHour: _zeFlat(95), pvByHour: _zePv(14 * 10),
                       planningDemandLimitKw: 100 });
    var ls = _planMonthlyBessSchedule(c, 'LOAD_SHIFTING');

    // Today: gate blocked -> 0. After option #1: grid charge allowed BUT capped
    // hard by the tiny 5 kW/hr headroom (6 base hrs * 5 = 30 kWh max), so it
    // stays small -- NOT a full cycle. The key invariant either way: grid
    // charge never exceeds total base headroom.
    var baseHeadroom = 0;
    for (var h = 0; h < 24; h++) {
      if (c.bucketByHour[h] !== 'base') continue;
      var net = c.loadByHour[h] - c.pvByHour[h];
      var head = c.planningDemandLimitKw - net;
      if (head > 0) baseHeadroom += Math.min(head, c.batteryPowerKw);
    }
    t.assertTrue('grid charge never exceeds base headroom (P1 ceiling holds)',
                 _zeSum(ls.gridChargeByHour) <= baseHeadroom + 0.01);

    // [4.18.0 UN-GATED] Now grid-charging is ALLOWED, but the P1 demand ceiling
    // caps it hard: only ~5 kW/hr headroom over 6 base hours = ~30 kWh max.
    // This proves the safety mechanism survives the un-gate -- the battery
    // grid-charges a SMALL amount (NOT a full cycle), so it can never
    // manufacture a new billed peak. This is the honest "real-life" behavior.
    t.assert('[4.18.0] high-base LS grid charge (capped by demand headroom)',
             30, Math.round(_zeSum(ls.gridChargeByHour)));
    t.assertTrue('grid charge well below a full cycle (headroom-limited)',
                 _zeSum(ls.gridChargeByHour) < c.usableKwh * 0.3);
  }
});


registerTest({
  id      : 'UNIT_BESS_ZE_ARCHETYPE_D_NET_BILLING_CONTROL',
  group   : 'unit',
  module  : 'calc/bess_plan_ze',
  scenarios: [],
  tags    : ['bess', 'dispatch', 'control'],
  source  : 'tests_unit/calc/BessZeroExportArchetypeTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/bess_plan_ze [4.17.0] D: NET_BILLING solar-poor low-base (CONTROL)');

    // IDENTICAL to archetype A except interconnMode = NET_BILLING. The gate
    // fires today, so this is the reference for what A *should* become after
    // option #1. This control must stay GREEN through the un-gate (it already
    // works; the un-gate must not regress NET_BILLING behavior).
    var c = _zeMkCtx({ interconnMode: 'NET_BILLING',
                       loadByHour: _zeFlat(40), pvByHour: _zePv(14 * 10) });
    var ls = _planMonthlyBessSchedule(c, 'LOAD_SHIFTING');

    t.assertTrue('CONTROL NET_BILLING LS grid-charges (gate fires)',
                 _zeSum(ls.gridChargeByHour) > 0);
    t.assertTrue('CONTROL NET_BILLING LS discharges in punta',
                 _zeSum(ls.dischargeByHour) > 0);

    // Lock the exact numbers so option #1 verification can assert archetype A
    // converges to THESE values (A and D differ only by interconnMode).
    t.assert('CONTROL grid charge kWh', 360, Math.round(_zeSum(ls.gridChargeByHour)));
    t.assert('CONTROL discharge kWh',   324, Math.round(_zeSum(ls.dischargeByHour)));
  }
});
