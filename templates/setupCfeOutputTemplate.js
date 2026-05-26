// =============================================================================
// ARGIA ENGINE v2 -- File: templates/setupCfeOutputTemplate.gs
// -----------------------------------------------------------------------------
// CHUNK 7 — CFE_OUTPUT_v2 template.
//
// WHAT THIS DOES
//   Creates or refreshes the CFE_OUTPUT_v2 sheet structure (all layout,
//   no source data):
//     - Banner (logo + title + subtitle) at rows 1-3, v2 convention
//       (matches MDC_v2 / BOM_v2 / INSTALLATION_v2 / RFQs_v2)
//     - 16-column canvas: A=margin, B=label, C..N=12 months, O=total, P=margin
//     - Header-strip label cells (rows 5-8) pre-styled, col B labels written
//     - KPI strip backdrop (row 10) pre-styled (writer fills values + colors)
//     - Section 1 (Con PV) header (row 12) + month header (row 13) + static
//       col-B labels for rows 14-20
//     - Section 2 (Con PV + BESS) header (row 22) + month header (row 23) +
//       static col-B labels for rows 24-31
//     - Annual footer header (row 33) + cascade label cells (row 34)
//     - Frozen rows 1-10 so banner + KPIs stay visible on scroll
//     - Hidden gridlines
//     - Image cleanup on refresh (the floating-logo stack fix from chunk 6)
//
//   Pure setup. Never reads INPUT_CFE, CFE_SIMULATION, BESS_SIMULATION, or
//   any other source. Never writes data values \u2014 only labels that are
//   constant across projects. Idempotent: running it twice is a no-op.
//
// POSITIONING (chunk 7 decision \u2014 matches legacy)
//   CFE_OUTPUT_v2 is positioned immediately BEFORE MDC_v2 in the tab order.
//   If MDC_v2 doesn't exist yet (chunk 2 hasn't run), the sheet is appended
//   at the end and re-positioning is left to the next engine run.
//
// LEAVES TO THE WRITER (conditional section)
//   - Y1SS section (rows 37-42) \u2014 only renders if BESS steady-state data
//     exists. Header styling + labels are NOT pre-laid by the template
//     because the whole section is sometimes absent.
//
// CALLED BY
//   - writers_v2/WriteCfeOutputV2.gs (writeCfeOutputV2)
//   - templates/TemplateRegistry.gs (setupAllV2Templates)
//   - tests_unit/templates/CfeOutputTemplateTests.gs
//
// DEPENDENCIES (v2 + shared infra only)
//   - V2_SHEETS.CFE_OUTPUT, V2_SHEETS.MDC       -- templates/TemplateRegistry.gs
//   - token, tokenNum, loadDesignTokens         -- 02a_DesignTokens.gs
//   - _insertArgiaLogo                          -- 02e_InputSetup.gs
//   - CFE_OUT_MONTHS_V2                         -- writers_v2/helpers/CfeOutputSourceMap.gs
// =============================================================================


// CFE_OUT_ROW_V2 — row addresses for CFE_OUTPUT_v2.
// Copy of legacy CFE_OUT_ROW (chunk 7 keeps the same layout for visual
// parity). All references go through this constant, never magic numbers,
// so future row shifts are localized to one place.
var CFE_OUT_ROW_V2 = (typeof CFE_OUT_ROW_V2 !== 'undefined' && CFE_OUT_ROW_V2) ? CFE_OUT_ROW_V2 : {
  // Banner — logo anchored at (2, 1) per v2 convention; title at row 2 col 3
  LOGO_ANCHOR     : 1,    // small blank row; logo image bleeds up into it
  TITLE           : 2,    // title text starts at col 3 (cols 1-2 = logo)
  SUBTITLE        : 3,

  // Header strip — 4 rows, label in col B, value in col C; second pair at H/J
  TARIFF_HEADER   : 5,
  LOCATION_ROW    : 6,
  INTERCONN_ROW   : 7,
  BESS_SPEC_ROW   : 8,

  // KPI headline — 3 big tiles
  KPI_HEADLINE    : 10,

  // Section 1: Con PV (rows 12-20)
  SEC1_HEADER     : 12,
  SEC1_MONTHHDR   : 13,
  SEC1_KWH_NETO   : 14,
  SEC1_SOLAR_KWH  : 15,
  SEC1_EXPORTADO  : 16,
  SEC1_DEMANDA    : 17,
  SEC1_FACTURACION: 18,
  SEC1_TOTAL      : 19,
  SEC1_AHORRO     : 20,

  // Section 2: Con PV + BESS (rows 22-31)
  SEC2_HEADER       : 22,
  SEC2_MONTHHDR     : 23,
  SEC2_DMAX_SIN     : 24,
  SEC2_POT_SHAVING  : 25,
  SEC2_DMAX_CON     : 26,
  SEC2_AHORRO_CAP   : 27,
  SEC2_AHORRO_DIST  : 28,
  SEC2_AHORRO_VAR   : 29,
  SEC2_AHORRO_TOTAL : 30,
  SEC2_RECIBO_FINAL : 31,

  // Annual footer cascade (rows 33-35)
  FOOTER_HEADER  : 33,
  FOOTER_LABELS  : 34,
  FOOTER_VALUES  : 35,

  // Year-1 vs Year-2+ steady-state section (rows 37-42) \u2014 conditional, NOT
  // pre-laid by template. Listed here for symbolic reference by writer.
  Y1SS_HEADER       : 37,
  Y1SS_LABELS       : 38,
  Y1SS_RECIBO       : 39,
  Y1SS_AHORRO_CAP   : 40,
  Y1SS_AHORRO_TOTAL : 41,
  Y1SS_NOTE         : 42
};


// 16 columns total. Same widths as legacy (BDF-11.1: 113px months, 135 totals).
var CFE_OUT_COL_WIDTHS_V2 = [25, 260, 113, 113, 113, 113, 113, 113, 113, 113, 113, 113, 113, 113, 135, 25];


// Static col-B row labels — these never change per project so the template
// owns them. Writer only fills col C..N values.
var CFE_OUT_SEC1_LABELS_V2 = [
  // [row, label]
  [14, 'Consumo neto (kWh)'],
  [15, 'kWh solares generados'],
  [16, 'kWh exportados a red'],
  [17, 'Demanda facturable (kW)'],
  [18, 'Facturacion (MXN)'],
  [19, 'TOTAL mensual (MXN)'],
  [20, 'Ahorro vs Sin PV (MXN)']
];
var CFE_OUT_SEC2_LABELS_V2 = [
  [24, 'Dmax punta sin BESS (kW)'],
  [25, 'Potencia de shaving (kW)'],
  [26, 'Dmax punta con BESS (kW)'],
  [27, 'Ahorro Capacidad (MXN)'],
  [28, 'Ahorro Distribucion (MXN)'],
  [29, 'Ahorro Variable estim. (MXN)'],
  [30, 'Ahorro BESS mensual TOTAL'],
  [31, 'Recibo final con BESS (MXN)']
];
var CFE_OUT_FOOTER_LABELS_V2 = [
  // [colStart, colEnd, label]
  [3,  4,  'Sin PV'],
  [5,  6,  'Ahorro PV'],
  [7,  8,  'Despues de PV'],
  [9,  10, 'Ahorro BESS'],
  [11, 12, 'Recibo final con BESS']
];


/**
 * Creates or refreshes the CFE_OUTPUT_v2 sheet structure.
 *
 * @param {Spreadsheet} ss   The active spreadsheet.
 * @param {Object}      opts Optional. { sheetName } overrides for tests.
 */
function setupCfeOutputTemplate(ss, opts) {
  ss = ss || SpreadsheetApp.getActive();
  opts = opts || {};

  if (typeof resetDesignTokenCache_ === 'function') resetDesignTokenCache_();
  if (typeof loadDesignTokens === 'function') loadDesignTokens(ss);

  var sheetName = opts.sheetName || V2_SHEETS.CFE_OUTPUT;
  var sh = ss.getSheetByName(sheetName);

  if (!sh) {
    // Position right before MDC_v2 if it exists; otherwise append.
    var mdcName = (V2_SHEETS && V2_SHEETS.MDC) || 'MDC_v2';
    var mdcSheet = ss.getSheetByName(mdcName);
    if (mdcSheet) {
      // insertSheet(name, index) is 0-based and inserts AT that index;
      // getIndex() is 1-based, so to insert BEFORE MDC pass mdcIndex - 1.
      sh = ss.insertSheet(sheetName, mdcSheet.getIndex() - 1);
    } else {
      sh = ss.insertSheet(sheetName);
    }
  } else {
    // Idempotent refresh: clear values + formats + notes + conditional
    // formats + floating images (the chunk-6 stacked-logo fix).
    sh.clear();
    sh.clearNotes();
    sh.clearConditionalFormatRules();
    _cfeOutV2_removeImages(sh);
  }

  // -- 1. Canvas: 16 columns, hidden gridlines ------------------------------
  try { sh.setHiddenGridlines(true); } catch (e) { /* not supported in mock */ }
  for (var c = 0; c < CFE_OUT_COL_WIDTHS_V2.length; c++) {
    sh.setColumnWidth(c + 1, CFE_OUT_COL_WIDTHS_V2[c]);
  }

  var R = CFE_OUT_ROW_V2;

  // -- 2. Banner (rows 1-3) ------------------------------------------------
  // Row 1 = small logo-anchor row (default height, kept blank).
  // Row 2 = title text from col 3 (cols 1-2 reserved for logo image).
  // Row 3 = subtitle.
  try {
    if (typeof _insertArgiaLogo === 'function') {
      _insertArgiaLogo(sh, R.TITLE, 1);
    }
  } catch (logoErr) {
    // Title text alone is sufficient if logo can't be loaded
  }

  sh.getRange(R.TITLE, 3, 1, 12).breakApart().merge()
    .setValue('CFE OUTPUT')
    .setFontWeight('bold')
    .setFontSize(16)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left');
  sh.setRowHeight(R.TITLE, 42);

  sh.getRange(R.SUBTITLE, 3, 1, 12).breakApart().merge()
    .setValue('Impacto economico:  Sin PV  vs  Con PV  vs  Con PV + BESS')
    .setFontSize(10)
    .setFontColor('#666666')
    .setVerticalAlignment('top')
    .setHorizontalAlignment('left');

  // -- 3. Header strip (rows 5-8) ------------------------------------------
  // Static col-B labels (left column) + col-H labels (right column).
  // Values land in col C and col J (writer fills).
  var stripLabels = [
    [R.TARIFF_HEADER, 'TARIFF CODE',     'SERVICE NAME'],
    [R.LOCATION_ROW,  'SERVICE NUMBER',  'CONTRACTED kW'],
    [R.INTERCONN_ROW, 'INTERCONEXION',   'AUTOCONSUMO %'],
    [R.BESS_SPEC_ROW, 'ESTRATEGIA BESS', 'BATERIA kWh / kW']
  ];
  for (var s = 0; s < stripLabels.length; s++) {
    var rr = stripLabels[s][0];
    sh.getRange(rr, 2).setValue(stripLabels[s][1])
      .setFontWeight('normal')
      .setHorizontalAlignment('right');
    sh.getRange(rr, 8).setValue(stripLabels[s][2])
      .setFontWeight('normal')
      .setHorizontalAlignment('right');
    sh.setRowHeight(rr, 22);
  }

  // -- 4. KPI strip (row 10) ----------------------------------------------
  // Just reserve the row + height. Writer paints the 3 tiles with their
  // colors and merges because the third tile is conditional (steady vs not).
  sh.setRowHeight(R.KPI_HEADLINE, 60);

  // -- 5. Section 1 header + month header + static labels -----------------
  _cfeOutV2_paintSectionHeader(sh, R.SEC1_HEADER, '1.  RECIBO CON PV', '#E3F2FD');
  _cfeOutV2_paintMonthHeader(sh, R.SEC1_MONTHHDR);
  for (var i = 0; i < CFE_OUT_SEC1_LABELS_V2.length; i++) {
    var lbl = CFE_OUT_SEC1_LABELS_V2[i];
    sh.getRange(lbl[0], 2).setValue(lbl[1])
      .setFontSize(10)
      .setHorizontalAlignment('left');
  }
  // Highlight totals + savings rows
  sh.getRange(R.SEC1_TOTAL,  2).setFontWeight('bold');
  sh.getRange(R.SEC1_AHORRO, 2).setFontWeight('bold');
  sh.getRange(R.SEC1_AHORRO, 2, 1, 13).setBackground('#E8F5E9');

  // -- 6. Section 2 header + month header + static labels -----------------
  _cfeOutV2_paintSectionHeader(sh, R.SEC2_HEADER, '2.  RECIBO CON PV + BESS', '#C8E6C9');
  _cfeOutV2_paintMonthHeader(sh, R.SEC2_MONTHHDR);
  for (var j = 0; j < CFE_OUT_SEC2_LABELS_V2.length; j++) {
    var lbl2 = CFE_OUT_SEC2_LABELS_V2[j];
    sh.getRange(lbl2[0], 2).setValue(lbl2[1])
      .setFontSize(10)
      .setHorizontalAlignment('left');
  }
  // Totals + final highlights
  sh.getRange(R.SEC2_AHORRO_TOTAL, 2).setFontWeight('bold');
  sh.getRange(R.SEC2_AHORRO_TOTAL, 2, 1, 13).setBackground('#C8E6C9');
  sh.getRange(R.SEC2_RECIBO_FINAL, 2).setFontWeight('bold');

  // -- 7. Annual footer cascade (rows 33-34) ------------------------------
  _cfeOutV2_paintSectionHeader(sh, R.FOOTER_HEADER,
                               'RESUMEN ANUAL  -  Cascada de ahorros',
                               '#F5F3EE');
  // Footer labels row 34 (merged blocks across 2 cols each)
  for (var k = 0; k < CFE_OUT_FOOTER_LABELS_V2.length; k++) {
    var f = CFE_OUT_FOOTER_LABELS_V2[k];
    var colStart = f[0], colEnd = f[1], label = f[2];
    sh.getRange(R.FOOTER_LABELS, colStart, 1, colEnd - colStart + 1)
      .breakApart().merge()
      .setValue(label)
      .setFontSize(9)
      .setFontColor('#666666')
      .setHorizontalAlignment('center');
  }
  // Reserve row 35 height (writer fills values)
  sh.setRowHeight(R.FOOTER_VALUES, 40);

  // -- 8. Freeze banner + KPI strip ---------------------------------------
  // Same as legacy: freeze through row 10 so banner + KPIs stay visible
  // when scrolling. setFrozenColumns is NOT used (legacy comment: KPI
  // strip merges across col B would conflict).
  sh.setFrozenRows(R.KPI_HEADLINE);

  SpreadsheetApp.flush && SpreadsheetApp.flush();
  return sh;
}


/**
 * Private: paint a section-header band (rows 12, 22, 33).
 * Merges cols B..N (2..14), sets value + bg + bold.
 */
function _cfeOutV2_paintSectionHeader(sh, row, label, bgColor) {
  sh.getRange(row, 2, 1, 13).breakApart().merge()
    .setValue(label)
    .setFontWeight('bold')
    .setFontSize(11)
    .setBackground(bgColor)
    .setVerticalAlignment('middle');
  sh.setRowHeight(row, 26);
}


/**
 * Private: paint a month-header row (Mes | Ene Feb ... Dic).
 */
function _cfeOutV2_paintMonthHeader(sh, row) {
  sh.getRange(row, 2).setValue('Mes')
    .setFontSize(9)
    .setFontColor('#666666')
    .setHorizontalAlignment('left');
  for (var m = 0; m < CFE_OUT_MONTHS_V2.length; m++) {
    sh.getRange(row, 3 + m).setValue(CFE_OUT_MONTHS_V2[m])
      .setFontSize(9)
      .setFontColor('#666666')
      .setHorizontalAlignment('right');
  }
  // Bottom border on the month-header row, light gray
  try {
    sh.getRange(row, 2, 1, 13).setBorder(
      false, false, true, false, false, false,
      '#cccccc', SpreadsheetApp.BorderStyle.SOLID
    );
  } catch (e) { /* mock may not support */ }
}


/**
 * Private: remove all floating images on the sheet. Used on refresh so
 * re-running the template doesn't stack logos (the chunk-6 issue).
 * Best-effort \u2014 swallows any error so tests that don't mock getImages()
 * still pass.
 */
function _cfeOutV2_removeImages(sh) {
  try {
    if (typeof sh.getImages !== 'function') return;
    var imgs = sh.getImages();
    if (!imgs || !imgs.length) return;
    for (var i = 0; i < imgs.length; i++) {
      try { imgs[i].remove(); } catch (e) { /* keep going */ }
    }
  } catch (err) {
    // No-op in test environments
  }
}
