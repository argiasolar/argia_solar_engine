// =============================================================================
// ARGIA ENGINE -- File: 02k_RepairFinanceModel.gs
// Three correctness fixes for the legacy FINANCE PPA sheet. All located by
// formula SIGNATURE (not row number) and applied only when the known-bad
// pattern is present -- so the repair is self-guarding and idempotent.
//
// WHY THIS EXISTS  (investigated against a live CULLIGAN workbook)
//
//   FIX 1 -- CAPEX reads a stale BOM cell.
//     FINANCE!C3 = (INSTALLATION_v2!G9 + BOM_v2!G80) / (1 - INPUT_PROJECT!D35)
//     BOM_v2!G80 is the BESS BATTERY line item (~$28.8M), NOT the BOM grand
//     total. The grand total is BOM_v2!G94 ($36.7M) -- the exact cell the
//     engine's own CAPEX reader uses (BOM_ROW.GRAND_TOTAL = 94). So FINANCE
//     silently dropped the entire PV BOM and most of the BESS BOS, landing at
//     $34.76M near the real figure only by coincidence. This is v2 template
//     drift: correct against the old layout, never updated when the grand
//     total moved to row 94. INSTALLATION_v2!G9 is correct (it IS the install
//     grand total). The whole model hangs off C3 -- I5 (loan principal) = C3*F8,
//     and 41M_FINANCE_CALCULATOR reads I5 -- so this one fix corrects the NPV,
//     the cash ROI (C34=C3/1.16), AND the loan amortization schedule.
//     FIX: BOM_v2!G80 -> BOM_v2!G94.
//
//   FIX 2 -- Year-0 production goes negative.
//     FINANCE!D15 = (12 - MONTH(TODAY()) - C5) * (SUM(CFE_SIMULATION!O8)/12)/1000
//     C5 is the interconnection delay in months. When current month + delay
//     exceeds 12 (e.g. June run + 8-month interconnect = go-live next Feb), the
//     term goes negative -> negative MWh and negative "CO2 savings". Production
//     can't be negative; it should be 0 when go-live spills into the next year.
//     FIX: floor with MAX(0, 12 - MONTH(TODAY()) - C5).
//
//   FIX 3 -- Stale CO2 factor.
//     FINANCE CO2 rows use 0.438 tCO2e/MWh; the engine standardized on the
//     verified FE-SEN 2024 value 0.444 (CO2 may never appear without that
//     factor -- a structural invariant). FIX: 0.438 -> 0.444 wherever a
//     "0.438*" CO2 factor appears.
//
// SAFETY
//   - ABORTS if FINANCE is missing.
//   - SIGNATURE-MATCHED: each fix fires only on its exact known-bad pattern;
//     anything else is left untouched.
//   - IDEMPOTENT: re-running is a no-op (the post-fix formula no longer matches
//     the bad signature; the production fix also explicitly refuses to double-
//     wrap MAX).
//   - ARRAY-FORMULA SAFE: any formula containing ARRAYFORMULA is skipped.
//   - WRITE-VERIFIED: each setFormula is read back before it counts as changed.
//
// MENU-ACCESSIBLE
//   runRepairFinanceModel() -> dialog summary. Returns a summary string.
//   Throws nothing.
//
// NOTE (out of scope, flagged): C4 "NPV" is Sigma(payments) - CAPEX, i.e.
//   UNDISCOUNTED, and there is no IRR / DSCR. Making the PPA model a true
//   market-standard benchmark (discounted NPV at the project cost of capital,
//   IRR, DSCR vs the 41M debt service) is a separate, structural enhancement.
// =============================================================================

function repairFinanceModel(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('FINANCE');
  if (!sh) {
    return { ok: false, changed: 0, results: [],
             lines: ['ABORT: FINANCE sheet not found -- nothing repaired.'] };
  }

  var results = [];

  // FIX 1 -- CAPEX BOM grand-total reference.
  var capex = _finScanReplace(sh,
    function(f) {
      return f.indexOf('BOM_v2!G80') !== -1 && f.indexOf('INSTALLATION_v2!G9') !== -1;
    },
    function(f) { return f.split('BOM_v2!G80').join('BOM_v2!G94'); });
  results.push(_finResult('CAPEX BOM ref (G80->G94)', capex,
    'CAPEX formula (install G9 + BOM G80) not found -- already G94 or absent'));

  // FIX 2 -- Year-0 production proration floor.
  var prod = _finScanReplace(sh,
    function(f) {
      return f.indexOf('MONTH(TODAY())')    !== -1 &&
             f.indexOf('CFE_SIMULATION!O8') !== -1 &&
             f.indexOf('MAX(0,12-MONTH')    === -1;     // not already floored
    },
    function(f) {
      return f.split('12-MONTH(TODAY())-C5').join('MAX(0,12-MONTH(TODAY())-C5)');
    });
  results.push(_finResult('Y00 production floor MAX(0,...)', prod,
    'production proration cell not found -- already floored or absent'));

  // FIX 3 -- CO2 factor 0.438 -> 0.444 (FE-SEN 2024).
  var co2 = _finScanReplace(sh,
    function(f) { return f.indexOf('0.438*') !== -1; },
    function(f) { return f.split('0.438').join('0.444'); });
  results.push(_finResult('CO2 factor 0.438->0.444', co2,
    'no 0.438 CO2 factor found -- already 0.444 or absent'));

  var changed = results.reduce(function(n, r) { return n + r.changed; }, 0);
  var lines   = results.map(function(r) { return '  ' + r.id + ': ' + r.msg; });
  return { ok: true, changed: changed, results: results, lines: lines };
}

// Scan FINANCE's used range once; for every formula cell that matchFn accepts
// and that transformFn actually changes, write the new formula and verify it
// stuck. Returns the list of A1 addresses changed.
function _finScanReplace(sh, matchFn, transformFn) {
  var rng = sh.getDataRange();
  var formulas = rng.getFormulas();
  var r0 = rng.getRow(), c0 = rng.getColumn();
  var changed = [];
  for (var r = 0; r < formulas.length; r++) {
    for (var c = 0; c < formulas[r].length; c++) {
      var f = formulas[r][c];
      if (!f || f.indexOf('ARRAYFORMULA') !== -1) continue;   // skip blanks + array formulas
      if (!matchFn(f)) continue;
      var nf = transformFn(f);
      if (nf === f) continue;
      var cell = sh.getRange(r0 + r, c0 + c);
      cell.setFormula(nf);
      if (cell.getFormula() === nf) changed.push(_finA1(r0 + r, c0 + c));
    }
  }
  return changed;
}

function _finResult(id, changedCells, emptyMsg) {
  return {
    id: id,
    changed: changedCells.length,
    cells: changedCells,
    msg: changedCells.length
      ? ('fixed ' + changedCells.join(', '))
      : (emptyMsg + ' -- no change')
  };
}

// A1 helper (handles columns past Z).
function _finColLetter(col) {
  var s = '';
  while (col > 0) { var m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = (col - m - 1) / 26; }
  return s;
}
function _finA1(row, col) { return _finColLetter(col) + row; }

// Menu-callable entry point. Shows a dialog with the repair summary.
function runRepairFinanceModel() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rep = repairFinanceModel(ss);
  SpreadsheetApp.flush();

  var summary = 'Repair FINANCE model:\n\n' + rep.lines.join('\n') +
    '\n\nChanged: ' + rep.changed + (rep.ok ? '' : '   (ABORTED)');

  try {
    SpreadsheetApp.getUi().alert('Repair FINANCE model',
      summary, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (_) {
    // Headless (test runner) -- no UI.
  }
  return summary;
}
