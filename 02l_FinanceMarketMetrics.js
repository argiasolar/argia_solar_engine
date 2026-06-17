// =============================================================================
// ARGIA ENGINE -- File: 02l_FinanceMarketMetrics.gs
// Add a market-standard metrics block to the FINANCE PPA sheet: discounted NPV,
// project IRR, IRR-vs-target margin, and a loan-term-aware DSCR. Idempotent and
// header-anchored, so re-running rewrites the same block in place (never
// duplicates).
//
// WHY THIS EXISTS
//   The FINANCE PPA model reports C4 "NPV" = SUM(D30:X30) - C3 -- i.e. nominal
//   profit, UNDISCOUNTED -- and carries no IRR or DSCR. That is not a market-
//   standard project-finance benchmark. This block adds the standard metrics as
//   live formulas, so they recompute whenever the underlying PPA inputs change.
//
//   DISCOUNT RATE -- single source, no duplication.
//     ARGIA's cost of capital already lives in the engine at INPUT_BAAS!D15
//     ("Tasa de descuento / WACC ARGIA", default 12%), and ARGIA's target IRR at
//     INPUT_BAAS!D14 (default 15%). Both are populated regardless of deal type
//     (the BaaS NPV already discounts with D15). We REUSE those rather than mint
//     a new, divergent discount-rate cell. They are independent of the BanBajio
//     loan rate (F9 = 12.66%), which is what option (b) asked for.
//
//   BASIS -- unlevered project.
//     Cashflow = PPA revenue (ARGIA Annual Payment, row 30) vs CAPEX (C3); this
//     matches the existing C4 basis, just discounted. Levered/equity IRR is
//     undefined here because the deal is 100% debt-financed (F8 = 1.0), so the
//     unlevered project return is the meaningful figure.
//
//   FORMULAS (live; reference the stable FINANCE template anchors)
//     Discount rate (WACC)      = INPUT_BAAS!D15
//     ARGIA target IRR          = INPUT_BAAS!D14
//     Project cashflow          = [-C3, D30, E30, ... X30]   (t0 = -CAPEX)
//     Discounted NPV (project)  = -C3 + NPV(INPUT_BAAS!D15, D30:X30)
//     IRR (project)             = IRR( cashflow row )
//     IRR margin vs target      = IRR - INPUT_BAAS!D14
//     Annual debt service       = I7 * 12   (monthly loan payment x 12)
//     DSCR by year (loan term)  = revenue_t / debt service, only while the loan
//                                 is active -- gated by F7 (loan term, years) via
//                                 the column offset, so it follows the term
//                                 dynamically rather than a hardcoded window
//     Min / Avg DSCR            = MIN / AVERAGE over the active DSCR years
//
// SAFETY
//   - ABORTS if FINANCE or INPUT_BAAS is missing (never writes a #REF! source).
//   - HEADER-ANCHORED + IDEMPOTENT: the block is located by its header text in
//     column B; found -> rewritten in place, not found -> appended after the
//     last content row. Re-running never duplicates it.
//   - ADDITIVE: writes only its own block (cols B..X on its rows); touches no
//     existing FINANCE content.
//
// MENU-ACCESSIBLE
//   runFinanceMarketMetrics() -> dialog summary. Returns a summary string.
// =============================================================================

var _FMM_HEADER   = 'MARKET-STANDARD METRICS (PPA -- unlevered project)';
var _FMM_WACC_REF = 'INPUT_BAAS!D15';   // ARGIA WACC / discount rate
var _FMM_TIRR_REF = 'INPUT_BAAS!D14';   // ARGIA target IRR
var _FMM_FIRST_CF_COL = 4;              // D = first cashflow year column (Y00)
var _FMM_LAST_CF_COL  = 24;             // X = last cashflow year column (Y20)

function repairFinanceMarketMetrics(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  var sh = ss.getSheetByName('FINANCE');
  if (!sh) return { ok: false, changed: 0, lines: ['ABORT: FINANCE sheet not found.'] };
  if (!ss.getSheetByName('INPUT_BAAS')) {
    return { ok: false, changed: 0,
             lines: ['ABORT: INPUT_BAAS not found -- discount rate source missing.'] };
  }

  // Locate the block by its header in column B (idempotent placement).
  var lastRow = sh.getLastRow();
  var headerRow = -1;
  if (lastRow >= 1) {
    var colB = sh.getRange(1, 2, lastRow, 1).getValues();
    for (var r = 0; r < colB.length; r++) {
      if (String(colB[r][0]).trim() === _FMM_HEADER) { headerRow = r + 1; break; }
    }
  }
  var relocated = (headerRow === -1);
  var H = relocated ? (lastRow + 2) : headerRow;   // blank separator row when appending

  // Build and write the block.
  var block = _fmmBuildBlock(H);
  sh.getRange(H, 2, block.length, block[0].length).setValues(block);
  SpreadsheetApp.flush();

  return {
    ok: true,
    changed: block.length,
    headerRow: H,
    lines: [
      '  block ' + (relocated ? 'added' : 'refreshed') + ' at FINANCE!B' + H,
      '  discount rate  <- ' + _FMM_WACC_REF + '   target IRR <- ' + _FMM_TIRR_REF,
      '  NPV / IRR / IRR-vs-target / DSCR(min,avg) written'
    ]
  };
}

// Build the block as a 2D array (rows x cols B..X). Strings starting with '='
// are written as live formulas by setValues. H is the header's sheet row.
function _fmmBuildBlock(H) {
  var W = _FMM_LAST_CF_COL - 2 + 1;        // cols B..X inclusive
  function emptyRow() { var a = []; for (var i = 0; i < W; i++) a.push(''); return a; }
  function put(row, sheetCol, val) { row[sheetCol - 2] = val; }   // col B -> index 0

  var rHeader = H, rWacc = H + 1, rTirr = H + 2, rCash = H + 3, rNpv = H + 4,
      rIrr = H + 5, rIrrM = H + 6, rDs = H + 7, rDscr = H + 8, rDscrSum = H + 9;

  var rows = [];
  for (var i = 0; i < 10; i++) rows.push(emptyRow());

  // header
  put(rows[0], 2, _FMM_HEADER);

  // discount rate + target IRR
  put(rows[1], 2, 'Discount rate (WACC)');   put(rows[1], 3, '=' + _FMM_WACC_REF);
  put(rows[2], 2, 'ARGIA target IRR');        put(rows[2], 3, '=' + _FMM_TIRR_REF);

  // project cashflow row: C = -C3 (t0), D..X = revenue per year (=D30 ... =X30)
  put(rows[3], 2, 'Project cashflow');
  put(rows[3], 3, '=-C3');
  for (var c = _FMM_FIRST_CF_COL; c <= _FMM_LAST_CF_COL; c++) {
    put(rows[3], c, '=' + _fmmCol(c) + '30');
  }

  // discounted NPV
  put(rows[4], 2, 'Discounted NPV (project)');
  put(rows[4], 3, '=-C3+NPV(' + _FMM_WACC_REF + ',D30:X30)');

  // IRR over the cashflow row (C..X on rCash)
  var cfRange = 'C' + rCash + ':' + _fmmCol(_FMM_LAST_CF_COL) + rCash;
  put(rows[5], 2, 'IRR (project)');
  put(rows[5], 3, '=IFERROR(IRR(' + cfRange + '),"n/a")');

  // IRR margin vs target
  put(rows[6], 2, 'IRR margin vs target');
  put(rows[6], 3, '=IFERROR(C' + rIrr + '-' + _FMM_TIRR_REF + ',"n/a")');

  // annual debt service
  put(rows[7], 2, 'Annual debt service');
  put(rows[7], 3, '=I7*12');

  // DSCR by year, gated by the loan term F7 (years) via column offset
  put(rows[8], 2, 'DSCR by year (loan term)');
  for (var c2 = _FMM_FIRST_CF_COL; c2 <= _FMM_LAST_CF_COL; c2++) {
    var f = '=IF(COLUMN()-COLUMN($D$' + rDscr + ')<$F$7,' +
            _fmmCol(c2) + '30/$C$' + rDs + ',"")';
    put(rows[8], c2, f);
  }

  // min / avg DSCR over the active years
  var dscrRange = 'D' + rDscr + ':' + _fmmCol(_FMM_LAST_CF_COL) + rDscr;
  put(rows[9], 2, 'Min / Avg DSCR (loan term)');
  put(rows[9], 3, '=IFERROR(MIN('     + dscrRange + '),"n/a")');
  put(rows[9], 4, '=IFERROR(AVERAGE(' + dscrRange + '),"n/a")');

  return rows;
}

// Column number -> letter (handles past Z, though FINANCE stops at X).
function _fmmCol(col) {
  var s = '';
  while (col > 0) { var m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = (col - m - 1) / 26; }
  return s;
}

// Menu-callable entry point.
function runFinanceMarketMetrics() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rep = repairFinanceMarketMetrics(ss);
  SpreadsheetApp.flush();
  var summary = 'FINANCE market-standard metrics:\n\n' + rep.lines.join('\n') +
    (rep.ok ? '' : '\n\n(ABORTED)');
  try {
    SpreadsheetApp.getUi().alert('FINANCE market metrics', summary,
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (_) { /* headless */ }
  return summary;
}
