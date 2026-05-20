// =============================================================================
// ARGIA ENGINE -- File: 02g_RepairCfeSimulationTotals.gs
// One-shot fix for missing annual TOTAL (column O) formulas in CFE_SIMULATION.
//
// WHY THIS EXISTS
//   CFE_SIMULATION!O is the annual-total column (=SUM(C{r}:N{r})). Many rows
//   had it; several critical ones did not:
//     - O37 (Facturacion)
//     - O39 (TOTAL)
//     - O40 (Credito Exportacion)
//     - O41 (ENERGY SAVINGS)
//     - O42 (PV Exportado kWh)
//   BESS_SIMULATION!D12 reads CFE_SIMULATION!O39 + O41 + O40 to compute the
//   annual "Recibo CFE base". With those three cells blank, D12 evaluated to
//   $0, cascaded through D14 ($0) and produced a negative D18, which then
//   surfaced in CFE_OUTPUT as "$0 / $0 / -$1,875,097".
//
// WHAT THIS DOES
//   Writes =SUM(C{r}:N{r}) into O37, O39, O40, O41, O42 if they are blank.
//   Skips rows that already have a formula or a literal value (idempotent --
//   re-runnable without overwriting existing content).
//
//   Label assertion BEFORE writing each formula: if B{r} doesn't match the
//   expected label (e.g. "Facturacion" / "TOTAL" / "ENERGY SAVINGS"), the
//   row is skipped and the user is told to verify the sheet manually. This
//   guards against silently summing the wrong row if CFE_SIMULATION layout
//   ever shifts.
//
// IDEMPOTENT, SAFE, MENU-ACCESSIBLE
//   Exposed via runRepairCfeSimulationTotals() so it can be added to the
//   ARGIA menu. Returns a summary string. Throws nothing -- bad labels
//   become warnings in the returned summary.
// =============================================================================

// Rows we will repair, with the label-substring guard for each.
// substring is matched case-insensitively against col B of the row.
var _CFESIM_TOTAL_REPAIR_ROWS = [
  { row: 37, labelContains: 'facturac' },     // 'Facturación'
  { row: 39, labelContains: 'total'    },     // 'TOTAL'
  { row: 40, labelContains: 'cr'       },     // 'Crédito Exportación' (handles accent)
  { row: 41, labelContains: 'saving'   },     // 'ENERGY SAVINGS'
  { row: 42, labelContains: 'exportado'},     // 'PV Exportado kWh'
];

function repairCfeSimulationTotals(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH.CFE_SIM);
  if (!sh) {
    return 'CFE_SIMULATION sheet not found -- nothing to repair.';
  }

  var written = [];
  var skippedExisting = [];
  var skippedLabel = [];

  _CFESIM_TOTAL_REPAIR_ROWS.forEach(function(spec) {
    var r = spec.row;
    var labelCell = sh.getRange(r, 2);
    var label = String(labelCell.getValue() || '').toLowerCase();
    if (label.indexOf(spec.labelContains) === -1) {
      skippedLabel.push('row ' + r + ' label="' + labelCell.getValue() +
                        '" (expected to contain "' + spec.labelContains + '")');
      return;
    }
    var targetCell = sh.getRange(r, 15);  // column O
    var existingFormula = targetCell.getFormula();
    var existingValue = targetCell.getValue();
    if (existingFormula || (existingValue !== '' && existingValue !== null)) {
      skippedExisting.push('row ' + r + ' (' + spec.labelContains + ')');
      return;
    }
    var formula = '=SUM(C' + r + ':N' + r + ')';
    targetCell.setFormula(formula);
    written.push('O' + r + ' = ' + formula);
  });

  SpreadsheetApp.flush();

  var summary = 'CFE_SIMULATION annual totals repair:\n' +
    '  wrote:   ' + (written.length ? written.join(', ') : '(none)') + '\n' +
    '  skipped (already populated): ' +
      (skippedExisting.length ? skippedExisting.join(', ') : '(none)') + '\n' +
    '  skipped (label mismatch): ' +
      (skippedLabel.length ? skippedLabel.join(' | ') : '(none)');
  return summary;
}

// Menu-callable entry point. Shows a dialog with the repair summary so the
// user has visible confirmation of what changed.
function runRepairCfeSimulationTotals() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var summary = repairCfeSimulationTotals(ss);
  try {
    SpreadsheetApp.getUi().alert('CFE_SIMULATION repair', summary,
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (_) {
    // Headless context (e.g. test runner) -- skip the dialog.
  }
  return summary;
}