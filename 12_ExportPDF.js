// =============================================================================
// ARGIA ENGINE -- File: 12_ExportPDF.gs
// Exports v2 sheets (MDC_v2, BOM_v2, INSTALLATION_v2, PROJECT_CARD_v2,
// RFQ_*_v2) as PDF files to the Offer folder defined in 00_MASTER_LINK!H2.
//
// EXPORT RANGES (verified against ARGIA_ENGINE_40 sample on 2026-05-27):
//   MDC_v2              -> B1:G115  (portrait)   was legacy B1:F99
//   BOM_v2              -> A1:H94   (portrait)   was legacy A1:H77
//   INSTALLATION_v2     -> A1:J34   (landscape)  unchanged (line-item zone at
//                                                row 40+ is internal-only)
//   PROJECT_CARD_v2     -> A1:J69   (landscape)  was missing in Tier 2 cutover
//   RFQ_<cat>_v2 (x6)   -> A1:M<L>  (landscape)  end row via getLastRow()
//
// FILE NAMING:
//   <LABEL>_<ProjectName>_<Client>_<YYYY-MM-DD>.pdf
//
// HOW IT WORKS:
//   Google Sheets export URL is called with range and formatting parameters.
//   The PDF blob is saved directly to Google Drive via DriveApp.
//   An existing file with the same name in the same folder is overwritten.
//
// TIER 3 NOTES (2026-05-27):
//   - All exports point at the v2 sheets that the engine currently writes.
//     The legacy MDC / BOM / INSTALLATION / PROJECT_CARD / RFQ_* sheets are
//     stale snapshots from before the Tier 1 cutover and must NOT be exported.
//   - RFQ exports use a dynamic end row read from the sheet rather than a
//     hard-coded one, because each RFQ varies in item count (PANELES might be
//     1 row, ELECTRICO might be 24 rows).
//   - The unified PDF_EXPORTS table is the single source of truth. Adding a
//     new export only requires a new entry here and a menu item in 00_Main.js.
// =============================================================================

// ---------------------------------------------------------------------------
// SHARED FOLDER RESOLVER
// Single source of truth for all PDF exports.
// Reads 00_MASTER_LINK!H2 (EXPORTS column). Falls back to spreadsheet parent folder.
// ---------------------------------------------------------------------------
function getOutputFolder_(ss) {
  try {
    var ml = ss.getSheetByName('00_MASTER_LINK') || ss.getSheetByName('00_MASTERLINK');
    if (ml) {
      var fid = String(ml.getRange(2, 8).getValue() || '').trim();
      if (fid) return DriveApp.getFolderById(fid);
    }
  } catch(e_) {}
  // Fallback: same folder as the spreadsheet
  try {
    var parents = DriveApp.getFileById(ss.getId()).getParents();
    if (parents.hasNext()) return parents.next();
  } catch(e_) {}
  return DriveApp.getRootFolder();
}

// ---------------------------------------------------------------------------
// EXPORT CONFIG -- range per document (0-indexed, inclusive)
//
// Coordinate convention reminder: Google's export endpoint uses 0-indexed,
// inclusive r1/c1/r2/c2. So A1:H94 -> r1=0, c1=0, r2=93, c2=7.
//
// Tier 3.1 (2026-05-27): Visual review of first PDF batch surfaced two
// rendering quirks in Google's export endpoint:
//   1. Trailing-row trim: when the requested range ends with a row that
//      lands near a page boundary, the exporter silently trims the last
//      row (BOM grand total at row 94 was missing; INSTALLATION TOTAL at
//      row 34 was missing).
//   2. Trailing-col trim: similar effect on the rightmost column when fitw
//      fits tightly (INSTALLATION col J TOTAL was missing; RFQ col M Notes
//      was clipped mid-character).
// Fix: extend r2/c2 by 1-3 cells past the actual content so the trim
// affects only empty buffer cells, not real data. The buffer columns/rows
// are visually invisible (blank) so the deliverable looks unchanged.
//
// `scale` (optional, 1-4): Google PDF endpoint scaling mode.
//   1 = Normal (100%), 2 = Fit to Width, 3 = Fit to Height, 4 = Fit to Page
//   Default behaviour (no `scale` key) keeps the legacy `fitw=true&fith=false`.
//   For single-page deliverables (RFQs, PC) scale=4 forces the content onto
//   one page even when it's slightly oversize.
//
// `dynamicEndRow` (optional): when true, _exportSheetToPdf overrides r2 with
// (sheet.getLastRow() - 1) so RFQ exports follow the actual content length
// instead of a hard-coded ceiling.
// ---------------------------------------------------------------------------
var PDF_EXPORTS = {
  MDC: {
    sheet   : 'MDC_v2',
    r1: 0,  c1: 1,    // B1
    r2: 119, c2: 7,   // H120 -- content ends at G115; +5 row, +1 col buffer
    orient  : 'portrait',
    label   : 'MDC',
  },
  BOM: {
    sheet   : 'BOM_v2',
    r1: 0,  c1: 0,    // A1
    r2: 95, c2: 8,    // I96 -- content ends at H94; +2 row, +1 col buffer
    orient  : 'portrait',
    label   : 'BOM',
  },
  INSTALLATION: {
    sheet   : 'INSTALLATION_v2',
    r1: 0,  c1: 0,    // A1
    r2: 36, c2: 10,   // K37 -- content ends at J34; +3 row, +1 col buffer.
                      // Line-item zone at row 40+ stays internal (not in range).
    orient  : 'landscape',
    label   : 'INSTALLATION',
  },
  PROJECT_CARD: {
    sheet   : 'PROJECT_CARD_v2',
    r1: 0,  c1: 0,    // A1
    r2: 70, c2: 10,   // K71 -- content ends at J69; +2 row, +1 col buffer.
                      // Portrait orientation per user preference (2026-05-27).
                      // scale=2 (Fit to Width) fills the portrait page
                      // width and lets the 69-row content paginate
                      // naturally -- typically 2 pages: main content
                      // through Gross Profit on p1, docs/risks/comments/
                      // signatures and footnotes on p2.
    orient  : 'portrait',
    label   : 'PC',
    scale   : 2,
  },

  // ---- Financial deliverables (Track B) ----
  // Both use dynamicEndRow: the BaaS note / scenario block length varies with
  // term and configuration. c2: 12 = buffer column M (the widest merges --
  // disclaimers -- span cols A..L = index 11).
  CLIENT_FINANCIALS: {
    sheet   : 'CLIENT_FINANCIALS_v2',
    r1: 0,  c1: 0,    // A1
    r2: 0,  c2: 12,   // overridden at export time (dynamicEndRow)
    orient  : 'portrait',
    label   : 'FINANCIALS',
    scale   : 2,
    dynamicEndRow: true,
  },
  BAAS_PROJECTION: {
    sheet   : 'BAAS_PROJECTION_v2',
    r1: 0,  c1: 0,    // A1
    r2: 0,  c2: 12,   // overridden at export time (dynamicEndRow)
    orient  : 'landscape',   // 11-column projection table
    label   : 'BAAS',
    scale   : 2,
    dynamicEndRow: true,
  },

  // ---- RFQs (Tier 3, dynamic end row, scale=4 fit-to-page) ----
  // c2: 13 = column N (buffer column past N=M to avoid col M trim).
  // r2 is overridden at export time with sheet.getLastRow()-1.
  // scale=4 (Fit to Page) ensures supplier-facing RFQs are exactly one page,
  // no column M ("Notes") truncation.
  RFQ_PANELES: {
    sheet   : 'RFQ_PANELES_v2',
    r1: 0,  c1: 0,
    r2: 0,  c2: 13,
    orient  : 'landscape',
    label   : 'RFQ_PANELES',
    scale   : 4,
    dynamicEndRow: true,
  },
  RFQ_INVERSORES: {
    sheet   : 'RFQ_INVERSORES_v2',
    r1: 0,  c1: 0,
    r2: 0,  c2: 13,
    orient  : 'landscape',
    label   : 'RFQ_INVERSORES',
    scale   : 4,
    dynamicEndRow: true,
  },
  RFQ_ESTRUCTURA: {
    sheet   : 'RFQ_ESTRUCTURA_v2',
    r1: 0,  c1: 0,
    r2: 0,  c2: 13,
    orient  : 'landscape',
    label   : 'RFQ_ESTRUCTURA',
    scale   : 4,
    dynamicEndRow: true,
  },
  RFQ_ELECTRICO: {
    sheet   : 'RFQ_ELECTRICO_v2',
    r1: 0,  c1: 0,
    r2: 0,  c2: 13,
    orient  : 'landscape',
    label   : 'RFQ_ELECTRICO',
    scale   : 4,
    dynamicEndRow: true,
  },
  RFQ_MONITOREO: {
    sheet   : 'RFQ_MONITOREO_v2',
    r1: 0,  c1: 0,
    r2: 0,  c2: 13,
    orient  : 'landscape',
    label   : 'RFQ_MONITOREO',
    scale   : 4,
    dynamicEndRow: true,
  },
  RFQ_BESS: {
    sheet   : 'RFQ_BESS_v2',
    r1: 0,  c1: 0,
    r2: 0,  c2: 13,
    orient  : 'landscape',
    label   : 'RFQ_BESS',
    scale   : 4,
    dynamicEndRow: true,
  },
};

// Ordered list of RFQ config keys -- used by exportAllRfqs and any test
// that needs to iterate. Order matches the menu order.
var PDF_EXPORTS_RFQ_KEYS = [
  'RFQ_PANELES',
  'RFQ_INVERSORES',
  'RFQ_ESTRUCTURA',
  'RFQ_ELECTRICO',
  'RFQ_MONITOREO',
  'RFQ_BESS',
];

// ---------------------------------------------------------------------------
// INTERNAL: build export URL for a given sheet + range
//
// When cfg.scale is set (1-4), use Google's `scale=` parameter directly and
// drop fitw/fith — they conflict. Otherwise fall back to the legacy
// fitw=true/fith=false (fit to width, let height paginate naturally).
//   scale=1  Normal (100%)
//   scale=2  Fit to Width
//   scale=3  Fit to Height
//   scale=4  Fit to Page  -- shrinks both dims so content lands on 1 page
// ---------------------------------------------------------------------------
function _buildPdfUrl(ssId, sheetGid, cfg) {
  var isLandscape = cfg.orient === 'landscape';
  var params = [
    'format=pdf',
    'size=A4',
    'portrait=' + (isLandscape ? 'false' : 'true'),
  ];

  if (cfg.scale != null) {
    params.push('scale=' + cfg.scale);   // 1-4 per Google's enum
  } else {
    params.push('fitw=true');             // fit to page width
    params.push('fith=false');
  }

  params.push(
    'top_margin=0.5',
    'bottom_margin=0.5',
    'left_margin=0.5',
    'right_margin=0.5',
    'sheetnames=false',
    'printtitle=false',
    'pagenumbers=false',
    'gridlines=false',
    'fzr=false',          // don't repeat frozen rows on every page
    'gid=' + sheetGid,
    'r1=' + cfg.r1,
    'c1=' + cfg.c1,
    'r2=' + cfg.r2,
    'c2=' + cfg.c2
  );
  return 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?' + params.join('&');
}

// ---------------------------------------------------------------------------
// INTERNAL: read project name and client name for filename
// ---------------------------------------------------------------------------
function _getProjectMeta(ss) {
  try {
    var gen = ss.getSheetByName('INPUT_GENERAL');
    var proj   = gen ? String(gen.getRange(5, 3).getValue() || '').trim() : '';
    var client = gen ? String(gen.getRange(6, 3).getValue() || '').trim() : '';
    return {
      project: proj   || ss.getName(),
      client : client || 'CLIENT',
    };
  } catch (e) {
    return { project: ss.getName(), client: 'CLIENT' };
  }
}

// ---------------------------------------------------------------------------
// INTERNAL: sanitise string for use in a filename
// ---------------------------------------------------------------------------
function _safeFileName(s) {
  return String(s)
    .replace(/[\/\\:*?"<>|]/g, '')   // remove illegal chars
    .replace(/\s+/g, '_')            // spaces -> underscores
    .substring(0, 40)                // cap length
    .replace(/_+$/g, '');            // trim trailing underscores
}

// ---------------------------------------------------------------------------
// INTERNAL: core export -- fetches PDF blob and saves to Drive folder
//
// For dynamic-end-row exports (RFQs), overrides cfg.r2 with the sheet's
// actual last populated row, minus 1 (because cfg uses 0-indexed inclusive
// while getLastRow returns 1-indexed count of populated rows).
// ---------------------------------------------------------------------------
function _exportSheetToPdf(ss, cfgKey, offerFolder) {
  var cfg = PDF_EXPORTS[cfgKey];
  if (!cfg) throw new Error('Unknown PDF export key: ' + cfgKey);

  // Get sheet
  var sheet = ss.getSheetByName(cfg.sheet);
  if (!sheet) throw new Error('Sheet not found: ' + cfg.sheet);

  // Resolve dynamic end row if requested. Clone cfg so we don't mutate the
  // global table (multiple exports could race during exportAllRfqs).
  var effective = cfg;
  if (cfg.dynamicEndRow) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 1) {
      throw new Error('Sheet ' + cfg.sheet + ' is empty (getLastRow=' + lastRow + ')');
    }
    effective = {
      sheet : cfg.sheet,
      r1: cfg.r1, c1: cfg.c1,
      r2: lastRow - 1, c2: cfg.c2,
      orient: cfg.orient,
      label : cfg.label,
      scale : cfg.scale,        // preserve scale on the clone
    };
  }

  // Build filename
  var meta   = _getProjectMeta(ss);
  var date   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var fname  = [
    effective.label,
    _safeFileName(meta.project),
    _safeFileName(meta.client),
    date,
  ].join('_') + '.pdf';

  // Fetch PDF from Google's export endpoint
  var url  = _buildPdfUrl(ss.getId(), sheet.getSheetId(), effective);
  var resp = UrlFetchApp.fetch(url, {
    headers    : { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error(
      'PDF export failed for ' + effective.sheet +
      ' (HTTP ' + resp.getResponseCode() + '). ' +
      'Check sheet name and range.'
    );
  }

  var blob = resp.getBlob().setName(fname);

  // Delete existing file with same name in folder (overwrite)
  var existing = offerFolder.getFilesByName(fname);
  while (existing.hasNext()) { existing.next().setTrashed(true); }

  // Save to Drive
  var file = offerFolder.createFile(blob);
  engineLog(ss, 'ExportPDF', 'OK',
    effective.label + ' -> ' + fname + ' (' +
    Math.round(blob.getBytes().length / 1024) + ' KB) -- ' +
    file.getUrl());

  return { name: fname, url: file.getUrl() };
}

// ---------------------------------------------------------------------------
// PUBLIC: Export a single document -- called by each menu item
// ---------------------------------------------------------------------------
function _runExport(cfgKey) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();

  try {
    var offerFolder = getOutputFolder_(ss);
    var res         = _exportSheetToPdf(ss, cfgKey, offerFolder);

    ui.alert(
      '\u2705  ' + cfgKey + ' exported',
      'File saved to: ' + offerFolder.getName() + '\n\n' + res.name + '\n\n' + res.url,
      ui.ButtonSet.OK
    );
  } catch (e) {
    engineLog(ss, 'ExportPDF', 'ERROR', cfgKey + ': ' + e.message);
    ui.alert('Export Error \u2014 ' + cfgKey, e.message, ui.ButtonSet.OK);
  }
}

// ---------------------------------------------------------------------------
// PUBLIC ENTRY POINTS (called from menu)
// ---------------------------------------------------------------------------
function exportMDC()          { _runExport('MDC');          }
function exportBOM()          { _runExport('BOM');          }
function exportInstallation() { _runExport('INSTALLATION'); }
function exportProjectCard()  { _runExport('PROJECT_CARD'); }
function exportClientFinancials() { _runExport('CLIENT_FINANCIALS'); }
function exportBaasProjection()   { _runExport('BAAS_PROJECTION');   }

function exportRfqPaneles()    { _runExport('RFQ_PANELES');    }
function exportRfqInversores() { _runExport('RFQ_INVERSORES'); }
function exportRfqEstructura() { _runExport('RFQ_ESTRUCTURA'); }
function exportRfqElectrico()  { _runExport('RFQ_ELECTRICO');  }
function exportRfqMonitoreo()  { _runExport('RFQ_MONITOREO');  }
function exportRfqBess()       { _runExport('RFQ_BESS');       }

// ---------------------------------------------------------------------------
// Export the four main deliverables in one go: MDC + BOM + Installation + PC
//
// RFQs are NOT in this bundle -- they go through exportAllRfqs instead so the
// progress bar and result UI stays manageable. A user who wants everything
// would invoke exportAll then exportAllRfqs (two clicks, ~30s total).
// ---------------------------------------------------------------------------
function exportAll() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();

  var bundle = ['MDC', 'BOM', 'INSTALLATION', 'PROJECT_CARD'];
  var TOTAL  = bundle.length + 1;  // +1 for the "Starting" step

  try {
    _setArgiaProgress(0, TOTAL, 'Starting export\u2026');
    _showArgiaProgress('ARGIA \u2014 Export All');

    SpreadsheetApp.flush();
    Utilities.sleep(500);
    var offerFolder = getOutputFolder_(ss);
    var results = [];

    for (var i = 0; i < bundle.length; i++) {
      var key = bundle[i];
      _setArgiaProgress(i + 1, TOTAL, 'Exporting ' + key + '\u2026');
      try {
        var r = _exportSheetToPdf(ss, key, offerFolder);
        results.push('\u2705  ' + r.name);
      } catch (e) {
        results.push('\u274C  ' + key + ': ' + e.message);
        engineLog(ss, 'ExportPDF', 'ERROR', key + ': ' + e.message);
      }
    }

    _setArgiaProgress(TOTAL, TOTAL, '\u2705 Done!');
    Utilities.sleep(1200);

    ui.alert(
      'Export All \u2014 Complete',
      results.join('\n') + '\n\nFolder: ' + offerFolder.getName(),
      ui.ButtonSet.OK
    );
  } catch (e) {
    try { _setArgiaProgress(TOTAL, TOTAL, '\u274C Error'); } catch(_) {}
    engineLog(ss, 'ExportPDF', 'ERROR', 'exportAll: ' + e.message);
    ui.alert('Export Error', e.message, ui.ButtonSet.OK);
  }
}

// ---------------------------------------------------------------------------
// Export all 6 RFQs in one go.
//
// Each RFQ is independent (one supplier-facing PDF per category). A failure
// on one RFQ does NOT abort the others -- results are collected and reported
// at the end. Sheets that don't exist (e.g. RFQ_BESS_v2 on a PV-only project)
// are skipped with a warning, not treated as a fatal error.
// ---------------------------------------------------------------------------
function exportAllRfqs() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();

  var TOTAL = PDF_EXPORTS_RFQ_KEYS.length + 1;

  try {
    _setArgiaProgress(0, TOTAL, 'Starting RFQ export\u2026');
    _showArgiaProgress('ARGIA \u2014 Export All RFQs');

    SpreadsheetApp.flush();
    Utilities.sleep(500);
    var offerFolder = getOutputFolder_(ss);
    var results = [];

    for (var i = 0; i < PDF_EXPORTS_RFQ_KEYS.length; i++) {
      var key = PDF_EXPORTS_RFQ_KEYS[i];
      var cfg = PDF_EXPORTS[key];
      _setArgiaProgress(i + 1, TOTAL, 'Exporting ' + key + '\u2026');

      // Soft-skip if the sheet doesn't exist (e.g. PV-only project, no BESS RFQ).
      var sh = ss.getSheetByName(cfg.sheet);
      if (!sh) {
        results.push('\u26A0  ' + key + ': sheet ' + cfg.sheet + ' not found (skipped)');
        continue;
      }

      try {
        var r = _exportSheetToPdf(ss, key, offerFolder);
        results.push('\u2705  ' + r.name);
      } catch (e) {
        results.push('\u274C  ' + key + ': ' + e.message);
        engineLog(ss, 'ExportPDF', 'ERROR', key + ': ' + e.message);
      }
    }

    _setArgiaProgress(TOTAL, TOTAL, '\u2705 Done!');
    Utilities.sleep(1200);

    ui.alert(
      'Export All RFQs \u2014 Complete',
      results.join('\n') + '\n\nFolder: ' + offerFolder.getName(),
      ui.ButtonSet.OK
    );
  } catch (e) {
    try { _setArgiaProgress(TOTAL, TOTAL, '\u274C Error'); } catch(_) {}
    engineLog(ss, 'ExportPDF', 'ERROR', 'exportAllRfqs: ' + e.message);
    ui.alert('Export Error', e.message, ui.ButtonSet.OK);
  }
}
