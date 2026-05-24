// =============================================================================
// ARGIA ENGINE -- File: 02i_SetupBessSimulationSteady.gs
// BDF-11.1: idempotent setup tool for BESS_SIMULATION steady-state (Year 2+)
//           Capacidad savings block. Extends existing workbooks with new
//           rows 43-49.
//
// WHY THIS EXISTS
//   BDF-11 fixed the four CFE math bugs. The repair tool corrected Year-1
//   Capacidad math (C23 = C21 × rate; C30 uses C23/C21 instead of C23/C18).
//
//   But BDF-11 also defined a "steady-state" scenario: year 2+ of BESS
//   operation, after CFE's 12-month rolling demand window has decayed from
//   pre-BESS peaks to post-BESS peaks. In year 2+, the 0.7×movil floor no
//   longer binds, so BESS Capacidad savings can be much larger.
//
//   This tool adds a new section to BESS_SIMULATION computing steady-state
//   Capacidad savings (the part that differs between year-1 and steady).
//   The CFE_OUTPUT writer then renders both side-by-side so customers see
//   "Año 1: $X · Año 2+: $Y".
//
//   Distribución and Variable savings are NOT recomputed for steady-state
//   here because the math is more nuanced (Distribución may have small
//   year-1/steady differences via the C18 cap; Variable doesn't change at
//   all between scenarios). Punting both to BDF-12 if needed.
//
// LAYOUT WRITTEN (rows 43-49 in BESS_SIMULATION)
//   r43: section header "5.0 ESCENARIO AÑO 2+ — Steady-state"
//   r44: month header (Mes | Ene | Feb | ... | Dic)
//   r45: monthly steady-state Capacidad savings (per month)
//        Formula: =MAX(0, (CFE_SIM!C21 - C27) * (CFE_SIM!C23 / CFE_SIM!C21))
//        — same as Year-1 (C30) but with the floor removed: in steady state
//        the rolling max decays to post-BESS punta, so floor = 0.7 * C27 < C27
//        and the MAX in year-1's formula collapses to C27.
//   r46: O45 annual sum (same row, column O)
//   r47: scalar "(=) Ahorro Capacidad anual steady" — D47 = O45
//   r48: scalar "(=) Recibo CFE final año 2+ (PV + BESS)"
//        Formula: =D14 - O45 - O31 - O32
//        (recibo después de PV minus all three BESS savings, where Capacidad
//         comes from steady; Dist and Var same as year-1)
//
// IDEMPOTENT, SAFE, MENU-ACCESSIBLE
//   Reads each target row's column B label first; only writes if cell is
//   empty OR already contains the BDF-11.1 marker. This prevents overwriting
//   if the user customized the area. Re-running on already-set-up sheet
//   does nothing.
//
//   Tagged with "[BDF-11.1]" in the section header label so re-runs can
//   identify their own writes.
// =============================================================================

var _BDF11_1_MARKER = '[BDF-11.1]';
var _BDF11_1_START_ROW = 43;   // section header
var _BDF11_1_END_ROW   = 48;   // last touched row

function setupBessSimulationSteady(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH.BESS_SIM);
  if (!sh) {
    return 'BESS_SIMULATION sheet not found -- nothing to set up.';
  }

  var written = [];
  var skippedExisting = [];

  // Check if any row in our target range has non-empty, non-marker content
  // that we DIDN'T write. If yes, refuse to touch any of them.
  for (var checkR = _BDF11_1_START_ROW; checkR <= _BDF11_1_END_ROW; checkR++) {
    var labelCell = sh.getRange(checkR, 2);
    var existingLabel = String(labelCell.getValue() || '');
    if (existingLabel && existingLabel.indexOf(_BDF11_1_MARKER) === -1) {
      // Allow blank or marker-tagged rows; refuse on foreign content
      return 'BESS_SIMULATION row ' + checkR + ' has non-BDF-11.1 content: "'
           + existingLabel + '". Refusing to overwrite. If you need to '
           + 'reset, clear rows ' + _BDF11_1_START_ROW + '-' + _BDF11_1_END_ROW
           + ' manually and re-run.';
    }
  }

  // r43: section header
  var hdrCell = sh.getRange(43, 2);
  hdrCell.setValue('5.0  ESCENARIO AÑO 2+ — Steady-state ' + _BDF11_1_MARKER)
         .setFontWeight('bold')
         .setBackground('#E8F5E9');
  written.push('B43 header');

  // r44: month header row
  sh.getRange(44, 2).setValue('Mes').setFontColor('#666666');
  var months = ['Ene','Feb','Mar','Abr','May','Jun',
                'Jul','Ago','Sep','Oct','Nov','Dic'];
  for (var mc = 0; mc < 12; mc++) {
    sh.getRange(44, 3 + mc).setValue(months[mc]).setFontColor('#666666');
  }
  // r44 col O: "Total"
  sh.getRange(44, 15).setValue('Total').setFontColor('#666666');
  written.push('r44 month header');

  // r45: Ahorro Capacidad steady (monthly + annual)
  // Per-month formula:
  //   =IFERROR(IF(INPUT_PROJECT!$D$64<>"YES", 0,
  //      MAX(0, (CFE_SIM!C21 - C27) * (CFE_SIM!C23 / CFE_SIM!C21))), 0)
  //
  // Compared to r30 (year-1):
  //   year1: MAX(0, (CFE_SIM!C21 - MAX(C27, 0.7*CFE_SIM!C18)) * rate)
  //   steady: MAX(0, (CFE_SIM!C21 - C27)                       * rate)
  // — same structure, just no 0.7×movil floor (rolling max decayed).
  sh.getRange(45, 2).setValue('Ahorro Capacidad steady (MXN) ' + _BDF11_1_MARKER)
                    .setFontColor('#333333');
  for (var mm = 3; mm <= 14; mm++) {
    var col = _bdf11_1_colLetter(mm);
    var formula = '=IFERROR(IF(INPUT_PROJECT!$D$64<>"YES",0,'
                + 'MAX(0, (CFE_SIMULATION!' + col + '21 - ' + col + '27)'
                + ' * (CFE_SIMULATION!' + col + '23 / CFE_SIMULATION!'
                + col + '21))), 0)';
    sh.getRange(45, mm).setFormula(formula).setNumberFormat('"$"#,##0');
  }
  // Annual sum in O45
  sh.getRange(45, 15).setFormula('=SUM(C45:N45)')
                     .setNumberFormat('"$"#,##0')
                     .setFontWeight('bold');
  written.push('r45 monthly + O45 sum');

  // r47: scalar "Ahorro Capacidad anual steady" (parallel to r39 year-1 marker)
  sh.getRange(47, 2).setValue('Ahorro Capacidad anual steady (MXN) ' + _BDF11_1_MARKER);
  sh.getRange(47, 4).setFormula('=O45').setNumberFormat('"$"#,##0');
  written.push('r47 annual scalar');

  // r48: scalar "Recibo CFE final año 2+ (PV + BESS)"
  // = D14 (recibo después de PV) - O45 (steady cap) - O31 (year-1 dist) - O32 (year-1 var)
  // Distribución and Variable use year-1 values because their BDF-11
  // steady-state behavior wasn't analyzed in this chunk.
  sh.getRange(48, 2).setValue('Recibo CFE final año 2+ (steady) ' + _BDF11_1_MARKER)
                    .setFontWeight('bold');
  sh.getRange(48, 4).setFormula('=D14 - O45 - O31 - O32')
                    .setNumberFormat('"$"#,##0')
                    .setFontWeight('bold');
  written.push('r48 steady-state final bill');

  SpreadsheetApp.flush();

  var summary = 'BDF-11.1 BESS_SIMULATION steady-state setup:\n' +
    '  wrote: ' + (written.length ? written.join(', ') : '(none)') + '\n' +
    '  skipped existing: ' +
      (skippedExisting.length ? skippedExisting.join(', ') : '(none)');
  return summary;
}

function runSetupBessSimulationSteady() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var summary = setupBessSimulationSteady(ss);
  try {
    SpreadsheetApp.getUi().alert('BDF-11.1 Steady-state setup', summary,
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (_) {
    // Headless context — skip dialog
  }
  return summary;
}

function _bdf11_1_colLetter(n) {
  if (n <= 26) return String.fromCharCode(64 + n);
  var letters = '';
  var nn = n;
  while (nn > 0) {
    var rem = (nn - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    nn = Math.floor((nn - 1) / 26);
  }
  return letters;
}
