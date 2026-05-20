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
// CO-EXISTENCE
//   The legacy runTests() in 99_TestRunner.gs is unchanged. The new runner
//   uses different function names (runAllTests, etc.) and writes to a
//   different sheet (_TEST_RESULTS_V2) so the two are fully isolated.
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
 * Core dispatch. Filter the registry, run each matching test in a try/catch,
 * gather entries, write the result sheet, return a summary string.
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
