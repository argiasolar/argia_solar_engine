// =============================================================================
// ARGIA TESTS -- tests_unit/ags/AgsLiveConformanceTests.gs
// -----------------------------------------------------------------------------
// AGS conformance track -- Task A2. Locks the live wiring: after A2, the
// engine's DC/AC gate is advisory-only (no hard block), so the conformance
// report run from the loaded `nom` raises NO DC/AC BLOCK. The 0.5%/yr
// degradation stays a VISIBLE, designer-owned REVIEW (we did not silently
// change a customer-facing financial number).
//
// PURE: feeds a synthetic post-A2 `nom` + client defaults (no workbook).
//
// COVERAGE (2 tests):
//   1. UNIT_AGS_LIVE_NO_DCAC_BLOCK_AFTER_A2  -- no DCAC-BAND BLOCK; DC/AC clears
//   2. UNIT_AGS_LIVE_DEGRADATION_STAYS_VISIBLE -- PB-01 still surfaces as REVIEW
// =============================================================================

// Synthetic post-A2 loaded `nom` (mirrors 02_LoadDB after A2).
function _agsPostA2Nom() {
  return {
    dcAcAgsMin:       1.10,
    dcAcAgsReviewLow: 1.35,
    dcAcAgsMax:       1.40,
    currentFactor1:   1.25,   // DC-01, already AGS-aligned
    // legacy keys still present but no longer drive the gate:
    dcAcWarn:         1.50,
    dcAcHard:         1.80
  };
}

// Client-financials defaults as shipped (degradation unchanged at 0.5%/yr).
function _agsClientDefaults() {
  return { panelDegradationPct: 0.005, co2FactorTonPerMwh: 0.444 };
}


registerTest({
  id      : 'UNIT_AGS_LIVE_NO_DCAC_BLOCK_AFTER_A2',
  group   : 'unit',
  module  : 'ags/conformance',
  scenarios: [],
  tags    : ['ags', 'conformance', 'a2'],
  source  : 'tests_unit/ags/AgsLiveConformanceTests.gs',
  fn      : function (t) {
    t.suite('UNIT ags/conformance: post-A2 config raises no DC/AC hard block');

    var r = agsConformanceFromNom(_agsPostA2Nom(), _agsClientDefaults());

    // No DC/AC BLOCK delta anywhere (the hard block was removed in A2).
    var dcAcBlocks = r.deltas.filter(function (d) {
      return d.id === 'DCAC-BAND' && d.severity === 'BLOCK';
    });
    t.assert('zero DCAC-BAND BLOCK deltas', 0, dcAcBlocks.length);

    // And no DC/AC REVIEW delta either: the engine now flags from the AGS
    // review-low (1.35), so it matches the AGS band exactly.
    var dcAcAny = r.deltas.filter(function (d) { return d.id === 'DCAC-BAND'; });
    t.assert('zero DCAC-BAND deltas of any kind', 0, dcAcAny.length);

    // Overall status is not BLOCK (only the intentional degradation REVIEW remains).
    t.assertFalse('overall status is not BLOCK', r.status === 'BLOCK');
  }
});


registerTest({
  id      : 'UNIT_AGS_LIVE_DEGRADATION_STAYS_VISIBLE',
  group   : 'unit',
  module  : 'ags/conformance',
  scenarios: [],
  tags    : ['ags', 'conformance', 'a2'],
  source  : 'tests_unit/ags/AgsLiveConformanceTests.gs',
  fn      : function (t) {
    t.suite('UNIT ags/conformance: 0.5%/yr degradation stays a visible designer-owned REVIEW');

    var r = agsConformanceFromNom(_agsPostA2Nom(), _agsClientDefaults());

    var pb01 = r.deltas.filter(function (d) { return d.id === 'PB-01'; });
    t.assert('PB-01 still surfaced as a delta', 1, pb01.length);
    t.assert('PB-01 severity is REVIEW (not blocking, not hidden)', 'REVIEW',
             pb01[0] ? pb01[0].severity : '');
    t.assert('overall status reflects the PB-01 REVIEW', 'REVIEW', r.status);

    // Lowering the default to the AGS cap (0.4%) would clear it -- proving the
    // knob works and the report is honest in both directions.
    var aligned = agsConformanceFromNom(_agsPostA2Nom(),
                    { panelDegradationPct: 0.004 });
    t.assert('aligned degradation clears the PB-01 delta', 'PASS', aligned.status);
  }
});
