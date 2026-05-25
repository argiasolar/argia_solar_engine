// =============================================================================
// ARGIA ENGINE v2 -- File: templates/setupProjectCardTemplate.gs
// -----------------------------------------------------------------------------
// CHUNK 3 — PROJECT_CARD_v2 template.
//
// WHAT THIS DOES
//   Creates or refreshes the PROJECT_CARD_v2 sheet structure:
//     - Title row + 10-column widths
//     - Section header bands at fixed rows from PC_ROW
//     - Static labels in cols B / G for every body row
//     - Sub-banner + USD/MXN/VALIDATION/MARGIN units row in §4 COST COMPARISON
//     - 9 cost-category labels (8 legacy + 1 new "Almacenamiento (BESS)")
//     - DOCUMENTATION / RISKS / COMMENTS / SIGNATURES boilerplate labels
//
//   Pure setup. Never reads INPUT_*, BOM, or INSTALLATION. Never writes
//   data values (costs, dates, names). Those come from WriteProjectCardV2.
//   Idempotent — running this twice leaves the same visual result.
//
// WHY A FIXED-ROW TEMPLATE
//   Legacy 14_WriteProjectCard.js increments `row++` as it writes, which
//   couples layout to data. PC_v2 splits the two: template owns the rows
//   (PC_ROW constants in 00_Main.js), writer owns the values. This is what
//   makes the v2 writer cleanly testable with a mock sheet — assertions
//   target known (row, col) addresses regardless of data shape.
//
// LAYOUT (10 cols)
//   A=margin  B=label-left  C=USD-cost     D=MXN-cost   E=validation
//   F=spacer  G=label-right H=USD-sales    I=MXN-sales  J=margin%
//
// CALLED BY
//   - setupAllV2Templates(ss) in templates/TemplateRegistry.gs (Chunk 0)
//   - runArgiaEngine() (Step 13-v2) once per engine run
//   - resetOutputs() (Chunk 12, when built)
//
// DEPENDENCIES
//   - V2_SHEETS.PROJECT_CARD ('PROJECT_CARD_v2')  -- templates/TemplateRegistry.gs
//   - PC_ROW, PC_COL                              -- 00_Main.js
//   - token, tokenNum, loadDesignTokens, resetDesignTokenCache_  -- 02a
// =============================================================================


// -----------------------------------------------------------------------------
// PC_v2 internal palette. Defined here AND in writers_v2/WriteProjectCardV2.gs
// with an idempotent guard, so the file load order doesn't matter and the
// writer can run in unit tests without this template file present in scope.
// Mirrors legacy PC_C exactly so the visual diff against legacy is just
// "+BESS row, +Storage row, fixed addresses".
// -----------------------------------------------------------------------------
var PC_V2_PALETTE = (typeof PC_V2_PALETTE !== 'undefined' && PC_V2_PALETTE) ? PC_V2_PALETTE : {
  navy     : '#0D1B2A',  navyFg  : '#FFFFFF',
  section  : '#37474F',  secFg   : '#FFFFFF',
  blue     : '#1565C0',  blueFg  : '#FFFFFF',
  light    : '#ECEFF1',
  white    : '#FFFFFF',
  green    : '#E8F5E9',
  pass     : '#C8E6C9',  passFg  : '#1B5E20',
  fail     : '#FFCDD2',  failFg  : '#B71C1C',
  orange   : '#FFF8E1'
};


// -----------------------------------------------------------------------------
// setupProjectCardTemplate(ss, opts)
// -----------------------------------------------------------------------------
//   ss   -- spreadsheet (default: active).
//   opts -- { sheetName: '_PC_v2_TEST_xyz' } overrides target sheet name for
//           integration tests. Production callers omit opts and get the
//           canonical V2_SHEETS.PROJECT_CARD name.
// -----------------------------------------------------------------------------
function setupProjectCardTemplate(ss, opts) {
  ss = ss || SpreadsheetApp.getActive();
  opts = opts || {};

  var sheetName = opts.sheetName || V2_SHEETS.PROJECT_CARD;
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  } else {
    // Idempotent refresh: wipe and re-render.
    sh.clear();
    sh.clearConditionalFormatRules();
  }

  // ---- Canvas: 10 columns -------------------------------------------------
  // Same widths as legacy PC (line 240 of 14_WriteProjectCard.js).
  var widths = [4, 165, 105, 110, 85, 14, 160, 105, 110, 70];
  for (var ci = 0; ci < widths.length; ci++) {
    sh.setColumnWidth(ci + 1, widths[ci]);
  }
  sh.setHiddenGridlines(true);

  // ---- Helpers ------------------------------------------------------------
  function hdr(row, c1, span, txt) {
    var rng = sh.getRange(row, c1, 1, span);
    if (span > 1) rng.merge();
    rng.setValue(txt)
       .setFontWeight('bold')
       .setFontSize(10)
       .setBackground(PC_V2_PALETTE.section)
       .setFontColor(PC_V2_PALETTE.secFg)
       .setVerticalAlignment('middle');
    sh.setRowHeight(row, 24);
  }
  function label(row, col, txt) {
    sh.getRange(row, col).setValue(txt).setVerticalAlignment('middle');
  }
  function boldLabel(row, col, txt) {
    sh.getRange(row, col).setValue(txt).setFontWeight('bold').setVerticalAlignment('middle');
  }

  // ════════════════════════════════════════════════════════════════════════
  // §0  TITLE BAR (row 1)
  // ════════════════════════════════════════════════════════════════════════
  sh.getRange(PC_ROW.TITLE, 1, 1, 10)
    .setBackground(PC_V2_PALETTE.section)
    .setFontColor(PC_V2_PALETTE.secFg)
    .setFontSize(10);
  boldLabel(PC_ROW.TITLE, PC_COL.LABEL_L, 'PROJECT CARD');
  label(PC_ROW.TITLE, PC_COL.USD_COST,    'Project Number:');
  label(PC_ROW.TITLE, PC_COL.LABEL_R,     'Date:');
  sh.getRange(PC_ROW.TITLE, PC_COL.LABEL_R).setHorizontalAlignment('right');
  sh.setRowHeight(PC_ROW.TITLE, 26);

  // ════════════════════════════════════════════════════════════════════════
  // §1  BUSINESS CASE
  // ════════════════════════════════════════════════════════════════════════
  hdr(PC_ROW.SEC_BUSINESS_HEADER, PC_COL.LABEL_L, 9, 'BUSINESS CASE');
  label(PC_ROW.BUSINESS_CUSTOMER, PC_COL.LABEL_L, 'Customer:');
  label(PC_ROW.BUSINESS_PROJECT,  PC_COL.LABEL_L, 'Project name:');
  label(PC_ROW.BUSINESS_LOCATION, PC_COL.LABEL_L, 'Location:');

  // ════════════════════════════════════════════════════════════════════════
  // §2  PROJECT TEAM
  // ════════════════════════════════════════════════════════════════════════
  hdr(PC_ROW.SEC_TEAM_HEADER, PC_COL.LABEL_L, 9, 'PROJECT TEAM');
  label(PC_ROW.TEAM_BIZ_MANAGER,  PC_COL.LABEL_L, 'Business manager:');
  label(PC_ROW.TEAM_DESIGNER,     PC_COL.LABEL_L, 'Designer:');
  label(PC_ROW.TEAM_PROJ_MANAGER, PC_COL.LABEL_L, 'Project manager:');

  // ════════════════════════════════════════════════════════════════════════
  // §3  SCOPE OF WORK (left) + ADDITIONAL INFORMATION (right)
  // ════════════════════════════════════════════════════════════════════════
  hdr(PC_ROW.SEC_SCOPE_HEADER, PC_COL.LABEL_L, 4, 'SCOPE OF WORK');
  hdr(PC_ROW.SEC_SCOPE_HEADER, PC_COL.LABEL_R, 4, 'ADDITIONAL INFORMATION');
  // Right-side labels at fixed rows. Left-side scope rows are filled by
  // the writer (variable: depends on inverter count, BESS enabled, etc).
  label(PC_ROW.INFO_POWER_PEAK,    PC_COL.LABEL_R, 'Power peak');
  label(PC_ROW.INFO_COVERAGE,      PC_COL.LABEL_R, 'System coverage');
  label(PC_ROW.INFO_INSTALL_TYPE,  PC_COL.LABEL_R, 'Installation type');
  label(PC_ROW.INFO_SELLING_PRICE, PC_COL.LABEL_R, 'Selling price');
  label(PC_ROW.INFO_COST,          PC_COL.LABEL_R, 'Cost');
  label(PC_ROW.INFO_STORAGE,       PC_COL.LABEL_R, 'Storage');

  // ════════════════════════════════════════════════════════════════════════
  // §4  SCHEDULE
  // ════════════════════════════════════════════════════════════════════════
  hdr(PC_ROW.SEC_SCHEDULE_HEADER, PC_COL.LABEL_L, 9, 'SCHEDULE');
  label(PC_ROW.SCHEDULE_R1, PC_COL.LABEL_L, 'Contract sign date:');
  label(PC_ROW.SCHEDULE_R1, PC_COL.LABEL_R, 'Contract finish date:');
  label(PC_ROW.SCHEDULE_R2, PC_COL.LABEL_L, 'Equipment delivery date:');
  label(PC_ROW.SCHEDULE_R3, PC_COL.LABEL_L, 'Installation start date:');
  label(PC_ROW.SCHEDULE_R3, PC_COL.LABEL_R, 'Installation finish date:');

  // ════════════════════════════════════════════════════════════════════════
  // §5  COST COMPARISON  (the money table)
  // ════════════════════════════════════════════════════════════════════════
  // Header band
  hdr(PC_ROW.SEC_COST_HEADER, PC_COL.LABEL_L, 9, 'COST COMPARISON');
  // "Exchange rate:" label lives in col D of the header row; writer fills col E
  sh.getRange(PC_ROW.SEC_COST_HEADER, PC_COL.MXN_COST)
    .setValue('Exchange rate:')
    .setFontColor(PC_V2_PALETTE.secFg)
    .setBackground(PC_V2_PALETTE.section)
    .setVerticalAlignment('middle');

  // Sub-banner: ESTIMATED COSTS | VALIDATION | SALES PRICE | MARGIN
  var subRange = sh.getRange(PC_ROW.COST_SUBBANNER, PC_COL.LABEL_L, 1, 9);
  subRange.setBackground(PC_V2_PALETTE.light)
          .setFontColor('#000000')
          .setFontWeight('bold');
  sh.getRange(PC_ROW.COST_SUBBANNER, PC_COL.LABEL_L).setValue('ESTIMATED COSTS');
  sh.getRange(PC_ROW.COST_SUBBANNER, PC_COL.VALIDATION)
    .setValue('VALIDATION').setHorizontalAlignment('center');
  sh.getRange(PC_ROW.COST_SUBBANNER, PC_COL.LABEL_R).setValue('SALES PRICE');
  sh.getRange(PC_ROW.COST_SUBBANNER, PC_COL.MARGIN_PCT)
    .setValue('MARGIN').setHorizontalAlignment('center');
  sh.setRowHeight(PC_ROW.COST_SUBBANNER, 22);

  // Units row: USD | MXN | vs range | USD | MXN | %
  var unitsRange = sh.getRange(PC_ROW.COST_UNITS, PC_COL.LABEL_L, 1, 9);
  unitsRange.setBackground(PC_V2_PALETTE.light).setFontWeight('bold');
  sh.getRange(PC_ROW.COST_UNITS, PC_COL.USD_COST).setValue('USD');
  sh.getRange(PC_ROW.COST_UNITS, PC_COL.MXN_COST).setValue('MXN');
  sh.getRange(PC_ROW.COST_UNITS, PC_COL.VALIDATION).setValue('vs range');
  sh.getRange(PC_ROW.COST_UNITS, PC_COL.USD_SALES).setValue('USD');
  sh.getRange(PC_ROW.COST_UNITS, PC_COL.MXN_SALES).setValue('MXN');
  sh.getRange(PC_ROW.COST_UNITS, PC_COL.MARGIN_PCT).setValue('%');
  [PC_COL.USD_COST, PC_COL.MXN_COST, PC_COL.VALIDATION,
   PC_COL.USD_SALES, PC_COL.MXN_SALES, PC_COL.MARGIN_PCT].forEach(function(c) {
    sh.getRange(PC_ROW.COST_UNITS, c).setHorizontalAlignment('right');
  });

  // 9 cost-category labels in col B. Striped backgrounds (idx 0,2,4,6,8 white;
  // 1,3,5,7 light) to match legacy banding. Sales/cost cells are filled by
  // the writer; the template just owns the labels and the row striping.
  // NOTE: The BESS row (idx 8) lands on a WHITE band because there are 9 rows
  // and an odd-indexed last row would clash with the navy TOTAL row below it.
  // Match legacy: idx 0,2,4,6,8 white; idx 1,3,5,7 light.
  var costLabels = [
    [PC_ROW.COST_PANELS,     'Solar panels'],
    [PC_ROW.COST_INVERTERS,  'Inverters'],
    [PC_ROW.COST_STRUCTURE,  'Structure'],
    [PC_ROW.COST_ELEC_DC,    'Electric DC'],
    [PC_ROW.COST_ELEC_AC,    'Electric AC'],
    [PC_ROW.COST_MONITORING, 'Monitoring'],
    [PC_ROW.COST_PERMITS,    'Permits & others'],
    [PC_ROW.COST_INSTALL,    'Installation'],
    [PC_ROW.COST_BESS,       'Almacenamiento (BESS)']    // Chunk 3 new row
  ];
  costLabels.forEach(function(pair, idx) {
    var r  = pair[0];
    var bg = idx % 2 === 0 ? PC_V2_PALETTE.white : PC_V2_PALETTE.light;
    sh.getRange(r, PC_COL.LABEL_L, 1, 9).setBackground(bg);
    label(r, PC_COL.LABEL_L, pair[1]);
  });

  // TOTAL row (navy band, white text)
  var totRange = sh.getRange(PC_ROW.COST_TOTAL, PC_COL.LABEL_L, 1, 9);
  totRange.setBackground(PC_V2_PALETTE.section)
          .setFontColor(PC_V2_PALETTE.secFg)
          .setFontWeight('bold');
  boldLabel(PC_ROW.COST_TOTAL, PC_COL.LABEL_L, 'TOTAL');
  sh.getRange(PC_ROW.COST_TOTAL, PC_COL.LABEL_L)
    .setFontColor(PC_V2_PALETTE.secFg);   // keep label white on navy

  // §5b PRICE / DISCOUNT / GROSS PROFIT
  // Row labels only; values are formulas the writer fills.
  sh.getRange(PC_ROW.PRICE_DISCOUNT_ROW, PC_COL.LABEL_L, 1, 4)
    .setBackground(PC_V2_PALETTE.light);
  label(PC_ROW.PRICE_DISCOUNT_ROW, PC_COL.LABEL_L, 'Payment Terms [DP/D/C/P]:');
  boldLabel(PC_ROW.PRICE_DISCOUNT_ROW, PC_COL.LABEL_R, 'Discount %');

  label(PC_ROW.PRICE_AFTER_DISC, PC_COL.LABEL_L, 'Payment time [days]:');
  boldLabel(PC_ROW.PRICE_AFTER_DISC, PC_COL.LABEL_R, 'Price after discount');

  sh.getRange(PC_ROW.PRICE_GROSS_PROFIT, PC_COL.LABEL_R, 1, 4)
    .setBackground(PC_V2_PALETTE.green);
  boldLabel(PC_ROW.PRICE_GROSS_PROFIT, PC_COL.LABEL_R, 'Gross Profit:');

  // ════════════════════════════════════════════════════════════════════════
  // §6  DOCUMENTATION (5 rows, two-column list — left = mandatory, right = additional)
  // ════════════════════════════════════════════════════════════════════════
  hdr(PC_ROW.SEC_DOCS_HEADER, PC_COL.LABEL_L, 4, 'MANDATORY DOCUMENTATION');
  hdr(PC_ROW.SEC_DOCS_HEADER, PC_COL.LABEL_R, 4, 'ADDITIONAL DOCUMENTATION');
  var docsLeft = [
    [PC_ROW.DOCS_R1, 'Argia offer',           'Yes'],
    [PC_ROW.DOCS_R2, 'Helioscope simulation', 'Yes'],
    [PC_ROW.DOCS_R3, 'Installation manual',   'Yes'],
    [PC_ROW.DOCS_R4, 'Contract or Customer PO', 'Yes'],
    [PC_ROW.DOCS_R5, 'Technical Audit',       'Yes']
  ];
  var docsRight = [
    [PC_ROW.DOCS_R1, 'Installation Quotation', 'No'],
    [PC_ROW.DOCS_R2, 'RFQ',                    'Yes'],
    [PC_ROW.DOCS_R3, 'Harmonogram',            'No'],
    [PC_ROW.DOCS_R4, 'Tender specification',   'Yes']
    // DOCS_R5 right cell intentionally blank — only 4 additional docs
  ];
  docsLeft.forEach(function(d) {
    label(d[0], PC_COL.LABEL_L, d[1]);
    label(d[0], PC_COL.USD_COST, d[2]);  // col C = the "Yes/No" value
  });
  docsRight.forEach(function(d) {
    label(d[0], PC_COL.LABEL_R, d[1]);
    label(d[0], PC_COL.USD_SALES, d[2]); // col H = the "Yes/No" value
  });

  // ════════════════════════════════════════════════════════════════════════
  // §7  RISKS MANAGEMENT (5 label rows; values are filled manually by user)
  // ════════════════════════════════════════════════════════════════════════
  hdr(PC_ROW.SEC_RISKS_HEADER, PC_COL.LABEL_L, 9, 'RISKS MANAGEMENT:');
  label(PC_ROW.RISKS_PENALTIES, PC_COL.LABEL_L, 'Penalties:');
  label(PC_ROW.RISKS_WARRANTY,  PC_COL.LABEL_L, 'Warranty:');
  label(PC_ROW.RISKS_INSURANCE, PC_COL.LABEL_L, 'Insurance:');
  label(PC_ROW.RISKS_FIRE,      PC_COL.LABEL_L, 'Fire:');
  label(PC_ROW.RISKS_WORKPLACE, PC_COL.LABEL_L, 'Workplace security:');

  // ════════════════════════════════════════════════════════════════════════
  // §8  COMMENTS
  // ════════════════════════════════════════════════════════════════════════
  hdr(PC_ROW.SEC_COMMENTS_HEADER, PC_COL.LABEL_L, 9, 'COMMENTS:');
  sh.setRowHeight(PC_ROW.COMMENTS_BODY, 55);

  // ════════════════════════════════════════════════════════════════════════
  // §9  SIGNATURES (4 entries — values & dates filled by writer)
  // ════════════════════════════════════════════════════════════════════════
  // Each signature occupies 2 rows: label row + narrative row.
  var sigs = [
    [PC_ROW.SIG_SUBMITTED_DESIGN, 'SUBMITTED BY:',
       '(I take responsibility for delivering engineering design according to standards NOM)'],
    [PC_ROW.SIG_SUBMITTED_PM,     'SUBMITTED BY:', ''],
    [PC_ROW.SIG_RECEIVED,         'RECEIVED BY:',
       '(I verified and taking responsibility)'],
    [PC_ROW.SIG_APPROVED,         'APPROVED BY:',
       '(Budget approval)']
  ];
  sigs.forEach(function(s) {
    var headerRow = s[0];
    sh.getRange(headerRow, PC_COL.LABEL_L, 1, 8).setBackground(PC_V2_PALETTE.light);
    boldLabel(headerRow, PC_COL.LABEL_L, s[1]);
    label(headerRow, PC_COL.LABEL_R, 'Date:');
    if (s[2]) {
      label(headerRow + 1, PC_COL.USD_COST, s[2]);
    }
  });

  return sh;
}
