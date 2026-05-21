// =============================================================================
// ARGIA TEST FRAMEWORK -- TestRegistry.gs
// -----------------------------------------------------------------------------
// Central registry of all tests. Each test file calls registerTest({...}) at
// load time. The runner reads TEST_REGISTRY and dispatches accordingly --
// no hand-maintained dispatch list, so "forgot to wire it up" is impossible.
//
// Apps Script loads files in alphabetical order. Framework files (test/*) load
// before suite files (tests_unit/*, tests_integration/*, tests_regression/*),
// so TEST_REGISTRY exists before any registerTest() call.
//
// REGISTRY ENTRY SHAPE
//   {
//     id        : 'UNIT_CALC_DC_BIFACIAL',           // unique, ALL_CAPS
//     group     : 'unit',                            // 'unit' | 'integration' | 'regression'
//     module    : 'calc/dc',                         // slash-delimited path
//     scenarios : ['PV_BASIC_GDMTH'],                // scenario ids loaded for fn
//     tags      : ['calc', 'dc', 'bifacial'],        // free-form filter labels
//     source    : 'tests_unit/calc/CalcDcTests.gs',  // where this lives
//     fn        : function (t, ctx) { ... }          // the test body
//   }
//
// PUBLIC API
//   registerTest(entry)                  -- called by each test file
//   getRegistry()                        -- defensive copy
//   findRegistry(filterFn)               -- filter helper
//   getScenarioIds()                     -- distinct scenarios across registry
//   getModules()                         -- distinct module paths
//   getTags()                            -- distinct tags
// =============================================================================


/**
 * The single source of truth for all tests in the new framework.
 *
 * Why the funny init? Apps Script's cross-file load order is not strictly
 * alphabetical, and we can't assume this file loads before suite files that
 * call registerTest() at their own load time. If a suite file loads first
 * and triggers a registerTest() call (which lazy-inits the array via the
 * guard below), then this file loads, a plain `var TEST_REGISTRY = []`
 * would overwrite the array and wipe the entries. The guard below makes
 * initialization idempotent: only assign [] if nothing's there yet.
 */
var TEST_REGISTRY = (typeof TEST_REGISTRY !== 'undefined' && TEST_REGISTRY)
  ? TEST_REGISTRY
  : [];


/**
 * Register a test. Called at file load time by suite files.
 *
 * Validates that:
 *   - id is unique
 *   - group is one of unit | integration | regression
 *   - fn is a function
 *
 * Throws on bad input -- a registration error breaks the runner load so the
 * problem is found immediately, not silently dropped.
 *
 * @param {Object} entry  See REGISTRY ENTRY SHAPE above.
 */
function registerTest(entry) {
  // Lazy init guard. If this is called before the `var TEST_REGISTRY = ...`
  // above has executed (Apps Script cross-file load order is not strictly
  // alphabetical), initialize it ourselves. The `var` line above is also
  // guarded so this assignment isn't overwritten when that line later runs.
  if (typeof TEST_REGISTRY === 'undefined' || !TEST_REGISTRY) {
    TEST_REGISTRY = [];
  }

  if (!entry || typeof entry !== 'object') {
    throw new Error('registerTest: entry must be an object');
  }
  if (!entry.id || typeof entry.id !== 'string') {
    throw new Error('registerTest: id required (string)');
  }
  if (['unit', 'integration', 'regression'].indexOf(entry.group) < 0) {
    throw new Error('registerTest: group must be unit|integration|regression, got "'
                    + entry.group + '" for id ' + entry.id);
  }
  if (typeof entry.fn !== 'function') {
    throw new Error('registerTest: fn must be a function for id ' + entry.id);
  }

  // Reject duplicate ids -- silent overwrite is the exact bug this framework
  // is meant to prevent.
  for (var i = 0; i < TEST_REGISTRY.length; i++) {
    if (TEST_REGISTRY[i].id === entry.id) {
      throw new Error('registerTest: duplicate id "' + entry.id
                      + '" (already registered from '
                      + (TEST_REGISTRY[i].source || 'unknown') + ')');
    }
  }

  // Normalize optional fields to predictable shapes.
  TEST_REGISTRY.push({
    id        : entry.id,
    group     : entry.group,
    module    : entry.module    || '',
    scenarios : (entry.scenarios || []).slice(),
    tags      : (entry.tags      || []).slice(),
    source    : entry.source    || '',
    fn        : entry.fn
  });
}


/** Defensive copy of the registry. */
function getRegistry() { return TEST_REGISTRY.slice(); }


/**
 * Filter the registry. fn receives each entry and returns truthy to include.
 * @param {function(Object): boolean} filterFn
 * @return {Array<Object>}
 */
function findRegistry(filterFn) {
  if (typeof filterFn !== 'function') return getRegistry();
  return TEST_REGISTRY.filter(filterFn);
}


/** Distinct scenario ids referenced by any registered test. Sorted. */
function getScenarioIds() {
  var seen = {};
  TEST_REGISTRY.forEach(function (e) {
    (e.scenarios || []).forEach(function (s) { seen[s] = true; });
  });
  return Object.keys(seen).sort();
}


/** Distinct module paths. Sorted. */
function getModules() {
  var seen = {};
  TEST_REGISTRY.forEach(function (e) { if (e.module) seen[e.module] = true; });
  return Object.keys(seen).sort();
}


/** Distinct tags. Sorted. */
function getTags() {
  var seen = {};
  TEST_REGISTRY.forEach(function (e) {
    (e.tags || []).forEach(function (tg) { seen[tg] = true; });
  });
  return Object.keys(seen).sort();
}


/**
 * Diagnostic: dump the registry to the engine log (if available). Useful
 * when inspecting which tests are visible to the runner.
 */
function logRegistry() {
  var lines = [];
  lines.push('TEST_REGISTRY: ' + TEST_REGISTRY.length + ' tests');
  lines.push('  scenarios: ' + getScenarioIds().join(', '));
  lines.push('  modules  : ' + getModules().join(', '));
  lines.push('  tags     : ' + getTags().join(', '));
  TEST_REGISTRY.forEach(function (e) {
    lines.push('  [' + e.group + '] ' + e.id + '  (' + e.module + ')');
  });
  var text = lines.join('\n');
  if (typeof Logger !== 'undefined' && Logger.log) Logger.log(text);
  return text;
}