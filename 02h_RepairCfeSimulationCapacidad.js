// =============================================================================
// ARGIA ENGINE -- File: 02h_RepairCfeSimulationCapacidad.gs
// BDF-11: idempotent repair tool for CFE_SIMULATION row 18 (kWMaxAñoMovil)
//         and row 23 (Capacidad) formulas.
//
// WHY THIS EXISTS
//   CFE_SIMULATION!C18..N18 (kWMaxAñoMovil) and !C23..N23 (Capacidad) shipped
//   with formulas that don't match how CFE actually charges Capacidad.
//   Validated against 12 real CULLIGAN bills (May 2025 - Apr 2026, GDMTH
//   GOLFO NORTE): the corrected formulas reproduce bill Capacidad to the
//   cent. See bdf11_truth_table_final.md.
//
//   BUG #1 — row 23 Capacidad
//     BEFORE: =C18 × INDEX(20M_CFE_TARIFFS!...)   // multiplies by movil
//     AFTER:  =C21 × INDEX(20M_CFE_TARIFFS!...)   // multiplies by demanda fac
//     C21 already contains MAX(C17, 0.7*C18), the correct demanda facturable.
//
//   BUG #2 — row 18 kWMaxAñoMovil
//     BEFORE: =ROUNDUP(SUM(C12:C14)/24/C20/loadFactor, 0)   // synthesized
//     AFTER:  =MAX(MAX(INPUT_CFE!$C$13:$N$15), MAX(INPUT_CFE!$C$16:$N$16))
//             Same global value for every month. Option B + safety net:
//             rolling max of all measured kW data (rows 13-15 = base/inter/
//             punta), with a safety floor at MAX(row 16 across months) to
//             catch partial-data scenarios where rows 13-15 are incomplete
//             but the period-kWMax row 16 is filled.
//
//   BUG #4 — BESS_SIMULATION!C30..N30 Capacidad savings
//     The C30 formula =MAX(0, (C21-MAX(C27, 0.7*C18)) × (C23/C18)) carried
//     forward both bugs. After fixing #1 + #2 above:
//       - C23/C18 still gives the correct rate (numerator+denominator both
//         change consistently when we fix #1: C23 = C21×rate, so C23/C18
//         no longer equals rate. BREAKS the formula.)
//       - We must rewrite C30 to use C23/C21 (the correct rate) instead.
//     This repair also rewrites BESS_SIMULATION!C30..N30 to:
//       =IFERROR(IF(INPUT_PROJECT!$D$64<>"YES",0,
//          MAX(0, (CFE_SIMULATION!C21 - MAX(C27, 0.7*CFE_SIMULATION!C18))
//                  * (CFE_SIMULATION!C23 / CFE_SIMULATION!C21))), 0)
//
// WHAT THIS DOES
//   1. For each col in C..N of CFE_SIMULATION:
//        row 18 ← =MAX(MAX(INPUT_CFE!$C$13:$N$15), MAX(INPUT_CFE!$C$16:$N$16))
//        row 23 ← =<col>21 × <existing INDEX/MATCH lookup>
//   2. For each col in C..N of BESS_SIMULATION:
//        row 30 ← updated formula using C23/C21 instead of C23/C18
//   3. Label assertions before each write — skips if labels don't match.
//   4. Idempotent: re-running checks current formula; only writes if needed.
//
// SAFETY MODEL
//   - Reads existing C23 formula to extract the INDEX/MATCH tariff lookup,
//     then rewrites with C21× instead of C18×. Preserves the project's
//     tariff region/season setup.
//   - Reads existing C30 formula and pattern-matches the structure before
//     rewriting. If the formula has diverged (e.g. customized), skips and
//     reports in the summary.
//   - Backup row recorded in console.log for forensic recovery if needed.
//   - Throws nothing — bad labels / divergent formulas become warnings.
//
// MENU-ACCESSIBLE
//   Exposed via runRepairCfeSimulationCapacidad() — to be added to the
//   ARGIA Setup submenu (parallel to "Repair CFE_SIM Totals").
// =============================================================================

// Rows we will repair, with the label-substring guard for each.
var _CFESIM_CAPACIDAD_REPAIR_ROWS = [
  { row: 18, labelContains: 'movil',      sheet: 'CFE_SIM' },
  { row: 23, labelContains: 'capacidad',  sheet: 'CFE_SIM' },
];
var _BESSSIM_CAPACIDAD_REPAIR_ROWS = [
  { row: 30, labelContains: 'capacidad',  sheet: 'BESS_SIM' },
];

// New formulas, one per column. {col} placeholder will be substituted.
//
// row 18 movil: same global value in every column, so we use absolute refs.
var _NEW_MOVIL_FORMULA =
  '=MAX(MAX(INPUT_CFE!$C$13:$N$15),MAX(INPUT_CFE!$C$16:$N$16))';

// row 23 Capacidad: rewrite <col>18*  →  <col>21*  in-place.
//
// We do an in-place column-anchored substitution rather than extracting +
// re-prepending. This handles both formula shapes seen in the wild:
//
//   Plain:        =C18*INDEX('20M_CFE_TARIFFS'!$J:$J,MATCH(1,...,0))
//   Array-wrapped:=ARRAY_CONSTRAIN(ARRAYFORMULA(C18*INDEX(...)), 1, 1)
//
// The match is column-anchored — we look for the SAME column letter as the
// current cell, followed immediately by `18` (the kWMaxAñoMovil row), then
// `*`. This prevents accidentally replacing e.g. C18 inside another part of
// the formula if some future variant has multiple references.
function _bdf11_rewriteRow23(existingFormula, col) {
  if (typeof existingFormula !== 'string' || !existingFormula) return null;
  // Match: \b<col>18 (with optional space) * (with optional space)
  // \b prevents matching e.g. AC18 when col=C
  var re = new RegExp('\\b' + col + '18\\s*\\*\\s*', 'g');
  if (!re.test(existingFormula)) return null;
  // Reset lastIndex (test() advanced it) and do the replace
  re.lastIndex = 0;
  return existingFormula.replace(re, col + '21*');
}

function repairCfeSimulationCapacidad(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var cfeSim = ss.getSheetByName(SH.CFE_SIM);
  var bessSim = ss.getSheetByName(SH.BESS_SIM);
  if (!cfeSim) {
    return 'CFE_SIMULATION sheet not found -- nothing to repair.';
  }

  var written = [];
  var skippedAlreadyFixed = [];
  var skippedLabel = [];
  var skippedUnparseable = [];

  // ---- row 18 (kWMaxAñoMovil): all 12 cols write same formula ----------
  var movilLabelCell = cfeSim.getRange(18, 2);
  var movilLabel = String(movilLabelCell.getValue() || '').toLowerCase();
  if (movilLabel.indexOf('movil') === -1) {
    skippedLabel.push('CFE_SIM row 18 label="' + movilLabelCell.getValue()
                      + '" (expected to contain "movil")');
  } else {
    for (var c1 = 3; c1 <= 14; c1++) {
      var cell = cfeSim.getRange(18, c1);
      var existing = cell.getFormula();
      // Idempotency: if formula already matches target, skip
      if (existing === _NEW_MOVIL_FORMULA) {
        skippedAlreadyFixed.push('CFE_SIM!' + _bdf11_colLetter(c1) + '18');
        continue;
      }
      // Log the old formula for forensic recovery
      Logger.log('BDF-11 CFE_SIM!' + _bdf11_colLetter(c1) + '18 BEFORE: '
                 + existing);
      cell.setFormula(_NEW_MOVIL_FORMULA);
      written.push('CFE_SIM!' + _bdf11_colLetter(c1) + '18');
    }
  }

  // ---- row 23 (Capacidad): rewrite C23 = C21 × INDEX(...) ---------------
  var capLabelCell = cfeSim.getRange(23, 2);
  var capLabel = String(capLabelCell.getValue() || '').toLowerCase();
  if (capLabel.indexOf('capacidad') === -1) {
    skippedLabel.push('CFE_SIM row 23 label="' + capLabelCell.getValue()
                      + '" (expected to contain "capacidad")');
  } else {
    for (var c2 = 3; c2 <= 14; c2++) {
      var cell23 = cfeSim.getRange(23, c2);
      var existing23 = cell23.getFormula();
      var col = _bdf11_colLetter(c2);
      // Idempotency: already fixed if formula references <col>21* (not <col>18*)
      // Check: contains "<col>21*" AND does NOT contain "<col>18*"
      var hasC21 = new RegExp('\\b' + col + '21\\s*\\*').test(existing23);
      var hasC18 = new RegExp('\\b' + col + '18\\s*\\*').test(existing23);
      if (hasC21 && !hasC18) {
        skippedAlreadyFixed.push('CFE_SIM!' + col + '23');
        continue;
      }
      var newFormula = _bdf11_rewriteRow23(existing23, col);
      if (!newFormula || newFormula === existing23) {
        skippedUnparseable.push('CFE_SIM!' + col + '23 (formula='
                                + existing23 + ')');
        continue;
      }
      Logger.log('BDF-11 CFE_SIM!' + col + '23 BEFORE: ' + existing23);
      Logger.log('BDF-11 CFE_SIM!' + col + '23 AFTER:  ' + newFormula);
      cell23.setFormula(newFormula);
      written.push('CFE_SIM!' + col + '23');
    }
  }

  // ---- BESS_SIM row 30: rewrite C30 to use C23/C21 instead of C23/C18 ---
  if (bessSim) {
    var bessLabelCell = bessSim.getRange(30, 2);
    var bessLabel = String(bessLabelCell.getValue() || '').toLowerCase();
    if (bessLabel.indexOf('capacidad') === -1) {
      skippedLabel.push('BESS_SIM row 30 label="' + bessLabelCell.getValue()
                        + '" (expected to contain "capacidad")');
    } else {
      for (var c3 = 3; c3 <= 14; c3++) {
        var cell30 = bessSim.getRange(30, c3);
        var existing30 = cell30.getFormula();
        var col3 = _bdf11_colLetter(c3);
        // Idempotency: target formula uses /CFE_SIMULATION!C21
        var hasC21Denominator = existing30.indexOf('CFE_SIMULATION!' + col3
                                                    + '21)') > -1;
        if (hasC21Denominator) {
          skippedAlreadyFixed.push('BESS_SIM!' + col3 + '30');
          continue;
        }
        // Expected old shape: ...CFE_SIMULATION!C23/CFE_SIMULATION!C18))
        // Rewrite that denominator from C18 to C21.
        var newFormula30 = existing30.replace(
          /CFE_SIMULATION!([A-Z]{1,2})23\s*\/\s*CFE_SIMULATION!\1\s*18/g,
          'CFE_SIMULATION!$123/CFE_SIMULATION!$121'
        );
        if (newFormula30 === existing30) {
          skippedUnparseable.push('BESS_SIM!' + col3 + '30 (formula='
                                  + existing30 + ')');
          continue;
        }
        Logger.log('BDF-11 BESS_SIM!' + col3 + '30 BEFORE: ' + existing30);
        cell30.setFormula(newFormula30);
        written.push('BESS_SIM!' + col3 + '30');
      }
    }
  } else {
    skippedLabel.push('BESS_SIMULATION sheet not found -- row 30 NOT repaired');
  }

  SpreadsheetApp.flush();

  var summary = 'BDF-11 CFE_SIMULATION + BESS_SIMULATION Capacidad repair:\n' +
    '  written:  ' + (written.length ? written.join(', ') : '(none)') + '\n' +
    '  already fixed: ' +
      (skippedAlreadyFixed.length ? skippedAlreadyFixed.join(', ') : '(none)') + '\n' +
    '  skipped (label mismatch): ' +
      (skippedLabel.length ? skippedLabel.join(' | ') : '(none)') + '\n' +
    '  skipped (unparseable formula): ' +
      (skippedUnparseable.length ? skippedUnparseable.join(' | ') : '(none)');
  return summary;
}

// Menu-callable entry point.
function runRepairCfeSimulationCapacidad() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var summary = repairCfeSimulationCapacidad(ss);
  try {
    SpreadsheetApp.getUi().alert('BDF-11 Capacidad repair', summary,
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (_) {
    // Headless context — skip the dialog
  }
  return summary;
}

// Helper: column index 3 -> 'C', 14 -> 'N'.
function _bdf11_colLetter(n) {
  // n is 1-indexed (col 1 = A). For our range 3..14, this gives C..N.
  if (n <= 26) return String.fromCharCode(64 + n);
  // Safety for future expansion (AA, AB, ...)
  var letters = '';
  var nn = n;
  while (nn > 0) {
    var rem = (nn - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    nn = Math.floor((nn - 1) / 26);
  }
  return letters;
}
