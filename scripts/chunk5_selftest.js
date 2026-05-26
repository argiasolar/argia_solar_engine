// =============================================================================
// Chunk 5 self-test rig (Node.js, run locally before zipping for the user).
// -----------------------------------------------------------------------------
// Concats the relevant Apps Script source files + Apps Script global stubs
// + the chunk5 test files, then runs every chunk5-tagged test against the
// in-memory mock spreadsheet. Prints PASS/FAIL counts.
//
// This is NOT shipped to the user. It's a development tool to catch bugs
// before zipping (caught 6 template-test errors in chunk 4 patch1 because
// of the loadDesignTokens integration gap).
//
// Usage:
//   node scripts/chunk5_selftest.js
// =============================================================================

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

// -----------------------------------------------------------------------------
// 1) Apps Script global stubs
// -----------------------------------------------------------------------------

global.SpreadsheetApp = {
  BorderStyle: {
    SOLID:        'SOLID',
    SOLID_MEDIUM: 'SOLID_MEDIUM',
    SOLID_THICK:  'SOLID_THICK',
    DOTTED:       'DOTTED',
    DASHED:       'DASHED'
  },
  getActive: function() { throw new Error('SpreadsheetApp.getActive: not available in tests'); },
  flush: function() { /* no-op */ },
  newDataValidation: function() {
    var rule = {
      _options: null,
      _allowInvalid: true,
      requireValueInList: function(opts, _showDropdown) {
        rule._options = opts; return rule;
      },
      setAllowInvalid: function(v) { rule._allowInvalid = v; return rule; },
      build: function() {
        return {
          _options: rule._options,
          _allowInvalid: rule._allowInvalid,
          getCriteriaValues: function() { return [rule._options]; }
        };
      }
    };
    return rule;
  }
};

// engineLog — quiet
global.engineLog = function() {};

// Design tokens — load the REAL module (caught real integration bugs in chunk 4 patch1).
global.DESIGN_TOKENS_SHEET = '_DESIGN_TOKENS';
global._insertArgiaLogo = function() {};

// V2_SHEETS will be defined when TemplateRegistry loads below.

// -----------------------------------------------------------------------------
// 2) TEST_REGISTRY + minimal t-context (subset of TestAssert.gs)
// -----------------------------------------------------------------------------

global.TEST_REGISTRY = [];
global.registerTest = function(entry) {
  if (!entry || !entry.id) throw new Error('registerTest: missing id');
  if (!entry.fn || typeof entry.fn !== 'function') {
    throw new Error('registerTest: missing fn for ' + entry.id);
  }
  TEST_REGISTRY.push({
    id: entry.id,
    group: entry.group,
    module: entry.module || '',
    scenarios: (entry.scenarios || []).slice(),
    tags: (entry.tags || []).slice(),
    source: entry.source || '',
    fn: entry.fn
  });
};

function makeT() {
  var entries = [];
  function _eq(e, a) {
    if (e === null || e === undefined) return e === a;
    if (typeof e === 'number' && typeof a === 'number') return e === a;
    if (typeof e === 'object') {
      try { return JSON.stringify(e) === JSON.stringify(a); } catch(_) { return false; }
    }
    return String(e) === String(a);
  }
  return {
    suite: function() {},
    assert: function(label, expected, actual) {
      var ok = _eq(expected, actual);
      entries.push({ status: ok ? 'PASS' : 'FAIL', label: label,
                     expected: expected, actual: actual });
      return ok;
    },
    assertNear: function(label, expected, actual, tol) {
      var ok = Math.abs(expected - actual) <= tol;
      entries.push({ status: ok ? 'PASS' : 'FAIL', label: label,
                     expected: expected, actual: actual });
      return ok;
    },
    assertTrue: function(label, actual) {
      var ok = !!actual;
      entries.push({ status: ok ? 'PASS' : 'FAIL', label: label,
                     expected: 'TRUE', actual: ok ? 'TRUE' : 'FALSE' });
      return ok;
    },
    assertFalse: function(label, actual) {
      var ok = !actual;
      entries.push({ status: ok ? 'PASS' : 'FAIL', label: label,
                     expected: 'FALSE', actual: actual ? 'TRUE' : 'FALSE' });
      return ok;
    },
    assertThrows: function(label, fn, msg) {
      try {
        fn();
        entries.push({ status: 'FAIL', label: label, expected: '<throw>',
                       actual: '<no throw>' });
        return false;
      } catch(e) {
        var em = (e && e.message) ? e.message : String(e);
        if (msg) {
          var contains = em.indexOf(msg) >= 0;
          entries.push({ status: contains ? 'PASS' : 'FAIL', label: label,
                         expected: 'throw containing "' + msg + '"',
                         actual: 'throw: "' + em + '"' });
          return contains;
        }
        entries.push({ status: 'PASS', label: label, expected: '<throw>',
                       actual: 'throw: "' + em + '"' });
        return true;
      }
    },
    assertContains: function(label, h, n) {
      var ok = String(h || '').indexOf(String(n || '')) >= 0;
      entries.push({ status: ok ? 'PASS' : 'FAIL', label: label,
                     expected: 'contains "' + n + '"', actual: h });
      return ok;
    },
    info: function() {},
    _entries: entries
  };
}

// -----------------------------------------------------------------------------
// 3) Load the source files (in order: registry → DesignTokens → template → writer → tests)
// -----------------------------------------------------------------------------
function load(relPath) {
  var src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  try {
    require('vm').runInThisContext(src, { filename: relPath });
  } catch (e) {
    console.error('LOAD ERROR in ' + relPath + ': ' + e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  }
}

load('templates/TemplateRegistry.js');
load('02a_DesignTokens.js');
load('templates/setupInstallationTemplate.js');
load('writers_v2/WriteInstallationV2.js');

load('tests_unit/templates/InstallationTemplateTests.gs');
load('tests_unit/writers_v2/WriteInstallationV2Tests.gs');

// -----------------------------------------------------------------------------
// 4) Run every chunk5-tagged test and tally results
// -----------------------------------------------------------------------------
var totalTests = 0, totalPass = 0, totalFail = 0;
var testFailures = [];

TEST_REGISTRY
  .filter(function(t) { return t.tags && t.tags.indexOf('chunk5') !== -1; })
  .forEach(function(test) {
    totalTests++;
    var t = makeT();
    try {
      test.fn(t, {});
    } catch (e) {
      t._entries.push({ status: 'ERROR', label: 'test threw',
                        expected: '', actual: e.message });
      if (e.stack) console.error('  STACK: ' + e.stack);
    }
    var failed = t._entries.filter(function(e) {
      return e.status === 'FAIL' || e.status === 'ERROR';
    });
    if (failed.length === 0) {
      totalPass++;
      console.log('PASS ' + test.id + ' (' + t._entries.length + ' assertions)');
    } else {
      totalFail++;
      console.log('FAIL ' + test.id);
      failed.forEach(function(f) {
        console.log('   \u2717 ' + f.label);
        console.log('     expected: ' + JSON.stringify(f.expected));
        console.log('     actual:   ' + JSON.stringify(f.actual));
      });
      testFailures.push(test.id);
    }
  });

console.log('\n=======================================');
console.log('chunk5 self-test: ' + totalTests + ' tests, ' +
            totalPass + ' pass, ' + totalFail + ' fail');
console.log('=======================================');
if (testFailures.length > 0) {
  console.log('Failed tests:');
  testFailures.forEach(function(id) { console.log('  ' + id); });
  process.exit(1);
}
process.exit(0);
