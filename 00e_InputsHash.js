// =============================================================================
// ARGIA ENGINE -- 00e_InputsHash.js   (Batch 1 / B1.4 -- Staleness guard)
// -----------------------------------------------------------------------------
// PROBLEM
//   Outputs (MDC_v2, BOM_v2, ...) are static writes. Nothing previously told
//   the user that the INPUT_* tabs changed AFTER an output was generated, so a
//   workbook could show INPUT_PROJECT = "Project A" next to outputs computed
//   for "Project B" -- and those outputs could be exported to PDF. (Observed
//   live on 2026-06-10: Prologis inputs next to CULLIGAN outputs.)
//
// MECHANISM
//   1. computeInputsHash(ss): canonical FNV-1a hash over formulas+values of
//      the six INPUT_* tabs (formula precedence, same convention as the
//      00d snapshot). Pure core argiaHashGrids() is Node-testable.
//   2. After a successful generation, the producer stamps each tab it wrote:
//      _META key "STAMP::<sheet>" = the inputs hash it consumed
//      (engine stamps its 5 tabs; standalone runners stamp theirs).
//   3. refreshStalenessBanners(ss): any stamped+present output tab whose
//      stamp differs from the CURRENT inputs hash gets a red banner in A1.
//      Fresh tabs that carry our banner get it cleared. Tabs with no stamp
//      yet (pre-B1 outputs) are left untouched -- no false alarms on day 1.
//   4. assertExportFreshness(ss, sheetName): export-time check used by
//      12_ExportPDF to prompt before exporting a stale deliverable.
//
// _META KEY-VALUE STORE
//   stampMeta() (00a_Version.js) owns fixed rows 1-15 of _META. This module
//   stores its keys in a labelled block from row META_KV_FIRST_ROW down,
//   found by key match in column A (append if absent). Never touches rows
//   1-15. Visible + survives xlsx download, unlike PropertiesService.
//
// GOLDEN-MASTER SAFETY
//   refreshStalenessBanners writes ONLY when something must change: apply
//   banner on a genuinely stale tab, or clear OUR marker. A clean engine run
//   over fresh inputs performs zero banner writes, so CULLIGAN E2E goldens
//   are untouched.
// =============================================================================


// All deliverable tabs that participate in freshness stamping.
var ARGIA_STAMPED_TABS = [
  'MDC_v2', 'BOM_v2', 'INSTALLATION_v2', 'PROJECT_CARD_v2', 'CFE_OUTPUT_v2',
  'BAAS_PROJECTION_v2', 'CLIENT_FINANCIALS_v2',
  'RFQ_PANELES_v2', 'RFQ_INVERSORES_v2', 'RFQ_ESTRUCTURA_v2',
  'RFQ_ELECTRICO_v2', 'RFQ_MONITOREO_v2', 'RFQ_BESS_v2'
];

// Tabs the core engine (runArgiaEngine) writes in one run.
var ARGIA_ENGINE_TABS = [
  'MDC_v2', 'BOM_v2', 'INSTALLATION_v2', 'PROJECT_CARD_v2', 'CFE_OUTPUT_v2'
];

// Banner marker. Detection key for "this A1 text is OURS" -- clearing logic
// only ever clears cells that start with this exact prefix.
var ARGIA_STALE_BANNER_PREFIX = '\u26A0 DESACTUALIZADO';
var ARGIA_STALE_BANNER_TEXT =
  ARGIA_STALE_BANNER_PREFIX +
  ' \u2014 las entradas cambiaron despu\u00e9s de generar esta hoja. Regenerar antes de usar/exportar.';

// First _META row this module may use (rows 1-15 belong to stampMeta()).
var META_KV_FIRST_ROW = 17;
var META_KEY_INPUTS_HASH      = 'INPUTS_HASH';
var META_KEY_INPUTS_HASH_TIME = 'INPUTS_HASH_TIME';
var META_KEY_STAMP_PREFIX     = 'STAMP::';


// -----------------------------------------------------------------------------
// PURE CORE (Node-testable, no SpreadsheetApp)
// -----------------------------------------------------------------------------

/**
 * FNV-1a 32-bit over a string -> 8-char lowercase hex.
 * Deterministic, dependency-free, fast enough for ~1.5k cells per call.
 * @param {string} s
 * @return {string}
 */
function argiaHashString(s) {
  var h = 0x811c9dc5;
  s = String(s);
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (keeps everything in int range)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  var hex = h.toString(16);
  while (hex.length < 8) hex = '0' + hex;
  return hex;
}

/**
 * Canonical hash over a list of tab grids. Formula precedence (the formula
 * string where one exists, else the value) -- identical convention to the
 * 00d snapshot/restore, so "what restore would write" === "what we hash".
 *
 * Canonical string format (unit separators avoid 'AB'+'C' vs 'A'+'BC'
 * collisions):  tabName \x1D r \x1F c \x1F content \x1E ... per non-empty cell.
 * Empty cells are skipped so trailing blank rows/cols never change the hash.
 *
 * @param {Array<{name:string, formulas:Array<Array>, values:Array<Array>}>} grids
 * @return {string} 8-hex hash
 */
function argiaHashGrids(grids) {
  var parts = [];
  (grids || []).forEach(function (g) {
    if (!g || !g.name) return;
    var f = g.formulas || [];
    var v = g.values   || [];
    var rows = Math.max(f.length, v.length);
    for (var r = 0; r < rows; r++) {
      var fr = f[r] || [];
      var vr = v[r] || [];
      var cols = Math.max(fr.length, vr.length);
      for (var c = 0; c < cols; c++) {
        var fc = (fr[c] !== undefined && fr[c] !== null) ? fr[c] : '';
        var vc = (vr[c] !== undefined && vr[c] !== null) ? vr[c] : '';
        var content = (fc !== '') ? String(fc) : String(vc);
        if (content === '') continue;
        parts.push(g.name + '\x1D' + r + '\x1F' + c + '\x1F' + content);
      }
    }
  });
  return argiaHashString(parts.join('\x1E'));
}


// -----------------------------------------------------------------------------
// SHEET-FACING API
// -----------------------------------------------------------------------------

/**
 * Hash the CURRENT state of all six INPUT_* tabs.
 * Reuses INPUT_SNAPSHOT_TABS (00d) as the single source of which tabs count.
 * @param {Spreadsheet} ss
 * @return {string} 8-hex hash
 */
function computeInputsHash(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var grids = [];
  for (var i = 0; i < INPUT_SNAPSHOT_TABS.length; i++) {
    var name = INPUT_SNAPSHOT_TABS[i];
    var sh = ss.getSheetByName(name);
    if (!sh) continue;
    var r = Math.max(sh.getLastRow(), 1);
    var c = Math.max(sh.getLastColumn(), 1);
    grids.push({
      name: name,
      formulas: sh.getRange(1, 1, r, c).getFormulas(),
      values:   sh.getRange(1, 1, r, c).getValues()
    });
  }
  return argiaHashGrids(grids);
}


/**
 * Key-value SET in _META's labelled block (rows META_KV_FIRST_ROW+).
 * Finds the key in column A, else appends at the first free row at/after
 * META_KV_FIRST_ROW. Creates _META via stampMeta's layout if absent.
 * @param {Spreadsheet} ss
 * @param {string} key
 * @param {*} value
 */
function metaKvSet(ss, key, value) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SH_META);
  if (!sheet) {
    // Let the canonical creator build the fixed header block first.
    try { stampMeta(ss, { runType: 'engine' }); } catch (e) { /* fall through */ }
    sheet = ss.getSheetByName(SH_META);
    if (!sheet) sheet = ss.insertSheet(SH_META);
  }
  var last = Math.max(sheet.getLastRow(), META_KV_FIRST_ROW - 1);
  var targetRow = 0;
  if (last >= META_KV_FIRST_ROW) {
    var keys = sheet.getRange(META_KV_FIRST_ROW, 1,
                              last - META_KV_FIRST_ROW + 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === key) { targetRow = META_KV_FIRST_ROW + i; break; }
    }
  }
  if (!targetRow) targetRow = last + 1;
  if (targetRow < META_KV_FIRST_ROW) targetRow = META_KV_FIRST_ROW;
  sheet.getRange(targetRow, 1, 1, 2).setValues([[key, value]]);
}


/**
 * Key-value GET from _META's labelled block. Returns null when absent.
 * @param {Spreadsheet} ss
 * @param {string} key
 * @return {*|null}
 */
function metaKvGet(ss, key) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SH_META);
  if (!sheet) return null;
  var last = sheet.getLastRow();
  if (last < META_KV_FIRST_ROW) return null;
  var block = sheet.getRange(META_KV_FIRST_ROW, 1,
                             last - META_KV_FIRST_ROW + 1, 2).getValues();
  for (var i = 0; i < block.length; i++) {
    if (String(block[i][0]) === key) return block[i][1];
  }
  return null;
}


/**
 * Compute + persist the current inputs hash to _META. Returns the hash.
 * Called at the end of a successful engine run (and by standalone runners
 * via argiaStampOutputs).
 * @param {Spreadsheet} ss
 * @return {string}
 */
function recordInputsHash(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var hash = computeInputsHash(ss);
  metaKvSet(ss, META_KEY_INPUTS_HASH, hash);
  metaKvSet(ss, META_KEY_INPUTS_HASH_TIME, new Date().toISOString());
  return hash;
}


/**
 * Stamp a set of output tabs as "generated from the current inputs".
 * One call per producer: engine stamps ARGIA_ENGINE_TABS; standalone
 * runners stamp just their own tab(s). Also refreshes banners so a
 * regeneration immediately clears its own stale flag and immediately
 * flags the OTHER tabs that are now behind. NEVER throws (guarded) --
 * stamping failure must not break a generation that already succeeded.
 *
 * @param {Spreadsheet} ss
 * @param {Array<string>} sheetNames
 * @return {string|null} the hash used, or null when stamping failed
 */
function argiaStampOutputs(ss, sheetNames) {
  try {
    ss = ss || SpreadsheetApp.getActiveSpreadsheet();
    var hash = recordInputsHash(ss);
    (sheetNames || []).forEach(function (name) {
      metaKvSet(ss, META_KEY_STAMP_PREFIX + name, hash);
    });
    refreshStalenessBanners(ss);
    return hash;
  } catch (e) {
    try {
      engineLog(ss, 'Freshness', 'WARNING',
        'argiaStampOutputs failed (non-fatal): ' + e.message);
    } catch (_) {}
    return null;
  }
}


/**
 * Freshness report for every stamped tab.
 * status per tab:
 *   'FRESH'     stamp === current inputs hash
 *   'STALE'     stamp exists and differs
 *   'UNSTAMPED' tab exists but was generated before B1 (no stamp) -- unknown
 *   'ABSENT'    tab not in workbook
 * @param {Spreadsheet} ss
 * @return {{currentHash:string, tabs:Array<{name,status,stamp}>}}
 */
function getOutputFreshness(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var current = computeInputsHash(ss);
  var tabs = ARGIA_STAMPED_TABS.map(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return { name: name, status: 'ABSENT', stamp: null };
    var stamp = metaKvGet(ss, META_KEY_STAMP_PREFIX + name);
    if (stamp === null || stamp === '') {
      return { name: name, status: 'UNSTAMPED', stamp: null };
    }
    return {
      name: name,
      status: (String(stamp) === current) ? 'FRESH' : 'STALE',
      stamp: String(stamp)
    };
  });
  return { currentHash: current, tabs: tabs };
}


/**
 * Apply/clear the red A1 staleness banner across all stamped tabs.
 * Write-minimal: touches a cell ONLY to add a banner to a STALE tab or to
 * remove OUR marker from a no-longer-stale tab. UNSTAMPED tabs are never
 * touched. Safe in silent contexts (no UI). NEVER throws.
 * @param {Spreadsheet} ss
 * @return {{flagged:Array<string>, cleared:Array<string>}}
 */
function refreshStalenessBanners(ss) {
  var out = { flagged: [], cleared: [] };
  try {
    ss = ss || SpreadsheetApp.getActiveSpreadsheet();
    var report = getOutputFreshness(ss);
    report.tabs.forEach(function (t) {
      if (t.status === 'ABSENT') return;
      var sh = ss.getSheetByName(t.name);
      if (!sh) return;
      var a1 = sh.getRange(1, 1);
      var isOurs = String(a1.getValue()).indexOf(ARGIA_STALE_BANNER_PREFIX) === 0;
      try {
        if (t.status === 'STALE' && !isOurs) {
          a1.setValue(ARGIA_STALE_BANNER_TEXT)
            .setBackground('#cc0000')
            .setFontColor('#ffffff')
            .setFontWeight('bold');
          out.flagged.push(t.name);
        } else if (t.status !== 'STALE' && isOurs) {
          a1.clearContent();
          a1.setBackground(null).setFontColor(null).setFontWeight('normal');
          out.cleared.push(t.name);
        }
      } catch (cellErr) { /* fragile cell -> skip this tab */ }
    });
  } catch (e) {
    try {
      engineLog(ss, 'Freshness', 'WARNING',
        'refreshStalenessBanners failed (non-fatal): ' + e.message);
    } catch (_) {}
  }
  return out;
}


/**
 * Export-time check for one deliverable tab.
 * @param {Spreadsheet} ss
 * @param {string} sheetName
 * @return {{exportable:boolean, status:string, message:string}}
 *   exportable=false ONLY for STALE (caller decides whether to prompt
 *   through; UNSTAMPED legacy outputs export without nagging).
 */
function assertExportFreshness(ss, sheetName) {
  try {
    ss = ss || SpreadsheetApp.getActiveSpreadsheet();
    var stamp = metaKvGet(ss, META_KEY_STAMP_PREFIX + sheetName);
    if (stamp === null || stamp === '') {
      return { exportable: true, status: 'UNSTAMPED', message: '' };
    }
    var current = computeInputsHash(ss);
    if (String(stamp) === current) {
      return { exportable: true, status: 'FRESH', message: '' };
    }
    return {
      exportable: false,
      status: 'STALE',
      message: sheetName + ' fue generado con entradas que ya cambiaron.\n' +
               'Regenere el documento antes de exportar (o confirme para ' +
               'exportar la versi\u00f3n desactualizada).'
    };
  } catch (e) {
    // A freshness-check bug must never block an export.
    return { exportable: true, status: 'CHECK_FAILED', message: '' };
  }
}
