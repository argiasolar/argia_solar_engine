// =============================================================================
// ARGIA ENGINE v7 -- File: 15_WriteRFQ.gs
// Generates one RFQ sheet per supplier category from BOM data.
//
// Categories and their BOM row ranges (data rows only, not subtotals):
//   PANELS      rows 5-9   → sheet RFQ_PANELES
//   INVERTERS   rows 12-16 → sheet RFQ_INVERSORES
//   STRUCTURE   rows 19-21 → sheet RFQ_ESTRUCTURA
//   ELEC_BOS    rows 24-31 + 34-49 → sheet RFQ_ELECTRICO
//   MONITORING  rows 52-57 → sheet RFQ_MONITOREO
//
// Color palette (matches BOM/ProjectCard):
//   Section headers : #37474F  white text
//   TOTAL row       : #37474F  white text
//   Sub-header      : #ECEFF1  black bold
//   Alternating rows: #FFFFFF / #ECEFF1
//   Supplier cells  : #FFF9C4  (yellow - supplier fills)
//   Argia cells     : #ECEFF1  (grey  - read only)
//   Pass/fail       : #C8E6C9 / #FFCDD2
// =============================================================================

var RFQ_COLORS = {
  hdr      : '#37474F',  hdrFg  : '#FFFFFF',
  subHdr   : '#ECEFF1',  subFg  : '#000000',
  rowAlt   : '#ECEFF1',
  rowWhite : '#FFFFFF',
  supplier : '#FFF9C4',
  argia    : '#ECEFF1',
  total    : '#37474F',  totFg  : '#FFFFFF',
  green    : '#E8F5E9',
};

var RFQ_SHEETS = {
  PANELES    : 'RFQ_PANELES',
  INVERSORES : 'RFQ_INVERSORES',
  ESTRUCTURA : 'RFQ_ESTRUCTURA',
  ELECTRICO  : 'RFQ_ELECTRICO',
  MONITOREO  : 'RFQ_MONITOREO',
};

// ---------------------------------------------------------------------------
// BOM DATA READER — reads a row range from BOM, returns array of item objects
// ---------------------------------------------------------------------------
function readBomItems_(ss, rowStart, rowEnd) {
  var sh = ss.getSheetByName(SH.BOM);
  if (!sh) return [];
  var items = [];
  for (var r = rowStart; r <= rowEnd; r++) {
    var aVal = sh.getRange(r, 1).getValue();
    var bVal = sh.getRange(r, 2).getValue();
    // Item rows have a number in col A
    if (aVal !== '' && aVal !== null && !isNaN(parseFloat(aVal)) && bVal) {
      var qty      = sh.getRange(r, 3).getValue();
      var unit     = sh.getRange(r, 4).getValue();
      var priceUsd = sh.getRange(r, 5).getValue();
      var totalUsd = sh.getRange(r, 6).getValue();
      var ref      = sh.getRange(r, 8).getValue();
      items.push({
        num     : parseFloat(aVal),
        desc    : String(bVal || ''),
        qty     : qty || '',
        unit    : unit || '',
        priceUsd: parseFloat(priceUsd) || 0,
        totalUsd: parseFloat(totalUsd) || 0,
        ref     : String(ref || ''),
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// WRITE A SINGLE RFQ SHEET
// ---------------------------------------------------------------------------
function writeRfqSheet_(ss, sheetName, inp, categoryTitle, categoryCode, items, certReqs, techNotes, defaultCcy) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  sh.clearContents();
  sh.clearFormats();

  var C = RFQ_COLORS;

  // Column widths
  // A=30(#) B=240(desc) C=120(spec/model) D=60(qty) E=60(unit)
  // F=160(tech req) G=90(unit price) H=55(currency) I=90(total) J=60(lead) K=70(warranty) L=80(incoterms) M=100(notes)
  var colWidths = [30, 240, 120, 60, 60, 160, 90, 55, 90, 60, 70, 80, 100];
  colWidths.forEach(function(w, i) { sh.setColumnWidth(i+1, w); });
  sh.getRange(1, 2, 300, 1).setWrap(true);
  sh.getRange(1, 3, 300, 1).setWrap(true);
  sh.getRange(1, 6, 300, 1).setWrap(true);

  function w(r, c, val) {
    if (val !== null && val !== undefined && val !== '') sh.getRange(r, c).setValue(val);
  }
  function bg(r, c, rows, cols, color) { sh.getRange(r, c, rows, cols).setBackground(color); }
  function bold(r, c, cols) { sh.getRange(r, c, 1, cols).setFontWeight('bold'); }
  function merge(r, c, cols) { sh.getRange(r, c, 1, cols).merge(); }
  function hdr(r, txt, span) {
    merge(r, 1, span || 13);
    sh.getRange(r, 1).setValue(txt).setFontWeight('bold').setFontSize(10)
      .setBackground(C.hdr).setFontColor(C.hdrFg).setVerticalAlignment('middle');
    sh.setRowHeight(r, 24);
  }
  function numFmt(r, c, rows, cols, fmt) { sh.getRange(r, c, rows, cols).setNumberFormat(fmt); }

  var row = 1;

  // ── ROW 1: Title bar ────────────────────────────────────────────────────
  hdr(row, 'REQUEST FOR QUOTATION  —  ' + categoryTitle.toUpperCase());
  row++;

  // ── ROWS 2-5: RFQ metadata ─ label in col B (240px), value merged C-F ──
  sh.setRowHeight(row, 4); row++;  // spacer

  bg(row, 1, 1, 13, C.argia);
  sh.getRange(row, 2).setValue('FROM:').setFontWeight('bold');
  sh.getRange(row, 3, 1, 4).merge().setValue('ARGIA SOLAR  |  ' + (inp.projectManager || inp.bizManager));
  sh.getRange(row, 7).setValue('RFQ Number:').setFontWeight('bold');
  sh.getRange(row, 8, 1, 6).merge().setValue('RFQ-' + categoryCode + '-' + (inp.projectName || '').replace(/[^A-Z0-9]/gi,'').substring(0,10).toUpperCase() + '-' + new Date().getFullYear());
  row++;

  bg(row, 1, 1, 13, C.argia);
  sh.getRange(row, 2).setValue('PROJECT:').setFontWeight('bold');
  sh.getRange(row, 3, 1, 4).merge().setValue(inp.projectName + '  |  ' + inp.clientName);
  sh.getRange(row, 7).setValue('Issue date:').setFontWeight('bold');
  sh.getRange(row, 8, 1, 6).merge().setValue(Utilities.formatDate(new Date(), 'America/Monterrey', 'dd/MM/yyyy'));
  row++;

  bg(row, 1, 1, 13, C.argia);
  sh.getRange(row, 2).setValue('LOCATION:').setFontWeight('bold');
  sh.getRange(row, 3, 1, 4).merge().setValue([inp.street, inp.city, inp.state].filter(Boolean).join(', '));
  sh.getRange(row, 7).setValue('Response by:').setFontWeight('bold');
  var deadline = new Date(); deadline.setDate(deadline.getDate() + 14);
  sh.getRange(row, 8, 1, 6).merge().setValue(Utilities.formatDate(deadline, 'America/Monterrey', 'dd/MM/yyyy'))
    .setBackground('#FFCDD2').setNote('Adjust response deadline as needed');
  row++;

  bg(row, 1, 1, 13, C.argia);
  sh.getRange(row, 2).setValue('SYSTEM:').setFontWeight('bold');
  sh.getRange(row, 3, 1, 4).merge().setValue(inp.businessType + '  |  ' + (inp.panelQty || '') + ' modules  |  see BOM for full scope');
  sh.getRange(row, 7).setValue('Delivery req:').setFontWeight('bold');
  sh.getRange(row, 8, 1, 6).merge().setValue('DAP ' + (inp.city || 'site') + ', éxico');
  row++;

  sh.setRowHeight(row, 6); row++;  // spacer

  // ── Technical notes (if any) ─────────────────────────────────────────────
  if (techNotes) {
    bg(row, 1, 1, 13, '#FFF3E0');
    sh.getRange(row, 2).setValue('TECHNICAL NOTES:').setFontWeight('bold');
    sh.getRange(row, 3, 1, 11).merge().setValue(techNotes);
    row++;
    sh.setRowHeight(row, 4); row++;
  }

  // ── Column headers ───────────────────────────────────────────────────────
  bg(row, 1, 1, 13, C.subHdr);
  bold(row, 1, 13);
  sh.setRowHeight(row, 22);
  var colHdrs = ['#','Description','Model / Spec','Qty','Unit','Technical requirement',
                 'Unit price','CCY','Total','Lead wks','Warranty yrs','Incoterms','Notes'];
  colHdrs.forEach(function(h, i) { sh.getRange(row, i+1).setValue(h); });
  // Mark supplier columns yellow in header too
  bg(row, 7, 1, 7, '#F9A825'); // amber header for supplier columns
  sh.getRange(row, 7, 1, 7).setFontColor('#4E342E');
  row++;

  // Sub-header hint row
  bg(row, 7, 1, 7, C.supplier);
  sh.getRange(row, 7).setValue('← Supplier fills columns G–M →').setFontStyle('italic')
    .setFontColor('#795548').setFontSize(9);
  sh.getRange(row, 7, 1, 7).merge();
  sh.setRowHeight(row, 16);
  row++;

  // ── Item rows ────────────────────────────────────────────────────────────
  var itemStartRow = row;
  items.forEach(function(item, idx) {
    var rowBg = idx % 2 === 0 ? C.rowWhite : C.rowAlt;
    bg(row, 1, 1, 6, rowBg);    // Argia columns
    bg(row, 7, 1, 7, C.supplier); // Supplier columns

    sh.getRange(row, 1).setValue(item.num).setHorizontalAlignment('center');
    sh.getRange(row, 2).setValue(item.desc);
    sh.getRange(row, 3).setValue(item.ref || '').setFontSize(9).setFontColor('#546E7A');
    sh.getRange(row, 4).setValue(item.qty).setHorizontalAlignment('center');
    sh.getRange(row, 5).setValue(item.unit).setHorizontalAlignment('center');
    // Tech req from certReqs map if available
    var techReq = certReqs[item.num] || certReqs['*'] || '';
    sh.getRange(row, 6).setValue(techReq).setFontSize(9);

    // Supplier response columns — empty, yellow, editable
    sh.getRange(row, 7).setNote('Enter unit price in selected currency');
    sh.getRange(row, 8).setValue(defaultCcy || 'MXN').setHorizontalAlignment('center')
      .setNote('USD or MXN');
    // Total formula = Qty × Unit price
    // Total col: leave blank — supplier fills unit price, we note they should compute total
    sh.getRange(row, 9).setValue('').setNumberFormat('"$ "#,##0.00').setHorizontalAlignment('right')
      .setNote('= Qty × Unit price  (fill when pricing is complete)');
    sh.getRange(row, 10).setHorizontalAlignment('center').setNote('Lead time in weeks');
    sh.getRange(row, 11).setHorizontalAlignment('center').setNote('Warranty in years');
    sh.getRange(row, 12).setValue('DAP').setHorizontalAlignment('center')
      .setNote('DAP / CFR / EXW / DDP');
    sh.setRowHeight(row, 20);
    row++;
  });

  // ── Subtotal row ─────────────────────────────────────────────────────────
  if (items.length > 0) {
    bg(row, 1, 1, 13, C.total);
    sh.getRange(row, 1, 1, 13).setFontColor(C.totFg).setFontWeight('bold');
    sh.getRange(row, 2).setValue('SUBTOTAL ' + categoryTitle.toUpperCase());
    sh.getRange(row, 9).setValue('').setNumberFormat('"$ "#,##0.00').setFontColor(C.totFg)
      .setNote('Subtotal — fill after receiving supplier prices');
    sh.setRowHeight(row, 22);
    row++;
  }

  sh.setRowHeight(row, 6); row++;  // spacer

  // ── Commercial terms section ─────────────────────────────────────────────
  hdr(row, 'COMMERCIAL TERMS REQUESTED BY ARGIA SOLAR'); row++;

  bg(row, 1, 1, 13, C.argia);
  sh.getRange(row, 2).setValue('Payment terms:').setFontWeight('bold');
  sh.getRange(row, 3, 1, 11).merge().setValue('50% advance on Purchase Order, 50% on delivery and commissioning sign-off');
  row++;

  bg(row, 1, 1, 13, C.argia);
  sh.getRange(row, 2).setValue('Quote validity:').setFontWeight('bold');
  sh.getRange(row, 3, 1, 11).merge().setValue('Minimum 30 days from issue date');
  row++;

  bg(row, 1, 1, 13, C.argia);
  sh.getRange(row, 2).setValue('Delivery point:').setFontWeight('bold');
  sh.getRange(row, 3, 1, 11).merge().setValue('DAP ' + (inp.city || 'project site') + ', México — unloaded at site. Please confirm if DDP/CFR available and price difference.');
  row++;

  bg(row, 1, 1, 13, C.argia);
  sh.getRange(row, 2).setValue('Required docs:').setFontWeight('bold');
  sh.getRange(row, 3, 1, 11).merge().setValue('Datasheet · Technical specifications sheet · Warranty certificate template · Country of origin declaration · Certifications (see Technical requirement column)');
  row++;

  sh.setRowHeight(row, 6); row++;  // spacer

  // ── Supplier response block ───────────────────────────────────────────────
  hdr(row, 'SUPPLIER RESPONSE — fill cells below'); row++;

  var responseFields = [
    ['Company name:', ''],
    ['Contact name:', ''],
    ['Email / Phone:', ''],
    ['Payment terms offered:', ''],
    ['Quote validity (date):', ''],
    ['Delivery lead time (weeks):', ''],
    ['Warranty policy summary:', ''],
    ['Country of origin:', ''],
    ['Observations / conditions:', ''],
  ];

  responseFields.forEach(function(field, idx) {
    var rbg = idx % 2 === 0 ? C.rowWhite : C.rowAlt;
    sh.getRange(row, 1, 1, 2).setBackground(rbg);
    sh.getRange(row, 3, 1, 11).setBackground(C.supplier).merge();
    w(row, 1, field[0]); bold(row, 1, 1);
    if (field[1]) w(row, 3, field[1]);
    sh.setRowHeight(row, 22);
    row++;
  });

  sh.setRowHeight(row, 6); row++;

  // ── Footer ───────────────────────────────────────────────────────────────
  bg(row, 1, 1, 13, C.hdr);
  sh.getRange(row, 1, 1, 13).setFontColor(C.hdrFg).setFontSize(9);
  merge(row, 1, 7);
  sh.getRange(row, 1).setValue('ARGIA SOLAR  |  ' + (inp.projectManager || inp.bizManager) + '  |  Send response to: ' + (inp.projectManager || inp.bizManager));
  merge(row, 8, 6);
  sh.getRange(row, 8).setValue('Confidential — for quotation purposes only');

  SpreadsheetApp.flush();
}

// ---------------------------------------------------------------------------
// GENERATE ALL 5 RFQ SHEETS
// ---------------------------------------------------------------------------
function runWriteAllRFQs() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();
  var TOTAL = 7;

  try {
    _setArgiaProgress(0, TOTAL, 'Starting RFQ generation\u2026');
    _showArgiaProgress('ARGIA \u2014 Generating RFQs');

    _setArgiaProgress(1, TOTAL, 'Reading inputs\u2026');
    var nom     = loadNomConstants(ss);
    var inp     = readInputs(ss);
    var pcIn    = readPcInputs_(ss);
    inp.projectManager = pcIn.projectManager || inp.designer || inp.bizManager;
    var panel   = lookupPanel(ss, inp.panelModel);
    var invBank = buildInverterBank(ss, inp.inverterBank);

    // ── 1. PANELES ──────────────────────────────────────────────────────────
    _setArgiaProgress(2, TOTAL, 'RFQ 1/5 \u2014 Paneles solares\u2026');
    var panelItems = readBomItems_(ss, BOM_ROW.PANEL_PRIMARY, BOM_ROW.SUBTOTAL_PANELS - 1);
    var panelCerts = { '*': 'IEC 61215 / IEC 61730 · NOM-001-SEDE · Datasheet req. · Linear power warranty min 25yr · Product warranty min 12yr · Degradation ≤0.55%/yr' };
    var panelNotes = 'Bifacial modules preferred. Confirm: temperature coefficient Pmax, NOCT, dimensions, weight per module, pallet configuration and qty per pallet.';
    writeRfqSheet_(ss, RFQ_SHEETS.PANELES, inp, 'Paneles Solares', 'PAN', panelItems, panelCerts, panelNotes, 'USD');

    // ── 2. INVERSORES ───────────────────────────────────────────────────────
    _setArgiaProgress(3, TOTAL, 'RFQ 2/5 \u2014 Inversores\u2026');
    var invItems = readBomItems_(ss, BOM_ROW.INVERTER_PRIMARY, BOM_ROW.SUBTOTAL_INVERTERS - 1);
    var invCerts = { '*': 'IEC 62109-1/2 · UL 1741 · NOM-001-SEDE · IP65 outdoor · Datasheet + wiring diagram req.' };
    var invNotes = 'Confirm: communication protocol (Modbus/SunSpec), monitoring platform included, spare parts availability in Mexico, local service center.';
    writeRfqSheet_(ss, RFQ_SHEETS.INVERSORES, inp, 'Inversores', 'INV', invItems, invCerts, invNotes, 'USD');

    // ── 3. ESTRUCTURA ───────────────────────────────────────────────────────
    _setArgiaProgress(4, TOTAL, 'RFQ 3/5 \u2014 Estructura\u2026');
    var strItems = readBomItems_(ss, BOM_ROW.STRUCTURE_PRIMARY, BOM_ROW.STRUCTURE_INVERTER);
    var strCerts = { '*': 'ASCE 7-16 wind load design · Aluminum 6005-T5 or equiv · Installation manual req. · Structural calculation report preferred' };
    var strNotes = 'Specify: material grade, surface treatment (anodised/powder coat), wind speed design basis (m/s), required fasteners included or quoted separately.';
    writeRfqSheet_(ss, RFQ_SHEETS.ESTRUCTURA, inp, 'Estructura de Montaje', 'STR', strItems, strCerts, strNotes, 'MXN');

    // ── 4. ELECTRICO BOS ────────────────────────────────────────────────────
    _setArgiaProgress(5, TOTAL, 'RFQ 4/5 \u2014 Electrico BOS\u2026');
    // DC items + AC items (which include per-inverter blocks + transformer).
    // AC range goes through TRANSFORMER row but stops before SUBTOTAL_TRANSFORMER
    // so the subtotal row isn't included as an item.
    var elecDcItems = readBomItems_(ss, BOM_ROW.DC_CABLE, BOM_ROW.SUBTOTAL_DC - 1);
    var elecAcItems = readBomItems_(ss, BOM_ROW.AC_FEEDER, BOM_ROW.SUBTOTAL_TRANSFORMER - 1);
    var elecItems   = elecDcItems.concat(elecAcItems);
    var elecCerts = {
      '*'  : 'NOM-001-SEDE-2012 · UL listed or equivalent · Confirm voltage/temperature rating',
    };
    var elecNotes = 'Quote all items together for best freight efficiency. Cables: confirm Cu conductor, XLPE/THHW insulation, voltage rating ≥1kV DC for PV wire, ≥600V AC for THHW. Breakers: I-LINE frame preferred, confirm interrupting capacity ≥10kA.';
    writeRfqSheet_(ss, RFQ_SHEETS.ELECTRICO, inp, 'Electrico BOS (DC + AC)', 'ELEC', elecItems, elecCerts, elecNotes, 'MXN');

    // ── 5. MONITOREO ────────────────────────────────────────────────────────
    _setArgiaProgress(6, TOTAL, 'RFQ 5/5 \u2014 Monitoreo y servicios\u2026');
    var monItems = readBomItems_(ss, BOM_ROW.MON_DATALOGGER, BOM_ROW.MON_THERMOGRAPHY);  // BOM monitoring rows (datalogger through thermography)
    var monCerts = { '*': 'Compatible with Huawei FusionSolar or AlsoEnergy · Modbus TCP/SunSpec · Remote access cloud platform req.' };
    var monNotes = 'Include: data logger, communication module, cloud subscription (min 5yr), weather station if available. Specify data resolution (min 15-min interval) and alarm/reporting capabilities.';
    writeRfqSheet_(ss, RFQ_SHEETS.MONITOREO, inp, 'Monitoreo y Servicios', 'MON', monItems, monCerts, monNotes, 'MXN');

    _setArgiaProgress(TOTAL, TOTAL, '\u2705 All RFQs generated!');
    Utilities.sleep(1200);

    ui.alert(
      'RFQ Generation Complete\n\n' +
      '5 sheets created:\n' +
      '  \u2022 RFQ_PANELES\n  \u2022 RFQ_INVERSORES\n  \u2022 RFQ_ESTRUCTURA\n' +
      '  \u2022 RFQ_ELECTRICO\n  \u2022 RFQ_MONITOREO\n\n' +
      'Yellow cells = supplier fills in.\n' +
      'Use ARGIA \u2192 Export RFQ to save each as PDF.'
    );
  } catch(e) {
    try { _setArgiaProgress(TOTAL, TOTAL, '\u274C Error'); } catch(_) {}
    ui.alert('RFQ Error', e.message, ui.ButtonSet.OK);
  }
}

// ---------------------------------------------------------------------------
// EXPORT ONE RFQ SHEET AS PDF
// ---------------------------------------------------------------------------
function exportRfq_(ss, sheetName) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error(sheetName + ' not found. Run "Generate RFQs" first.');

  SpreadsheetApp.flush();
  Utilities.sleep(1500);

  var fileName = (ss.getName() || 'ARGIA') + '_' + sheetName + '.pdf';
  var folder   = getOutputFolder_(ss);

  // ── Attempt 1: direct gid export ─────────────────────────────────────────
  var blob = _tryGidExport_(ss.getId(), sh.getSheetId(), fileName);

  // ── Attempt 2: retry after 3s ─────────────────────────────────────────────
  if (!blob) {
    Utilities.sleep(3000);
    blob = _tryGidExport_(ss.getId(), sh.getSheetId(), fileName);
  }

  // ── Attempt 3: copy to temp spreadsheet and export that ───────────────────
  if (!blob) {
    blob = _exportViaTemp_(sh, fileName);
  }

  if (!blob) throw new Error('PDF export failed for "' + sheetName + '" after 3 attempts.');

  var files = folder.getFilesByName(fileName);
  while (files.hasNext()) files.next().setTrashed(true);
  return { file: folder.createFile(blob), folder: folder.getName() };
}

// Try direct gid-based export — returns blob or null on non-200
function _tryGidExport_(ssId, sheetId, fileName) {
  var url = 'https://docs.google.com/spreadsheets/d/' + ssId +
    '/export?format=pdf&size=A4&portrait=false&fitw=true&gridlines=false' +
    '&printtitle=false&sheetnames=false&pagenumbers=false&fzr=false&gid=' + sheetId;
  try {
    var resp = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() === 200) return resp.getBlob().setName(fileName);
  } catch(e) {}
  return null;
}

// Copy sheet to a fresh standalone spreadsheet, export it, then trash it
function _exportViaTemp_(sh, fileName) {
  var tmpSs = null;
  try {
    tmpSs = SpreadsheetApp.create('_argia_rfq_tmp_' + Date.now());
    sh.copyTo(tmpSs);
    // Remove the blank default sheet
    var sheets = tmpSs.getSheets();
    if (sheets.length > 1) tmpSs.deleteSheet(sheets[0]);
    SpreadsheetApp.flush();
    Utilities.sleep(2000);

    var tmpId  = tmpSs.getId();
    var gid    = tmpSs.getSheets()[0].getSheetId();
    var url    = 'https://docs.google.com/spreadsheets/d/' + tmpId +
      '/export?format=pdf&size=A4&portrait=false&fitw=true&gridlines=false' +
      '&printtitle=false&sheetnames=false&pagenumbers=false&fzr=false&gid=' + gid;
    var resp = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() === 200) return resp.getBlob().setName(fileName);
  } catch(e) {
    Logger.log('[RFQ Export] Temp spreadsheet fallback error: ' + e.message);
  } finally {
    // Always clean up temp spreadsheet
    if (tmpSs) {
      try { DriveApp.getFileById(tmpSs.getId()).setTrashed(true); } catch(e) {}
    }
  }
  return null;
}

function exportRfqPaneles()    { _exportRfqMenu_(RFQ_SHEETS.PANELES);    }
function exportRfqInversores() { _exportRfqMenu_(RFQ_SHEETS.INVERSORES); }
function exportRfqEstructura() { _exportRfqMenu_(RFQ_SHEETS.ESTRUCTURA); }
function exportRfqElectrico()  { _exportRfqMenu_(RFQ_SHEETS.ELECTRICO);  }
function exportRfqMonitoreo()  { _exportRfqMenu_(RFQ_SHEETS.MONITOREO);  }

function _exportRfqMenu_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    var result = exportRfq_(ss, sheetName);
    SpreadsheetApp.getUi().alert(
      'Exported: ' + sheetName + '\nFolder: ' + result.folder + '\n\n' + result.file.getUrl()
    );
  } catch(e) {
    SpreadsheetApp.getUi().alert('Export failed: ' + e.message);
  }
}

function exportAllRfqs() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var ui    = SpreadsheetApp.getUi();
  var names = Object.values(RFQ_SHEETS);
  var TOTAL = names.length + 1;

  try {
    _setArgiaProgress(0, TOTAL, 'Starting RFQ export\u2026');
    _showArgiaProgress('ARGIA \u2014 Export All RFQs');

    var results = [];
    names.forEach(function(name, idx) {
      _setArgiaProgress(idx + 1, TOTAL, 'Exporting ' + name + '\u2026');
      try {
        var result = exportRfq_(ss, name);
        results.push('\u2705  ' + name);
      } catch(e) {
        results.push('\u274C  ' + name + ': ' + e.message);
      }
    });

    _setArgiaProgress(TOTAL, TOTAL, '\u2705 Done!');
    Utilities.sleep(1200);

    var folder = getOutputFolder_(ss);
    ui.alert(
      'Export All RFQs \u2014 Complete',
      results.join('\n') + '\n\nFolder: ' + folder.getName(),
      ui.ButtonSet.OK
    );
  } catch(e) {
    try { _setArgiaProgress(6, 6, '\u274C Error'); } catch(_) {}
    ui.alert('Export RFQ Error', e.message, ui.ButtonSet.OK);
  }
}
