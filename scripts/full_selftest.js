// =============================================================================
// ARGIA full self-test rig (Node.js)
// -----------------------------------------------------------------------------
// Loads every .js source file and every .gs/.js test file in the repo, builds
// an Apps Script-equivalent global environment, then runs every registered
// test against the in-memory mock spreadsheet.
//
// USE BEFORE EVERY `clasp push`:
//
//   node scripts/full_selftest.js
//
// Output ends with:
//
//   PASS:  <N>
//   FAIL:  <N>
//   ERROR: <N>     ← integration tests that need a real workbook
//   SKIP:  <N>
//
// Push is safe IFF FAIL=0 and no ERROR is from a unit test. ERRORs from
// integration tests (those that touch ss.getSheetByName at the top of
// the test) are expected and are NOT a regression signal here — they
// run successfully from the ARGIA menu in a real workbook.
//
// This rig is the Node-side counterpart of the existing
// scripts/chunk5_selftest.js, scaled up from chunk5 to the whole repo.
// =============================================================================

var fs   = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

// -----------------------------------------------------------------------------
// 1) Apps Script global stubs
// -----------------------------------------------------------------------------

global.SpreadsheetApp = {
  BorderStyle: { SOLID:'SOLID', SOLID_MEDIUM:'SOLID_MEDIUM', SOLID_THICK:'SOLID_THICK', DOTTED:'DOTTED', DASHED:'DASHED' },
  WrapStrategy: { OVERFLOW:'OVERFLOW', CLIP:'CLIP', WRAP:'WRAP' },
  DataValidationCriteria: { VALUE_IN_LIST: 'VALUE_IN_LIST' },
  getActive: function() { return null; },
  getActiveSpreadsheet: function() { return null; },
  flush: function() {},
  newDataValidation: function() {
    var rule = {
      _options: null, _allowInvalid: true, _criteria: null,
      requireValueInList: function(opts, _show) {
        rule._options = opts; rule._criteria = 'VALUE_IN_LIST'; return rule;
      },
      setAllowInvalid: function(v) { rule._allowInvalid = v; return rule; },
      build: function() {
        return {
          _options: rule._options,
          _allowInvalid: rule._allowInvalid,
          getCriteriaType: function() { return rule._criteria; },
          getCriteriaValues: function() { return [rule._options]; }
        };
      }
    };
    return rule;
  },
  newCellImage: function() {
    var img = {
      _src:'', _alt:'',
      setSourceUrl: function(u){ img._src=u; return img; },
      setAltTextTitle: function(t){ img._alt=t; return img; },
      build: function(){ return { _src: img._src, _alt: img._alt }; }
    };
    return img;
  },
  newRichTextValue: function() {
    var v = { _text:'',
      setText: function(t){ v._text=t; return v; },
      setTextStyle: function(){ return v; },
      build: function(){ return { getText: function(){ return v._text; } }; } };
    return v;
  },
  newTextStyle: function() {
    var s = { setBold: function(){return s;}, setFontFamily: function(){return s;},
              setForegroundColor: function(){return s;}, setFontSize: function(){return s;},
              build: function(){ return {}; } };
    return s;
  }
};

global.Browser = { msgBox: function(){}, MsgType: { OK:1 } };
global.Utilities = {
  formatDate: function(d){ return String(d); },
  formatString: function(fmt) {
    var args = Array.prototype.slice.call(arguments, 1);
    return fmt.replace(/%s/g, function(){ return args.shift(); });
  },
  base64Encode: function(){ return 'b64'; },
  sleep: function(){}
};
global.Logger = { log: function(){} };
global.Session = {
  getActiveUser: function(){ return { getEmail: function(){ return 'test@argia'; } }; },
  getScriptTimeZone: function(){ return 'America/Mexico_City'; }
};
global.CacheService = {
  getScriptCache: function(){ return { get: function(){return null;}, put: function(){} }; }
};
global.DriveApp = {
  getFileById: function(){ return {
    getBlob: function(){ return { getBytes: function(){return [0];} }; },
    getName: function(){ return 'fake.png'; }
  }; }
};
global.PropertiesService = {
  getDocumentProperties: function(){
    var s = {};
    return {
      getProperty: function(k){ return s[k]||null; },
      setProperty: function(k,v){ s[k]=String(v); return this; },
      deleteProperty: function(k){ delete s[k]; return this; },
      getProperties: function(){ return Object.assign({}, s); }
    };
  }
};

global.engineLog = function() {};
global.logRunStart = function() {};
global.logRunEnd = function() {};
global.DESIGN_TOKENS_SHEET = '_DESIGN_TOKENS';
global._insertArgiaLogo = function() {};

// -----------------------------------------------------------------------------
// 2) File discovery
// -----------------------------------------------------------------------------

function listFiles(dir, exts) {
  var out = [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function(e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listFiles(p, exts));
    else if (exts.indexOf(path.extname(e.name)) !== -1) out.push(p);
  });
  return out;
}

// Source files in dependency-friendly order. 00_Main must load before files
// that reference its constants (SH, MC, PROV, MDC_ROW, BOM_ROW, BOM_COL).
var SOURCE_FILES_ORDERED = [
  '00_Main.js', '00a_Version.js',
  '01_ReadInputs.js', '01a_ReadInputsBess.js', '01b_RunBessStep.js',
  '02_LoadDB.js', '02a_DesignTokens.js', '02b_LayoutPrimitives.js',
  '02c_InputMap.js', '02d_InputIO.js', '02e_InputSetup.js',
  '02f_RepairCostRanges.js', '02g_RepairCfeSimulationTotals.js',
  '02h_RepairCfeSimulationCapacidad.js', '02i_SetupBessSimulationSteady.js',
  '03_ElecTables.js', '04_CalcDC.js', '04a_CalcCFEBill.js',
  '05_CalcAC.js', '06_CalcLayout.js', '09_Validate.js', '09b_OutputValidate.js',
  '09c_InstallCostSanity.js',         // NEW in 3.7.8 (install guardrails)
  '10_Logger.js', '11_HelioscopImport.js', '12_ExportPDF.js',
  '13_CalcInstallCost.js', '17_CalcBessSizing.js', '18_CalcBessCircuit.js',
  '19_RunBessSuggestion.js', '19b_WriteBessRecommendations.js',
  '20_CalcHourlySimulation.js', '20a_RunHourlySimulation.js',
  '21_BessPickerWiring.js', '22_CalcBessBosQuantities.js',
  '23_CalcBessVoltageDrop.js', '24_CalcBessNomChecks.js',
  '97_InputAudit.js'
];

var sourceFiles = SOURCE_FILES_ORDERED
  .map(function(n) { return path.join(ROOT, n); })
  .filter(function(p) { return fs.existsSync(p); })
  .concat(listFiles(path.join(ROOT, 'templates'),  ['.js']))
  .concat(listFiles(path.join(ROOT, 'writers_v2'), ['.js']));

var testFiles = []
  .concat(listFiles(path.join(ROOT, 'test'),                ['.gs', '.js']))
  .concat(listFiles(path.join(ROOT, 'tests_unit'),          ['.gs', '.js']))
  .concat(listFiles(path.join(ROOT, 'tests_integration'),   ['.gs', '.js']))
  .concat(listFiles(path.join(ROOT, 'tests_regression'),    ['.gs', '.js']));

// -----------------------------------------------------------------------------
// 3) Load
// -----------------------------------------------------------------------------

var loadErrors = [];
function loadFile(p) {
  var rel  = p.replace(ROOT + '/', '');
  var code = fs.readFileSync(p, 'utf8');
  try { (0, eval)(code); }
  catch (err) { loadErrors.push({ file: rel, err: err.message }); }
}
sourceFiles.forEach(loadFile);
testFiles.forEach(loadFile);

console.log('========== LOAD PHASE ==========');
console.log('Source files loaded: ' + sourceFiles.length);
console.log('Test files loaded:   ' + testFiles.length);
console.log('Load errors:         ' + loadErrors.length);
if (loadErrors.length > 0) {
  loadErrors.forEach(function(e) { console.log('  [' + e.file + '] ' + e.err); });
}

// -----------------------------------------------------------------------------
// 4) Test context (mirrors test/TestAssert.gs API surface used in tests)
// -----------------------------------------------------------------------------

function makeT(id) {
  var entries = [];

  function deepEq(e, a) {
    if (e === null || e === undefined) return e === a;
    if (typeof e === 'number' && typeof a === 'number') {
      if (Number.isNaN(e) && Number.isNaN(a)) return true;
      return e === a;
    }
    if (typeof e === 'object') {
      try { return JSON.stringify(e) === JSON.stringify(a); } catch(_) { return false; }
    }
    return String(e) === String(a);
  }
  function push(status, label, exp, act) {
    entries.push({ status: status, label: label, expected: exp, actual: act });
    return status === 'PASS';
  }

  // -------------------------------------------------------------------------
  // IMPORTANT: this object must expose EXACTLY the methods that the real
  // test/TestAssert.gs createTestContext() returns -- no more, no less.
  // If the harness defines a convenience method the real runner lacks
  // (e.g. assertNull, assertEq), a test using it passes here but throws
  // "t.X is not a function" in Apps Script. That defeats the whole point
  // of the harness. The canonical real API (TestAssert.gs:354-372) is:
  //   suite, assert, assertNear, assertThrows, assertContains, assertTrue,
  //   assertFalse, fail, assertSnapshot, expectWarning, expectNoWarning,
  //   info, error, flush, reset, _setContext
  // (flush/reset/_setContext are lifecycle no-ops here.)
  // -------------------------------------------------------------------------
  return {
    id: id,
    entries: entries,
    suite: function() {},
    info: function() {},
    error: function() { push('FAIL', 'threw', '<no throw>', 'threw'); },
    assert: function(label, exp, act, tol) {
      var ok;
      if (typeof exp === 'number' && typeof act === 'number' && typeof tol === 'number' && tol > 0) {
        ok = Math.abs(exp - act) <= tol;
      } else {
        ok = deepEq(exp, act);
      }
      return push(ok ? 'PASS' : 'FAIL', label, exp, act);
    },
    assertNear: function(label, exp, act, tol) {
      var ok = Math.abs(exp - act) <= tol;
      return push(ok ? 'PASS' : 'FAIL', label, exp, act);
    },
    assertTrue:  function(label, act) { return push(act ? 'PASS' : 'FAIL', label, 'truthy', act); },
    assertFalse: function(label, act) { return push(!act ? 'PASS' : 'FAIL', label, 'falsy',  act); },
    assertThrows: function(label, fn) {
      var ok = false; try { fn(); } catch(_) { ok = true; }
      return push(ok ? 'PASS' : 'FAIL', label, 'throws', ok);
    },
    assertContains: function(label, str, substr) {
      var ok = typeof str === 'string' && str.indexOf(substr) !== -1;
      return push(ok ? 'PASS' : 'FAIL', label, 'contains ' + substr, str);
    },
    assertSnapshot: function(label, exp, act, opts) {
      var tol = (opts && typeof opts.tolerance === 'number') ? opts.tolerance : 0;
      function chk(e, a) {
        if (typeof e === 'number' && typeof a === 'number') {
          if (tol > 0) return Math.abs(e - a) <= tol;
          return e === a;
        }
        if (e === null || a === null || typeof e !== 'object' || typeof a !== 'object') {
          return String(e) === String(a);
        }
        var ek = Object.keys(e), ak = Object.keys(a);
        if (ek.length !== ak.length) return false;
        for (var i = 0; i < ek.length; i++) {
          if (!chk(e[ek[i]], a[ek[i]])) return false;
        }
        return true;
      }
      return push(chk(exp, act) ? 'PASS' : 'FAIL', label, '<snapshot>', '<snapshot>');
    },
    expectWarning: function(label, warnings, code) {
      if (!warnings) return push('FAIL', label, code, 'no-warnings');
      if (!Array.isArray(warnings)) warnings = [warnings];
      for (var i = 0; i < warnings.length; i++) {
        var w = warnings[i];
        if (!w) continue;
        if (typeof w === 'string' && w.indexOf(code) !== -1) return push('PASS', label, code, w);
        if (w.code === code) return push('PASS', label, code, w.code);
        if (w.message && String(w.message).indexOf(code) !== -1) return push('PASS', label, code, w.message);
      }
      return push('FAIL', label, code, 'absent');
    },
    expectNoWarning: function(label, warnings, code) {
      if (!warnings) return push('PASS', label, code, 'no-warnings');
      if (!Array.isArray(warnings)) warnings = [warnings];
      for (var i = 0; i < warnings.length; i++) {
        var w = warnings[i];
        if (!w) continue;
        if (typeof w === 'string' && w.indexOf(code) !== -1) return push('FAIL', label, code, w);
        if (w.code === code) return push('FAIL', label, code, w.code);
        if (w.message && String(w.message).indexOf(code) !== -1) return push('FAIL', label, code, w.message);
      }
      return push('PASS', label, code, 'absent');
    },
    fail: function(label) { return push('FAIL', label, 'pass', 'manual-fail'); },
    flush: function() {},
    reset: function() {},
    _setContext: function() {}
  };
}

// -----------------------------------------------------------------------------
// 5) Run
// -----------------------------------------------------------------------------

var REGISTRY = (typeof TEST_REGISTRY !== 'undefined' && TEST_REGISTRY) ? TEST_REGISTRY : [];

console.log('');
console.log('========== REGISTRY ==========');
console.log('Total registered tests: ' + REGISTRY.length);
var byGroup = { unit:0, integration:0, regression:0, other:0 };
REGISTRY.forEach(function(e) { byGroup[e.group || 'other'] = (byGroup[e.group||'other']||0) + 1; });
console.log('Per group: ' + JSON.stringify(byGroup));

var results = { PASS:0, FAIL:0, ERROR:0, SKIP:0 };
var failures = [];
var integrationErrors = 0;

REGISTRY.forEach(function(entry) {
  var t = makeT(entry.id);
  try { entry.fn(t, {}); }
  catch (err) {
    results.ERROR++;
    if (entry.group === 'integration') integrationErrors++;
    failures.push({ id: entry.id, group: entry.group, module: entry.module,
                    type: 'ERROR', err: err.message });
    return;
  }
  var anyFail = false, allSkip = (t.entries.length > 0);
  t.entries.forEach(function(e) {
    if (e.status === 'FAIL') anyFail = true;
    if (e.status !== 'SKIP') allSkip = false;
  });
  if (t.entries.length === 0)    { results.PASS++; return; }
  if (allSkip)                    { results.SKIP++; return; }
  if (anyFail) {
    results.FAIL++;
    failures.push({ id: entry.id, group: entry.group, module: entry.module, type: 'FAIL',
                    assertions: t.entries.filter(function(e){ return e.status==='FAIL'; }) });
  } else {
    results.PASS++;
  }
});

console.log('');
console.log('========== RESULTS ==========');
console.log('PASS:  ' + results.PASS);
console.log('FAIL:  ' + results.FAIL);
console.log('ERROR: ' + results.ERROR + '  (of which ' + integrationErrors + ' are integration tests that need a real workbook)');
console.log('SKIP:  ' + results.SKIP);

if (failures.length > 0) {
  console.log('');
  console.log('========== FAILURES & ERRORS ==========');
  failures.slice(0, 60).forEach(function(f) {
    console.log('[' + f.type + '] ' + f.id + '  (' + f.module + ' / ' + f.group + ')');
    if (f.err) console.log('  err: ' + f.err);
    if (f.assertions) {
      f.assertions.slice(0, 3).forEach(function(a) {
        console.log('  FAIL: ' + a.label +
          '  expected=' + JSON.stringify(a.expected) +
          '  actual='   + JSON.stringify(a.actual));
      });
    }
  });
  if (failures.length > 60) console.log('... +' + (failures.length - 60) + ' more');
}

console.log('');
// Push is safe iff no FAILs and no ERRORs from real (non-workbook) unit logic.
// Some tests tagged as 'unit' actually call ctx.ss.getSheetByName(...) directly
// at the top of the test — they need a live workbook to run. These are
// indistinguishable from integration tests at runtime; we recognize them by
// the throw signature.
function _needsWorkbook(err) {
  if (!err) return false;
  return /Cannot read propert(y|ies) of (null|undefined) \(reading '(getSheetByName|insertSheet|getRange|getActiveSpreadsheet)'\)/.test(err);
}

var unitFails = failures.filter(function(f) { return f.type === 'FAIL' && f.group !== 'integration'; }).length;
var realUnitErrors = failures.filter(function(f) {
  return f.type === 'ERROR' && f.group !== 'integration' && !_needsWorkbook(f.err);
}).length;
var needsWorkbookErrors = failures.filter(function(f) {
  return f.type === 'ERROR' && _needsWorkbook(f.err);
}).length;

console.log('Breakdown:');
console.log('  Unit FAILs (must fix):                     ' + unitFails);
console.log('  Unit ERRORs (real bugs, must fix):         ' + realUnitErrors);
console.log('  Workbook-dependent test ERRORs (expected): ' + needsWorkbookErrors);

if (results.FAIL === 0 && realUnitErrors === 0) {
  console.log('');
  console.log('ALL GREEN — safe to clasp push.');
  console.log('Workbook-dependent tests (' + needsWorkbookErrors + ') will run from the');
  console.log('ARGIA menu > Setup > Run ALL Tests in the real spreadsheet.');
  process.exit(0);
} else {
  console.log('');
  console.log('NOT GREEN — fix unit FAILs (' + unitFails + ') and real unit ERRORs (' + realUnitErrors + ') before push.');
  process.exit(1);
}
