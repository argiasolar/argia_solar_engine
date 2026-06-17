// =============================================================================
// ARGIA ENGINE -- File: 02h_RepairFinanceSlideCfeSource.gs
// Repoint the legacy PPA / slide consumers of the dead INPUT_CFE sin-PV stub
// onto the authoritative engine sin-PV cell, BESS_SIMULATION!D12.
//
// WHY THIS EXISTS
//   INPUT_CFE rows 30-37 are a vestigial "current CFE bill" preview. They are
//   dead stub data (the "TOTAL" row's annual cell O37 = 0). Two sheets still
//   read it, and both break as a result:
//
//     FINANCE  "CFE Annual Payment"  D-col = INPUT_CFE!O37                -> 0
//     FINANCE  "CFE Tariff"          D-col = INPUT_CFE!O37/SUM(C10:N12)   -> 0
//     SLIDE_DATA[annual_energy_cost] B-col = SUM(INPUT_CFE!C37:N37)       -> #VALUE!
//
//   With the tariff at 0 the whole FINANCE/PPA cascade collapses (New CFE
//   payment 0, ARGIA tariff 0, % savings #DIV/0!, DSCR 0%), and SLIDE_DATA's
//   printed annual cost errors. This is the same silent-split disease the
//   4.28.0 CFE single-source fix cured for CLIENT_FINANCIALS: a stale duplicate
//   of the bill, read from the wrong physical cell.
//
//   The authoritative sin-PV already exists and is correct:
//     BESS_SIMULATION!D12 = CFE_SIMULATION!O39 + O41 + O40
//                         = "Recibo CFE base (sin PV ni BESS)"
//                         = 12,838,765 on CULLIGAN
//   These three consumers should read THAT. We cannot push values into
//   INPUT_CFE row 37 instead -- the sheet carries array formulas, and
//   setValue/setFormula over them strips evaluation context (a documented
//   hazard). So repointing the consumers is the only safe direction.
//
//   FINANCE & SLIDE_DATA are NOT engine-managed (the engine deliberately
//   "touches nothing in PPA/FINANCE"). This repair is the one surgical, opt-in
//   exception: run from the Administrator Panel, it rewrites exactly three
//   formulas and nothing else.
//
// SAFETY (why this cannot corrupt a contaminated FINANCE)
//   - ABORTS WHOLESALE if BESS_SIMULATION is missing (never points a consumer
//     at a #REF!).
//   - LABEL-MATCHED: each target row is located by its exact trimmed label,
//     never a hardcoded row number -- robust to layout drift.
//   - PATTERN-GUARDED: a cell is rewritten ONLY if its current formula is the
//     known dead stub (contains the expected INPUT_CFE reference). Blank cells,
//     array-formula spills, and any unexpected formula are LEFT UNTOUCHED and
//     reported. The repair can therefore never overwrite the wrong thing.
//   - IDEMPOTENT: a cell already pointing at BESS_SIMULATION!D12 is a no-op.
//   - WRITE-VERIFIED: each setFormula is read back and confirmed.
//   - PER-TARGET ISOLATION: a missing label on one target does not block the
//     other two.
//
// MENU-ACCESSIBLE
//   runRepairFinanceSlideCfeSource() -> dialog summary. Returns a summary
//   string. Throws nothing -- every failure mode becomes a reported skip.
// =============================================================================

// Authoritative engine sin-PV cell (annual "Recibo CFE base sin PV ni BESS").
var _FRS_SINPV_REF = 'BESS_SIMULATION!D12';

// The three formulas we repoint. Each is located by LABEL (never row number)
// and rewritten ONLY when its current formula is the known dead stub.
//   labelCol / labelText : where + what to match (1-indexed column)
//   formulaCol           : the cell to rewrite on that row (1-indexed)
//   deadStubContains     : substring that must be present in the CURRENT
//                          formula for the rewrite to fire (the guard)
//   newFormula           : what we write
var _FRS_TARGETS = [
  {
    id               : 'SLIDE_DATA[annual_energy_cost]',
    sheet            : 'SLIDE_DATA',
    labelCol         : 1,                       // col A holds the key
    labelText        : 'annual_energy_cost',
    formulaCol       : 2,                        // col B holds the formula
    deadStubContains : 'INPUT_CFE!C37',          // =SUM(INPUT_CFE!C37:N37)
    newFormula       : '=' + _FRS_SINPV_REF
  },
  {
    id               : 'FINANCE[CFE Annual Payment]',
    sheet            : 'FINANCE',
    labelCol         : 2,                        // col B holds the label
    labelText        : 'CFE Annual Payment',
    formulaCol       : 4,                        // col D = Y00 (only year that reads O37)
    deadStubContains : 'INPUT_CFE!O37',
    newFormula       : '=' + _FRS_SINPV_REF
  },
  {
    id               : 'FINANCE[CFE Tariff]',
    sheet            : 'FINANCE',
    labelCol         : 2,
    labelText        : 'CFE Tariff',
    formulaCol       : 4,
    deadStubContains : 'INPUT_CFE!O37',
    newFormula       : '=' + _FRS_SINPV_REF + '/SUM(INPUT_CFE!C10:N12)'
  }
];

// -----------------------------------------------------------------------------
// repairFinanceSlideCfeSource(ss) -> { ok, changed, results, lines }
//   ok      : false only when aborted wholesale (BESS_SIMULATION missing)
//   changed : count of formulas actually rewritten this call
//   results : per-target { id, status, msg }, status in
//             changed | already-ok | skipped
//   lines   : pretty per-target lines for the dialog
// -----------------------------------------------------------------------------
function repairFinanceSlideCfeSource(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  // Hard abort: never repoint onto a missing source sheet.
  if (!ss.getSheetByName('BESS_SIMULATION')) {
    return {
      ok      : false,
      changed : 0,
      results : [],
      lines   : ['ABORT: BESS_SIMULATION not found -- nothing repointed.']
    };
  }

  var results = [];
  var changed = 0;
  for (var i = 0; i < _FRS_TARGETS.length; i++) {
    var res = _frsRepointOne(ss, _FRS_TARGETS[i]);
    results.push(res);
    if (res.status === 'changed') changed++;
  }

  var lines = results.map(function(r) { return '  ' + r.id + ': ' + r.msg; });
  return { ok: true, changed: changed, results: results, lines: lines };
}

// Repoint a single target. Pure, side-effect only on the one guarded cell.
function _frsRepointOne(ss, spec) {
  var out = { id: spec.id, status: 'skipped', msg: '' };

  var sh = ss.getSheetByName(spec.sheet);
  if (!sh) { out.msg = 'sheet "' + spec.sheet + '" not found -- skipped'; return out; }

  var lastRow = sh.getLastRow();
  if (!lastRow) { out.msg = 'sheet empty -- skipped'; return out; }

  // Locate the row by exact, trimmed label in the label column.
  var labels = sh.getRange(1, spec.labelCol, lastRow, 1).getValues();
  var row = -1;
  for (var r = 0; r < labels.length; r++) {
    if (String(labels[r][0]).trim() === spec.labelText) { row = r + 1; break; }
  }
  if (row === -1) {
    out.msg = 'label "' + spec.labelText + '" not found -- skipped (nothing written)';
    return out;
  }

  var cell = sh.getRange(row, spec.formulaCol);
  var cur  = String(cell.getFormula() || '');

  // Idempotent: already repointed.
  if (cur === spec.newFormula) {
    out.status = 'already-ok';
    out.msg = 'already -> ' + _FRS_SINPV_REF + ' (no change)';
    return out;
  }

  // Guard: only ever convert the KNOWN dead stub. Blank, array-spill, or any
  // unexpected formula is left untouched.
  if (cur.indexOf(spec.deadStubContains) === -1) {
    out.msg = 'unexpected formula "' + cur + '" (need "' + spec.deadStubContains +
              '") -- left untouched';
    return out;
  }

  cell.setFormula(spec.newFormula);

  var after = String(cell.getFormula() || '');
  if (after !== spec.newFormula) {
    out.msg = 'write did not stick (got "' + after + '") -- verify manually';
    return out;
  }

  out.status = 'changed';
  out.msg = 'row ' + row + ' col ' + spec.formulaCol + ' -> ' + spec.newFormula;
  return out;
}

// Menu-callable entry point. Shows a dialog with the repair summary so the
// user has visible confirmation of what changed.
function runRepairFinanceSlideCfeSource() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rep = repairFinanceSlideCfeSource(ss);
  SpreadsheetApp.flush();

  var summary =
    'Repoint CFE source onto ' + _FRS_SINPV_REF + ':\n\n' +
    rep.lines.join('\n') +
    '\n\nChanged: ' + rep.changed + (rep.ok ? '' : '   (ABORTED)');

  try {
    SpreadsheetApp.getUi().alert('Repoint CFE source (FINANCE / SLIDE_DATA)',
      summary, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (_) {
    // Headless context (e.g. test runner) -- no UI.
  }
  return summary;
}
