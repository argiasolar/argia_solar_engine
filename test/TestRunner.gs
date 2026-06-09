// =============================================================================
// ARGIA TEST FRAMEWORK -- TestRunner.gs
// -----------------------------------------------------------------------------
// The orchestrator. Public entry points:
//
//   runAllTests()                 -- everything in TEST_REGISTRY
//   runUnitTests()                -- group === 'unit'
//   runIntegrationTests()         -- group === 'integration'
//   runRegressionTests()          -- group === 'regression'
//   runTestsByScenario(scenarioId)
//   runTestsByModule(modulePath)  -- 'calc/dc' matches 'calc/dc' and 'calc/dc/*'
//   runTestsByTag(tag)
//   listRegisteredTests()         -- diagnostic dump, no execution
//
// Each entry point:
//   1. Builds a fresh test context via createTestContext()
//   2. Filters TEST_REGISTRY
//   3. Calls each test's fn(t, ctx) with proper bookkeeping
//   4. Writes results via writeTestResultsV2()
//   5. Returns a summary string
//
// Tests are wrapped in try/catch so a throw in one doesn't kill the run.
// Exceptions are recorded via t.error() so they show up in the result sheet.
//
// INPUT PROTECTION (Track A / A1, 2026)
//   Any run that includes an integration or regression test snapshots all
//   INPUT_* tabs before the run and ALWAYS restores them afterwards. The
//   restore is RESILIENT (per-tab + cell-by-cell fallback in
//   00d_InputSnapshot.gs) -- a fragile cell can never abort it, so the suite
//   can no longer wipe the working project. DEFAULT rebuild is a manual
//   admin action only (A3); it is never triggered automatically by a run.
//
// LEGACY COMPATIBILITY
//   The legacy runTests() in 99_TestRunner.gs was deleted in Pass 23.
//   A compatibility shim function runTests() near the bottom of this
//   file redirects calls to runAllTests() so users who had runTests
//   bookmarked or set as their default Apps Script function still get
//   a working entry point. Output goes to _TEST_RESULTS_V2 (NOT the
//   stale _TEST_RESULTS sheet from legacy).
// =============================================================================


/** Run every test in the registry. */
function runAllTests() {
  return _tr_runFiltered(
    function () { return true; },
    'all tests'
  );
}


/** Run only unit-group tests (pure functions, fast). */
function runUnitTests() {
  return _tr_runFiltered(
    function (r) { return r.group === 'unit'; },
    'unit tests'
  );
}


/** Run only integration tests (sheet I/O, slower). */
function runIntegrationTests() {
  return _tr_runFiltered(
    function (r) { return r.group === 'integration'; },
    'integration tests'
  );
}


/** Run only regression tests (locked real-project numbers). */
function runRegressionTests() {
  return _tr_runFiltered(
    function (r) { return r.group === 'regression'; },
    'regression tests'
  );
}


/** Run tests whose scenarios include the given id. */
function runTestsByScenario(scenarioId) {
  if (!scenarioId) throw new Error('runTestsByScenario: scenarioId required');
  return _tr_runFiltered(
    function (r) { return (r.scenarios || []).indexOf(scenarioId) >= 0; },
    'scenario ' + scenarioId
  );
}


/**
 * Run tests in a module path. Matches exact path AND sub-paths:
 *   runTestsByModule('calc')          matches 'calc/dc', 'calc/ac', etc.
 *   runTestsByModule('calc/dc')       matches only 'calc/dc'
 */
function runTestsByModule(modulePath) {
  if (!modulePath) throw new Error('runTestsByModule: modulePath required');
  return _tr_runFiltered(
    function (r) {
      if (!r.module) return false;
      if (r.module === modulePath) return true;
      return r.module.indexOf(modulePath + '/') === 0;
    },
    'module ' + modulePath
  );
}


/** Run tests carrying the given tag. */
function runTestsByTag(tag) {
  if (!tag) throw new Error('runTestsByTag: tag required');
  return _tr_runFiltered(
    function (r) { return (r.tags || []).indexOf(tag) >= 0; },
    'tag ' + tag
  );
}


/**
 * Diagnostic: print the registry contents without executing anything.
 * Useful to confirm tests are registered as expected.
 */
function listRegisteredTests() {
  var text = logRegistry();
  SpreadsheetApp.getUi().alert('TEST REGISTRY', text,
                               SpreadsheetApp.getUi().ButtonSet.OK);
  return text;
}


// ============================================================================
// INTERNAL
// ============================================================================


/**
 * Core dispatch. Filter the registry, snapshot inputs if the run can mutate
 * them, run each matching test in a try/catch, ALWAYS restore inputs, gather
 * entries, write the result sheet, return a summary string.
 *
 * @param {function(Object): boolean} filterFn
 * @param {string} label  Used in the run banner / log
 * @return {string}  Human-readable summary
 */
function _tr_runFiltered(filterFn, label) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var t  = createTestContext();
  var runId = _tr_generateRunId();
  var startMs = Date.now();

  var matching = findRegistry(filterFn);

  if (matching.length === 0) {
    var emptyMsg = 'No tests matched filter (' + label + '). Registry size: '
                 + TEST_REGISTRY.length + '.';
    // Even with zero tests, write an empty result sheet so the user sees
    // unambiguous "0 ran" rather than stale data from a previous run.
    var entries = t.flush();
    _tr_stampEntries(entries, runId, matching);
    writeTestResultsV2(entries, Date.now() - startMs, ss);
    return emptyMsg;
  }

  // -------------------------------------------------------------------------
  // INPUT PROTECTION (A1). Only integration/regression tests mutate INPUT_*;
  // a pure unit-only run is left untouched (no needless writes). When needed,
  // snapshot before any test runs and ALWAYS restore in the finally below --
  // even if a test throws past its own finally. If restore itself fails,
  // rebuild the DEFAULT layout so a run can never leave the workbook wiped.
  // -------------------------------------------------------------------------
  var needsProtection = matching.some(function (r) {
    return r.group === 'integration' || r.group === 'regression';
  });
  var inputSnap = null;
  if (needsProtection) {
    try {
      inputSnap = snapshotInputSheets(ss);
    } catch (snapErr) {
      if (typeof Logger !== 'undefined' && Logger.log) {
        Logger.log('TestRunner: input snapshot failed -- run proceeds but inputs '
                   + 'may not auto-restore: ' + snapErr.message);
      }
    }
  }

  try {
    matching.forEach(function (entry) {
      t._setContext(entry.id, entry.module, (entry.scenarios || [])[0] || '');
      t.suite(entry.id);
      try {
        // Pass the test a context with cheap shortcuts. Tests can ignore ctx
        // and use the global TEST_SCENARIOS / getScenario() directly.
        var ctx = {
          ss        : ss,
          scenarios : TEST_SCENARIOS,
          getScenario: getScenario
        };
        entry.fn(t, ctx);
      } catch (e) {
        t.error(entry.id + ' aborted', e);
      } finally {
        t._completeTest(entry.id);
      }
    });
  } finally {
    // Restore inputs to their pre-run state no matter what happened above.
    // restoreInputSheets is resilient (per-tab + cell-by-cell fallback) and
    // does NOT throw on per-cell trouble, so a fragile cell can never trigger
    // a DEFAULT wipe of the loaded project (the rev-1 failure mode).
    if (inputSnap) {
      try {
        var restoreReport = restoreInputSheets(ss, inputSnap);
        if (restoreReport && restoreReport.fallback.length
            && typeof Logger !== 'undefined' && Logger.log) {
          Logger.log('TestRunner: inputs restored, fallback used on: '
                     + restoreReport.fallback.join(' | '));
        }
      } catch (restoreErr) {
        // Should not happen (restore is resilient). If it does, log and leave
        // inputs as-is -- do NOT auto-rebuild DEFAULT (that wipes loaded work).
        if (typeof Logger !== 'undefined' && Logger.log) {
          Logger.log('TestRunner: input restore raised unexpectedly (inputs '
                     + 'left as-is): ' + restoreErr.message);
        }
      }
    }
  }

  var entries2 = t.flush();
  _tr_stampEntries(entries2, runId, matching);
  var elapsed = Date.now() - startMs;
  writeTestResultsV2(entries2, elapsed, ss);

  // Build the summary string.
  var pass = 0, fail = 0, err = 0;
  entries2.forEach(function (e) {
    if (e.status === 'PASS' ) pass++;
    else if (e.status === 'FAIL' ) fail++;
    else if (e.status === 'ERROR') err++;
  });
  var summary = 'ARGIA TESTS V2 (' + label + '): '
              + pass + ' passed · '
              + fail + ' failed · '
              + err  + ' errors  ('
              + matching.length + ' tests, '
              + (elapsed / 1000).toFixed(1) + 's)';

  // Surface the summary on the result sheet header for at-a-glance reading.
  if (typeof Logger !== 'undefined' && Logger.log) Logger.log(summary);
  return summary;
}


/**
 * Fill the runner-managed fields on each entry post-run. The assert
 * framework can't fill these because they depend on registry metadata
 * (group, source) and the run-wide runId.
 */
function _tr_stampEntries(entries, runId, matching) {
  // Build a quick lookup testId -> registry entry.
  var byId = {};
  matching.forEach(function (e) { byId[e.id] = e; });
  entries.forEach(function (e) {
    e.runId = runId;
    var reg = byId[e.testId];
    if (reg) {
      e.group  = reg.group;
      e.source = reg.source;
    }
  });
}


/** Compact, sortable run identifier. */
function _tr_generateRunId() {
  var d = new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone(),
                              'yyyyMMdd-HHmmss')
       + '-' + Math.floor(Math.random() * 1000);
}


// ============================================================================
// LEGACY COMPATIBILITY SHIM (added Pass 23 alongside legacy deletion)
// ============================================================================
// The legacy runTests() in 99_TestRunner.gs ran every addPhase*Tests
// function in sequence and wrote to _TEST_RESULTS. Pass 23 deleted that
// file and all 14 phase files. This shim preserves the runTests() name
// so users who:
//   - Had runTests set as the default function in the Apps Script editor
//   - Bookmarked Run > runTests in the menu
//   - Reference runTests() in docs / READMEs
// get a working entry point instead of a ReferenceError.
//
// runTests() now invokes runAllTests() (every test in TEST_REGISTRY).
// Output goes to _TEST_RESULTS_V2, NOT the legacy _TEST_RESULTS.
//
// This shim does NOT replicate every behavior of the legacy runTests
// (e.g. specific phase-by-phase ordering). It runs all registered
// tests in registry order, which is the closest semantic match.
// ============================================================================

/**
 * Compatibility shim for the legacy runTests() entry point.
 * Redirects to runAllTests(). See file header for context.
 *
 * @return {string} Summary string from runAllTests
 */
function runTests() {
  return runAllTests();
}
