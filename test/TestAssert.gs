// =============================================================================
// ARGIA TEST FRAMEWORK -- TestAssert.gs
// -----------------------------------------------------------------------------
// The assertion framework. Returns a `t` object that test functions use to
// record pass/fail/info entries. Buffered: nothing writes to a sheet until
// the runner asks for the results.
//
// USAGE
//   var t = createTestContext();
//   t.suite('My suite');
//   t.assert('label', 42, actual);                      // exact equality
//   t.assertNear('label', 3.14, actual, 0.01);          // tolerance
//   t.assertThrows('label', function () { foo(); });    // expects throw
//   t.assertContains('label', haystack, 'needle');      // substring
//   t.assertSnapshot('label', expectedObj, actualObj);  // deep equality
//   t.expectWarning('label', warnings, 'CODE');         // warning-code present
//   t.expectNoWarning('label', warnings, 'CODE');       // warning-code absent
//   t.info('label', message);                           // diagnostic line
//   t.error('label', err);                              // record an exception
//   var results = t.flush();                            // get the entries
//
// COMPATIBILITY
//   The legacy `99_TestRunner.gs` has its own inline `t` object. This file's
//   createTestContext() is separate and used only by the new TestRunner.
//   Both can coexist without collision since they're not globals.
// =============================================================================


/**
 * Create a fresh test context. Each call to runAllTests/runUnitTests/etc.
 * creates a new context so concurrent invocations don't share state.
 *
 * @return {Object} A test context with the methods documented above.
 */
function createTestContext() {
  var entries = [];          // recorded assertion entries
  var currentSuite = '';     // last t.suite() label, used as Suite column
  var currentTestId = '';    // last test id, set by the runner per test
  var currentModule = '';    // last module, set by the runner per test
  var currentScenario = '';  // last scenario, set by the runner per test
  var startTimeByTest = {};  // testId -> Date.now() at start

  /**
   * Coerce a value to a comparable form. Dates become ISO strings, arrays
   * and objects become JSON, primitives pass through unchanged.
   */
  function _normalize(v) {
    if (v === null || v === undefined) return v;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
      try { return JSON.stringify(v); }
      catch (e) { return String(v); }
    }
    return v;
  }

  /**
   * Compare two normalized values with optional numeric tolerance.
   */
  function _equal(expected, actual, tolerance) {
    if (typeof expected === 'number' && typeof actual === 'number'
        && typeof tolerance === 'number' && tolerance > 0) {
      return Math.abs(expected - actual) <= tolerance;
    }
    return _normalize(expected) === _normalize(actual);
  }

  /**
   * Append an entry to the in-memory buffer. All assert methods funnel here.
   */
  function _record(status, label, expected, actual, note, tolerance) {
    entries.push({
      runId       : null,                       // filled by TestRunner on flush
      timestamp   : new Date(),
      engineVer   : typeof ENGINE_VERSION === 'string' ? ENGINE_VERSION : '',
      scenarioId  : currentScenario,
      testId      : currentTestId,
      group       : '',                         // filled by TestRunner on flush
      module      : currentModule,
      suite       : currentSuite,
      assertion   : label,
      status      : status,                     // 'PASS' | 'FAIL' | 'INFO' | 'ERROR'
      expected    : _normalize(expected),
      actual      : _normalize(actual),
      tolerance   : (typeof tolerance === 'number') ? tolerance : '',
      source      : '',                         // filled by TestRunner on flush
      durationMs  : '',                         // filled by TestRunner on flush
      errorStack  : '',
      note        : note || ''
    });
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /** Set the current suite label. Subsequent asserts inherit it. */
  function suite(label) { currentSuite = String(label); }

  /**
   * Exact equality. For numbers, use assertNear with a tolerance.
   * @return {boolean} true on PASS, false on FAIL.
   */
  function assert(label, expected, actual, tolerance) {
    var ok = _equal(expected, actual, tolerance);
    _record(ok ? 'PASS' : 'FAIL', label, expected, actual, '', tolerance);
    return ok;
  }

  /** Numeric near-equality with explicit tolerance. */
  function assertNear(label, expected, actual, tolerance) {
    if (typeof tolerance !== 'number' || tolerance < 0) {
      throw new Error('assertNear: tolerance must be a non-negative number');
    }
    return assert(label, expected, actual, tolerance);
  }

  /**
   * Verify that calling fn() throws. Optionally check that the thrown
   * message contains expectedMsgSubstring.
   */
  function assertThrows(label, fn, expectedMsgSubstring) {
    try {
      fn();
      _record('FAIL', label, '<throw>', '<no throw>', '');
      return false;
    } catch (e) {
      var msg = (e && e.message) ? String(e.message) : String(e);
      if (expectedMsgSubstring) {
        var contains = msg.indexOf(expectedMsgSubstring) >= 0;
        _record(contains ? 'PASS' : 'FAIL',
                label,
                'throw containing "' + expectedMsgSubstring + '"',
                'throw: "' + msg + '"',
                '');
        return contains;
      }
      _record('PASS', label, '<throw>', 'throw: "' + msg + '"', '');
      return true;
    }
  }

  /** Verify that haystack (string) contains needle (string). */
  function assertContains(label, haystack, needle) {
    var h = String(haystack == null ? '' : haystack);
    var n = String(needle == null ? '' : needle);
    var ok = h.indexOf(n) >= 0;
    _record(ok ? 'PASS' : 'FAIL',
            label,
            'contains "' + n + '"',
            h.length > 80 ? h.substring(0, 80) + '...' : h,
            '');
    return ok;
  }

  /**
   * Deep equality between expected and actual. Used for golden-output
   * snapshot tests. Drift fails loud with a JSON diff in the note column.
   *
   * @param {string} label
   * @param {Object|Array} expected
   * @param {Object|Array} actual
   * @param {Object} [opts]  { tolerance: number }  numeric leaves compared
   *                         within tolerance. Default 0 (exact).
   */
  function assertSnapshot(label, expected, actual, opts) {
    var tol = (opts && typeof opts.tolerance === 'number') ? opts.tolerance : 0;
    var diff = _deepDiff(expected, actual, tol, '');
    if (diff.length === 0) {
      _record('PASS', label, '<snapshot match>', '<snapshot match>', '', tol);
      return true;
    }
    _record('FAIL', label, '<snapshot>', '<snapshot drift>',
            diff.join(' | '), tol);
    return false;
  }

  /**
   * Recursive structural compare. Returns an array of human-readable
   * difference strings; empty means equal.
   */
  function _deepDiff(exp, act, tol, path) {
    var diffs = [];
    if (typeof exp === 'number' && typeof act === 'number') {
      if (!_equal(exp, act, tol)) {
        diffs.push(path + ': expected ' + exp + ', got ' + act);
      }
      return diffs;
    }
    if (exp === null || act === null
        || typeof exp !== 'object' || typeof act !== 'object') {
      if (_normalize(exp) !== _normalize(act)) {
        diffs.push(path + ': expected ' + _normalize(exp)
                   + ', got ' + _normalize(act));
      }
      return diffs;
    }
    // Both are objects/arrays
    var expKeys = Object.keys(exp);
    var actKeys = Object.keys(act);
    var allKeys = {};
    expKeys.forEach(function (k) { allKeys[k] = true; });
    actKeys.forEach(function (k) { allKeys[k] = true; });
    Object.keys(allKeys).forEach(function (k) {
      var subPath = path ? path + '.' + k : k;
      if (!(k in exp)) {
        diffs.push(subPath + ': unexpected key (got ' + _normalize(act[k]) + ')');
      } else if (!(k in act)) {
        diffs.push(subPath + ': missing key (expected ' + _normalize(exp[k]) + ')');
      } else {
        diffs = diffs.concat(_deepDiff(exp[k], act[k], tol, subPath));
      }
    });
    return diffs;
  }

  /**
   * Assert that warnings (an array of {code, message} or string) contains
   * the given code. Engine warnings should carry a `.code` field; for
   * legacy prose-only warnings, falls back to substring match on .message.
   */
  function expectWarning(label, warnings, code) {
    var found = _findWarning(warnings, code);
    _record(found ? 'PASS' : 'FAIL',
            label,
            'warning ' + code + ' present',
            found ? 'present' : 'absent',
            '');
    return found;
  }

  /** Inverse of expectWarning: code must NOT be present. */
  function expectNoWarning(label, warnings, code) {
    var found = _findWarning(warnings, code);
    _record(!found ? 'PASS' : 'FAIL',
            label,
            'warning ' + code + ' absent',
            found ? 'present' : 'absent',
            '');
    return !found;
  }

  function _findWarning(warnings, code) {
    if (!warnings) return false;
    if (!Array.isArray(warnings)) warnings = [warnings];
    for (var i = 0; i < warnings.length; i++) {
      var w = warnings[i];
      if (!w) continue;
      if (typeof w === 'string') {
        if (w.indexOf(code) >= 0) return true;
        continue;
      }
      if (w.code === code) return true;
      if (w.message && String(w.message).indexOf(code) >= 0) return true;
    }
    return false;
  }

  /** Record a diagnostic line. Counts as INFO, not as pass/fail. */
  function info(label, message) {
    _record('INFO', label, '', '', String(message == null ? '' : message));
  }

  /**
   * Record an exception. Used by the runner when a registered test throws.
   */
  function error(label, err) {
    var msg = (err && err.message) ? err.message : String(err);
    var stack = (err && err.stack) ? err.stack : '';
    _record('ERROR', label, '<no throw>', msg, '');
    // Stash the stack on the last entry so TestResults can render it.
    if (entries.length > 0) entries[entries.length - 1].errorStack = stack;
  }

  /**
   * Set runner-managed metadata. Called by TestRunner before invoking
   * each registered test, so subsequent asserts inherit the context.
   */
  function _setContext(testId, module, scenario) {
    currentTestId = testId || '';
    currentModule = module || '';
    currentScenario = scenario || '';
    if (testId) startTimeByTest[testId] = Date.now();
  }

  /**
   * Mark a test as complete; the runner uses this to fill durationMs on
   * all entries belonging to that test.
   */
  function _completeTest(testId) {
    var started = startTimeByTest[testId];
    if (!started) return;
    var dur = Date.now() - started;
    for (var i = entries.length - 1; i >= 0; i--) {
      if (entries[i].testId === testId && entries[i].durationMs === '') {
        entries[i].durationMs = dur;
      } else if (entries[i].testId !== testId) {
        // Older entries from a different test; stop walking.
        break;
      }
    }
  }

  /** Return a copy of recorded entries. Does not clear the buffer. */
  function flush() { return entries.slice(); }

  /** Empty the buffer. Used between runs if a context is reused. */
  function reset() {
    entries = [];
    startTimeByTest = {};
    currentSuite = '';
    currentTestId = '';
    currentModule = '';
    currentScenario = '';
  }

  return {
    suite           : suite,
    assert          : assert,
    assertNear      : assertNear,
    assertThrows    : assertThrows,
    assertContains  : assertContains,
    assertSnapshot  : assertSnapshot,
    expectWarning   : expectWarning,
    expectNoWarning : expectNoWarning,
    info            : info,
    error           : error,
    flush           : flush,
    reset           : reset,
    _setContext     : _setContext,
    _completeTest   : _completeTest
  };
}
