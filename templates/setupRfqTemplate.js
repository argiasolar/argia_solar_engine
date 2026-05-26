// =============================================================================
// ARGIA ENGINE v2 -- File: templates/setupRfqTemplate.gs
// -----------------------------------------------------------------------------
// CHUNK 6 — Generic RFQ template. Builds the static structure of a single
// RFQ sheet (banner, metadata block, column headers, commercial terms,
// supplier response block, footer). The item table is left blank; the
// writer (WriteRfqV2) fills it.
//
// WHAT THIS DOES
//   Creates or refreshes one RFQ_*_v2 sheet:
//     - Row 1   : Title bar "REQUEST FOR QUOTATION — <category>"
//     - Row 2   : Thin spacer
//     - Rows 3-6: Metadata block (FROM / PROJECT / LOCATION / SYSTEM with
//                 right-side RFQ Number, Issue date, Response by, Delivery req)
//     - Row 7   : Thin spacer
//     - Row 8   : Column headers (#, Description, Model/Spec, Qty, Unit,
//                 Technical requirement, Unit price, CCY, Total, Lead wks,
//                 Warranty yrs, Incoterms, Notes)
//     - Row 9   : Supplier-columns hint row ("Supplier fills G\u2013M")
//     - Rows 10+: Item table area (writer fills, template only sets widths)
//
//   Pure setup. Never reads INPUT_*, BOM_v2, or calc results. Idempotent.
//
// PARAMETERIZATION
//   This function is called 6 times \u2014 once per RFQ sheet \u2014 with
//   different sheetName and categoryTitle. The shape of the static structure
//   is identical across all 6; only the title text and the sheet it lands on
//   change at template time. Item content is filled later by the writer.
//
// COLUMN LAYOUT (13 cols, matches legacy 15_WriteRFQ.js)
//   A=#  B=Description  C=Model/Spec  D=Qty  E=Unit  F=Tech req
//   G=Unit price  H=CCY  I=Total  J=Lead wks  K=Warranty yrs
//   L=Incoterms  M=Notes
//
// PALETTE (independent of legacy RFQ_COLORS \u2014 v2 must stand alone)
//   Pulled from design tokens where possible (TEXT_PRIMARY, BG_PAGE,
//   FONT_FAMILY, FONT_SIZE_*, ROW_H_*). RFQ-specific colors hardcoded:
//   header band (#37474F), supplier cells (#FFF9C4 yellow), argia cells
//   (#ECEFF1 grey). These mirror legacy by design \u2014 visual parity is
//   a chunk acceptance criterion.
//
// CALLED BY
//   - writers_v2/WriteRfqV2.gs (writeRfqV2 calls setupRfqTemplate immediately
//     before writing data)
//   - templates/TemplateRegistry.gs (setupAllV2Templates iterates with sheet
//     name as argument)
//   - tests_unit/templates/RfqTemplateTests.gs
//
// DEPENDENCIES (v2 infra only \u2014 no legacy)
//   - V2_SHEETS, RFQ_REGISTRY   -- templates/RfqRegistry.gs + TemplateRegistry.gs
//   - token, tokenNum, loadDesignTokens -- 02a_DesignTokens.gs (shared infra)
//   - _insertArgiaLogo          -- 02e_InputSetup.gs (shared helper)
// =============================================================================


// RFQ template constants. Local to this file \u2014 NOT shared with legacy
// RFQ_COLORS or RFQ_SHEETS. Renaming this prefix is the only edit needed if
// legacy and v2 ever coexist in the same global namespace (they currently do).
var RFQV2_TPL = {
  // Color palette (matches legacy by design for visual parity)
  COLOR_HDR_BG       : '#37474F',
  COLOR_HDR_FG       : '#FFFFFF',
  COLOR_SUBHDR_BG    : '#ECEFF1',
  COLOR_SUBHDR_FG    : '#000000',
  COLOR_ROW_WHITE    : '#FFFFFF',
  COLOR_ROW_ALT      : '#ECEFF1',
  COLOR_SUPPLIER     : '#FFF9C4',  // yellow \u2014 supplier fills
  COLOR_SUPPLIER_HDR : '#F9A825',  // amber header above supplier cols
  COLOR_SUPPLIER_FG  : '#4E342E',
  COLOR_ARGIA        : '#ECEFF1',  // grey \u2014 read-only argia cells
  COLOR_TECH_NOTES_BG: '#FFF3E0',

  // Column widths in px (13 cols total). Matches legacy.
  COL_WIDTHS         : [30, 240, 120, 60, 60, 160, 90, 55, 90, 60, 70, 80, 100],

  // Layout row addresses \u2014 the static structure.
  // Row 1 is the logo anchor row: small (default ~21px), kept blank so the
  // 42px-tall logo image \u2014 anchored at (2, 1) per v2 convention used by
  // MDC_v2 / BOM_v2 / INSTALLATION_v2 \u2014 can bleed up into it without
  // overlapping any text. The title sits on row 2 with text starting at
  // col 3 (cols 1-2 reserved for the logo image footprint).
  ROW_LOGO_ANCHOR    : 1,
  ROW_TITLE          : 2,
  ROW_SPACER_1       : 3,
  ROW_META_FROM      : 4,
  ROW_META_PROJECT   : 5,
  ROW_META_LOCATION  : 6,
  ROW_META_SYSTEM    : 7,
  ROW_SPACER_2       : 8,
  ROW_COL_HEADERS    : 9,
  ROW_SUPPLIER_HINT  : 10,
  ROW_ITEMS_START    : 11,

  // Number of columns in the table
  NUM_COLS           : 13,

  // Column header labels
  COL_HEADERS        : ['#', 'Description', 'Model / Spec', 'Qty', 'Unit',
                        'Technical requirement', 'Unit price', 'CCY', 'Total',
                        'Lead wks', 'Warranty yrs', 'Incoterms', 'Notes']
};


/**
 * Creates or refreshes the static structure of one RFQ_*_v2 sheet.
 *
 * @param {Spreadsheet} ss        The active spreadsheet.
 * @param {string}      sheetName Name of the v2 RFQ sheet to set up. Must be
 *                                one of the V2_SHEETS RFQ values (e.g.
 *                                'RFQ_PANELES_v2', 'RFQ_BESS_v2').
 * @param {Object}      opts      Optional. { categoryTitle } overrides the
 *                                title text. If omitted, derived from
 *                                RFQ_REGISTRY by matching sheetName.
 */
function setupRfqTemplate(ss, sheetName, opts) {
  ss = ss || SpreadsheetApp.getActive();
  opts = opts || {};

  if (!sheetName) {
    throw new Error('setupRfqTemplate: sheetName is required ' +
                    '(e.g. V2_SHEETS.RFQ_PANELES)');
  }

  if (typeof resetDesignTokenCache_ === 'function') resetDesignTokenCache_();
  if (typeof loadDesignTokens === 'function') loadDesignTokens(ss);

  // Resolve title: explicit opts wins; otherwise look up by sheetName
  // in RFQ_REGISTRY. If no match, use the sheet name as the title.
  var categoryTitle = opts.categoryTitle;
  if (!categoryTitle) {
    for (var i = 0; i < RFQ_REGISTRY.length; i++) {
      var entry = RFQ_REGISTRY[i];
      if (V2_SHEETS[entry.sheetKey] === sheetName) {
        categoryTitle = entry.title;
        break;
      }
    }
    if (!categoryTitle) categoryTitle = sheetName;
  }

  // Sheet creation OR idempotent refresh
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  } else {
    // Idempotent refresh: clear values + formats so re-running setup
    // produces the same result as setting up fresh.
    sh.clear();
    sh.clearNotes();
    sh.clearConditionalFormatRules();
  }

  var T = RFQV2_TPL;

  // -- Column widths ----------------------------------------------------------
  for (var c = 0; c < T.COL_WIDTHS.length; c++) {
    sh.setColumnWidth(c + 1, T.COL_WIDTHS[c]);
  }

  // -- Wrap text on the columns that carry long strings ----------------------
  // Description (B), Model/Spec (C), Technical requirement (F). Apply
  // generously to the first 300 rows so item rows automatically wrap.
  sh.getRange(1, 2, 300, 1).setWrap(true);  // B
  sh.getRange(1, 3, 300, 1).setWrap(true);  // C
  sh.getRange(1, 6, 300, 1).setWrap(true);  // F

  // -- Row 1: Logo anchor row (kept default height, intentionally blank) -----
  // The logo image (42px tall) is anchored at (2, 1) below but floats up
  // into row 1's space. Keeping row 1 default-height + empty means the
  // logo has clean visual room above the title without overlapping text.

  // -- Row 2: Title row \u2014 logo at left (cols 1-2), title text from col 3 ---
  // Matches BOM_v2 / MDC_v2 / INSTALLATION_v2 banner convention.
  // Insert logo first so it ends up at (2, 1). Best-effort \u2014 swallowed if
  // the logo asset can't be loaded (mocked-out in tests, missing in dev).
  try {
    if (typeof _insertArgiaLogo === 'function') {
      _insertArgiaLogo(sh, T.ROW_TITLE, 1);
    }
  } catch (logoErr) {
    // Title text alone is sufficient if the logo can't be loaded.
  }

  // Title text \u2014 starts at col 3 so cols 1-2 host the logo image.
  sh.getRange(T.ROW_TITLE, 3, 1, T.NUM_COLS - 2).breakApart().merge()
    .setValue('REQUEST FOR QUOTATION  \u2014  ' +
              String(categoryTitle).toUpperCase())
    .setFontWeight('bold')
    .setFontSize(16)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left');
  sh.setRowHeight(T.ROW_TITLE, 42);   // matches LOGO_HEIGHT_PX

  // -- Row 3: thin spacer -----------------------------------------------------
  sh.setRowHeight(T.ROW_SPACER_1, 4);

  // -- Rows 3-6: Metadata block ----------------------------------------------
  // Layout per row: argia bg, label in col B (bold), value merged C-F,
  // right-side label in col G (bold), right-side value merged H-M.
  var META_LABELS = [
    { row: T.ROW_META_FROM,     left: 'FROM:',     right: 'RFQ Number:'  },
    { row: T.ROW_META_PROJECT,  left: 'PROJECT:',  right: 'Issue date:'  },
    { row: T.ROW_META_LOCATION, left: 'LOCATION:', right: 'Response by:' },
    { row: T.ROW_META_SYSTEM,   left: 'SYSTEM:',   right: 'Delivery req:'}
  ];
  for (var m = 0; m < META_LABELS.length; m++) {
    var row = META_LABELS[m].row;
    sh.getRange(row, 1, 1, T.NUM_COLS).setBackground(T.COLOR_ARGIA);
    sh.getRange(row, 2).setValue(META_LABELS[m].left).setFontWeight('bold');
    sh.getRange(row, 3, 1, 4).merge();   // value lands in C, merges C-F
    sh.getRange(row, 7).setValue(META_LABELS[m].right).setFontWeight('bold');
    sh.getRange(row, 8, 1, 6).merge();   // value lands in H, merges H-M
  }

  // -- Row 7: thin spacer -----------------------------------------------------
  sh.setRowHeight(T.ROW_SPACER_2, 6);

  // -- Row 8: Column header row ----------------------------------------------
  sh.getRange(T.ROW_COL_HEADERS, 1, 1, T.NUM_COLS)
    .setBackground(T.COLOR_SUBHDR_BG)
    .setFontWeight('bold')
    .setFontColor(T.COLOR_SUBHDR_FG);
  for (var h = 0; h < T.COL_HEADERS.length; h++) {
    sh.getRange(T.ROW_COL_HEADERS, h + 1).setValue(T.COL_HEADERS[h]);
  }
  // Mark supplier-fill columns (G-M = 7-13) with amber header
  sh.getRange(T.ROW_COL_HEADERS, 7, 1, 7)
    .setBackground(T.COLOR_SUPPLIER_HDR)
    .setFontColor(T.COLOR_SUPPLIER_FG);
  sh.setRowHeight(T.ROW_COL_HEADERS, 22);

  // -- Row 9: Supplier hint row ----------------------------------------------
  sh.getRange(T.ROW_SUPPLIER_HINT, 7, 1, 7)
    .setBackground(T.COLOR_SUPPLIER)
    .merge();
  sh.getRange(T.ROW_SUPPLIER_HINT, 7)
    .setValue('\u2190 Supplier fills columns G\u2013M \u2192')
    .setFontStyle('italic')
    .setFontColor('#795548')
    .setFontSize(9);
  sh.setRowHeight(T.ROW_SUPPLIER_HINT, 16);

  // -- Freeze the top 9 rows so the item table scrolls under stable header --
  sh.setFrozenRows(T.ROW_SUPPLIER_HINT);

  // Hide gridlines for a cleaner printable look (matches legacy intent)
  try { sh.setHiddenGridlines(true); } catch (e) { /* not supported in mock */ }

  SpreadsheetApp.flush && SpreadsheetApp.flush();
  return sh;
}
