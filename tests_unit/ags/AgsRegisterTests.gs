// =============================================================================
// ARGIA TESTS -- tests_unit/ags/AgsRegisterTests.gs
// -----------------------------------------------------------------------------
// AGS conformance track -- Task A1. Locks the AGS Parameter Register
// (00b_AgsRegister.js) and the pure conformance/drift report.
//
// These are PURE unit tests (no workbook) -- they must PASS in the Node rig and
// in Apps Script identically. They are the change-control gate on AGS-B: if a
// canonical value here ever moves, a test moves with it (AGS-B §B.10).
//
// COVERAGE (6 tests):
//   1. UNIT_AGS_REGISTER_INTEGRITY          -- self-check clean; every entry N/S/P + source; ids unique
//   2. UNIT_AGS_REGISTER_CANONICAL_VALUES   -- spot-check the AGS-B figures the engine depends on
//   3. UNIT_AGS_GET_THROWS_ON_UNKNOWN       -- traceability guard (AGS-802 R1: no oracle => not validated)
//   4. UNIT_AGS_CONFORMANCE_DETECTS_DELTAS  -- current engine values raise the known Category-A drift
//   5. UNIT_AGS_CONFORMANCE_CLEAN_WHEN_ALIGNED -- AGS-aligned values => zero deltas, status PASS
//   6. UNIT_AGS_CONFORMANCE_FLAGS_NOT_MODELED  -- absent subsystems surface as INFO, never silent
// =============================================================================

// Current ENGINE operative values, as found in the v4.59.0 codebase + live
// NOM_DB (61_NOM_LIMITS). Centralised here so the drift the report should see
// is explicit and reviewable. A2 will feed these from the live `nom` object.
function _agsEngineCurrentObserved() {
  return {
    dcAcReviewAbove:     1.5,    // NOM_DB project_dc_ac_ratio warn
    dcAcFailAbove:       1.8,    // NOM_DB project_dc_ac_ratio hard
    panelDegradationPct: 0.005,  // 31a_RunClientFinancials CLIENT_FIN_DEFAULTS
    dcCurrentFactor:     1.25,   // NOM_DB dc_current_factor (already AGS-aligned)
    bessRtePct:          0.90,   // 17_CalcBessSizing default (already AGS-aligned)
    bessSohEolModeled:   false,  // sizing does not derate to SOH_EOL yet
    bankabilityModeled:  false   // no P50/P90/sigma model yet
  };
}

// AGS-aligned target values (post-A2). Used to prove the report goes clean.
function _agsAlignedObserved() {
  return {
    dcAcReviewAbove:     1.35,
    dcAcFailAbove:       1.40,
    panelDegradationPct: 0.004,
    dcCurrentFactor:     1.25,
    bessRtePct:          0.90
  };
}


registerTest({
  id      : 'UNIT_AGS_REGISTER_INTEGRITY',
  group   : 'unit',
  module  : 'ags/register',
  scenarios: [],
  tags    : ['ags', 'register', 'a1'],
  source  : 'tests_unit/ags/AgsRegisterTests.gs',
  fn      : function (t) {
    t.suite('UNIT ags/register: register self-integrity (change-control gate)');

    var sc = agsRegisterSelfCheck();
    t.assertTrue('self-check ok (no problems)', sc.ok);
    t.assert('self-check problems = 0', 0, sc.problems.length);

    var all = agsAll();
    t.assertTrue('register is non-empty', all.length > 0);

    // Every entry: id matches key context, class in {N,S,P}, source present.
    var classOk = true, sourceOk = true, idOk = true;
    var seen = {};
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (['N', 'S', 'P'].indexOf(e.cls) < 0) classOk = false;
      if (!e.source) sourceOk = false;
      if (!e.id) idOk = false;
      if (seen[e.id]) idOk = false;
      seen[e.id] = true;
    }
    t.assertTrue('every entry class in {N,S,P}', classOk);
    t.assertTrue('every entry has a source', sourceOk);
    t.assertTrue('every entry id present and unique', idOk);
  }
});


registerTest({
  id      : 'UNIT_AGS_REGISTER_CANONICAL_VALUES',
  group   : 'unit',
  module  : 'ags/register',
  scenarios: [],
  tags    : ['ags', 'register', 'a1'],
  source  : 'tests_unit/ags/AgsRegisterTests.gs',
  fn      : function (t) {
    t.suite('UNIT ags/register: canonical AGS-B values the engine depends on');

    // Performance & bankability (AGS-B §B.9)
    t.assert('PB-01 degradation cap = 0.4%/yr',  0.004, agsValue('PB-01'));
    t.assert('PB-02 PR_STC benchmark = 0.87',    0.87,  agsValue('PB-02'));
    t.assert('PB-03 availability = 0.99',         0.99,  agsValue('PB-03'));
    t.assert('PB-04 soiling = 0.03',              0.03,  agsValue('PB-04'));
    t.assert('PB-07 roof ceiling = 0.70',         0.70,  agsValue('PB-07'));

    // Exceedance z-values (FR-207-03 / PB-06)
    var pb06 = agsValue('PB-06');
    t.assertNear('PB-06 z_P75 = 0.674', 0.674, pb06.zP75, 1e-9);
    t.assertNear('PB-06 z_P90 = 1.282', 1.282, pb06.zP90, 1e-9);
    t.assertNear('PB-06 z_P99 = 2.326', 2.326, pb06.zP99, 1e-9);
    t.assertNear('PB-06 sigma acceptable ceiling = 0.08', 0.08, pb06.sigmaAcceptable, 1e-9);

    // DC current factors (FR-205-04)
    t.assert('DC-01 = 1.25',     1.25,   agsValue('DC-01'));
    t.assert('DC-02 = 1.5625',   1.5625, agsValue('DC-02'));

    // BESS defaults (BS-06)
    var bs06 = agsValue('BS-06');
    t.assert('BS-06 DoD = 0.90',     0.90, bs06.dodMax);
    t.assert('BS-06 RTE = 0.90',     0.90, bs06.rteAc);
    t.assert('BS-06 SOH_EOL = 0.80', 0.80, bs06.sohEol);

    // Regulatory + reference
    t.assert('REG-01 exempt limit = 0.7 MW', 0.7,  agsValue('REG-01'));
    t.assert('STC-03 albedo = 0.20',         0.20, agsValue('STC-03'));

    // DC/AC band (FR-204-04 + AGS-204 §7)
    var band = agsValue('DCAC-BAND');
    t.assert('DC/AC min = 1.10',       1.10, band.min);
    t.assert('DC/AC review low = 1.35', 1.35, band.reviewLow);
    t.assert('DC/AC max (fail above) = 1.40', 1.40, band.max);
  }
});


registerTest({
  id      : 'UNIT_AGS_GET_THROWS_ON_UNKNOWN',
  group   : 'unit',
  module  : 'ags/register',
  scenarios: [],
  tags    : ['ags', 'register', 'a1'],
  source  : 'tests_unit/ags/AgsRegisterTests.gs',
  fn      : function (t) {
    t.suite('UNIT ags/register: agsGet throws on an unknown ID (AGS-802 R1)');
    t.assertThrows('agsGet("DOES-NOT-EXIST") throws', function () { agsGet('DOES-NOT-EXIST'); });
    // A known ID does NOT throw and returns the entry.
    var e = agsGet('PB-01');
    t.assertTrue('agsGet known ID returns an entry', !!e && e.id === 'PB-01');
  }
});


registerTest({
  id      : 'UNIT_AGS_CONFORMANCE_DETECTS_DELTAS',
  group   : 'unit',
  module  : 'ags/conformance',
  scenarios: [],
  tags    : ['ags', 'conformance', 'a1'],
  source  : 'tests_unit/ags/AgsRegisterTests.gs',
  fn      : function (t) {
    t.suite('UNIT ags/conformance: current engine values raise the Category-A drift');

    var r = agsConformanceReport(_agsEngineCurrentObserved());

    t.assert('status = BLOCK (DC/AC fail-threshold above 1.40)', 'BLOCK', r.status);

    // DC/AC hard-fail above 1.40 -> a BLOCK delta on DCAC-BAND.
    var dcAcBlock = r.deltas.filter(function (d) {
      return d.id === 'DCAC-BAND' && d.severity === 'BLOCK';
    });
    t.assert('one DCAC-BAND BLOCK delta', 1, dcAcBlock.length);

    // Degradation 0.5% > 0.4% -> a REVIEW delta on PB-01.
    var pb01 = r.deltas.filter(function (d) { return d.id === 'PB-01'; });
    t.assert('one PB-01 delta', 1, pb01.length);
    t.assert('PB-01 delta severity REVIEW', 'REVIEW', pb01[0] ? pb01[0].severity : '');

    // DC-01 (1.25) and BS-06 RTE (0.90) are already aligned -> conformant.
    var conformantIds = r.conformant.map(function (c) { return c.id; });
    t.assertTrue('DC-01 reported conformant', conformantIds.indexOf('DC-01') !== -1);
    t.assertTrue('BS-06 reported conformant', conformantIds.indexOf('BS-06') !== -1);
  }
});


registerTest({
  id      : 'UNIT_AGS_CONFORMANCE_CLEAN_WHEN_ALIGNED',
  group   : 'unit',
  module  : 'ags/conformance',
  scenarios: [],
  tags    : ['ags', 'conformance', 'a1'],
  source  : 'tests_unit/ags/AgsRegisterTests.gs',
  fn      : function (t) {
    t.suite('UNIT ags/conformance: AGS-aligned values produce zero deltas');

    var r = agsConformanceReport(_agsAlignedObserved());
    t.assert('status = PASS', 'PASS', r.status);
    t.assert('zero deltas when aligned', 0, r.deltas.length);
    t.assertTrue('some values reported conformant', r.conformant.length > 0);
  }
});


registerTest({
  id      : 'UNIT_AGS_CONFORMANCE_FLAGS_NOT_MODELED',
  group   : 'unit',
  module  : 'ags/conformance',
  scenarios: [],
  tags    : ['ags', 'conformance', 'a1'],
  source  : 'tests_unit/ags/AgsRegisterTests.gs',
  fn      : function (t) {
    t.suite('UNIT ags/conformance: absent subsystems surface as INFO, never silent');

    var r = agsConformanceReport(_agsEngineCurrentObserved());
    var notModeledIds = r.notModeled.map(function (n) { return n.id; });

    t.assertTrue('SOH_EOL deration flagged not-modeled (BS-06)',
                 notModeledIds.indexOf('BS-06') !== -1);
    t.assertTrue('bankability model flagged not-modeled (PB-06)',
                 notModeledIds.indexOf('PB-06') !== -1);

    // An empty observed object must not throw and must not invent deltas.
    var empty = agsConformanceReport({});
    t.assert('empty input => PASS', 'PASS', empty.status);
    t.assert('empty input => 0 deltas', 0, empty.deltas.length);
  }
});
