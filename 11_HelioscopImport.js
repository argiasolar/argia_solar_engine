// =============================================================================
// ARGIA ENGINE v7 -- File: 11_HelioscopeImport.gs
// Reads a Helioscope Annual Production Report from Google Drive and
// auto-fills INPUT_DESIGN tab.
//
// FOLDER CONFIGURATION (read from 00_MASTERLINK):
//   I2 = Helioscope folder  -- where PDFs are stored AND where Helioscope.png is saved
//   (H2 = Offer folder, used only by 30_ArgiaKicker.gs)
//
// SUPPORTED FILE FORMATS:
//   FORMAT A -- ZIP-PDF (older Helioscope export):
//     A .pdf file that is actually a ZIP containing manifest.json + N.txt pages.
//   FORMAT B -- Real PDF (current Helioscope export):
//     Drive.Files.copy( convert:true ) -> Google Doc -> getText()
//
// FIELD MAPPING:
//   INPUT_DESIGN rows 6-17 : GHI, POA, Shaded, Nameplate, Grid (12 months)
//   INPUT_DESIGN G18       : Total annual production kWh
//   INPUT_DESIGN row 22    : Panel model, qty, Wp
//   INPUT_DESIGN rows 27-31: Inverter types, qty, kW
//   INPUT_DESIGN D30       : Total strings
//   INPUT_DESIGN F30       : Modules per string
//   INPUT_DESIGN M32       : Row pitch
//   INPUT_DESIGN M39       : Project type (ROOF/GROUND/CARPORT)
// =============================================================================

var HELIO_IMAGE_NAME = 'Helioscope.png';

var MONTH_MAP_H = {
  'January':1,'February':2,'March':3,'April':4,'May':5,'June':6,
  'July':7,'August':8,'September':9,'October':10,'November':11,'December':12
};
var MONTH_ABBR_H = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

// =============================================================================
// ENTRY POINT
// =============================================================================
function importHelioscopePdf() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var TOTAL = 7;

  try {
    _setArgiaProgress(0, TOTAL, 'Starting\u2026');
    _showArgiaProgress('ARGIA \u2014 Helioscope Import');
    engineLog(ss, 'HelioImport', 'START', 'Helioscope import started');

    _setArgiaProgress(1, TOTAL, 'Finding Helioscope PDF\u2026');
    var folders = getMasterLinkFolderIds(ss);
    var helioFolder = DriveApp.getFolderById(folders.helioFolderId);
    var file = findHelioscopePdfInFolder(helioFolder);
    if (!file) {
      _setArgiaProgress(TOTAL, TOTAL, '\u274C PDF not found');
      ui.alert('Helioscope Import',
        'No Helioscope PDF found in the configured Helioscope folder.\n\n' +
        'Folder: ' + helioFolder.getName() + '\n\n' +
        'Place the Helioscope Annual Production Report (.pdf) in that folder.\n' +
        'File name must contain "helioscope", "production", or "annual" (case insensitive).',
        ui.ButtonSet.OK);
      return;
    }
    engineLog(ss, 'HelioImport', 'INFO', 'Found file: ' + file.getName());

    _setArgiaProgress(2, TOTAL, 'Extracting pages from PDF\u2026');
    var pages = extractPages(file, ss);
    if (!pages || pages.length === 0) {
      _setArgiaProgress(TOTAL, TOTAL, '\u274C Extraction failed');
      ui.alert('Helioscope Import Error',
        'Could not extract text from: ' + file.getName() + '\n\n' +
        'If this is a valid Aurora Solar / Helioscope PDF, try again in 1 minute.\n' +
        'Drive API has rate limits that can block conversions.\n\n' +
        'Check the LOGS sheet for the specific error message.',
        ui.ButtonSet.OK);
      return;
    }

    _setArgiaProgress(3, TOTAL, 'Parsing Helioscope data\u2026');
    var data = parseHelioscopeData(pages);
    engineLog(ss, 'HelioImport', 'INFO',
      'Parsed: ' + data.panelModel + ' | ' + data.totalModules + ' mods | ' +
      data.inverters.length + ' inv type(s) | ' + data.totalStrings + ' strings');

    _setArgiaProgress(4, TOTAL, 'Awaiting confirmation\u2026');
    var invList = data.inverters.map(function(inv) {
      return '  ' + inv.qty + 'x ' + inv.model + ' (' + inv.kw.toFixed(0) + 'kW)' +
        (inv.stringsIsEstimate ? ' -> ~' + inv.stringsEstimate + ' strings (est.)' : '');
    }).join('\n');
    var summary =
      'Panel: ' + data.panelModel + ' x' + data.totalModules +
        ' = ' + data.dcNameplateKw.toFixed(2) + ' kWp\n' +
      'AC: ' + data.acNameplateKw.toFixed(0) + ' kW | Ratio: ' + data.loadRatio.toFixed(2) + '\n' +
      'Annual: ' + (data.annualGwh * 1000).toFixed(1) + ' MWh\n' +
      'Strings: ' + data.totalStrings + ' | Mods/string: ' + data.modsPerString + '\n' +
      'String wire: ' + (data.stringWireName || 'N/A') + ' | ' + data.stringWireLengthM.toFixed(0) + 'm\n' +
      'Inverters (' + data.inverters.length + '):\n' + invList + '\n' +
      (data.secondaryModules && data.secondaryModules.length > 0
        ? 'Secondary panels: ' + data.secondaryModules.map(function(m){return m.model;}).join(', ') + '\n'
        : '') +
      '\nConfirm import?';
    var response = ui.alert('Helioscope Import -- Preview', summary, ui.ButtonSet.YES_NO);
    if (response !== ui.Button.YES) {
      _setArgiaProgress(TOTAL, TOTAL, 'Cancelled.');
      engineLog(ss, 'HelioImport', 'INFO', 'User cancelled.');
      return;
    }

    _setArgiaProgress(5, TOTAL, 'Writing to INPUT_DESIGN\u2026');
    var warnings = writeToInputDesign(ss, data);
    engineLog(ss, 'HelioImport', 'OK',
      'Import complete. ' + warnings.length + ' items need manual review.');

    _setArgiaProgress(6, TOTAL, 'Saving Helioscope.png\u2026');
    engineLog(ss, 'HelioImport', 'INFO',
      'Layout image target: ' + helioFolder.getName() + '/' + HELIO_IMAGE_NAME);

    _setArgiaProgress(TOTAL, TOTAL, '\u2705 Import complete!');
    Utilities.sleep(1600);

    var warnMsg = warnings.length > 0
      ? '\n\nYellow cells need manual entry:\n' +
        warnings.map(function(w) { return '  - ' + w; }).join('\n')
      : '\n\nAll auto-fillable fields populated.';
    ui.alert('Helioscope Import Complete',
      'Imported from: ' + file.getName() + warnMsg +
      '\n\nRun "Verify Inputs" before calculating.',
      ui.ButtonSet.OK);

  } catch(e) {
    try {
      _setArgiaProgress(TOTAL, TOTAL, '\u274C Error \u2014 see alert');
      engineLog(ss, 'HelioImport', 'ERROR', e.message + '\n' + e.stack);
    } catch(_) {}
    ui.alert('Helioscope Import Error', e.message, ui.ButtonSet.OK);
  }
}

// =============================================================================
// DRIVE HELPERS
// =============================================================================
function getDriveFolder(ss) {
  var parents = DriveApp.getFileById(ss.getId()).getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}

function findHelioscopePdfInFolder(folder) {
  var files      = folder.getFiles();
  var candidates = [];
  while (files.hasNext()) {
    var f    = files.next();
    // Must be a PDF — guards against picking up Helioscope.png or other non-PDF files
    // that share the same folder and match the name filter below.
    if (f.getMimeType() !== 'application/pdf') continue;
    var name = f.getName().toLowerCase();
    if (name.indexOf('helioscope') !== -1 ||
        name.indexOf('production')  !== -1 ||
        name.indexOf('annual')      !== -1) {
      candidates.push({ file: f, modified: f.getLastUpdated() });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort(function(a, b) { return b.modified - a.modified; });
  return candidates[0].file;
}

// =============================================================================
// PAGE EXTRACTION
// =============================================================================
function extractPages(driveFile, ss) {
  // FORMAT A: ZIP-PDF
  try {
    var blob     = driveFile.getBlob();
    var zipBlob  = Utilities.newBlob(blob.getBytes(), 'application/zip', driveFile.getName());
    var unzipped = Utilities.unzip(zipBlob);
    var textFiles = {};
    unzipped.forEach(function(entry) {
      var m = entry.getName().match(/^(\d+)\.txt$/);
      if (m) textFiles[parseInt(m[1])] = entry.getDataAsString('UTF-8');
    });
    var keys = Object.keys(textFiles).map(Number).sort(function(a, b) { return a - b; });
    if (keys.length > 0) {
      engineLog(ss, 'HelioImport', 'INFO', 'Format: ZIP-PDF (' + keys.length + ' pages)');
      return keys.map(function(k) { return textFiles[k]; });
    }
  } catch(zipErr) {}

  // FORMAT B: Real PDF via Drive conversion
  try {
    var helioFolderId;
    try {
      var _ss = ss || SpreadsheetApp.getActiveSpreadsheet();
      helioFolderId = getMasterLinkFolderIds(_ss).helioFolderId;
    } catch(e) {
      helioFolderId = driveFile.getParents().hasNext()
        ? driveFile.getParents().next().getId() : 'root';
      engineLog(ss, 'HelioImport', 'WARNING',
        'Could not read MASTERLINK I2; image saved to source folder. ' + e.message);
    }

    var resource = {
      title    : '_helio_import_tmp_' + Date.now(),
      mimeType : 'application/vnd.google-apps.document',
      parents  : [{ id: helioFolderId }]
    };
    var converted = Drive.Files.copy(resource, driveFile.getId(), { convert: true });
    var docText   = '';
    try {
      var doc  = DocumentApp.openById(converted.id);
      var body = doc.getBody();
      docText  = body.getText();
      try {
        var images = body.getImages();
        if (images.length > 0) {
          var bestBlob = null, bestSize = 0;
          for (var ii = 0; ii < images.length; ii++) {
            var imgBlob = images[ii].getBlob();
            var sz      = imgBlob.getBytes().length;
            if (sz > bestSize) { bestSize = sz; bestBlob = imgBlob; }
          }
          if (bestBlob && bestSize > 10000) {
            bestBlob.setName(HELIO_IMAGE_NAME).setContentType('image/png');
            var targetFolder = DriveApp.getFolderById(helioFolderId);
            var existing = targetFolder.getFilesByName(HELIO_IMAGE_NAME);
            while (existing.hasNext()) { existing.next().setTrashed(true); }
            targetFolder.createFile(bestBlob);
            engineLog(ss, 'HelioImport', 'OK',
              'Layout image saved: ' + HELIO_IMAGE_NAME +
              ' (' + Math.round(bestSize / 1024) + ' KB) to folder: ' + targetFolder.getName());
          } else {
            engineLog(ss, 'HelioImport', 'WARNING',
              'No suitable layout image (' + images.length + ' images, largest=' +
              Math.round(bestSize/1024) + 'KB). PDF may be image-only.');
          }
        } else {
          engineLog(ss, 'HelioImport', 'WARNING', 'No images found in converted doc.');
        }
      } catch(imgErr) {
        engineLog(ss, 'HelioImport', 'WARNING', 'Image extraction error: ' + imgErr.message);
      }
    } finally {
      try { Drive.Files.remove(converted.id); } catch(e) {}
    }
    if (docText && docText.length > 200) {
      engineLog(ss, 'HelioImport', 'INFO',
        'Format: Real PDF via Drive conversion (' + Math.round(docText.length/1000) + 'k chars)');
      return [docText];
    } else {
      engineLog(ss, 'HelioImport', 'WARNING',
        'Drive conversion returned empty text (length=' + (docText ? docText.length : 0) + '). ' +
        'PDF may be image-based or Drive quota exceeded. Try again in 1 minute.');
    }
  } catch(driveErr) {
    engineLog(ss, 'HelioImport', 'WARNING',
      'Drive API error: ' + driveErr.message + ' | ' + driveErr.stack);
    try {
      Utilities.sleep(3000);
      var helioFolderIdRetry;
      try {
        helioFolderIdRetry = getMasterLinkFolderIds(ss || SpreadsheetApp.getActiveSpreadsheet()).helioFolderId;
      } catch(e) {
        helioFolderIdRetry = driveFile.getParents().hasNext()
          ? driveFile.getParents().next().getId() : 'root';
      }
      var converted2 = Drive.Files.copy({
        title   : '_helio_retry_' + Date.now(),
        mimeType: 'application/vnd.google-apps.document',
        parents : [{ id: helioFolderIdRetry }]
      }, driveFile.getId(), { convert: true });
      var docText2 = '';
      try {
        docText2 = DocumentApp.openById(converted2.id).getBody().getText();
      } finally {
        try { Drive.Files.remove(converted2.id); } catch(e) {}
      }
      if (docText2 && docText2.length > 200) {
        engineLog(ss, 'HelioImport', 'INFO',
          'Retry success (' + Math.round(docText2.length/1000) + 'k chars)');
        return [docText2];
      }
    } catch(retryErr) {
      engineLog(ss, 'HelioImport', 'WARNING', 'Retry also failed: ' + retryErr.message);
    }
  }
  return null;
}

// =============================================================================
// PARSE
// =============================================================================
function parseHelioscopeData(pages) {
  var data = {
    projectName:0, projectAddress:'', designerName:'', designerEmail:'',
    stringWireName:'', stringWireLengthM:0,
    dcNameplateKw:0, acNameplateKw:0, loadRatio:0, annualGwh:0,
    monthly:[], panelBrand:'', panelModel:'', panelWp:0, totalModules:0,
    inverters:[], totalStrings:0, modsPerString:0, mixedStrings:false,
    stringNote:'', racking:'', rowPitchM:0, tiltDeg:0,
    frameSize:'', totalFrames:0, avgAmbientC:0, projectType:'ROOF',
    fieldSegments:[], secondaryModules:[],
    mixedPitch:false, mixedPitchNote:'',
    inverterOverflow:false, inverterOverflowNote:'',
  };

  var all    = pages.join('\n');
  var tlines = all.split('\n').map(function(l){ return l.trim(); });
  var flines = tlines.filter(Boolean);

  var pnM = all.match(/\bDesign\s+([A-Z][^\n]{3,80})/) ||
            all.match(/Project\s+Name\s*([^\n\r]+)/i);
  data.projectName = pnM ? pnM[1].trim() : '';

  for (var ai = 0; ai < Math.min(flines.length, 10); ai++) {
    if (flines[ai].match(/,/) && flines[ai].match(/\d{4,5}/)) {
      var rawAddr = flines[ai];
      var addrClean = rawAddr;
      if (data.projectName && rawAddr.indexOf(data.projectName) === 0) {
        addrClean = rawAddr.substring(data.projectName.length).trim();
      }
      var commaIdx = addrClean.indexOf(',');
      if (commaIdx > 0) {
        var beforeComma = addrClean.substring(0, commaIdx).trim();
        var isProjectName    = beforeComma === beforeComma.toUpperCase() && !beforeComma.match(/^\d/);
        var isDesignId       = beforeComma.match(/^\d+$/) !== null;
        var hasProjectPrefix = beforeComma.match(/^\d+\s+[A-Z]/) !== null;
        if (isProjectName || isDesignId || hasProjectPrefix) {
          addrClean = addrClean.substring(commaIdx + 1).trim();
        }
      }
      data.projectAddress = addrClean.substring(0, 150);
      break;
    }
  }
  data.streetAddress = ''; data.cityAddress = ''; data.stateAddress = '';
  if (data.projectAddress) {
    var addrParts = data.projectAddress.split(',').map(function(p){ return p.trim(); });
    if (addrParts.length >= 3) {
      var postalIdx = -1;
      for (var pi = 0; pi < addrParts.length; pi++) {
        if (addrParts[pi].match(/^\d{4,5}\b/)) { postalIdx = pi; break; }
      }
      if (postalIdx > 0) {
        data.streetAddress = addrParts.slice(0, postalIdx).join(', ');
        var postalAndCity  = addrParts[postalIdx].replace(/^\d{4,5}\s*/, '').trim();
        data.cityAddress   = postalAndCity || (addrParts[postalIdx+1] || '');
        data.stateAddress  = addrParts[addrParts.length-1];
      } else {
        data.stateAddress  = addrParts[addrParts.length-1];
        data.cityAddress   = addrParts[addrParts.length-2].replace(/\d+/g,'').trim();
        data.streetAddress = addrParts.slice(0, addrParts.length-2).join(', ');
      }
    } else if (addrParts.length === 2) {
      data.streetAddress = addrParts[0]; data.cityAddress = addrParts[1];
    } else {
      data.streetAddress = data.projectAddress;
    }
  }

  var des1   = all.match(/produced\s+by\s+([^\n\r(c)]+)/i);
  var des2   = all.match(/Prepared\s+([\w][\w\s\.]{2,40})\s*[\r\n]+\s*By\s+([\w.@+\-]+@[\w.+\-]+)/i) ||
               all.match(/Prepared\s+By\s+([\w][\w\s\.]{2,40})[\r\n]+([\w.@+\-]+@[\w.+\-]+)/i);
  var emailM = all.match(/([\w.+\-]+@[\w.+\-]+\.[a-z]{2,})/i);
  if (des2)      { data.designerName = des2[1].trim(); data.designerEmail = des2[2].trim(); }
  else if (des1) { data.designerName = des1[1].replace(/\s*$/,'').trim(); data.designerEmail = emailM ? emailM[1] : ''; }

  var dcM = all.match(/Nameplate\s*([\d,\.]+)\s*kW/i);
  if (dcM) data.dcNameplateKw = parseFloat(dcM[1].replace(/,/g,''));

  var acIdx = flines.indexOf('Inverter AC Nameplate');
  if (acIdx < 0) {
    for (var ai2=0; ai2<flines.length; ai2++) {
      if (flines[ai2].match(/Inverter\s+AC\s+Nameplate/i)) { acIdx=ai2; break; }
      if (flines[ai2].match(/Inverter\s+AC$/i))            { acIdx=ai2; break; }
    }
  }
  if (acIdx >= 0) {
    for (var aj=acIdx+1; aj<Math.min(acIdx+6,flines.length); aj++) {
      var acLM = flines[aj].match(/^([\d,\.]+)\s*kW/i);
      if (acLM) { data.acNameplateKw = parseFloat(acLM[1].replace(/,/g,'')); break; }
    }
  }
  if (!data.acNameplateKw) {
    var acFallback = all.match(/Inverter\s+AC[\s\S]{0,60}?(\d{2,4}\.\d{1,2})\s*kW/i);
    if (acFallback) data.acNameplateKw = parseFloat(acFallback[1]);
  }

  var lrM = all.match(/Load\s+Ratio:\s*([\d\.]+)/i);
  if (lrM) data.loadRatio = parseFloat(lrM[1]);
  var apM = all.match(/Annual\s+Production\s*([\d,\.]+)\s*GWh/i) ||
            all.match(/Annual\s+Production([\d,\.]+)\s*GWh/i) ||
            all.match(/Production([\d,\.]+)\s*GWh/i);
  if (apM) {
    data.annualGwh = parseFloat(apM[1].replace(',',''));
  } else {
    var apMwh = all.match(/Annual\s+Production\s*([\d,\.]+)\s*MWh/i) ||
               all.match(/Production([\d,\.]+)\s*MWh/i);
    if (apMwh) data.annualGwh = parseFloat(apMwh[1].replace(',','')) / 1000;
  }

  var MNAMES = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  var MABBR  = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  for (var mi = 0; mi < tlines.length; mi++) {
    var tl = tlines[mi];
    for (var mn = 0; mn < 12; mn++) {
      if (tl.indexOf(MNAMES[mn]) !== 0) continue;
      var inlineV = tl.match(new RegExp('^' + MNAMES[mn] + '\\s+([\\d,\\.]+)'));
      var vals = inlineV ? [inlineV[1]] : [];
      for (var ji = mi + 1; ji < tlines.length && vals.length < 5; ji++) {
        var v = tlines[ji];
        if (/^[\d,\.]+$/.test(v)) vals.push(v);
        else if (v === '') continue;
        else break;
      }
      if (vals.length === 5) {
        data.monthly.push({ month:mn+1, abbr:MABBR[mn],
          ghi:parseFloat(vals[0].replace(/,/g,'')), poa:parseFloat(vals[1].replace(/,/g,'')),
          shaded:parseFloat(vals[2].replace(/,/g,'')), nameplateKwh:parseFloat(vals[3].replace(/,/g,'')),
          gridKwh:parseFloat(vals[4].replace(/,/g,'')) });
      }
      break;
    }
  }
  data.monthly.sort(function(a,b){ return a.month - b.month; });

  var ambM = all.match(/Avg\.\s+Operating\s+Ambient\s+Temp\s+([\d\.]+)/i);
  if (ambM) data.avgAmbientC = parseFloat(ambM[1]);

  // MODULE PARSING
  var qty_re2 = /^([\d,]+)\s+\(([\d,\.]+)/;
  function extractModuleFromLine(fullLine) {
    var noBrand = fullLine.replace(/^[^,]+,\s*/, '');
    noBrand = noBrand.replace(/\s*\(\d{4}\)\s*/g, ' ').trim();
    var mm = noBrand.match(/^([\w\d][\w\d\-\/\.\s]+?)\s+\((\d{3,4})W\)/i);
    if (mm) {
      var mdl = mm[1].trim().replace(/\s+\d{3,4}[Ww]\s*$/,'').trim().replace(/\s+\d{3,4}\s*$/,'').trim();
      return { model: mdl, wp: parseInt(mm[2]) };
    }
    return null;
  }

  for (var li = 0; li < flines.length; li++) {
    var fl = flines[li];
    if (fl.match(/&\s*Component|Binning|^Module\s+DC\b/i)) continue;
    if (fl.match(/^Module[A-Z0-9,]/i)) {
      var fullLine = fl.replace(/^Module/, '');
      var ext = extractModuleFromLine(fullLine);
      if (ext) {
        var mergedQtyM = fullLine.match(/\((\d{3,4})W\)([\d,]+)/);
        var qty2;
        if (mergedQtyM && mergedQtyM[2]) {
          qty2 = parseInt(mergedQtyM[2].replace(/,/g,''));
        } else {
          var qm2 = li+1 < flines.length ? flines[li+1].match(qty_re2) : null;
          qty2 = qm2 ? parseInt(qm2[1].replace(/,/g,'')) : 0;
        }
        if (!data.panelModel) {
          data.panelModel = ext.model; data.panelWp = ext.wp; data.totalModules = qty2;
        } else {
          var isDupe2 = ext.model === data.panelModel ||
            data.secondaryModules.some(function(x){return x.model===ext.model;});
          if (!isDupe2) data.secondaryModules.push({model:ext.model,wp:ext.wp,qty:qty2});
        }
        li++; continue;
      }
    }
    if (fl.trim() === 'Module') {
      var line2b = li+1<flines.length?flines[li+1]:'';
      var line3b = li+2<flines.length?flines[li+2]:'';
      var line4b = li+3<flines.length?flines[li+3]:'';
      var combined = line2b.endsWith('-') ? line2b+line3b : line2b+' '+line3b;
      var qLineb   = line4b;
      var ext2 = extractModuleFromLine(combined);
      if (ext2) {
        var qmLine = qLineb.match(qty_re2);
        var qty3   = qmLine ? parseInt(qmLine[1].replace(/,/g,'')) : 0;
        if (!data.panelModel) {
          data.panelModel = ext2.model; data.panelWp = ext2.wp; data.totalModules = qty3;
        } else {
          var isDupe3 = ext2.model===data.panelModel ||
            data.secondaryModules.some(function(x){return x.model===ext2.model;});
          if (!isDupe3) data.secondaryModules.push({model:ext2.model,wp:ext2.wp,qty:qty3});
        }
        li += 4; continue;
      }
    }
  }

  // INVERTER PARSING
  for (var li2 = 0; li2 < flines.length; li2++) {
    var line2 = flines[li2];
    // Glued single-line layout from the Drive PDF->Doc converter, e.g.
    //   "Component Name Count Inverters SE100KUS (SolarEdge)5 (500.00 kW)"
    // "Inverters" appears mid-line (prefixed by the table header) and the count
    // is glued to the brand with no space. Not anchored to start; \s* between
    // brand and qty tolerates the missing space.
    var eGlued = line2.match(/Inverters\s+([A-Z][\w\d\-\.]+(?:\s*\(\d{2,4}V\))?)\s+\(([A-Za-z][A-Za-z\s]+)\)\s*(\d+)\s*\(([\d,\.]+)\s*kW\)/i);
    if (eGlued) {
      var mdlEG=eGlued[1].trim(), qtyEG=parseInt(eGlued[3]), kwEG=parseFloat(eGlued[4].replace(/,/g,''))/qtyEG;
      if (qtyEG>0 && data.inverters.every(function(x){return x.model!==mdlEG;})) {
        data.inverters.push({model:mdlEG,qty:qtyEG,kw:kwEG,brand:eGlued[2].trim(),stringsEstimate:0,stringsIsEstimate:false});
        continue;
      }
    }
    var eInline = line2.match(/^Inverters\s+([A-Z][\w\d\-\.]+(?:\s*\(\d{2,4}V\))?)\s+\([A-Za-z][A-Za-z\s]+\)\s+(\d+)\s+\(([\d,\.]+)\s*kW\)/i);
    if (eInline) {
      var mdlEI=eInline[1].trim(), qtyEI=parseInt(eInline[2]), kwEI=parseFloat(eInline[3].replace(/,/g,''))/qtyEI;
      if (data.inverters.every(function(x){return x.model!==mdlEI;})) {
        data.inverters.push({model:mdlEI,qty:qtyEI,kw:kwEI,brand:'',stringsEstimate:0,stringsIsEstimate:false});
        continue;
      }
    }
    var eM1 = line2.match(/^Inverters\s+([A-Z][\w\d\-\.]+(?:\s*\(\d{2,4}V\))?)\s+\(([A-Za-z][A-Za-z\s]+)\)\s*$/i);
    if (eM1) {
      var mdlE1=eM1[1].trim(), nxtCtx=(flines[li2+1]||'')+' '+(flines[li2+2]||'');
      var qkE1=nxtCtx.match(/(\d+)\s+\(([\d,\.]+)\s*kW/);
      if (qkE1 && data.inverters.every(function(x){return x.model!==mdlE1;})) {
        data.inverters.push({model:mdlE1,qty:parseInt(qkE1[1]),kw:parseFloat(qkE1[2].replace(/,/g,''))/parseInt(qkE1[1]),brand:eM1[2].trim(),stringsEstimate:0,stringsIsEstimate:false});
        li2+=2; continue;
      }
    }
    var eM2 = line2.match(/^Inverters\s+([A-Z][\w\d\-\.]+)\s+\((\d{4})\)\s*$/i);
    if (eM2) {
      var mdlE2=eM2[1].trim()+'('+eM2[2]+')', skip2=1;
      if ((flines[li2+1]||'').match(/^\([A-Za-z]/)) skip2=2;
      var nxtCtx2=(flines[li2+skip2]||'')+' '+(flines[li2+skip2+1]||'');
      var qkE2=nxtCtx2.match(/(\d+)\s+\(([\d,\.]+)\s*kW/);
      if (qkE2 && data.inverters.every(function(x){return x.model!==mdlE2;})) {
        data.inverters.push({model:mdlE2,qty:parseInt(qkE2[1]),kw:parseFloat(qkE2[2].replace(/,/g,''))/parseInt(qkE2[1]),brand:'',stringsEstimate:0,stringsIsEstimate:false});
        li2+=skip2+1; continue;
      }
    }
    var drM = line2.match(/Inverters([A-Z]\w[\w\d\-\.]*(?:\s*\(\d+V?\))?)\s*$/i);
    if (drM) {
      var mdlA=drM[1].replace(/\s*\(\d+V?\)\s*$/,'').trim(), nxtA=li2+1<flines.length?flines[li2+1]:'';
      var qkA=nxtA.match(/(?:\([^\)]*\))?(\d+)\s+\(([\d,\.]+)\s*kW\)/);
      if (qkA && mdlA && data.inverters.every(function(x){return x.model!==mdlA;})) {
        data.inverters.push({model:mdlA,qty:parseInt(qkA[1]),kw:parseFloat(qkA[2].replace(/,/g,''))/parseInt(qkA[1]),brand:'',stringsEstimate:0,stringsIsEstimate:false});
        li2++; continue;
      }
    }
    if (line2.trim() === 'Inverters') {
      var mdlLine=li2+1<flines.length?flines[li2+1]:'', brLine=li2+2<flines.length?flines[li2+2]:'';
      var looksLikeModel=mdlLine.match(/[A-Z0-9][A-Z0-9\-]{3,}/i)&&!mdlLine.match(/^(Strings|Module|Component|Wiring|Field)/i);
      var skipBr=brLine.match(/^\([A-Za-z]/)?1:0;
      var cntCtx=(flines[li2+2+skipBr]||'')+' '+(flines[li2+3+skipBr]||'');
      var cntM=cntCtx.match(/^([\d,]+)\s+\(([\d,\.]+)\s*kW/);
      if (looksLikeModel && cntM) {
        var mdlB=mdlLine.replace(/\s*\(\d+V?\)\s*$/,'').trim();
        var qty4=parseInt(cntM[1].replace(/,/g,'')), kwT4=parseFloat(cntM[2].replace(/,/g,''));
        if (qty4>0 && data.inverters.every(function(x){return x.model!==mdlB;})) {
          data.inverters.push({model:mdlB,qty:qty4,kw:kwT4/qty4,brand:skipBr?brLine.replace(/[()]/g,'').trim():'',stringsEstimate:0,stringsIsEstimate:false});
          li2+=3+skipBr; continue;
        }
      }
    }
    var stdM = line2.match(/^Inverters\s+([\d,]+)\s+\(([\d,\.]+)\s*kW\)/i);
    if (stdM) {
      var qty3c=parseInt(stdM[1].replace(/,/g,'')), kwT=parseFloat(stdM[2].replace(/,/g,''));
      var prev3=li2>0?flines[li2-1]:'';
      var mdl3=prev3.replace(/\s*\(\d+V?\)\s*$/,'').replace(/\s+Wiring.*/i,'').trim();
      if (mdl3 && data.inverters.every(function(x){return x.model!==mdl3;})) {
        data.inverters.push({model:mdl3,qty:qty3c,kw:kwT/qty3c,brand:'',stringsEstimate:0,stringsIsEstimate:false});
      }
    }
  }

  // STRING WIRE
  for (var swi = 0; swi < flines.length; swi++) {
    var swLine = flines[swi];
    if (!swLine.match(/^Strings\s/i)) continue;
    var swM = swLine.match(/^Strings\s+(.+?)\s+(\d[\d,]*)\s+\(([\d,\.]+)\s*m\)/i);
    if (swM) { data.stringWireName=swM[1].trim(); data.stringWireLengthM=parseFloat(swM[3].replace(/,/g,'')); break; }
    var swName=swLine.replace(/^Strings\s+/i,'').trim();
    var swCtx=(flines[swi+1]||'')+' '+(flines[swi+2]||'');
    var swM2=swCtx.match(/(\d[\d,]*)\s+\(([\d,\.]+)\s*m\)/i);
    if (swM2 && swName) { data.stringWireName=swName; data.stringWireLengthM=parseFloat(swM2[2].replace(/,/g,'')); break; }
  }

  // TOTAL STRINGS & MODS PER STRING
  var strSizes = [];
  for (var wzi = 0; wzi < flines.length; wzi++) {
    var szM = flines[wzi].match(/\b(\d+)-(\d+)\b/);
    if (szM && flines[wzi].match(/Along|Up\s+and\s+Down/i)) strSizes.push(parseInt(szM[2]));
  }
  if (strSizes.length > 0) {
    data.modsPerString = Math.max.apply(null, strSizes);
    if (new Set(strSizes).size > 1) { data.mixedStrings=true; data.stringNote=strSizes.join(', '); }
  }
  var strCntM = all.match(/^Strings\s+[^\n]+\n([\d,]+)\s+\(/m) ||
                all.match(/Strings\s+[^\n]+?(\d+)\s+\([\d,\.]+\s*m\)/);
  if (strCntM && !data.totalStrings)
    data.totalStrings = parseInt((strCntM[1]||strCntM[2]||'0').replace(/,/g,''));

  // FIELD SEGMENTS & ROW PITCH
  var pitches=[], weightedPitch=0, totalMods4Pitch=0;
  for (var fsi = 0; fsi < flines.length; fsi++) {
    var fsL=flines[fsi];
    if (!fsL.match(/^Field Segment/i) && !fsL.match(/^Zona\s+/i)) continue;
    var searchCtx=fsL;
    for (var rki=1;rki<=5;rki++) if(fsi+rki<flines.length) searchCtx+=' '+flines[fsi+rki];
    var rkStr='';
    if (searchCtx.match(/Flush/i))           rkStr='Flush Mount';
    else if (searchCtx.match(/Fixed.Tilt/i)) rkStr='Fixed Tilt';
    else if (searchCtx.match(/Carport/i))    rkStr='Carport';
    var geoCtx='';
    for (var gi=0;gi<=7;gi++) if(fsi+gi<flines.length) geoCtx+=' '+flines[fsi+gi];
    var gM=geoCtx.match(/([\d\.]+)\s*m\s+(\d+)x(\d+)\s+(\d+)/);
    if (gM) {
      var pitch=parseFloat(gM[1]), fcols=parseInt(gM[2]), frows=parseInt(gM[3]);
      var frames=parseInt(gM[4]), mods=frames*fcols*frows;
      if (mods>0) {
        pitches.push(pitch); weightedPitch+=pitch*mods; totalMods4Pitch+=mods;
        data.fieldSegments.push({racking:rkStr,pitchM:pitch,frameSize:gM[2]+'x'+gM[3],frames:frames,modules:mods});
        if (!data.racking) data.racking=rkStr;
      }
    }
  }
  if (totalMods4Pitch > 0) {
    var avgPitch=weightedPitch/totalMods4Pitch;
    var uniquePitches=pitches.filter(function(v,i,a){return a.indexOf(v)===i;});
    data.rowPitchM=Math.round(avgPitch*10)/10;
    if (uniquePitches.length>1) {
      data.mixedPitch=true;
      data.mixedPitchNote='MIXED PITCH: '+uniquePitches.map(function(p){return 'FS='+p+'m';}).join(', ')+' -- weighted avg='+data.rowPitchM+'m';
    }
  }

  if (data.fieldSegments.some(function(f){return f.racking&&f.racking.match(/Flush/i);}))       data.projectType='ROOF';
  else if (data.fieldSegments.some(function(f){return f.racking&&f.racking.match(/Fixed/i);})) data.projectType='GROUND';

  // STRING ASSIGNMENT
  var totAC2=data.inverters.reduce(function(s,inv){return s+inv.qty*inv.kw;},0);
  data.inverters.forEach(function(inv){
    var share=totAC2>0?(inv.qty*inv.kw)/totAC2:1.0/data.inverters.length;
    inv.acShare=share; inv.stringsEstimate=Math.round(data.totalStrings*share);
    inv.stringsIsEstimate=data.inverters.length>1;
  });
  if (data.inverters.length>0 && data.totalStrings>0) {
    var esum=data.inverters.reduce(function(s,inv){return s+inv.stringsEstimate;},0);
    var rem=data.totalStrings-esum;
    if (rem!==0) {
      var maxIdx=0;
      data.inverters.forEach(function(inv,idx){ if(inv.acShare>data.inverters[maxIdx].acShare) maxIdx=idx; });
      data.inverters[maxIdx].stringsEstimate+=rem;
    }
  }
  if (data.inverters.length>5) {
    data.inverterOverflow=true;
    data.inverterOverflowNote='ATENCION: '+data.inverters.length+' tipos de inversor -- solo 5 soportados. Tipos 6+ ignorados.';
  }
  data.secondaryModules=data.secondaryModules||[];
  return data;
}

// =============================================================================
// DB MIRROR LOOKUP HELPERS
// =============================================================================
function findPanelInMirror(ss, model) {
  if (!model) return null;
  var sh=ss.getSheetByName('11M_PRODUCTS_PANELS'); if (!sh) return null;
  var data=sh.getDataRange().getValues(), headers=data[0].map(function(h){return String(h).trim();});
  var modelIdx=headers.indexOf('PANEL_MODEL');
  var idIdx=headers.indexOf('PROD_ID')>=0?headers.indexOf('PROD_ID'):headers.indexOf('PANEL_ID');
  if (modelIdx<0) return null;
  var modelUp=String(model).toUpperCase().trim();
  for (var i=1;i<data.length;i++) {
    var dbModel=String(data[i][modelIdx]||'').toUpperCase().trim();
    if (dbModel===modelUp) return {prodId:data[i][idIdx]||'',matchType:'EXACT'};
  }
  for (var j=1;j<data.length;j++) {
    var dbM=String(data[j][modelIdx]||'').toUpperCase().trim();
    if (dbM.indexOf(modelUp)>=0||modelUp.indexOf(dbM)>=0) return {prodId:data[j][idIdx]||'',matchType:'PARTIAL'};
  }
  return null;
}

function findInverterInMirror(ss, model) {
  if (!model) return null;
  var sh=ss.getSheetByName('12M_PRODUCTS_INVERTERS'); if (!sh) return null;
  var data=sh.getDataRange().getValues(), headers=data[0].map(function(h){return String(h).trim();});
  var modelIdx=headers.indexOf('INV_MODEL'), idIdx=headers.indexOf('INV_ID'), readyIdx=headers.indexOf('VALID_MDC_READY');
  if (modelIdx<0) return null;
  var modelUp=String(model).toUpperCase().trim().replace(/\s*\(\d{2,4}V\)\s*$/,'').trim();
  for (var i=1;i<data.length;i++) {
    var dbModel=String(data[i][modelIdx]||'').toUpperCase().trim();
    if (dbModel===modelUp||dbModel===modelUp.replace(/\s*\(\d+\)\s*$/,''))
      return {invId:data[i][idIdx]||'',matchType:'EXACT',mdcReady:data[i][readyIdx]||'VALID'};
  }
  for (var j=1;j<data.length;j++) {
    var dbM=String(data[j][modelIdx]||'').toUpperCase().trim();
    if (dbM.indexOf(modelUp)>=0||modelUp.indexOf(dbM)>=0)
      return {invId:data[j][idIdx]||'',matchType:'PARTIAL',mdcReady:data[j][readyIdx]||'VALID'};
  }
  return null;
}

// =============================================================================
// WRITE TO INPUT_DESIGN — new layout (Phase 2a, 2026-04-24)
//
// Writes helioscope-imported data into the new INPUT_DESIGN layout via
// writeInput() + INPUT_MAP. Old direct getRange calls by column M/D coords
// are gone.
//
// Regions the import controls (everything below is cleared + rewritten):
//   §07 HELIOSCOPE monthly block  B34:G45          range key 'helioscopeMonthly'
//   Annual production             G46              scalar 'annualKwh'
//   §08 Panel primary             C50:E50          scalars panelModel/Qty/PowerW
//   §08 Panels secondary          C51:E54          range key 'panelsSecondary'
//   §09 Inverter primary          C58:F58          scalars inverterPrimary{Model,Qty,Kw,Strings}
//   §09 Inverters secondary       C59:F62          range key 'invertersSecondary'
//   §09 Inverter totals           D63 / E63        scalars totalInverters / totalStrings
//   §10 String config             C66 / C67 / C68  scalars stringsTotal / parallelStrings / modsPerString
//   §04 GEOMETRÍA  row pitch      I14              scalar 'rowPitch'
//   §01 AMBIENTE   project type   C13              scalar 'projectType'
//
// Regions NOT touched (operator-managed engine inputs in top two-column grid):
//   §01 AMBIENTE Y TECHO (most fields, left col)
//   §02 PARÁMETROS ELÉCTRICOS (left col)
//   §03 DISTANCIAS (left col)
//   §04 GEOMETRÍA (right col, except rowPitch)
//   §05 LAYOUT OVERRIDE (right col)
//   §06 BOM CONFIG (right col)
//
// Notes (cell setNote markers for UX) are attached via coord lookup from
// INPUT_MAP. Secondary table notes use per-cell coords derived from the
// range anchor.
// =============================================================================
function writeToInputDesign(ss, data) {
  var warnings = [];
  var sh = ss.getSheetByName(SH.INPUT_DESIGN);
  if (!sh) {
    engineLog(ss, 'HelioImport', 'ERROR', 'INPUT_DESIGN tab not found');
    warnings.push('INPUT_DESIGN tab not found -- run setupInputDesign() first');
    return warnings;
  }

  // -- Helper: set a note on the cell that INPUT_MAP scalar key points at -----
  function setKeyNote(key, note) {
    try {
      var m = INPUT_MAP[key];
      if (!m || m.mode === 'range' || m.mode === 'skip') return;
      sh.getRange(m.row, m.col).setNote(note);
    } catch(e) { /* non-fatal */ }
  }

  // -- Helper: parse range A1 (e.g. 'C51:E54') into [startRow, startCol] -----
  function rangeStart(rangeA1) {
    var m = rangeA1.match(/^([A-Z]+)(\d+):/);
    if (!m) return null;
    var col = 0;
    for (var i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
    return { row: parseInt(m[2]), col: col };
  }

  // -- PRE-CLEAR: helioscope-controlled regions only ------------------------
  try {
    // Monthly data + annual total
    var monMap = INPUT_MAP.helioscopeMonthly;
    if (monMap) sh.getRange(monMap.rangeA1).clearContent().clearNote();
    var annMap = INPUT_MAP.annualKwh;
    if (annMap) sh.getRange(annMap.row, annMap.col).clearContent().clearNote();

    // Panel primary row (C50:E50) + secondary range (C51:E54)
    var panMap = INPUT_MAP.panelModel;
    if (panMap) sh.getRange(panMap.row, panMap.col, 1, 3).clearContent().clearNote();
    var panSecMap = INPUT_MAP.panelsSecondary;
    if (panSecMap) sh.getRange(panSecMap.rangeA1).clearContent().clearNote();

    // Inverter primary row (C58:F58) + secondary range (C59:F62) + totals (D63:E63)
    var invMap = INPUT_MAP.inverterPrimaryModel;
    if (invMap) sh.getRange(invMap.row, invMap.col, 1, 4).clearContent().clearNote();
    var invSecMap = INPUT_MAP.invertersSecondary;
    if (invSecMap) sh.getRange(invSecMap.rangeA1).clearContent().clearNote();
    var totMap = INPUT_MAP.totalInverters;
    if (totMap) sh.getRange(totMap.row, totMap.col, 1, 2).clearContent().clearNote();

    // String config scalars (not cleared — let helioscope overwrite directly)
    // Row pitch + project type (not cleared — overwritten below)
  } catch(clearErr) {
    engineLog(ss, 'HelioImport', 'WARNING', 'Pre-clear error: ' + clearErr.message);
  }

  // -- MONTHLY DATA (12 × 6 array: abbr, ghi, poa, shaded, nameplate, grid) --
  var months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  var monthlyArr = [];
  for (var mi = 0; mi < 12; mi++) {
    var m = data.monthly[mi] || {};
    monthlyArr.push([
      m.abbr || months[mi],
      m.ghi !== undefined ? m.ghi : 0,
      m.poa !== undefined ? m.poa : 0,
      m.shaded !== undefined ? m.shaded : 0,
      m.nameplateKwh !== undefined ? m.nameplateKwh : 0,
      m.gridKwh !== undefined ? m.gridKwh : 0
    ]);
  }
  try { writeInput(ss, 'helioscopeMonthly', monthlyArr); }
  catch(e) { engineLog(ss, 'HelioImport', 'WARNING', 'helioscopeMonthly: ' + e.message); }

  // Annual production total at G46
  try {
    writeInput(ss, 'annualKwh', Math.round(data.annualGwh * 1000000));
    setKeyNote('annualKwh', 'Annual production kWh. Source: ' + (data.annualGwh * 1000).toFixed(1) + ' MWh');
  } catch(e) { engineLog(ss, 'HelioImport', 'WARNING', 'annualKwh: ' + e.message); }

  // -- PANEL PRIMARY (row 50) ------------------------------------------------
  var panelDbMatch = findPanelInMirror(ss, data.panelModel);
  var panelNote = panelDbMatch
    ? 'DB MATCH: ' + panelDbMatch.prodId + ' (' + panelDbMatch.matchType + ')'
    : 'Panel "' + data.panelModel + '" NOT IN DB -- add to 11M_PRODUCTS_PANELS';
  if (!panelDbMatch) warnings.push('Panel "' + data.panelModel + '" -- verify matches DB exactly');
  try {
    writeInput(ss, 'panelModel', data.panelModel);
    writeInput(ss, 'panelQty', data.totalModules);
    if (data.panelWp > 0) writeInput(ss, 'panelPowerW', data.panelWp);
    setKeyNote('panelModel', panelNote);
  } catch(e) { engineLog(ss, 'HelioImport', 'WARNING', 'panel primary: ' + e.message); }

  // -- PANELS SECONDARY (4 × 3 array at C51:E54) -----------------------------
  var secPanels = (data.secondaryModules || []).slice(0, 4);
  var secPanelArr = [];
  var secPanelNotes = [];
  for (var spi = 0; spi < 4; spi++) {
    var sm = secPanels[spi];
    if (sm) {
      secPanelArr.push([sm.model || '', sm.qty > 0 ? sm.qty : '', sm.wp > 0 ? sm.wp : '']);
      var secMatch = findPanelInMirror(ss, sm.model);
      secPanelNotes.push(secMatch
        ? 'PANEL SECUNDARIO (info only). DB: ' + secMatch.prodId
        : 'PANEL SECUNDARIO NOT IN DB: ' + sm.model);
    } else {
      secPanelArr.push(['', '', '']);
      secPanelNotes.push(null);
    }
  }
  try { writeInput(ss, 'panelsSecondary', secPanelArr); }
  catch(e) { engineLog(ss, 'HelioImport', 'WARNING', 'panelsSecondary: ' + e.message); }

  // Per-cell notes on secondary panel model column (col C of C51:E54)
  try {
    var spStart = rangeStart(INPUT_MAP.panelsSecondary.rangeA1);
    secPanelNotes.forEach(function(note, idx) {
      if (note) sh.getRange(spStart.row + idx, spStart.col).setNote(note);
    });
  } catch(e) { /* non-fatal */ }

  if (secPanels.length > 0) {
    warnings.push('MULTI-PANEL PROJECT: Primario=' + data.panelModel +
      ' | Secundario(s)=' + secPanels.map(function(m){return m.model;}).join(', ') +
      '. Motor usa solo 1 tipo de panel (mayor cantidad).');
  }

  // -- INVERTERS (primary + up to 4 secondary) -------------------------------
  if (data.inverterOverflow) {
    warnings.push(data.inverterOverflowNote);
    engineLog(ss, 'HelioImport', 'WARNING', data.inverterOverflowNote);
  }
  var inverters = data.inverters || [];

  // Build an inverter DB note for each row (reused for primary + secondary)
  function inverterNoteFor(inv) {
    var invDbMatch = findInverterInMirror(ss, inv.model);
    var note = 'From Helioscope.';
    var isValid = true;
    if (invDbMatch) {
      note = 'DB MATCH: ' + invDbMatch.invId + ' (' + invDbMatch.matchType + ') | VALID_MDC_READY=' + invDbMatch.mdcReady;
      if (invDbMatch.mdcReady === 'INVALID') {
        note += ' -- LEGACY ALIAS';
        isValid = false;
      }
    } else {
      note = 'NOT IN DB: "' + inv.model + '" -- add to 12M_PRODUCTS_INVERTERS';
      isValid = false;
    }
    return { note: note, valid: isValid };
  }

  // Primary inverter at row 58
  if (inverters.length > 0) {
    var inv0 = inverters[0];
    try {
      writeInput(ss, 'inverterPrimaryModel', inv0.model);
      writeInput(ss, 'inverterPrimaryQty', inv0.qty);
      writeInput(ss, 'inverterPrimaryKw', inv0.kw);
      writeInput(ss, 'inverterPrimaryStrings', inv0.stringsEstimate);
      var inv0NoteRes = inverterNoteFor(inv0);
      setKeyNote('inverterPrimaryModel', inv0NoteRes.note);
      if (!inv0NoteRes.valid) warnings.push('Inverter "' + inv0.model + '" NOT in DB or INVALID');
      if (inv0.stringsIsEstimate) {
        warnings.push('Strings for ' + inv0.model + '=' + inv0.stringsEstimate + ' (estimated -- verify)');
      }
    } catch(e) {
      engineLog(ss, 'HelioImport', 'WARNING', 'inverter primary: ' + e.message);
      warnings.push('Primary inverter write error -- enter manually');
    }
  }

  // Secondary inverters (rows 68-71)
  var secInverters = inverters.slice(1, 5);  // up to 4
  var secInvArr = [];
  var secInvNotes = [];
  for (var ii = 0; ii < 4; ii++) {
    var inv = secInverters[ii];
    if (inv) {
      secInvArr.push([inv.model || '', inv.qty || '', inv.kw || '', inv.stringsEstimate || '']);
      var noteRes = inverterNoteFor(inv);
      secInvNotes.push(noteRes.note);
      if (!noteRes.valid) warnings.push('Inverter "' + inv.model + '" NOT in DB or INVALID');
      if (inv.stringsIsEstimate) warnings.push('Strings for ' + inv.model + '=' + inv.stringsEstimate + ' (estimated -- verify)');
    } else {
      secInvArr.push(['', '', '', '']);
      secInvNotes.push(null);
    }
  }
  try { writeInput(ss, 'invertersSecondary', secInvArr); }
  catch(e) { engineLog(ss, 'HelioImport', 'WARNING', 'invertersSecondary: ' + e.message); }

  // Per-cell notes on secondary inverter model column
  try {
    var siStart = rangeStart(INPUT_MAP.invertersSecondary.rangeA1);
    secInvNotes.forEach(function(note, idx) {
      if (note) sh.getRange(siStart.row + idx, siStart.col).setNote(note);
    });
  } catch(e) { /* non-fatal */ }

  // -- TOTALS (row 63) -------------------------------------------------------
  var totalQty = inverters.reduce(function(s, inv) { return s + (inv.qty || 0); }, 0);
  try {
    writeInput(ss, 'totalInverters', totalQty);
    writeInput(ss, 'totalStrings', data.totalStrings);
  } catch(e) { engineLog(ss, 'HelioImport', 'WARNING', 'inverter totals: ' + e.message); }

  // -- STRING CONFIG (C75, C76, C77) -----------------------------------------
  // stringsTotal mirrors totalStrings from the helioscope components table.
  // parallelStrings defaults to 1 (helioscope can't know combiner wiring zones).
  // modsPerString comes from helioscope wiring zones; only write if > 0.
  try {
    writeInput(ss, 'stringsTotal', data.totalStrings);
    setKeyNote('stringsTotal', 'Total strings from Helioscope Components table');
    writeInput(ss, 'parallelStrings', 1);
    setKeyNote('parallelStrings', 'Default parallel=1. Check wiring zones if combiners used.');
    if (data.modsPerString > 0) {
      writeInput(ss, 'modsPerString', data.modsPerString);
      var szNote = data.mixedStrings
        ? 'MIXED STRING SIZES: ' + data.stringNote + ' -- using max.'
        : 'Mods/string from Helioscope wiring zones.';
      setKeyNote('modsPerString', szNote);
      if (data.mixedStrings) warnings.push('Mixed string sizes: ' + data.stringNote);
    } else {
      warnings.push('PV/STRING: no string size data found -- enter manually at ' +
                    inputLocation('modsPerString'));
    }
  } catch(e) { engineLog(ss, 'HelioImport', 'WARNING', 'string config: ' + e.message); }

  // -- ROW PITCH (I14) -------------------------------------------------------
  try {
    writeInput(ss, 'rowPitch', data.rowPitchM);
    var pitchNote = data.mixedPitch
      ? 'MIXED PITCH: ' + data.mixedPitchNote
      : 'Row pitch from Helioscope field segments';
    setKeyNote('rowPitch', pitchNote);
    if (data.mixedPitch) warnings.push('Mixed row pitch: ' + data.mixedPitchNote);
  } catch(e) { engineLog(ss, 'HelioImport', 'WARNING', 'rowPitch: ' + e.message); }

  // -- PROJECT TYPE (C13) ----------------------------------------------------
  if (data.projectType) {
    try {
      writeInput(ss, 'projectType', data.projectType);
      setKeyNote('projectType', 'From Helioscope racking: ' + data.racking);
    } catch(e) { engineLog(ss, 'HelioImport', 'WARNING', 'projectType: ' + e.message); }
  }

  // -- MANUAL-ENTRY HINTS: sticky notes on cells that still need user input --
  // Attached only if the cell is empty, so we don't clobber a value the
  // operator already entered on a prior run.
  var MANUAL_HINTS = [
    ['minTemp',         'MIN SITE TEMP (°C): verificar para este proyecto'],
    ['maxTemp',         'MAX AMBIENT TEMP (°C): verificar para este proyecto'],
    ['roofClearanceMm', 'ROOF CLEARANCE TO CONDUIT BASE (mm): verificar para este proyecto'],
    ['distInverter',    'DISTANCE TO INVERTER (m): medir en plano'],
    ['distAcProt',      'DISTANCE TO AC PROTECTION (m): medir en plano'],
    ['distGrid',        'DISTANCE TO GRID (m): medir en plano'],
    ['availableSpace',  'AVAILABLE SPACE (m²): medir en plano']
  ];
  MANUAL_HINTS.forEach(function(h) {
    try {
      var m = INPUT_MAP[h[0]];
      if (!m) return;
      var cell = sh.getRange(m.row, m.col);
      var v = cell.getValue();
      if (v === '' || v === null || v === undefined) {
        cell.setNote(h[1]);
        warnings.push(h[1]);
      }
    } catch(e) { /* non-fatal */ }
  });

  return warnings;
}
