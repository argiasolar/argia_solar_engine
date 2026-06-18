// =============================================================================
// 39_RetireCfeBillReconstruction.js
// -----------------------------------------------------------------------------
// Retires the legacy in-sheet CFE bill reconstruction in INPUT_CFE rows 30-37
// (Energía Total / 2% Baja Tensión / Cargo FP / Subtotal / IVA / Facturación /
// DAP / TOTAL). That block summed the pasted MXN bill components (rows 21-29)
// to rebuild the monthly invoice, but NOTHING authoritative consumes it:
//   - the engine reimplements the bill in code (04a_CalcCFEBill); it never reads
//     these cells.
//   - the sin-PV bill is BESS_SIMULATION!D12.
//   - FINANCE / SLIDE_DATA / CFE_OUTPUT were repointed OFF INPUT_CFE row 37 (the
//     "dead stub") in T1 (4.29) and T2.
// It is also fragile: on partial/blank monthly data the FP division and the
// summation chain throw #DIV/0! / #VALUE!, surfacing errors in an input tab.
//
// INPUT_CFE rows 30-37 are persistent sheet content (setupInputCFE only styles,
// and only when the optional INPUT_CFE_RAW tab exists -- which it doesn't), so
// clearing them once retires them: nothing regenerates the formulas.
//
// SAFE: only clears B30:N37. Does NOT touch the pasted components (rows 21-29,
// which the engine DOES consume), the consumption inputs (10-20), or the PV
// INTERCONNECTION block (rows 39+). Does NOT delete rows -- deleting would shift
// row 39+ and break INPUT_MAP coords (cfeInterconnMode is at row 41). Idempotent.
// =============================================================================

// PURE. Single source for the range to clear. Caller code + tests read this.
function cfeBillReconClearRange() {
  return {
    sheet:    'INPUT_CFE',
    firstRow: 30, lastRow: 37,     // Energía Total .. TOTAL
    firstCol: 2,  lastCol: 14,     // col B (labels) .. col N (DIC)
    a1:       'B30:N37',
    labels: ['Energía Total', '2% Baja Tension', 'Cargo FP', 'Subtotal',
             'IVA', 'Facturación', 'DAP', 'TOTAL']
  };
}

// LIVE. Clears INPUT_CFE!B30:N37 (labels + formulas). Idempotent.
// Returns { ok, sheetMissing, alreadyEmpty, clearedCells, a1 }.
function retireCfeBillReconstruction(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var spec = cfeBillReconClearRange();
  var sh = ss.getSheetByName(spec.sheet);
  if (!sh) {
    return { ok: false, sheetMissing: true, alreadyEmpty: false, clearedCells: 0, a1: spec.a1 };
  }

  var nRows = spec.lastRow - spec.firstRow + 1;
  var nCols = spec.lastCol - spec.firstCol + 1;
  var rng = sh.getRange(spec.firstRow, spec.firstCol, nRows, nCols);

  // Count non-empty cells before clearing (so the report is honest + idempotent).
  var vals = rng.getValues();
  var nonEmpty = 0;
  for (var r = 0; r < vals.length; r++) {
    for (var c = 0; c < vals[r].length; c++) {
      if (vals[r][c] !== '' && vals[r][c] !== null) nonEmpty++;
    }
  }
  if (nonEmpty === 0) {
    return { ok: true, sheetMissing: false, alreadyEmpty: true, clearedCells: 0, a1: spec.a1 };
  }

  rng.clearContent();                          // values + formulas; keeps layout
  if (typeof rng.clearNote === 'function') { try { rng.clearNote(); } catch (e) {} }
  try { if (typeof Logger !== 'undefined') Logger.log('Retired CFE bill reconstruction: cleared ' + nonEmpty + ' cells in ' + spec.sheet + '!' + spec.a1); } catch (e) {}

  return { ok: true, sheetMissing: false, alreadyEmpty: false, clearedCells: nonEmpty, a1: spec.a1 };
}

// UI wrapper (Administrator Panel > Repairs).
function runRetireCfeBillReconstruction() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var go = ui.alert(
    'Retire CFE Bill Reconstruction',
    'INPUT_CFE rows 30-37 (Energía Total .. TOTAL) are a legacy in-sheet bill\n' +
    'reconstruction that NOTHING in the engine reads (the bill is computed in\n' +
    'code; the sin-PV bill is BESS_SIMULATION!D12). It is fragile and shows\n' +
    '#DIV/0! / #VALUE! on partial data.\n\n' +
    'This clears INPUT_CFE!B30:N37 (labels + formulas). Your pasted bill\n' +
    'components (rows 21-29) and the PV interconnection block (rows 39+) are\n' +
    'NOT touched. Continue?',
    ui.ButtonSet.OK_CANCEL);
  if (go !== ui.Button.OK) { ui.alert('Cancelled', 'No changes made.', ui.ButtonSet.OK); return; }

  var rep = retireCfeBillReconstruction(ss);
  var msg = rep.sheetMissing ? 'INPUT_CFE not found -- nothing to do.'
          : rep.alreadyEmpty ? 'Already retired -- INPUT_CFE!' + rep.a1 + ' was empty.'
          : 'Retired. Cleared ' + rep.clearedCells + ' cell(s) in INPUT_CFE!' + rep.a1 + '.';
  ui.alert('Retire CFE Bill Reconstruction', msg, ui.ButtonSet.OK);
}
