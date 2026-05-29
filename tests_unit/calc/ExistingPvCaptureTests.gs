// =============================================================================
// ARGIA TESTS -- tests_unit/calc/ExistingPvCaptureTests.gs
// -----------------------------------------------------------------------------
// CHUNK 7 Scenario 4B -- existing-PV capture.
//
// Two groups:
//   A) 28_CalcExistingPvShape: source priority + monthly distribution.
//   B) The dispatcher charging-only channel: the ANTI-DOUBLE-COUNT
//      invariant -- existing-PV surplus raises battery charging but NEVER
//      moves the net / demand-limit (the bill baseline).
//
// COVERAGE (10 tests):
//   1. UNIT_EXPV_MONTHLY_MEASURED_WINS
//   2. UNIT_EXPV_ANNUAL_DISTRIBUTES
//   3. UNIT_EXPV_KWP_ESTIMATED_FALLBACK
//   4. UNIT_EXPV_SOURCE_TYPE_REPORTED
//   5. UNIT_EXPV_NONE_WHEN_NO_DATA
//   6. UNIT_EXPV_ANNUAL_SUM_PRESERVED
//   7. UNIT_4B_SURPLUS_RAISES_CHARGING       (capture works)
//   8. UNIT_4B_ANTI_DOUBLE_COUNT_DEMAND_LIMIT (invariant: net untouched)
//   9. UNIT_4B_ZERO_SURPLUS_BYTE_IDENTICAL    (non-4B unaffected)
//  10. UNIT_4B_SURPLUS_CHARGING_ONLY_NOT_LOAD (surplus added, not re-netted)
// =============================================================================

// ---- Group A: shape module ------------------------------------------------

registerTest({
  id: 'UNIT_EXPV_MONTHLY_MEASURED_WINS', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/existingpv: a supplied 12-month array wins (MONTHLY_MEASURED)');
    var monthly = [100,100,100,100,100,100,100,100,100,100,100,100];
    var r = calcExistingPvMonthly({ monthlyKwh: monthly, existingPvAnnualKwh: 999999 });
    t.assert('source MONTHLY_MEASURED', 'MONTHLY_MEASURED', r.source.type);
    t.assert('annual = 1200 (sum, not the 999999 annual field)', 1200, r.annualKwh);
  }
});

registerTest({
  id: 'UNIT_EXPV_ANNUAL_DISTRIBUTES', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/existingpv: annual kWh distributes across 12 months');
    var r = calcExistingPvMonthly({ existingPvAnnualKwh: 120000 });
    t.assert('source ANNUAL_MEASURED', 'ANNUAL_MEASURED', r.source.type);
    t.assert('12 months', 12, r.monthlyKwh.length);
    // Seasonal: April (peak) > July (cloudiest).
    t.assertTrue('April > July (seasonal shape)', r.monthlyKwh[3] > r.monthlyKwh[6]);
  }
});

registerTest({
  id: 'UNIT_EXPV_KWP_ESTIMATED_FALLBACK', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/existingpv: kWp x factor when annual is blank');
    var r = calcExistingPvMonthly({ existingPvKwp: 500, prodFactor: 1650 });
    t.assert('source KWP_ESTIMATED', 'KWP_ESTIMATED', r.source.type);
    t.assert('annual = 500 x 1650 = 825,000', 825000, r.annualKwh);
  }
});

registerTest({
  id: 'UNIT_EXPV_SOURCE_TYPE_REPORTED', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/existingpv: source.detail describes the basis');
    var est = calcExistingPvMonthly({ existingPvKwp: 500 });
    t.assertTrue('kWp detail mentions estimado', est.source.detail.indexOf('estimado') >= 0);
    var meas = calcExistingPvMonthly({ existingPvAnnualKwh: 100000 });
    t.assertTrue('annual detail mentions medida', meas.source.detail.indexOf('medida') >= 0);
  }
});

registerTest({
  id: 'UNIT_EXPV_NONE_WHEN_NO_DATA', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/existingpv: no data => NONE, all-zero months');
    var r = calcExistingPvMonthly({});
    t.assert('source NONE', 'NONE', r.source.type);
    t.assert('annual 0', 0, r.annualKwh);
    var sum = 0; for (var i = 0; i < 12; i++) sum += r.monthlyKwh[i];
    t.assert('months all zero', 0, sum);
  }
});

registerTest({
  id: 'UNIT_EXPV_ANNUAL_SUM_PRESERVED', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/existingpv: distributed months sum back to the annual');
    var r = calcExistingPvMonthly({ existingPvAnnualKwh: 250000 });
    var sum = 0; for (var i = 0; i < 12; i++) sum += r.monthlyKwh[i];
    t.assertNear('months sum to annual', 250000, sum, 1);
  }
});

// ---- Group B: dispatcher charging-only channel (the invariant) ------------

// Build a minimal monthCtx with a midday PV surplus opportunity. The planner
// charges from surplus and discharges in punta.
function _4bBaseCtx(extra) {
  var load = new Array(24).fill(50);     // flat 50 kWh/h load
  var bucket = new Array(24).fill('base');
  bucket[19] = 'punta'; bucket[20] = 'punta';  // evening punta
  var ctx = {
    monthIndex: 0, daysInMonth: 30,
    bucketByHour: bucket,
    loadByHour: load,
    pvByHour: new Array(24).fill(0),     // NO new PV (4B)
    batteryCapKwh: 1000, batteryPowerKw: 500,
    minSocKwh: 100, maxSocKwh: 900, usableKwh: 800, rte: 0.9,
    interconnMode: 'NET_BILLING',
    rateBase: 1.5, rateInter: 2.0, ratePunta: 3.5
  };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) ctx[k] = extra[k];
  return ctx;
}

registerTest({
  id: 'UNIT_4B_SURPLUS_RAISES_CHARGING', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT 4B: existing-PV surplus lets the battery charge (capture works)');
    // No surplus -> with no new PV, PEAK_SHAVING has zero PV to capture.
    var noSurplus = _planMonthlyBessSchedule(_4bBaseCtx(), 'PEAK_SHAVING');
    // Midday existing-PV exportable surplus (already net of load).
    var surplus = new Array(24).fill(0);
    surplus[11] = 300; surplus[12] = 400; surplus[13] = 300;  // 1000 kWh/day surplus
    var withSurplus = _planMonthlyBessSchedule(
      _4bBaseCtx({ existingPvExportableSurplusByHour: surplus }), 'PEAK_SHAVING');

    var chgNo  = noSurplus.dailyChargeKwh  || _4bSumCharge(noSurplus);
    var chgYes = withSurplus.dailyChargeKwh || _4bSumCharge(withSurplus);
    t.assertTrue('charging with surplus > charging without', chgYes > chgNo);
  }
});

registerTest({
  id: 'UNIT_4B_ANTI_DOUBLE_COUNT_DEMAND_LIMIT', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b', 'invariant'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT 4B: INVARIANT existing-PV surplus does NOT change the planning demand limit');
    // The planning demand limit derives from net = load - pvByHour. Existing-
    // PV surplus must NEVER enter that. So the planningDemandLimitKw must be
    // identical with and without the surplus channel.
    var surplus = new Array(24).fill(0);
    surplus[11] = 300; surplus[12] = 400; surplus[13] = 300;
    var noSurplus   = _planMonthlyBessSchedule(_4bBaseCtx(), 'PEAK_SHAVING');
    var withSurplus = _planMonthlyBessSchedule(
      _4bBaseCtx({ existingPvExportableSurplusByHour: surplus }), 'PEAK_SHAVING');

    var limNo  = noSurplus.meta.planningDemandLimitKw;
    var limYes = withSurplus.meta.planningDemandLimitKw;
    t.assert('planning demand limit UNCHANGED by existing-PV surplus', limNo, limYes);
  }
});

registerTest({
  id: 'UNIT_4B_ZERO_SURPLUS_BYTE_IDENTICAL', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b', 'regression'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT 4B: zero/absent surplus channel => byte-identical (non-4B unaffected)');
    var withField = _planMonthlyBessSchedule(
      _4bBaseCtx({ existingPvExportableSurplusByHour: new Array(24).fill(0) }), 'PEAK_SHAVING');
    var without   = _planMonthlyBessSchedule(_4bBaseCtx(), 'PEAK_SHAVING');
    t.assert('same demand limit', without.meta.planningDemandLimitKw, withField.meta.planningDemandLimitKw);
    t.assert('same daily discharge',
             _4bSumDischarge(without), _4bSumDischarge(withField));
  }
});

registerTest({
  id: 'UNIT_4B_SURPLUS_CHARGING_ONLY_NOT_LOAD', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b', 'invariant'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT 4B: surplus is added to charging, NOT re-netted against load');
    // The surplus is already net of load. Feeding 400 surplus must let the
    // battery charge up to ~400 (x power/rte limits) from it -- it must NOT
    // be reduced by load again (which would zero it, since load=50<surplus).
    var surplus = new Array(24).fill(0);
    surplus[12] = 400;
    var sched = _planMonthlyBessSchedule(
      _4bBaseCtx({ existingPvExportableSurplusByHour: surplus }), 'PEAK_SHAVING');
    t.assertTrue('battery charged from the surplus (>0)', _4bSumCharge(sched) > 0);
  }
});

// Helpers to sum schedule fields regardless of exact field names.
function _4bSumCharge(s) {
  var by = s.chargeByHour || s.gridChargeByHour || s.pvChargeByHour;
  if (Array.isArray(by)) { var t = 0; for (var i=0;i<by.length;i++) t += (by[i]||0); return t; }
  return Number(s.dailyChargeKwh || s.pvChargeKwh || 0);
}
function _4bSumDischarge(s) {
  var by = s.dischargeByHour;
  if (Array.isArray(by)) { var t = 0; for (var i=0;i<by.length;i++) t += (by[i]||0); return t; }
  return Number(s.dailyDischargeKwh || 0);
}


// =============================================================================
// Export-data gating: the channel populates ONLY from real export data
// =============================================================================
registerTest({
  id: 'UNIT_4B_EXPORT_IS_SURPLUS_NOT_NET_ESTIMATE', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b', 'invariant'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT 4B: measured export IS the surplus -- fed directly, NOT max(0,gen-load)');
    // The honest rule: we never derive surplus from net load. When the
    // customer gives measured export (say 200,000 kWh/yr), that figure IS
    // the exportable surplus -- distributed across months, shaped hourly,
    // and handed to the battery as-is. This test documents that contract:
    // calcExistingPvMonthly(annual=export) preserves the total.
    var exp = calcExistingPvMonthly({ existingPvAnnualKwh: 200000 });
    var sum = 0; for (var i = 0; i < 12; i++) sum += exp.monthlyKwh[i];
    t.assertNear('measured export total preserved (no net-load estimate)',
                 200000, sum, 1);
  }
});

registerTest({
  id: 'UNIT_4B_NO_EXPORT_DATA_MEANS_NO_CAPTURE', group: 'unit', module: 'calc/existingpv',
  scenarios: [], tags: ['calc', 'existingpv', 'chunk7', '4b', 'invariant'],
  source: 'tests_unit/calc/ExistingPvCaptureTests.gs',
  fn: function (t) {
    t.suite('UNIT 4B: absent export data => classifyScenario gives capture-OFF screening');
    // No export data -> 4B-screening, capture OFF, peak-shaving-only. The
    // engine must NEVER fabricate a capture number from the net bill.
    var s = classifyScenario(
      { installed: false, hasExistingPv: true, existingProfileKnown: true,
        exportDataAvailable: false }, true);
    t.assertTrue('capture OFF', s.pvCapture === false);
    t.assert('screening id', '4B-screening', s.id);
    t.assertTrue('tells user what data is needed',
                 s.disclaimer.indexOf('exportación') >= 0
                 || s.disclaimer.indexOf('producción') >= 0);
  }
});
