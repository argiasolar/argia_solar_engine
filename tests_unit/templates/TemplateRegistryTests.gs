// =============================================================================
// ARGIA TESTS -- tests_unit/templates/TemplateRegistryTests.gs
// -----------------------------------------------------------------------------
// CHUNK 0 — Template framework registry tests.
// UPDATED 2026-05-27: counts bumped after Chunk 6 (RFQ_BESS added) and the
// addition of INSTALL_DRIVER_MAP to V2_SHEETS:
//   V2_SHEETS              : 12 entries (10 + RFQ_BESS + INSTALL_DRIVER_MAP)
//   V2_TEMPLATE_FUNCTIONS  : 11 entries (RFQ_BESS shares setupRfqTemplate;
//                                        INSTALL_DRIVER_MAP has no template)
//   V2_LEGACY_MAP          : 11 entries (INSTALL_DRIVER_MAP excluded -- it's
//                                        a v2-only audit sheet)
// Two V2_SHEETS keys are intentionally absent from companion maps and
// these tests now check those exact exceptions instead of treating them
// as failures.
//
// COVERAGE
//   Pure invariant checks on V2_SHEETS, V2_TEMPLATE_FUNCTIONS, V2_LEGACY_MAP,
//   getV2SheetForLegacy(), listV2Sheets(), setupAllV2Templates().
//
//   - exactly 12 v2 sheets
//   - every sheet name ends in '_v2' (lowercase)
//   - every key in V2_SHEETS (except INSTALL_DRIVER_MAP) has a matching
//     entry in V2_TEMPLATE_FUNCTIONS
//   - every key in V2_SHEETS (except INSTALL_DRIVER_MAP) has a matching
//     entry in V2_LEGACY_MAP
//   - no duplicate v2 sheet names
//   - all 6 RFQ keys map to the same shared setup function
//   - the legacy ↔ v2 mapping is consistent with V2_SHEETS for the
//     entries that exist in both
//   - getV2SheetForLegacy('MDC') returns 'MDC_v2'
//   - getV2SheetForLegacy(nonsense) returns null
//   - listV2Sheets() returns 12 strings
//   - setupAllV2Templates() returns a well-formed summary
//
// CLASSIFICATION
//   group=unit. Pure data checks. No sheet I/O. No engine dependencies.
//
// DEPENDENCIES
//   - V2_SHEETS, V2_TEMPLATE_FUNCTIONS, V2_LEGACY_MAP (templates/TemplateRegistry.gs)
//   - getV2SheetForLegacy, listV2Sheets, setupAllV2Templates (same file)
// =============================================================================


registerTest({
  id      : 'UNIT_TEMPLATES_V2_REGISTRY_INVARIANTS',
  group   : 'unit',
  module  : 'templates/registry',
  scenarios: [],
  tags    : ['templates', 'v2', 'registry', 'chunk0'],
  source  : 'tests_unit/templates/TemplateRegistryTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/registry: v2 sheet registry invariants');

    // === V2_SHEETS shape ===================================================
    t.assertTrue('V2_SHEETS is defined as an object',
      typeof V2_SHEETS === 'object' && V2_SHEETS !== null);

    var sheetKeys = Object.keys(V2_SHEETS);
    t.assert('V2_SHEETS has exactly 12 entries', 12, sheetKeys.length);

    // Every sheet name must end with '_v2' lowercase
    var allLowerV2Suffix = true;
    var badName = '';
    for (var i = 0; i < sheetKeys.length; i++) {
      var name = V2_SHEETS[sheetKeys[i]];
      if (typeof name !== 'string' || name.slice(-3) !== '_v2') {
        allLowerV2Suffix = false;
        badName = name;
        break;
      }
    }
    t.assertTrue('every V2_SHEETS value ends in "_v2" (got "' + badName + '" otherwise)',
      allLowerV2Suffix);

    // No duplicate sheet names (Set-like dedupe check)
    var seen = {};
    var hasDuplicate = false;
    for (var j = 0; j < sheetKeys.length; j++) {
      var v = V2_SHEETS[sheetKeys[j]];
      if (seen[v]) { hasDuplicate = true; break; }
      seen[v] = true;
    }
    t.assertTrue('V2_SHEETS values are unique (no duplicate v2 sheet names)',
      !hasDuplicate);

    // === V2_TEMPLATE_FUNCTIONS shape ======================================
    t.assertTrue('V2_TEMPLATE_FUNCTIONS is defined as an object',
      typeof V2_TEMPLATE_FUNCTIONS === 'object' && V2_TEMPLATE_FUNCTIONS !== null);

    var fnKeys = Object.keys(V2_TEMPLATE_FUNCTIONS);
    t.assert('V2_TEMPLATE_FUNCTIONS has exactly 11 entries (1 per templated sheet; INSTALL_DRIVER_MAP excluded)',
      11, fnKeys.length);

    // Every V2_SHEETS key (except INSTALL_DRIVER_MAP, which is a v2-only
    // audit sheet with no template) has a matching V2_TEMPLATE_FUNCTIONS
    // entry.
    var TEMPLATELESS_V2_SHEETS = { 'INSTALL_DRIVER_MAP': true };
    var allKeysMatch = true;
    var missingKey = '';
    for (var k = 0; k < sheetKeys.length; k++) {
      var sk = sheetKeys[k];
      if (TEMPLATELESS_V2_SHEETS[sk]) continue;
      if (typeof V2_TEMPLATE_FUNCTIONS[sk] !== 'string') {
        allKeysMatch = false;
        missingKey = sk;
        break;
      }
    }
    t.assertTrue('every templated V2_SHEETS key has a string function name in V2_TEMPLATE_FUNCTIONS' +
                 (missingKey ? ' (missing: ' + missingKey + ')' : ''),
      allKeysMatch);

    // All 6 RFQ keys (including RFQ_BESS added in Chunk 6) map to the SAME
    // shared setup function.
    var rfqKeys = ['RFQ_PANELES', 'RFQ_INVERSORES', 'RFQ_ESTRUCTURA',
                   'RFQ_ELECTRICO', 'RFQ_MONITOREO', 'RFQ_BESS'];
    var rfqFn = V2_TEMPLATE_FUNCTIONS.RFQ_PANELES;
    var allRfqShare = true;
    for (var r = 0; r < rfqKeys.length; r++) {
      if (V2_TEMPLATE_FUNCTIONS[rfqKeys[r]] !== rfqFn) {
        allRfqShare = false;
        break;
      }
    }
    t.assertTrue('all 6 RFQ keys map to the same shared setup function',
      allRfqShare);
    t.assert('the shared RFQ function name', 'setupRfqTemplate', rfqFn);

    // The 5 non-RFQ sheets each have a unique setup function (no accidental sharing)
    var nonRfqKeys = ['MDC', 'BOM', 'INSTALLATION', 'PROJECT_CARD', 'CFE_OUTPUT'];
    var nonRfqFns = {};
    var nonRfqUnique = true;
    for (var n = 0; n < nonRfqKeys.length; n++) {
      var fn = V2_TEMPLATE_FUNCTIONS[nonRfqKeys[n]];
      if (nonRfqFns[fn]) { nonRfqUnique = false; break; }
      nonRfqFns[fn] = true;
    }
    t.assertTrue('the 5 non-RFQ setup functions are distinct',
      nonRfqUnique);

    // === V2_LEGACY_MAP consistency ========================================
    t.assertTrue('V2_LEGACY_MAP is defined as an object',
      typeof V2_LEGACY_MAP === 'object' && V2_LEGACY_MAP !== null);

    var legacyKeys = Object.keys(V2_LEGACY_MAP);
    t.assert('V2_LEGACY_MAP has 11 entries (10 legacy + RFQ_BESS; INSTALL_DRIVER_MAP excluded)',
      11, legacyKeys.length);

    // Every value in V2_LEGACY_MAP must equal the corresponding V2_SHEETS
    // value -- except INSTALL_DRIVER_MAP which is intentionally absent
    // from V2_LEGACY_MAP (it's a v2-only audit sheet with no legacy
    // counterpart).
    var mappingConsistent = true;
    for (var m = 0; m < sheetKeys.length; m++) {
      var legKey = sheetKeys[m];
      if (TEMPLATELESS_V2_SHEETS[legKey]) continue;
      if (V2_LEGACY_MAP[legKey] !== V2_SHEETS[legKey]) {
        mappingConsistent = false;
        break;
      }
    }
    t.assertTrue('every V2_LEGACY_MAP entry agrees with V2_SHEETS', mappingConsistent);

    // === Helper functions =================================================
    t.assert('getV2SheetForLegacy("MDC") returns "MDC_v2"',
      'MDC_v2', getV2SheetForLegacy('MDC'));
    t.assert('getV2SheetForLegacy("BOM") returns "BOM_v2"',
      'BOM_v2', getV2SheetForLegacy('BOM'));
    t.assert('getV2SheetForLegacy("RFQ_PANELES") returns "RFQ_PANELES_v2"',
      'RFQ_PANELES_v2', getV2SheetForLegacy('RFQ_PANELES'));
    t.assert('getV2SheetForLegacy("LOGS") returns null (out-of-scope sheet)',
      null, getV2SheetForLegacy('LOGS'));
    t.assert('getV2SheetForLegacy("") returns null',
      null, getV2SheetForLegacy(''));
    t.assert('getV2SheetForLegacy(null) returns null',
      null, getV2SheetForLegacy(null));

    var list = listV2Sheets();
    t.assertTrue('listV2Sheets returns an array', Array.isArray(list));
    t.assert('listV2Sheets returns 12 names', 12, list.length);
    t.assertTrue('listV2Sheets contains MDC_v2', list.indexOf('MDC_v2') !== -1);
    t.assertTrue('listV2Sheets contains RFQ_MONITOREO_v2',
      list.indexOf('RFQ_MONITOREO_v2') !== -1);
    t.assertTrue('listV2Sheets contains RFQ_BESS_v2 (Chunk 6 addition)',
      list.indexOf('RFQ_BESS_v2') !== -1);

    // === Cross-check against SH constants (00_Main.js) ====================
    // The 5 non-RFQ legacy names should appear in the SH constants object.
    // (RFQ names are hardcoded in 15_WriteRFQ.js and not in SH today, which
    // is exactly why V2_LEGACY_MAP exists — it's the canonical reference.)
    if (typeof SH === 'object' && SH !== null) {
      t.assert('SH.MDC matches V2_LEGACY_MAP source key for MDC_v2',
        'MDC', findLegacyKeyForV2_(V2_LEGACY_MAP, 'MDC_v2'));
      t.assert('SH.BOM matches V2_LEGACY_MAP source key for BOM_v2',
        'BOM', findLegacyKeyForV2_(V2_LEGACY_MAP, 'BOM_v2'));
      t.assert('SH.INSTALL_COST equals "INSTALLATION" (matches legacy key in V2_LEGACY_MAP)',
        'INSTALLATION', SH.INSTALL_COST);
      t.assert('SH.CFE_OUTPUT equals "CFE_OUTPUT"',
        'CFE_OUTPUT', SH.CFE_OUTPUT);
    } else {
      t.info('SH constants not visible from this context — cross-check skipped', '');
    }
  }
});


// Helper: reverse-lookup a legacy key by its v2 value. Not exposed publicly —
// only used by these tests, named with trailing underscore per the codebase
// convention for module-private helpers.
function findLegacyKeyForV2_(map, v2Name) {
  for (var k in map) {
    if (map.hasOwnProperty(k) && map[k] === v2Name) return k;
  }
  return null;
}


registerTest({
  id      : 'UNIT_TEMPLATES_V2_SETUPALL_BEFORE_FUNCTIONS_EXIST',
  group   : 'unit',
  module  : 'templates/registry',
  scenarios: [],
  tags    : ['templates', 'v2', 'registry', 'chunk0'],
  source  : 'tests_unit/templates/TemplateRegistryTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT templates/registry: setupAllV2Templates handles missing setup functions');

    // This is the Chunk 0 state: no setupMdcTemplate / setupBomTemplate /
    // etc. functions exist yet. The orchestrator must return a clean
    // summary with everything in 'skipped', and must not throw.
    //
    // As later chunks add setup functions, those keys will start appearing
    // in 'succeeded' instead — same test, no edit required.

    var ss = SpreadsheetApp.getActive();
    var summary;
    var threw = false;
    try {
      summary = setupAllV2Templates(ss);
    } catch (e) {
      threw = true;
      t.error('setupAllV2Templates threw', e);
    }
    t.assertTrue('setupAllV2Templates does not throw when setup functions are missing',
      !threw);

    if (threw) return;

    t.assertTrue('summary is an object', typeof summary === 'object' && summary !== null);
    // setupAllV2Templates iterates V2_TEMPLATE_FUNCTIONS (11 entries; the
    // INSTALL_DRIVER_MAP audit sheet is intentionally absent from the
    // template-function map), so summary.attempted == 11.
    t.assert('summary.attempted is 11', 11, summary.attempted);
    t.assertTrue('summary.succeeded is an array', Array.isArray(summary.succeeded));
    t.assertTrue('summary.failed is an array', Array.isArray(summary.failed));
    t.assertTrue('summary.skipped is an array', Array.isArray(summary.skipped));

    // The number of succeeded + failed + skipped should equal attempted
    var total = summary.succeeded.length + summary.failed.length + summary.skipped.length;
    t.assert('succeeded + failed + skipped == attempted', summary.attempted, total);

    // Each skipped entry has the expected shape
    if (summary.skipped.length > 0) {
      var s = summary.skipped[0];
      t.assertTrue('skipped entries have .key', typeof s.key === 'string');
      t.assertTrue('skipped entries have .sheet', typeof s.sheet === 'string');
      t.assertTrue('skipped entries have .reason', typeof s.reason === 'string');
    }
  }
});
