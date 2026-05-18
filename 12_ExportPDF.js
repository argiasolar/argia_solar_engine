// =============================================================================
// ARGIA ENGINE v7 -- File: 12_ExportPDF.gs
// Exports MDC, BOM, and INSTALLATION sheets as PDF files.
// Each PDF is saved to the Offer folder defined in 00_MASTERLINK!H2.
//
// EXPORT RANGES (as specified):
//   MDC          → B1:F99
//   BOM          → A1:G62
//   INSTALLATION → A1:J34
//
// FILE NAMING:
//   MDC_ProjectName_Client_YYYY-MM-DD.pdf
//   BOM_ProjectName_Client_YYYY-MM-DD.pdf
//   INSTALLATION_ProjectName_Client_YYYY-MM-DD.pdf
//
// HOW IT WORKS:
//   Google Sheets export URL is called with range and formatting parameters.
//   The PDF blob is saved directly to Google Drive via DriveApp.
//   An existing file with the same name in the same folder is overwritten.
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
// EXPORT CONFIG — range per document (0-indexed, inclusive)
// ---------------------------------------------------------------------------
var PDF_EXPORTS = {
  MDC: {
    sheet   : 'MDC',
    r1: 0, c1: 1,   // B1  (row 0-idx=0, col 0-idx=1)
    r2: 98, c2: 5,  // F99 (row 0-idx=98, col 0-idx=5)
    orient  : 'portrait',
    label   : 'MDC',
  },
  BOM: {
    sheet   : 'BOM',
    r1: 0, c1: 0,   // A1
    r2: 76, c2: 7,  // H77 (row 0-idx=76, col 0-idx=7)
    orient  : 'portrait',
    label   : 'BOM',
  },
  INSTALLATION: {
    sheet   : 'INSTALLATION',
    r1: 0, c1: 0,   // A1
    r2: 33, c2: 9,  // J34
    orient  : 'landscape',
    label   : 'INSTALLATION',
  },
};

// ---------------------------------------------------------------------------
// INTERNAL: build export URL for a given sheet + range
// ---------------------------------------------------------------------------
function _buildPdfUrl(ssId, sheetGid, cfg) {
  var isLandscape = cfg.orient === 'landscape';
  var params = [
    'format=pdf',
    'size=A4',
    'portrait=' + (isLandscape ? 'false' : 'true'),
    'fitw=true',          // fit to page width
    'fith=false',
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
    'c2=' + cfg.c2,
  ];
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
    .replace(/\s+/g, '_')            // spaces → underscores
    .substring(0, 40)                // cap length
    .replace(/_+$/g, '');            // trim trailing underscores
}

// ---------------------------------------------------------------------------
// INTERNAL: core export — fetches PDF blob and saves to Drive folder
// ---------------------------------------------------------------------------
function _exportSheetToPdf(ss, cfgKey, offerFolder) {
  var cfg = PDF_EXPORTS[cfgKey];

  // Get sheet
  var sheet = ss.getSheetByName(cfg.sheet);
  if (!sheet) throw new Error('Sheet not found: ' + cfg.sheet);

  // Build filename
  var meta   = _getProjectMeta(ss);
  var date   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var fname  = [
    cfg.label,
    _safeFileName(meta.project),
    _safeFileName(meta.client),
    date,
  ].join('_') + '.pdf';

  // Fetch PDF from Google's export endpoint
  var url  = _buildPdfUrl(ss.getId(), sheet.getSheetId(), cfg);
  var resp = UrlFetchApp.fetch(url, {
    headers    : { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error(
      'PDF export failed for ' + cfg.sheet +
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
    cfg.label + ' → ' + fname + ' (' +
    Math.round(blob.getBytes().length / 1024) + ' KB) — ' +
    file.getUrl());

  return { name: fname, url: file.getUrl() };
}

// ---------------------------------------------------------------------------
// PUBLIC: Export a single document — called by each menu item
// ---------------------------------------------------------------------------
function _runExport(cfgKey) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();

  try {
    var offerFolder = getOutputFolder_(ss);
    var res         = _exportSheetToPdf(ss, cfgKey, offerFolder);

    ui.alert(
      '✅  ' + cfgKey + ' exported',
      'File saved to: ' + offerFolder.getName() + '\n\n' + res.name + '\n\n' + res.url,
      ui.ButtonSet.OK
    );
  } catch (e) {
    engineLog(ss, 'ExportPDF', 'ERROR', cfgKey + ': ' + e.message);
    ui.alert('Export Error — ' + cfgKey, e.message, ui.ButtonSet.OK);
  }
}

// ---------------------------------------------------------------------------
// PUBLIC ENTRY POINTS (called from menu)
// ---------------------------------------------------------------------------
function exportMDC()          { _runExport('MDC');          }
function exportBOM()          { _runExport('BOM');          }
function exportInstallation() { _runExport('INSTALLATION'); }

// ---------------------------------------------------------------------------
// Export all three in one go
// ---------------------------------------------------------------------------
function exportAll() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();
  var TOTAL = 5;

  try {
    _setArgiaProgress(0, TOTAL, 'Starting export\u2026');
    _showArgiaProgress('ARGIA \u2014 Export All');

    SpreadsheetApp.flush();
    Utilities.sleep(500);
    var offerFolder = getOutputFolder_(ss);
    var results = [];

    // MDC
    _setArgiaProgress(1, TOTAL, 'Exporting MDC\u2026');
    try {
      var r = _exportSheetToPdf(ss, 'MDC', offerFolder);
      results.push('\u2705  ' + r.name);
    } catch (e) {
      results.push('\u274C  MDC: ' + e.message);
      engineLog(ss, 'ExportPDF', 'ERROR', 'MDC: ' + e.message);
    }

    // BOM
    _setArgiaProgress(2, TOTAL, 'Exporting BOM\u2026');
    try {
      var r = _exportSheetToPdf(ss, 'BOM', offerFolder);
      results.push('\u2705  ' + r.name);
    } catch (e) {
      results.push('\u274C  BOM: ' + e.message);
      engineLog(ss, 'ExportPDF', 'ERROR', 'BOM: ' + e.message);
    }

    // INSTALLATION
    _setArgiaProgress(3, TOTAL, 'Exporting Installation\u2026');
    try {
      var r = _exportSheetToPdf(ss, 'INSTALLATION', offerFolder);
      results.push('\u2705  ' + r.name);
    } catch (e) {
      results.push('\u274C  INSTALLATION: ' + e.message);
      engineLog(ss, 'ExportPDF', 'ERROR', 'INSTALLATION: ' + e.message);
    }

    // Project Card
    _setArgiaProgress(4, TOTAL, 'Exporting Project Card\u2026');
    try {
      var pcSh = ss.getSheetByName('PROJECT_CARD');
      if (pcSh) {
        var meta   = _getProjectMeta(ss);
        var date   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        var pcName = ['PC', _safeFileName(meta.project), _safeFileName(meta.client), date].join('_') + '.pdf';
        var pcUrl  = 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
          '/export?format=pdf&size=A4&portrait=true&fitw=true&gridlines=false' +
          '&printtitle=false&sheetnames=false&pagenumbers=false&fzr=false&gid=' + pcSh.getSheetId();
        var pcResp = UrlFetchApp.fetch(pcUrl, {
          headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
          muteHttpExceptions: true,
        });
        if (pcResp.getResponseCode() === 200) {
          var pcBlob = pcResp.getBlob().setName(pcName);
          var ex = offerFolder.getFilesByName(pcName);
          while (ex.hasNext()) ex.next().setTrashed(true);
          offerFolder.createFile(pcBlob);
          results.push('\u2705  ' + pcName);
        } else {
          results.push('\u274C  Project Card: HTTP ' + pcResp.getResponseCode());
        }
      } else {
        results.push('\u26A0  Project Card: sheet not found \u2014 run Generate Project Card first');
      }
    } catch (e) {
      results.push('\u274C  Project Card: ' + e.message);
    }

    _setArgiaProgress(TOTAL, TOTAL, '\u2705 Done!');
    Utilities.sleep(1200);

    ui.alert(
      'Export All \u2014 Complete',
      results.join('\n') + '\n\nFolder: ' + offerFolder.getName(),
      ui.ButtonSet.OK
    );
  } catch (e) {
    try { _setArgiaProgress(5, 5, '\u274C Error'); } catch(_) {}
    engineLog(ss, 'ExportPDF', 'ERROR', 'exportAll: ' + e.message);
    ui.alert('Export Error', e.message, ui.ButtonSet.OK);
  }
}
