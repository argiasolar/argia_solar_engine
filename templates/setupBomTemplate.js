// =============================================================================
// ARGIA ENGINE v2 -- File: templates/setupBomTemplate.gs
// -----------------------------------------------------------------------------
// CHUNK 4 — BOM_v2 template.
//
// WHAT THIS DOES
//   Creates or refreshes the BOM_v2 sheet structure:
//     - Banner (logo + title + subtitle) at rows 1-3
//     - Project meta row (4), column header row (5), exchange-rate row (6)
//     - 8 section header rows (panels/inverters/structure/DC/AC/transformer/
//       monitoring/BESS) at fixed BOM_ROW addresses
//     - 8 subtotal rows pre-styled (cream bg, bold, top border)
//     - Grand total row pre-styled (stronger emphasis)
//     - Cell-level formatting (number formats, alignment, fonts) for the
//       entire content range
//     - Frozen header + Description col
//
//   Pure setup. Never reads INPUT_*, BOM_v2 sheet, MASTER_DB sheets, or
//   calc results. Never writes data values (item #s, quantities, prices,
//   formulas referencing other rows). Those come from WriteBomV2.
//   Idempotent — running this twice leaves the same visual result.
//
// WHY A FIXED-ROW TEMPLATE
//   Legacy 08_WriteBOM.js mixes layout and data: the writer set backgrounds,
//   row heights, and borders DURING data writing. Then the §8 BESS reset
//   block at lines 936-991 in legacy is pure cleanup of inconsistencies
//   that the template should have prevented in the first place.
//
//   v2 fixes this: template owns all formatting, writer only writes values
//   and value-bearing formulas. The §8 reset block disappears.
//
// LAYOUT (8 cols, mirrors legacy + BOM_COL constants in 00_Main.js)
//   A=ITEM(#)  B=DESCRIPTION  C=QTY  D=UNIT
//   E=UNIT_PRICE(USD)  F=TOTAL_USD  G=TOTAL_MXN  H=REFERENCE
//
// CALLED BY
//   - setupAllV2Templates(ss) in templates/TemplateRegistry.gs (Chunk 0)
//   - runArgiaEngine() (Step 11-v2) once per engine run
//   - resetOutputs() (Chunk 12, when built)
//
// DEPENDENCIES
//   - V2_SHEETS.BOM ('BOM_v2')                  -- templates/TemplateRegistry.gs
//   - BOM_ROW, BOM_COL                           -- 00_Main.js (shared with legacy)
//   - token, tokenNum, loadDesignTokens          -- 02a_DesignTokens.js
//   - _insertArgiaLogo                           -- 02e_InputSetup.js (shared helper)
// =============================================================================


function setupBomTemplate(ss, opts) {
  ss = ss || SpreadsheetApp.getActive();
  opts = opts || {};
  if (typeof resetDesignTokenCache_ === 'function') resetDesignTokenCache_();
  if (typeof loadDesignTokens === 'function') loadDesignTokens(ss);

  var sheetName = opts.sheetName || V2_SHEETS.BOM;
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  } else {
    // Idempotent refresh: clear everything (values + formats + notes + CF),
    // then re-render. Same pattern as PC_v2.
    sh.clear();
    sh.clearConditionalFormatRules();
  }
  sh.setHiddenGridlines(true);

  // ---- Column widths (mirror legacy setupBOMTemplate) ---------------------
  sh.setColumnWidth(BOM_COL.ITEM,        50);
  sh.setColumnWidth(BOM_COL.DESCRIPTION, 380);
  sh.setColumnWidth(BOM_COL.QTY,         70);
  sh.setColumnWidth(BOM_COL.UNIT,        70);
  sh.setColumnWidth(BOM_COL.UNIT_PRICE,  110);
  sh.setColumnWidth(BOM_COL.TOTAL_USD,   120);
  sh.setColumnWidth(BOM_COL.TOTAL_MXN,   120);
  sh.setColumnWidth(BOM_COL.REFERENCE,   220);

  // ---- Banner (rows 1-3) --------------------------------------------------
  if (typeof _insertArgiaLogo === 'function') {
    _insertArgiaLogo(sh, 2, 1);
  }
  sh.getRange(BOM_ROW.BANNER_TITLE, 3, 1, 4).breakApart().merge()
    .setValue('BILL OF MATERIALS')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_TITLE'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('bottom')
    .setHorizontalAlignment('left');
  sh.getRange(BOM_ROW.BANNER_SUBTITLE, 3, 1, 4).breakApart().merge()
    .setValue('Cantidades, precios unitarios y subtotales por sección · v2')
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setHorizontalAlignment('left');
  sh.setRowHeight(BOM_ROW.BANNER_TITLE, tokenNum('ROW_H_TITLE'));

  // ---- Project meta row (4) ----------------------------------------------
  // Writer fills "BOM -- <projectName> | <client> | <kWp> ..." here.
  sh.getRange(BOM_ROW.PROJECT_META, 1, 1, 8)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_MUTED'))
    .setVerticalAlignment('middle');

  // ---- Column header row (5) ---------------------------------------------
  var headers = ['#','DESCRIPCION','QTY','UNIDAD','PRECIO U (USD)',
                 'TOTAL (USD)','TOTAL (MXN)','REFERENCIA'];
  sh.getRange(BOM_ROW.HEADERS, 1, 1, 8)
    .setValues([headers])
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setBackground(token('BG_INPUT_CELL'))
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('center');
  sh.getRange(BOM_ROW.HEADERS, BOM_COL.DESCRIPTION).setHorizontalAlignment('left');
  sh.getRange(BOM_ROW.HEADERS, BOM_COL.REFERENCE).setHorizontalAlignment('left');
  sh.setRowHeight(BOM_ROW.HEADERS, 28);
  sh.getRange(BOM_ROW.HEADERS, 1, 1, 8).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_STRONG'), SpreadsheetApp.BorderStyle.SOLID
  );

  // ---- Exchange-rate row (6) ---------------------------------------------
  // Pre-styled. Writer fills label in col E + value in col F.
  sh.getRange(BOM_ROW.EXCHANGE_RATE, 1, 1, 8)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setVerticalAlignment('middle');
  sh.getRange(BOM_ROW.EXCHANGE_RATE, BOM_COL.TOTAL_USD)
    .setBackground(token('BG_PAGE'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setHorizontalAlignment('right');

  // ---- Pre-style content rows (7..GRAND_TOTAL) ----------------------------
  // The writer's setValue calls preserve formatting, so styling here persists.
  var contentStart = BOM_ROW.SEC_PANELS;
  var contentRows  = BOM_ROW.GRAND_TOTAL - BOM_ROW.SEC_PANELS + 1;
  var contentRange = sh.getRange(contentStart, 1, contentRows, 8);
  contentRange
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('middle');
  // QTY (col C) — integers with thousands sep
  sh.getRange(contentStart, BOM_COL.QTY, contentRows, 1)
    .setNumberFormat('#,##0').setHorizontalAlignment('right');
  // Unit prices (col E) — 2 decimals
  sh.getRange(contentStart, BOM_COL.UNIT_PRICE, contentRows, 1)
    .setNumberFormat('#,##0.00').setHorizontalAlignment('right');
  // Line total USD (col F) — 2 decimals
  sh.getRange(contentStart, BOM_COL.TOTAL_USD, contentRows, 1)
    .setNumberFormat('#,##0.00').setHorizontalAlignment('right');
  // Line total MXN (col G) — no decimals
  sh.getRange(contentStart, BOM_COL.TOTAL_MXN, contentRows, 1)
    .setNumberFormat('#,##0').setHorizontalAlignment('right');
  // Description (col B) left-aligned + wrap
  sh.getRange(contentStart, BOM_COL.DESCRIPTION, contentRows, 1)
    .setHorizontalAlignment('left').setWrap(true);
  // Item # (col A) center-aligned, integer format
  sh.getRange(contentStart, BOM_COL.ITEM, contentRows, 1)
    .setHorizontalAlignment('center').setNumberFormat('0');
  // Reference (col H) muted, smaller, left-aligned, wrap
  sh.getRange(contentStart, BOM_COL.REFERENCE, contentRows, 1)
    .setHorizontalAlignment('left')
    .setFontSize(tokenNum('FONT_SIZE_SMALL'))
    .setFontColor(token('TEXT_MUTED'))
    .setWrap(true);

  // ---- Section header bands (8 sections) ----------------------------------
  // Light-grey bg, bold, 11pt. Writer overwrites col B with section title
  // text; styling persists through setValue.
  var sectionHeaderRows = [
    BOM_ROW.SEC_PANELS,
    BOM_ROW.SEC_INVERTERS,
    BOM_ROW.SEC_STRUCTURE,
    BOM_ROW.SEC_DC,
    BOM_ROW.SEC_AC,
    BOM_ROW.SEC_TRANSFORMER,
    BOM_ROW.SEC_MONITORING,
    BOM_ROW.SEC_BESS
  ];
  sectionHeaderRows.forEach(function(r) {
    sh.getRange(r, 1, 1, 8)
      .setBackground('#f5f5f5')
      .setFontWeight('bold')
      .setFontSize(11);
    sh.setRowHeight(r, 24);
  });

  // ---- Subtotal rows (8 subtotals) ----------------------------------------
  // Bold + cream bg + top border. Writer fills label in col B + SUM formula
  // in cols F & G; styling persists through setValue/setFormula.
  var subtotalRows = [
    BOM_ROW.SUBTOTAL_PANELS,
    BOM_ROW.SUBTOTAL_INVERTERS,
    BOM_ROW.SUBTOTAL_STRUCTURE,
    BOM_ROW.SUBTOTAL_DC,
    BOM_ROW.SUBTOTAL_AC,
    BOM_ROW.SUBTOTAL_TRANSFORMER,
    BOM_ROW.SUBTOTAL_MONITORING,
    BOM_ROW.SUBTOTAL_BESS
  ];
  subtotalRows.forEach(function(r) {
    sh.getRange(r, 1, 1, 8)
      .setBackground('#fff8e1')
      .setFontWeight('bold')
      .setBorder(true, null, null, null, null, null,
                 '#bdbdbd', SpreadsheetApp.BorderStyle.SOLID);
    sh.setRowHeight(r, 22);
  });

  // ---- Grand total row -----------------------------------------------------
  // Strongest emphasis: bold larger font + thicker top+bottom border + bg.
  sh.getRange(BOM_ROW.GRAND_TOTAL, 1, 1, 8)
    .setBackground('#fffde7')
    .setFontWeight('bold')
    .setFontSize(12)
    .setBorder(true, null, true, null, null, null,
               '#424242', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setRowHeight(BOM_ROW.GRAND_TOTAL, 28);

  // ---- Freeze --------------------------------------------------------------
  // Freeze through col headers (5 rows). Row 6 (exchange rate) intentionally
  // NOT frozen — it's an editable rate input below the freeze line.
  sh.setFrozenRows(BOM_ROW.HEADERS);
  sh.setFrozenColumns(BOM_COL.DESCRIPTION);

  return sh;
}
