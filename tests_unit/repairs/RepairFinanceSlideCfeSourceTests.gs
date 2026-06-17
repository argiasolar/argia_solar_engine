// =============================================================================
// ARGIA ENGINE -- tests_unit/repairs/RepairFinanceSlideCfeSourceTests.gs
// Unit tests for repairFinanceSlideCfeSource (02h). Fully self-contained:
// builds a tiny in-memory mock spreadsheet, so no live workbook is required.
//
// Coverage:
//   1. HAPPY PATH    -- all three dead stubs repointed to BESS_SIMULATION!D12
//   2. IDEMPOTENT    -- re-running on the clean workbook changes nothing
//   3. MISSING LABEL -- a target whose label is absent is skipped; others fix
//   4. GUARD         -- an unexpected formula is LEFT UNTOUCHED (never clobbered)
//   5. ABORT         -- no BESS_SIMULATION => write nothing, ok=false
// =============================================================================

// --- tiny mock-sheet helpers -------------------------------------------------
function _frsMockSheet(name, cells) {
  // cells: array of { r, c, f, v }. Label cells pass v only; formula cells
  // pass f (v defaults to '').
  var grid = {}; var maxRow = 0;
  cells.forEach(function(x) {
    grid[x.r + ',' + x.c] = { f: x.f || '', v: (x.v !== undefined ? x.v : '') };
    if (x.r > maxRow) maxRow = x.r;
  });
  function at(r, c) {
    var k = r + ',' + c;
    if (!grid[k]) grid[k] = { f: '', v: '' };
    return grid[k];
  }
  return {
    getName    : function() { return name; },
    getLastRow : function() { return maxRow; },
    getRange   : function(r, c, nr, nc) {
      if (nr === undefined) {                     // single cell
        var cell = at(r, c);
        return {
          getFormula : function() { return cell.f; },
          getValue   : function() { return cell.v; },
          setFormula : function(f) { cell.f = f; cell.v = ''; return this; }
        };
      }
      return {                                    // rectangular range
        getValues : function() {
          var out = [];
          for (var i = 0; i < nr; i++) {
            var rowArr = [];
            for (var j = 0; j < nc; j++) rowArr.push(at(r + i, c + j).v);
            out.push(rowArr);
          }
          return out;
        }
      };
    }
  };
}

function _frsMockSs(sheetMap) {
  return { getSheetByName: function(n) { return sheetMap[n] || null; } };
}

// Build a "pre-repair" workbook with all three dead stubs present.
//   opts.noBess       : omit BESS_SIMULATION (abort case)
//   opts.noTariff     : omit FINANCE "CFE Tariff" row (missing-label case)
//   opts.slideFormula : override the SLIDE_DATA formula (guard case)
function _frsBuildDirtySs(opts) {
  opts = opts || {};
  var sheets = {};

  if (!opts.noBess) {
    sheets['BESS_SIMULATION'] = _frsMockSheet('BESS_SIMULATION', [
      { r: 12, c: 4, f: '=CFE_SIMULATION!O39+IFERROR(O41,0)+IFERROR(O40,0)', v: 12838765 }
    ]);
  }

  // SLIDE_DATA: col A keys, col B formulas.
  var slideCells = [
    { r: 24, c: 1, v: 'annual_savings' }, { r: 24, c: 2, f: '=123', v: 123 },
    { r: 25, c: 1, v: 'annual_energy_cost' },
    { r: 25, c: 2, f: (opts.slideFormula || '=SUM(INPUT_CFE!C37:N37)'), v: 0 }
  ];
  sheets['SLIDE_DATA'] = _frsMockSheet('SLIDE_DATA', slideCells);

  // FINANCE: col B labels, col D formulas.
  var finCells = [
    { r: 15, c: 2, v: 'Production' }, { r: 15, c: 4, f: '=99', v: 99 },
    { r: 17, c: 2, v: 'CFE Annual Payment' },
    { r: 17, c: 4, f: '=INPUT_CFE!O37', v: 0 }
  ];
  if (!opts.noTariff) {
    finCells.push({ r: 16, c: 2, v: 'CFE Tariff' });
    finCells.push({ r: 16, c: 4, f: '=INPUT_CFE!O37/SUM(INPUT_CFE!C10:N12)', v: 0 });
  }
  sheets['FINANCE'] = _frsMockSheet('FINANCE', finCells);

  return { ss: _frsMockSs(sheets), sheets: sheets };
}

function _frsResultFor(rep, id) {
  var hit = rep.results.filter(function(r) { return r.id === id; });
  return hit.length ? hit[0] : { id: id, status: '(absent)', msg: '(absent)' };
}

registerTest({
  id     : 'UNIT_REPAIR_FINANCE_SLIDE_CFE_SOURCE',
  group  : 'unit',
  module : 'repairs/finance_slide_cfe_source',
  source : 'tests_unit/repairs/RepairFinanceSlideCfeSourceTests.gs',
  fn: function (t) {
    t.suite('UNIT repairs/finance_slide_cfe_source: repoint dead INPUT_CFE stub -> BESS_SIMULATION!D12');

    var SLIDE_NEW   = '=BESS_SIMULATION!D12';
    var FIN_PAY_NEW = '=BESS_SIMULATION!D12';
    var FIN_TAR_NEW = '=BESS_SIMULATION!D12/SUM(INPUT_CFE!C10:N12)';

    // --- 1. HAPPY PATH -------------------------------------------------------
    var w = _frsBuildDirtySs();
    var rep = repairFinanceSlideCfeSource(w.ss);
    t.assertTrue('happy: ok', rep.ok);
    t.assert('happy: changed 3', 3, rep.changed);
    t.assert('happy: SLIDE_DATA repointed', SLIDE_NEW,
      w.sheets['SLIDE_DATA'].getRange(25, 2).getFormula());
    t.assert('happy: FINANCE CFE Annual Payment repointed', FIN_PAY_NEW,
      w.sheets['FINANCE'].getRange(17, 4).getFormula());
    t.assert('happy: FINANCE CFE Tariff repointed', FIN_TAR_NEW,
      w.sheets['FINANCE'].getRange(16, 4).getFormula());

    // --- 2. IDEMPOTENT (re-run on the now-clean workbook) --------------------
    var rep2 = repairFinanceSlideCfeSource(w.ss);
    t.assertTrue('idempotent: ok', rep2.ok);
    t.assert('idempotent: changed 0 on 2nd run', 0, rep2.changed);
    t.assert('idempotent: all three already-ok', 'already-ok,already-ok,already-ok',
      rep2.results.map(function(r) { return r.status; }).join(','));
    t.assert('idempotent: SLIDE_DATA still repointed', SLIDE_NEW,
      w.sheets['SLIDE_DATA'].getRange(25, 2).getFormula());

    // --- 3. MISSING LABEL (FINANCE has no "CFE Tariff" row) ------------------
    var w3 = _frsBuildDirtySs({ noTariff: true });
    var rep3 = repairFinanceSlideCfeSource(w3.ss);
    t.assertTrue('missing-label: still ok', rep3.ok);
    t.assert('missing-label: only 2 changed', 2, rep3.changed);
    var tarRes = _frsResultFor(rep3, 'FINANCE[CFE Tariff]');
    t.assert('missing-label: tariff target skipped', 'skipped', tarRes.status);
    t.assertContains('missing-label: tariff msg explains', tarRes.msg, 'not found');
    t.assert('missing-label: payment still repointed', FIN_PAY_NEW,
      w3.sheets['FINANCE'].getRange(17, 4).getFormula());

    // --- 4. GUARD: unexpected formula is LEFT UNTOUCHED ---------------------
    var w4 = _frsBuildDirtySs({ slideFormula: '=SOME_OTHER!A1*2' });
    var rep4 = repairFinanceSlideCfeSource(w4.ss);
    var slideRes = _frsResultFor(rep4, 'SLIDE_DATA[annual_energy_cost]');
    t.assert('guard: unexpected slide formula skipped', 'skipped', slideRes.status);
    t.assert('guard: unexpected slide formula NOT overwritten', '=SOME_OTHER!A1*2',
      w4.sheets['SLIDE_DATA'].getRange(25, 2).getFormula());
    t.assertContains('guard: msg says left untouched', slideRes.msg, 'left untouched');

    // --- 5. ABORT: no BESS_SIMULATION -> write nothing ----------------------
    var w5 = _frsBuildDirtySs({ noBess: true });
    var rep5 = repairFinanceSlideCfeSource(w5.ss);
    t.assertFalse('abort: ok=false when source sheet missing', rep5.ok);
    t.assert('abort: changed 0', 0, rep5.changed);
    t.assert('abort: FINANCE payment left as dead stub', '=INPUT_CFE!O37',
      w5.sheets['FINANCE'].getRange(17, 4).getFormula());
    t.assert('abort: SLIDE_DATA left as dead stub', '=SUM(INPUT_CFE!C37:N37)',
      w5.sheets['SLIDE_DATA'].getRange(25, 2).getFormula());
  }
});
