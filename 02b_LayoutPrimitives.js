// =============================================================================
// ARGIA ENGINE v7 -- File: 02b_LayoutPrimitives.gs
// Reusable layout functions that render consistent visual patterns across
// every sheet in the workbook — both the inputs the user edits and the
// outputs the engine generates.
//
// WHY
//   Every writer used to call setFontColor / setBorder / setFontSize /
//   setBackground directly, with different hex codes sprinkled across 5
//   files. That made retheming impossible and drift inevitable.
//
//   Primitives centralize the patterns. Writers call primBodyRow() and get
//   the same look as every other body row in the workbook. Tokens drive
//   the values; primitives drive the layout.
//
// REQUIRES
//   loadDesignTokens(ss) must have been called before any primitive runs.
//   Each writer / template function calls it once at the top.
//
// COLUMN CONVENTION
//   Col A (1)    narrow left margin (empty, 24px wide)
//   Cols B..G    printable content area (2..7)
//   Cols H+      audit / off-print columns (MDC only — primAuditCells)
//
// NAMING
//   All primitives are prefixed prim* to avoid collisions with writers
//   or with Apps Script globals.
//
// POPULATED HERE
//   primDocTitle        top-of-page title + subtitle
//   primSectionHeader   "01 IDENTIFICACIÓN" style with optional progress pill
//   primBodyRow         label + value + optional status icon
//
// DEFERRED (added as writers are refactored — we build from real usage,
// not speculation)
//   primAuditCells      MDC off-print auditoría columns (PROV / CITATION / FORMULA)
//   primSubtotalRow     BOM / InstallCost / ProjectCard subtotals
//   primTotalRow        grand totals with double-rule above
//   primCalloutBox      DES-FLAG / DATA-FLAG boxes
//   primStatBlock       Project Card big-number cells (655.2 kWp etc.)
//   primReadinessBar    Input-sheet readiness + action buttons
//   primInputRow        Input-sheet row with "— pendiente" italic placeholder
// =============================================================================

// -----------------------------------------------------------------------------
// primDocTitle
// -----------------------------------------------------------------------------
//   Writes the top-of-page title and (optionally) a subtitle one row below.
//   Mockup reference: MDC row 2 "MEMORIA DE CÁLCULO" + row 3 breadcrumb.
//
//   sh        sheet
//   row       first row of the title block (subtitle goes to row+1)
//   title     string — e.g. "MEMORIA DE CÁLCULO"
//   subtitle  optional string — e.g. "CPA VITALMEX · Rev 00 · Generado 22/04/2026"
//             pass null or '' to skip the subtitle row
// -----------------------------------------------------------------------------
function primDocTitle(sh, row, title, subtitle) {
  sh.getRange(row, 2, 1, 6).breakApart().merge()
    .setValue(title)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_TITLE'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('bottom');
  sh.setRowHeight(row, tokenNum('ROW_H_TITLE'));

  if (subtitle != null && subtitle !== '') {
    sh.getRange(row + 1, 2, 1, 6).breakApart().merge()
      .setValue(subtitle)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SMALL'))
      .setFontColor(token('TEXT_SECONDARY'));
  }
}

// -----------------------------------------------------------------------------
// primSectionHeader
// -----------------------------------------------------------------------------
//   Writes a numbered section header with a bottom divider line.
//   Mockup reference: "01 IDENTIFICACIÓN    ● 4 de 6 completos"
//
//   Layout:
//     col B     section number, grey           e.g. "01"
//     cols C-E  section title, bold black      e.g. "IDENTIFICACIÓN"
//     cols F-G  right-aligned progress (opt.)  e.g. "4 de 6 completos"
//
//   sh        sheet
//   row       row to write
//   num       section number string — e.g. "01", "02", "03"
//   title     title string — e.g. "IDENTIFICACIÓN"
//   right     optional right-side text (progress, status, etc.) — null to omit
// -----------------------------------------------------------------------------
function primSectionHeader(sh, row, num, title, right) {
  sh.getRange(row, 2).setValue(num)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SECTION'))
    .setFontColor(token('TEXT_SECONDARY'))
    .setVerticalAlignment('middle');

  sh.getRange(row, 3, 1, 3).breakApart().merge()
    .setValue(title)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_SECTION'))
    .setFontWeight(token('FONT_WEIGHT_EMPHASIS'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('middle');

  if (right != null && right !== '') {
    sh.getRange(row, 6, 1, 2).breakApart().merge()
      .setValue(right)
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_SMALL'))
      .setFontColor(token('TEXT_SECONDARY'))
      .setHorizontalAlignment('right')
      .setVerticalAlignment('middle');
  }

  sh.setRowHeight(row, tokenNum('ROW_H_SECTION'));

  // Thin bottom divider
  sh.getRange(row, 2, 1, 6).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
}

// -----------------------------------------------------------------------------
// primBodyRow
// -----------------------------------------------------------------------------
//   Writes a single label/value row with optional status icon on the far right.
//   Mockup reference: "Proyecto ........ CPA VITALMEX   ✓"
//                     "Contacto principal ... — pendiente   !"
//
//   Layout:
//     cols B-C   label, left-aligned                e.g. "Proyecto"
//     cols D-F   value, right-aligned               e.g. "CPA VITALMEX"
//     col G      status icon, centered (optional)   ✓ / ! / ✗
//
//   Empty values render as italic muted "— pendiente" automatically.
//
//   sh        sheet
//   row       row to write
//   label     left-column text
//   value     right-column value — null/'' renders as italic pendiente
//   status    optional: 'pass' | 'warn' | 'fail' — renders coloured icon
// -----------------------------------------------------------------------------
function primBodyRow(sh, row, label, value, status) {
  // Label (cols B-C merged)
  sh.getRange(row, 2, 1, 2).breakApart().merge()
    .setValue(label)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(token('TEXT_PRIMARY'))
    .setVerticalAlignment('middle');

  // Value (cols D-F merged, right-aligned)
  var isEmpty = (value == null || value === '');
  sh.getRange(row, 4, 1, 3).breakApart().merge()
    .setValue(isEmpty ? '— pendiente' : value)
    .setFontFamily(token('FONT_FAMILY'))
    .setFontSize(tokenNum('FONT_SIZE_BODY'))
    .setFontColor(isEmpty ? token('TEXT_MUTED') : token('TEXT_PRIMARY'))
    .setFontStyle(isEmpty ? 'italic' : 'normal')
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');

  // Status icon (col G)
  if (status) {
    var iconMap  = { pass: '✓', warn: '!', fail: '✗' };
    var colorMap = {
      pass: token('STATUS_PASS'),
      warn: token('STATUS_WARN'),
      fail: token('STATUS_FAIL')
    };
    sh.getRange(row, 7).setValue(iconMap[status] || '')
      .setFontFamily(token('FONT_FAMILY'))
      .setFontSize(tokenNum('FONT_SIZE_BODY'))
      .setFontColor(colorMap[status] || token('TEXT_SECONDARY'))
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  }

  sh.setRowHeight(row, tokenNum('ROW_H_BODY'));

  // Subtle row divider
  sh.getRange(row, 2, 1, 6).setBorder(
    null, null, true, null, null, null,
    token('DIVIDER_LINE'), SpreadsheetApp.BorderStyle.SOLID
  );
}

// -----------------------------------------------------------------------------
// Convenience: apply page-level background and remove gridlines.
// Call once per sheet from the template setup function or from a writer that
// wants to guarantee the page-wide look. Idempotent.
// -----------------------------------------------------------------------------
function primApplyPageCanvas(sh) {
  sh.setHiddenGridlines(true);
  // Left margin column — narrow spacer
  sh.setColumnWidth(1, 24);
  // Content area default widths (writers can override per sheet)
  sh.setColumnWidth(2, 180);  // B
  sh.setColumnWidth(3, 160);  // C
  sh.setColumnWidth(4, 160);  // D
  sh.setColumnWidth(5, 160);  // E
  sh.setColumnWidth(6, 160);  // F
  sh.setColumnWidth(7, 80);   // G (status icon column)
}
