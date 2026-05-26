// =============================================================================
// ARGIA ENGINE v2 -- File: writers_v2/WriteRfqV2.gs
// -----------------------------------------------------------------------------
// CHUNK 6 \u2014 v2 RFQ generation. Writes 6 sheets:
//   - RFQ_PANELES_v2     (PV modules)
//   - RFQ_INVERSORES_v2  (inverters)
//   - RFQ_ESTRUCTURA_v2  (mounting structures)
//   - RFQ_ELECTRICO_v2   (DC + AC BOS + BESS electrical balance-of-system)
//   - RFQ_MONITOREO_v2   (monitoring + commissioning services)
//   - RFQ_BESS_v2        (battery hardware + BESS commissioning)
//
// ENTRY POINTS
//   - runWriteAllRfqsV2()  : menu-driven, writes all 6 sheets
//   - writeRfqV2(ss, entry, ctx) : single-sheet writer, callable in isolation
//
// INVOCATION MODEL (Chunk 6 decision)
//   Unlike MDC_v2, BOM_v2, INSTALLATION_v2, PROJECT_CARD_v2 \u2014 which run
//   inside runArgiaEngine() \u2014 RFQs are NOT part of the engine. They're
//   generated on demand via the menu (matches the legacy "Generate RFQs"
//   button behavior). This is a deliberate architectural choice.
//
// ISOLATION FROM LEGACY (15_WriteRFQ.gs)
//   - Does NOT call writeRfqSheet_ or readBomItems_ (legacy)
//   - Does NOT reference RFQ_COLORS or RFQ_SHEETS (legacy)
//   - Reads items from BOM_v2 (NOT legacy BOM)
//   - Uses its own constants (RFQV2_TPL, RFQ_REGISTRY)
//
//   When 15_WriteRFQ.gs is deleted at cutover, v2 keeps working.
//
// DATA FLOW
//   1. Menu click \u2192 runWriteAllRfqsV2
//   2. Read inputs (readInputs + readPcInputs_) \u2014 these are SHARED infra,
//      not legacy RFQ-specific, so v2 uses them.
//   3. Read engine metadata from _META!B6 (calculated_at timestamp) for the
//      RFQ year. Falls back to current year if missing.
//   4. For each entry in RFQ_REGISTRY:
//        a. Call setupRfqTemplate(ss, sheetName) \u2014 idempotent
//        b. Read items from BOM_v2 via readRfqBomItems(ss, entry.bomRanges)
//        c. Call writeRfqV2(ss, entry, ctx) to fill data into the template
//
// COLUMN LAYOUT (mirrors template)
//   A=#  B=Description  C=Model/Spec  D=Qty  E=Unit  F=Tech req
//   G=Unit price  H=CCY  I=Total  J=Lead wks  K=Warranty yrs
//   L=Incoterms  M=Notes
//
// DEPENDENCIES (v2 + shared only \u2014 no legacy RFQ code)
//   - readInputs, readPcInputs_  -- 01_ReadInputs.gs (shared infra)
//   - V2_SHEETS                  -- templates/TemplateRegistry.gs
//   - RFQ_REGISTRY, getRfqByKey  -- templates/RfqRegistry.gs
//   - setupRfqTemplate, RFQV2_TPL -- templates/setupRfqTemplate.gs
//   - readRfqBomItems            -- writers_v2/helpers/RfqBomReader.gs
// =============================================================================


// =============================================================================
// MENU ENTRY POINT \u2014 wire this into the ARGIA menu in 00_Main.gs
// =============================================================================
/**
 * Generates all 6 v2 RFQ sheets. Reads inputs once, then iterates the
 * RFQ_REGISTRY, setting up the template and writing data for each sheet.
 *
 * Wrapped per-RFQ in try/catch so a single broken RFQ doesn't kill the
 * other 5. Shows a UI alert at the end summarizing what was generated.
 */
function runWriteAllRfqsV2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var total = RFQ_REGISTRY.length + 2;  // +2: "starting" + "reading inputs"

  try {
    // Progress shim \u2014 use legacy progress helpers if available, else no-op.
    // These helpers (_setArgiaProgress, _showArgiaProgress) are defined in
    // 00_Main.gs and are SHARED infra, not legacy-RFQ-specific.
    var prog = (typeof _setArgiaProgress === 'function')
      ? _setArgiaProgress : function () {};
    var show = (typeof _showArgiaProgress === 'function')
      ? _showArgiaProgress : function () {};

    prog(0, total, 'Starting RFQ generation\u2026');
    show('ARGIA \u2014 Generating RFQs v2');

    prog(1, total, 'Reading inputs\u2026');
    var ctx = _buildRfqContext(ss);

    var succeeded = [];
    var failed    = [];

    for (var i = 0; i < RFQ_REGISTRY.length; i++) {
      var entry = RFQ_REGISTRY[i];
      var sheetName = V2_SHEETS[entry.sheetKey];

      prog(2 + i, total,
           'RFQ ' + (i + 1) + '/' + RFQ_REGISTRY.length + ' \u2014 ' +
           entry.title + '\u2026');

      try {
        setupRfqTemplate(ss, sheetName);
        writeRfqV2(ss, entry, ctx);
        succeeded.push(sheetName);
      } catch (rfqErr) {
        failed.push({ sheet: sheetName, error: rfqErr.message });
        // engineLog if available; otherwise just keep going
        if (typeof engineLog === 'function') {
          engineLog(ss, 'V2', 'WARNING',
                    'RFQ generation failed for ' + sheetName + ': ' +
                    rfqErr.message + '\n' + (rfqErr.stack || ''));
        }
      }
    }

    prog(total, total, succeeded.length === RFQ_REGISTRY.length
                       ? '\u2705 All RFQs generated' : '\u26a0 Some RFQs failed');
    Utilities.sleep(800);

    var msg = 'RFQ v2 generation complete.\n\n' +
              'Succeeded (' + succeeded.length + '/' + RFQ_REGISTRY.length + '):\n  \u2022 ' +
              succeeded.join('\n  \u2022 ');
    if (failed.length) {
      msg += '\n\nFailed (' + failed.length + '):\n  \u2022 ' +
             failed.map(function (f) { return f.sheet + ': ' + f.error; })
                   .join('\n  \u2022 ');
    }
    msg += '\n\nYellow cells = supplier fills in.';
    ui.alert(msg);
  } catch (fatalErr) {
    ui.alert('RFQ v2 Error', fatalErr.message, ui.ButtonSet.OK);
  }
}


// =============================================================================
// CONTEXT BUILDER \u2014 reads shared inputs once, returns object passed to
// every writeRfqV2 call. Pulling this out makes single-sheet rebuilds cheap
// (used by per-RFQ export and by tests).
// =============================================================================
function _buildRfqContext(ss) {
  // readInputs and readPcInputs_ are shared infra (NOT legacy-RFQ-specific).
  // They live in 01_ReadInputs.gs and 14_WriteProjectCard.gs respectively.
  var inp = readInputs(ss);

  // readPcInputs_ pulls projectManager / bizManager / designer if available.
  // It's defined in 14_WriteProjectCard.gs. If not loaded for some reason,
  // we fall back to whatever readInputs gave us.
  if (typeof readPcInputs_ === 'function') {
    try {
      var pcIn = readPcInputs_(ss);
      inp.projectManager = pcIn.projectManager || inp.designer || inp.bizManager;
    } catch (e) {
      inp.projectManager = inp.designer || inp.bizManager;
    }
  } else {
    inp.projectManager = inp.designer || inp.bizManager;
  }

  // Issue date \u2014 read from _META!B6 (calculated_at, set by every engine
  // run). Falls back to current date if _META is missing or unreadable.
  var issueDate = _readMetaCalculatedAt(ss);
  if (!issueDate) issueDate = new Date();

  // Response deadline = issue date + 14 days
  var responseDate = new Date(issueDate.getTime());
  responseDate.setDate(responseDate.getDate() + 14);

  return {
    inp           : inp,
    issueDate     : issueDate,
    responseDate  : responseDate,
    issueYear     : issueDate.getFullYear(),
    timezone      : ss.getSpreadsheetTimeZone() || 'America/Monterrey'
  };
}


/**
 * Reads _META!B6 (calculated_at, ISO 8601 string) and returns a Date.
 * Returns null if the cell can't be read or parsed.
 */
function _readMetaCalculatedAt(ss) {
  try {
    var sh = ss.getSheetByName('_META');
    if (!sh) return null;
    var v = sh.getRange(6, 2).getValue();
    if (!v) return null;
    if (v instanceof Date) return v;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
}


// =============================================================================
// SINGLE-SHEET WRITER \u2014 pure function (almost). Takes ss + registry entry
// + context, writes data into the already-setup sheet. Items are scraped
// from BOM_v2 inside the call so the function works in isolation.
// =============================================================================
/**
 * Writes data into one RFQ sheet. Assumes setupRfqTemplate has already
 * created/cleared the sheet and laid down the static structure.
 *
 * @param {Spreadsheet} ss     Active spreadsheet.
 * @param {Object}      entry  One element of RFQ_REGISTRY.
 * @param {Object}      ctx    Context from _buildRfqContext.
 * @param {Object}      _testOpts Optional. { sheetName, items } for tests.
 */
function writeRfqV2(ss, entry, ctx, _testOpts) {
  if (!entry) throw new Error('writeRfqV2: entry is required');
  if (!ctx)   throw new Error('writeRfqV2: ctx is required');
  _testOpts = _testOpts || {};

  var sheetName = _testOpts.sheetName || V2_SHEETS[entry.sheetKey];
  if (!sheetName) {
    throw new Error('writeRfqV2: no V2_SHEETS entry for sheetKey "' +
                    entry.sheetKey + '". Update TemplateRegistry.');
  }

  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    throw new Error('writeRfqV2: sheet "' + sheetName + '" not found. ' +
                    'Call setupRfqTemplate(ss, sheetName) first.');
  }

  // Test seam: callers (tests) can inject items directly to avoid needing a
  // populated BOM_v2 sheet. Production calls go through readRfqBomItems.
  var items = _testOpts.items;
  if (!items) {
    items = readRfqBomItems(ss, entry.bomRanges);
  }

  var T = RFQV2_TPL;
  var inp = ctx.inp || {};
  var tz  = ctx.timezone || 'America/Monterrey';

  // -- Fill metadata block values (template already painted labels + bg) ----
  // Row 3 (FROM / RFQ Number)
  sh.getRange(T.ROW_META_FROM, 3)
    .setValue('ARGIA SOLAR  |  ' + (inp.projectManager || inp.bizManager || ''));
  var projTag = String(inp.projectName || '')
                 .replace(/[^A-Z0-9]/gi, '')
                 .substring(0, 10)
                 .toUpperCase();
  var rfqNumber = 'RFQ-' + entry.code + '-' + projTag + '-' + ctx.issueYear;
  sh.getRange(T.ROW_META_FROM, 8).setValue(rfqNumber);

  // Row 4 (PROJECT / Issue date)
  sh.getRange(T.ROW_META_PROJECT, 3)
    .setValue((inp.projectName || '') + '  |  ' + (inp.clientName || ''));
  sh.getRange(T.ROW_META_PROJECT, 8)
    .setValue(Utilities.formatDate(ctx.issueDate, tz, 'dd/MM/yyyy'));

  // Row 5 (LOCATION / Response by)
  var loc = [inp.street, inp.city, inp.state].filter(Boolean).join(', ');
  sh.getRange(T.ROW_META_LOCATION, 3).setValue(loc);
  sh.getRange(T.ROW_META_LOCATION, 8)
    .setValue(Utilities.formatDate(ctx.responseDate, tz, 'dd/MM/yyyy'))
    .setBackground('#FFCDD2')
    .setNote('Adjust response deadline as needed');

  // Row 6 (SYSTEM / Delivery req)
  var sysDesc = (inp.businessType || '') + '  |  ' +
                (inp.panelQty || '') + ' modules  |  see BOM for full scope';
  sh.getRange(T.ROW_META_SYSTEM, 3).setValue(sysDesc);
  sh.getRange(T.ROW_META_SYSTEM, 8)
    .setValue('DAP ' + (inp.city || 'site') + ', M\u00e9xico');

  // -- Item table (starts at ROW_ITEMS_START = row 10) -----------------------
  // Layout per item row:
  //   A: item #     (centered)
  //   B: description
  //   C: model/spec / DB ref (small grey)
  //   D: qty        (centered)
  //   E: unit       (centered)
  //   F: tech req (from entry.certReqs map, '*' fallback)
  //   G: blank      (supplier fills price)
  //   H: default ccy
  //   I: blank      (supplier fills total)
  //   J: blank      (supplier fills lead)
  //   K: blank      (supplier fills warranty)
  //   L: 'DAP'      (default incoterms)
  //   M: blank      (notes)

  var row = T.ROW_ITEMS_START;
  for (var ix = 0; ix < items.length; ix++) {
    var item = items[ix];
    var rowBg = (ix % 2 === 0) ? T.COLOR_ROW_WHITE : T.COLOR_ROW_ALT;

    sh.getRange(row, 1, 1, 6).setBackground(rowBg);        // Argia cols
    sh.getRange(row, 7, 1, 7).setBackground(T.COLOR_SUPPLIER); // Supplier cols

    sh.getRange(row, 1).setValue(item.num).setHorizontalAlignment('center');
    sh.getRange(row, 2).setValue(item.desc);
    sh.getRange(row, 3).setValue(item.ref || '')
                       .setFontSize(9)
                       .setFontColor('#546E7A');
    sh.getRange(row, 4).setValue(item.qty).setHorizontalAlignment('center');
    sh.getRange(row, 5).setValue(item.unit).setHorizontalAlignment('center');

    var techReq = (entry.certReqs && (entry.certReqs[item.num] || entry.certReqs['*'])) || '';
    sh.getRange(row, 6).setValue(techReq).setFontSize(9);

    // Supplier-fill columns: notes-only, no values
    sh.getRange(row, 7).setNote('Enter unit price in selected currency');
    sh.getRange(row, 8).setValue(entry.defaultCcy || 'MXN')
                       .setHorizontalAlignment('center')
                       .setNote('USD or MXN');
    sh.getRange(row, 9).setNumberFormat('"$ "#,##0.00')
                       .setHorizontalAlignment('right')
                       .setNote('= Qty \u00d7 Unit price  (fill when pricing is complete)');
    sh.getRange(row, 10).setHorizontalAlignment('center')
                        .setNote('Lead time in weeks');
    sh.getRange(row, 11).setHorizontalAlignment('center')
                        .setNote('Warranty in years');
    sh.getRange(row, 12).setValue('DAP')
                        .setHorizontalAlignment('center')
                        .setNote('DAP / CFR / EXW / DDP');
    sh.setRowHeight(row, 20);
    row++;
  }

  // -- Subtotal row (only if there were items) -------------------------------
  if (items.length > 0) {
    sh.getRange(row, 1, 1, T.NUM_COLS)
      .setBackground(T.COLOR_HDR_BG)
      .setFontColor(T.COLOR_HDR_FG)
      .setFontWeight('bold');
    sh.getRange(row, 2).setValue('SUBTOTAL ' + String(entry.title).toUpperCase());
    sh.getRange(row, 9).setNumberFormat('"$ "#,##0.00')
                       .setFontColor(T.COLOR_HDR_FG)
                       .setNote('Subtotal \u2014 fill after receiving supplier prices');
    sh.setRowHeight(row, 22);
    row++;
  }

  // Thin spacer after subtotal
  sh.setRowHeight(row, 6);
  row++;

  // -- Technical notes section (if entry has them) ---------------------------
  if (entry.techNotes) {
    sh.getRange(row, 1, 1, T.NUM_COLS).setBackground(T.COLOR_TECH_NOTES_BG);
    sh.getRange(row, 2).setValue('TECHNICAL NOTES:').setFontWeight('bold');
    sh.getRange(row, 3, 1, 11).merge().setValue(entry.techNotes);
    sh.setRowHeight(row, 36);
    sh.getRange(row, 3).setWrap(true);
    row++;
    sh.setRowHeight(row, 4);
    row++;
  }

  // -- Commercial terms section ----------------------------------------------
  _rfqV2_writeSectionHeader(sh, row, 'COMMERCIAL TERMS REQUESTED BY ARGIA SOLAR');
  row++;

  var terms = [
    ['Payment terms:', '50% advance on Purchase Order, 50% on delivery and ' +
                       'commissioning sign-off'],
    ['Quote validity:', 'Minimum 30 days from issue date'],
    ['Delivery point:', 'DAP ' + (inp.city || 'project site') +
                        ', M\u00e9xico \u2014 unloaded at site. Please confirm ' +
                        'if DDP/CFR available and price difference.'],
    ['Required docs:', 'Datasheet \u00b7 Technical specifications sheet ' +
                       '\u00b7 Warranty certificate template \u00b7 Country of ' +
                       'origin declaration \u00b7 Certifications (see Technical ' +
                       'requirement column)']
  ];
  for (var t = 0; t < terms.length; t++) {
    sh.getRange(row, 1, 1, T.NUM_COLS).setBackground(T.COLOR_ARGIA);
    sh.getRange(row, 2).setValue(terms[t][0]).setFontWeight('bold');
    sh.getRange(row, 3, 1, 11).merge().setValue(terms[t][1]);
    row++;
  }

  // Thin spacer
  sh.setRowHeight(row, 6);
  row++;

  // -- Supplier response block -----------------------------------------------
  _rfqV2_writeSectionHeader(sh, row, 'SUPPLIER RESPONSE \u2014 fill cells below');
  row++;

  var responseFields = [
    'Company name:',
    'Contact name:',
    'Email / Phone:',
    'Payment terms offered:',
    'Quote validity (date):',
    'Delivery lead time (weeks):',
    'Warranty policy summary:',
    'Country of origin:',
    'Observations / conditions:'
  ];
  for (var f = 0; f < responseFields.length; f++) {
    var fBg = (f % 2 === 0) ? T.COLOR_ROW_WHITE : T.COLOR_ROW_ALT;
    sh.getRange(row, 1, 1, 2).setBackground(fBg);
    sh.getRange(row, 3, 1, 11).setBackground(T.COLOR_SUPPLIER).merge();
    sh.getRange(row, 1).setValue(responseFields[f]).setFontWeight('bold');
    sh.setRowHeight(row, 22);
    row++;
  }

  // Thin spacer
  sh.setRowHeight(row, 6);
  row++;

  // -- Footer bar ------------------------------------------------------------
  sh.getRange(row, 1, 1, T.NUM_COLS)
    .setBackground(T.COLOR_HDR_BG)
    .setFontColor(T.COLOR_HDR_FG)
    .setFontSize(9);
  sh.getRange(row, 1, 1, 7).merge();
  sh.getRange(row, 1).setValue(
    'ARGIA SOLAR  |  ' + (inp.projectManager || inp.bizManager || '') +
    '  |  Send response to: ' + (inp.projectManager || inp.bizManager || '')
  );
  sh.getRange(row, 8, 1, 6).merge();
  sh.getRange(row, 8).setValue('Confidential \u2014 for quotation purposes only');

  SpreadsheetApp.flush && SpreadsheetApp.flush();
  return { sheet: sheetName, itemCount: items.length, lastRow: row };
}


/**
 * Private helper: paints a section header band on a single row.
 * Used for "COMMERCIAL TERMS REQUESTED BY ARGIA SOLAR" and
 * "SUPPLIER RESPONSE \u2014 fill cells below" bands.
 */
function _rfqV2_writeSectionHeader(sh, row, text) {
  var T = RFQV2_TPL;
  sh.getRange(row, 1, 1, T.NUM_COLS).merge();
  sh.getRange(row, 1)
    .setValue(text)
    .setFontWeight('bold')
    .setFontSize(10)
    .setBackground(T.COLOR_HDR_BG)
    .setFontColor(T.COLOR_HDR_FG)
    .setVerticalAlignment('middle');
  sh.setRowHeight(row, 24);
}
