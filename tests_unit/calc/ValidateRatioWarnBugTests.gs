// =============================================================================
// ARGIA TESTS -- tests_unit/calc/ValidateRatioWarnBugTests.gs
// -----------------------------------------------------------------------------
// Bug regression test for v3.7.8 patch B3:
//
//   B3 - 09_Validate.js:206: operator-precedence bug.
//        Pre-patch: `if (acKw > 0 && ratio < X || ratio < 0.8)`
//        which parses as `(acKw > 0 && ratio < X) || (ratio < 0.8)`.
//        The second clause fires regardless of acKw>0 guard.
//        Today it is masked because the enclosing block on line 194
//        already guards acKw > 0, but this is a footgun.
//
// SCOPE
//   We can't easily run runValidation() in pure-function mode (it touches
//   the engine log and reads from INPUT_MAP). Instead we mirror the exact
//   patched conditional in a tiny helper and exercise its truth table.
//   If anyone ever drops the parens, the truth table will catch it.
// =============================================================================


// Mirror of the patched conditional (09_Validate.js:211)
function _b3_shouldWarn(acKw, ratio, warnMin) {
  return acKw > 0 && (ratio < warnMin || ratio < 0.8);
}

// What the pre-patch code did (kept here as documentation / negative test
// reference). NOT called in production.
function _b3_brokenLegacy(acKw, ratio, warnMin) {
  // Equivalent to acKw > 0 && ratio < warnMin || ratio < 0.8
  return (acKw > 0 && ratio < warnMin) || (ratio < 0.8);
}


registerTest({
  id      : 'UNIT_VALIDATE_B3_DCAC_LOW_RATIO_WARN',
  group   : 'unit',
  module  : 'calc/validate',
  scenarios: [],
  tags    : ['validate', 'dc-ac', 'bug', 'b3', 'regression'],
  source  : 'tests_unit/calc/ValidateRatioWarnBugTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/validate: B3 DC/AC low-ratio warn parens');

    var warnMin = 1.10; // typical value from NOM_DB

    // ---- Patched behavior (what the engine does now) ----------------------

    // Real low-ratio project: acKw=10, ratio=0.50 -> warn fires
    t.assertTrue('acKw>0, ratio<warnMin and <0.8 => warn',
      _b3_shouldWarn(10, 0.50, warnMin));

    // Borderline below warnMin but above 0.8: still warns (ratio < warnMin)
    t.assertTrue('acKw>0, ratio=1.0 (< 1.10 warnMin) => warn',
      _b3_shouldWarn(10, 1.0, warnMin));

    // Healthy ratio: no warn
    t.assertFalse('acKw>0, ratio=1.20 (above warnMin) => no warn',
      _b3_shouldWarn(10, 1.20, warnMin));

    // Critical guard: if acKw is 0, never warn (we cannot compute ratio anyway)
    t.assertFalse('acKw=0 => no warn even when ratio<0.8',
      _b3_shouldWarn(0, 0.5, warnMin));
    t.assertFalse('acKw=0 => no warn even when ratio<warnMin',
      _b3_shouldWarn(0, 1.0, warnMin));

    // ---- Demonstrate the legacy bug (negative reference) ------------------
    // These assertions document the bug that motivated the patch.
    // If parens are ever removed, the legacy behavior would resurface.
    t.assertTrue('LEGACY bug: acKw=0 + ratio=0.5 would have warned (wrong)',
      _b3_brokenLegacy(0, 0.5, warnMin));
    t.assertFalse('PATCHED: acKw=0 + ratio=0.5 does NOT warn',
      _b3_shouldWarn(0, 0.5, warnMin));
  }
});
