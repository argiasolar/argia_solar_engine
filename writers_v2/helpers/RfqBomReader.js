// =============================================================================
// ARGIA ENGINE v2 -- File: writers_v2/helpers/RfqBomReader.gs
// -----------------------------------------------------------------------------
// CHUNK 6 — Reads item rows from BOM_v2 for RFQ generation.
//
// WHAT THIS DOES
//   Given a row range (or set of ranges) in BOM_v2, returns an array of item
//   objects: { num, desc, qty, unit, priceUsd, totalUsd, ref }. Skips rows
//   that don't have a numeric item number in column A (handles blank/spacer
//   rows naturally).
//
// WHY IT EXISTS (isolation)
//   Legacy 15_WriteRFQ.js has readBomItems_(ss, rowStart, rowEnd) that reads
//   from the legacy BOM sheet. v2 must NOT call that function — when legacy
//   gets deleted at cutover, v2 has to keep working.
//
//   This module reads from BOM_v2 only. After cutover (when BOM_v2 → BOM
//   rename happens), changing V2_SHEETS.BOM in TemplateRegistry.js is the
//   only edit needed. No code change here.
//
// CONTRACT
//   readRfqBomItems(ss, ranges) -- ranges is an array of { from, to } row
//   spans. Returns a single concatenated array of item objects, in input
//   range order. Empty rows are silently skipped.
//
// COLUMN MAP (matches BOM_COL in 00_Main.gs — BOM_v2 uses same column layout)
//   A=ITEM  B=DESCRIPTION  C=QTY  D=UNIT  E=UNIT_PRICE  F=TOTAL_USD  H=REFERENCE
//
// CALLED BY
//   writers_v2/WriteRfqV2.gs (writeRfqV2)
//
// NO DEPENDENCIES ON LEGACY
//   - Does NOT call readBomItems_ (legacy)
//   - Does NOT reference SH.BOM (legacy sheet name)
//   - DOES reference V2_SHEETS.BOM via templates/TemplateRegistry.gs (v2 infra)
// =============================================================================


/**
 * Reads item rows from BOM_v2 across one or more row ranges.
 *
 * @param {Spreadsheet} ss          The active spreadsheet.
 * @param {Array}       ranges      Array of { from, to } objects (1-indexed,
 *                                  inclusive). Rows without a numeric col-A
 *                                  value are skipped.
 * @param {Object}      _testOpts   Optional. { sheetName } override for tests.
 * @return {Array}                  Item objects in concatenated range order.
 *
 * @throws Error if BOM_v2 sheet doesn't exist (RFQ generation requires that
 *         legacy "Run Engine" or v2 BOM_v2 write has happened first).
 */
function readRfqBomItems(ss, ranges, _testOpts) {
  if (!ss) throw new Error('readRfqBomItems: ss is required');
  if (!ranges || !ranges.length) return [];

  var sheetName = (_testOpts && _testOpts.sheetName) || V2_SHEETS.BOM;
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    throw new Error(
      'readRfqBomItems: ' + sheetName + ' sheet not found. ' +
      'Run the engine first to populate BOM_v2.'
    );
  }

  // Compute the bounding box once for one big getValues() call.
  // Reading one rectangle is ~10x faster than per-cell reads in Apps Script.
  var minRow = Infinity, maxRow = -Infinity;
  for (var i = 0; i < ranges.length; i++) {
    if (ranges[i].from < minRow) minRow = ranges[i].from;
    if (ranges[i].to   > maxRow) maxRow = ranges[i].to;
  }
  if (minRow === Infinity || maxRow < minRow) return [];

  // Read cols A through H (8 cols) covering the union of all ranges
  var values = sh.getRange(minRow, 1, maxRow - minRow + 1, 8).getValues();

  var items = [];
  for (var r = 0; r < ranges.length; r++) {
    var from = ranges[r].from;
    var to   = ranges[r].to;
    for (var row = from; row <= to; row++) {
      var rowArr = values[row - minRow];
      if (!rowArr) continue;
      var aVal = rowArr[0];  // col A (item #)
      var bVal = rowArr[1];  // col B (description)

      // Item rows must have a numeric # in A and a non-empty desc in B
      if (aVal === '' || aVal === null || aVal === undefined) continue;
      var n = parseFloat(aVal);
      if (isNaN(n)) continue;
      if (!bVal && bVal !== 0) continue;

      items.push({
        num     : n,
        desc    : String(bVal),
        qty     : rowArr[2] || '',           // col C
        unit    : rowArr[3] || '',           // col D
        priceUsd: parseFloat(rowArr[4]) || 0, // col E
        totalUsd: parseFloat(rowArr[5]) || 0, // col F
        ref     : String(rowArr[7] || '')    // col H
      });
    }
  }
  return items;
}
