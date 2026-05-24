// =============================================================================
// ARGIA ENGINE v2 -- File: templates/TemplateRegistry.gs
// -----------------------------------------------------------------------------
// Single source of truth for the v2 output migration:
//   - Which sheets exist in v2 (10 of them, all with the _v2 suffix)
//   - Which setup function builds each sheet's template
//   - A single orchestrator (setupAllV2Templates) that calls every setup
//     function with isolated try/catch — one broken template never blocks
//     the others.
//
// WHY THIS FILE EXISTS
//   When Chunk 12 (Reset Outputs) builds the reset feature, it needs a
//   declarative list of v2 sheets and how to recreate each one. This file
//   is that list. It also lets unit tests check the migration's invariants
//   (legacy ↔ v2 name mapping, no duplicates, correct function references)
//   without scraping the codebase.
//
// LAZY INIT PATTERN
//   Same idiom as test/TestRegistry.gs line 44: Apps Script cross-file load
//   order is not strictly alphabetical. Constants are guarded so they
//   survive any load order. The setup functions themselves are looked up
//   at call time, not bound at file load time.
//
// USAGE
//   setupAllV2Templates(ss);                 // build / refresh every v2 sheet
//   V2_SHEETS.MDC;                           // -> 'MDC_v2'
//   V2_TEMPLATE_FUNCTIONS.MDC;               // -> 'setupMdcTemplate'
//   getV2SheetForLegacy('MDC');              // -> 'MDC_v2'
//
// CHUNK 0 STATE
//   This file ships before any setup function exists. Calling
//   setupAllV2Templates() right now returns an array of "function not
//   defined yet" warnings — that's expected. As each chunk lands its
//   setup function, the orchestrator picks it up automatically.
// =============================================================================


// -----------------------------------------------------------------------------
// V2_SHEETS — every v2 output sheet name. Lowercase _v2 suffix per the plan.
// Keys mirror the legacy SH constants in 00_Main.js where applicable, so
// callers can write V2_SHEETS.MDC the same way they write SH.MDC.
// -----------------------------------------------------------------------------
var V2_SHEETS = (typeof V2_SHEETS !== 'undefined' && V2_SHEETS) ? V2_SHEETS : {
  MDC            : 'MDC_v2',
  BOM            : 'BOM_v2',
  INSTALLATION   : 'INSTALLATION_v2',
  PROJECT_CARD   : 'PROJECT_CARD_v2',
  CFE_OUTPUT     : 'CFE_OUTPUT_v2',
  RFQ_PANELES    : 'RFQ_PANELES_v2',
  RFQ_INVERSORES : 'RFQ_INVERSORES_v2',
  RFQ_ESTRUCTURA : 'RFQ_ESTRUCTURA_v2',
  RFQ_ELECTRICO  : 'RFQ_ELECTRICO_v2',
  RFQ_MONITOREO  : 'RFQ_MONITOREO_v2'
};


// -----------------------------------------------------------------------------
// V2_TEMPLATE_FUNCTIONS — the name of the setup function that builds each
// sheet's template. Stored as strings, not function references, so this file
// loads cleanly even before any setup function is defined.
//
// All 5 RFQ sheets share a single setup function (setupRfqTemplate) which
// takes the sheet name as an argument. That's why RFQ_PANELES through
// RFQ_MONITOREO all map to the same string.
// -----------------------------------------------------------------------------
var V2_TEMPLATE_FUNCTIONS = (typeof V2_TEMPLATE_FUNCTIONS !== 'undefined' && V2_TEMPLATE_FUNCTIONS) ? V2_TEMPLATE_FUNCTIONS : {
  MDC            : 'setupMdcTemplate',
  BOM            : 'setupBomTemplate',
  INSTALLATION   : 'setupInstallationTemplate',
  PROJECT_CARD   : 'setupProjectCardTemplate',
  CFE_OUTPUT     : 'setupCfeOutputTemplate',
  RFQ_PANELES    : 'setupRfqTemplate',
  RFQ_INVERSORES : 'setupRfqTemplate',
  RFQ_ESTRUCTURA : 'setupRfqTemplate',
  RFQ_ELECTRICO  : 'setupRfqTemplate',
  RFQ_MONITOREO  : 'setupRfqTemplate'
};


// -----------------------------------------------------------------------------
// V2_LEGACY_MAP — legacy sheet name (from SH in 00_Main.js) -> v2 sheet name.
// Used by cutover (Chunk 11) and by unit tests that assert mapping integrity.
// Note: RFQ sheet names aren't in SH today (they're hardcoded in 15_WriteRFQ.js),
// so the RFQ entries here are the canonical reference for those legacy names.
// -----------------------------------------------------------------------------
var V2_LEGACY_MAP = (typeof V2_LEGACY_MAP !== 'undefined' && V2_LEGACY_MAP) ? V2_LEGACY_MAP : {
  'MDC'            : 'MDC_v2',
  'BOM'            : 'BOM_v2',
  'INSTALLATION'   : 'INSTALLATION_v2',
  'PROJECT_CARD'   : 'PROJECT_CARD_v2',
  'CFE_OUTPUT'     : 'CFE_OUTPUT_v2',
  'RFQ_PANELES'    : 'RFQ_PANELES_v2',
  'RFQ_INVERSORES' : 'RFQ_INVERSORES_v2',
  'RFQ_ESTRUCTURA' : 'RFQ_ESTRUCTURA_v2',
  'RFQ_ELECTRICO'  : 'RFQ_ELECTRICO_v2',
  'RFQ_MONITOREO'  : 'RFQ_MONITOREO_v2'
};


// -----------------------------------------------------------------------------
// getV2SheetForLegacy
// -----------------------------------------------------------------------------
//   Returns the v2 sheet name for a given legacy sheet name. Returns null
//   if the legacy name isn't part of the v2 migration scope (e.g. INPUT_*,
//   CFE_SIMULATION, mirrors, LOGS, _DESIGN_TOKENS — none of which migrate).
// -----------------------------------------------------------------------------
function getV2SheetForLegacy(legacyName) {
  if (!legacyName || typeof legacyName !== 'string') return null;
  return V2_LEGACY_MAP[legacyName] || null;
}


// -----------------------------------------------------------------------------
// listV2Sheets
// -----------------------------------------------------------------------------
//   Returns an array of all v2 sheet names. Used by Reset Outputs (Chunk 12)
//   to know which sheets to delete-and-recreate.
// -----------------------------------------------------------------------------
function listV2Sheets() {
  var out = [];
  for (var key in V2_SHEETS) {
    if (V2_SHEETS.hasOwnProperty(key)) out.push(V2_SHEETS[key]);
  }
  return out;
}


// -----------------------------------------------------------------------------
// setupAllV2Templates
// -----------------------------------------------------------------------------
//   Orchestrator. Calls every v2 setup function in order. Each call is
//   wrapped in try/catch so a single broken template never blocks the rest.
//
//   Returns a summary object:
//     {
//       attempted : 10,                          // sheets we tried to set up
//       succeeded : ['MDC', 'BOM', ...],         // keys from V2_SHEETS
//       failed    : [{ key, sheet, error }],     // anything that threw
//       skipped   : [{ key, sheet, reason }],    // function not defined yet
//     }
//
//   During Chunk 0 this will return a summary with all 10 in 'skipped'
//   because no setup function exists yet. That's the contract: this file
//   ships *before* any setup function and the orchestrator handles that
//   gracefully.
// -----------------------------------------------------------------------------
function setupAllV2Templates(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var summary = { attempted: 0, succeeded: [], failed: [], skipped: [] };

  // Stable iteration order matching the migration order in the plan.
  var ORDER = ['MDC', 'BOM', 'INSTALLATION', 'PROJECT_CARD', 'CFE_OUTPUT',
               'RFQ_PANELES', 'RFQ_INVERSORES', 'RFQ_ESTRUCTURA',
               'RFQ_ELECTRICO', 'RFQ_MONITOREO'];

  for (var i = 0; i < ORDER.length; i++) {
    var key = ORDER[i];
    var sheetName = V2_SHEETS[key];
    var fnName = V2_TEMPLATE_FUNCTIONS[key];
    summary.attempted++;

    // Resolve the function at call time, not at file load time. In Apps
    // Script V8, top-level `var`/`function` declarations are placed on
    // globalThis. If the function isn't defined yet, lookup returns undefined
    // rather than throwing.
    var fn = (typeof globalThis !== 'undefined' && typeof globalThis[fnName] === 'function')
      ? globalThis[fnName]
      : null;

    if (!fn) {
      summary.skipped.push({
        key    : key,
        sheet  : sheetName,
        reason : 'function ' + fnName + '() not defined yet'
      });
      continue;
    }

    try {
      // RFQ setup is parameterized by sheet name; others take only ss.
      if (fnName === 'setupRfqTemplate') {
        fn(ss, sheetName);
      } else {
        fn(ss);
      }
      summary.succeeded.push(key);
    } catch (err) {
      summary.failed.push({
        key   : key,
        sheet : sheetName,
        error : err.message
      });
    }
  }

  return summary;
}
