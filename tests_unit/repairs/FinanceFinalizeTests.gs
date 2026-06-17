// =============================================================================
// ARGIA ENGINE -- tests_unit/repairs/FinanceFinalizeTests.gs
// Unit tests for repairFinanceAll (02m): orchestrates the three FINANCE repairs
// and writes provenance notes. Uses one unified mock that supports everything
// the sub-repairs touch (formulas, value grids, getDataRange/getFormulas,
// setValues, getLastRow) plus setNote/getNote.
//
// Coverage:
//   1. ORCHESTRATION -- all 4 steps run and report OK on a realistic workbook
//   2. SUB-REPAIR EFFECT -- CAPEX repointed G80->G94, metrics block appended
//   3. NOTES -- provenance notes land on fixed cells AND the metrics block,
//      with the right source references
//   4. IDEMPOTENT -- re-run still OK; metrics header still appears once
//   5. ABORT -- missing FINANCE => ok=false
// =============================================================================

// Unified mock cell: raw content `c` (a formula '=...' or a value/label) + note.
function _ffMockSheet(name, cells) {
  var grid = {}; var maxR = 0, maxC = 0;
  (cells || []).forEach(function (x) {
    grid[x.r + ',' + x.c] = { c: (x.c2 !== undefined ? x.c2 : x.v), note: '' };
    if (x.r > maxR) maxR = x.r; if (x.c > maxC) maxC = x.c;
  });
  function at(r, c) { var k = r + ',' + c; if (!grid[k]) grid[k] = { c: '', note: '' }; return grid[k]; }
  function isF(v) { return typeof v === 'string' && v.charAt(0) === '='; }
  return {
    getName: function () { return name; },
    getLastRow: function () { return maxR; },
    getRange: function (r, c, nr, nc) {
      if (nr === undefined) {
        var cell = at(r, c);
        return {
          getFormula: function () { return isF(cell.c) ? cell.c : ''; },
          setFormula: function (f) { cell.c = f; return this; },
          getValue:   function () { return cell.c; },
          setValue:   function (v) { cell.c = v; return this; },
          getNote:    function () { return cell.note; },
          setNote:    function (n) { cell.note = n; return this; }
        };
      }
      return {
        getValues:   function () { var o = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(at(r + i, c + j).c); o.push(row); } return o; },
        getFormulas: function () { var o = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) { var v = at(r + i, c + j).c; row.push(isF(v) ? v : ''); } o.push(row); } return o; },
        setValues:   function (vals) { for (var i = 0; i < vals.length; i++) for (var j = 0; j < vals[i].length; j++) { at(r + i, c + j).c = vals[i][j]; if (r + i > maxR) maxR = r + i; if (c + j > maxC) maxC = c + j; } return this; }
      };
    },
    getDataRange: function () {
      var self = this;
      return {
        getRow: function () { return 1; }, getColumn: function () { return 1; },
        getFormulas: function () { return self.getRange(1, 1, Math.max(maxR, 1), Math.max(maxC, 1)).getFormulas(); }
      };
    }
  };
}
function _ffMockSs(sheets) { return { getSheetByName: function (n) { return sheets[n] || null; } }; }

// A realistic pre-repair workbook: FINANCE with the three bugs + cashflow +
// loan cells, plus SLIDE_DATA, BESS_SIMULATION, INPUT_BAAS.
function _ffWorkbook() {
  var finCells = [
    { r: 3,  c: 2, v: 'CAPEX' }, { r: 3, c: 3, c2: '=(INSTALLATION_v2!G9+BOM_v2!G80)/(1-INPUT_PROJECT!D35)' },
    { r: 15, c: 2, v: 'Production' }, { r: 15, c: 4, c2: '=(12-MONTH(TODAY())-C5)*(SUM(CFE_SIMULATION!O8)/12)/1000' },
    { r: 16, c: 2, v: 'CFE Tariff' }, { r: 16, c: 4, c2: '=INPUT_CFE!O37/SUM(INPUT_CFE!C10:N12)' },
    { r: 17, c: 2, v: 'CFE Annual Payment' }, { r: 17, c: 4, c2: '=INPUT_CFE!O37' },
    { r: 22, c: 4, c2: '=0.438*D15' },
    { r: 30, c: 2, v: 'ARGIA Annual Payment' },
    { r: 46, c: 2, v: 'Average Zone Value' },
    { r: 7,  c: 9, c2: '=-PMT(F9/12,I6,I5)' }   // I7
  ];
  return {
    FINANCE: _ffMockSheet('FINANCE', finCells),
    SLIDE_DATA: _ffMockSheet('SLIDE_DATA', [
      { r: 25, c: 1, v: 'annual_energy_cost' }, { r: 25, c: 2, c2: '=SUM(INPUT_CFE!C37:N37)' }
    ]),
    BESS_SIMULATION: _ffMockSheet('BESS_SIMULATION', [
      { r: 12, c: 4, c2: '=CFE_SIMULATION!O39+IFERROR(O41,0)+IFERROR(O40,0)' }
    ]),
    INPUT_BAAS: _ffMockSheet('INPUT_BAAS', [
      { r: 14, c: 4, v: 0.15 }, { r: 15, c: 4, v: 0.12 }
    ])
  };
}

registerTest({
  id     : 'UNIT_REPAIR_FINANCE_ALL',
  group  : 'unit',
  module : 'repairs/finance_finalize',
  source : 'tests_unit/repairs/FinanceFinalizeTests.gs',
  fn: function (t) {
    t.suite('UNIT repairs/finance_finalize: orchestrate repairs + provenance notes');

    // --- 1. ORCHESTRATION ----------------------------------------------------
    var wb = _ffWorkbook();
    var ss = _ffMockSs(wb);
    var rep = repairFinanceAll(ss);
    t.assertTrue('orchestration: overall ok', rep.ok);
    t.assert('orchestration: 4 steps', 4, rep.steps.length);
    t.assert('orchestration: step names',
      'CFE source repoint,model correctness,market metrics,provenance notes',
      rep.steps.map(function (s) { return s.name; }).join(','));
    t.assertTrue('orchestration: all steps ok', rep.steps.every(function (s) { return s.ok; }));

    // --- 2. SUB-REPAIR EFFECT ------------------------------------------------
    t.assert('effect: CAPEX repointed G80->G94',
      '=(INSTALLATION_v2!G9+BOM_v2!G94)/(1-INPUT_PROJECT!D35)',
      wb.FINANCE.getRange(3, 3).getFormula());
    t.assert('effect: CFE source repointed to D12', '=BESS_SIMULATION!D12',
      wb.FINANCE.getRange(17, 4).getFormula());
    // metrics block header appended at row 48 (content ends at 46, blank 47)
    t.assert('effect: metrics header at B48', 'MARKET-STANDARD METRICS (PPA -- unlevered project)',
      wb.FINANCE.getRange(48, 2).getValue());

    // --- 3. PROVENANCE NOTES -------------------------------------------------
    var notesStep = rep.steps.filter(function (s) { return s.name === 'provenance notes'; })[0];
    t.assertTrue('notes: block found', notesStep.detail.blockFound);
    t.assert('notes: 8 fixed + 6 block = 14', 14, notesStep.detail.count);
    t.assertContains('notes: CAPEX note cites BOM_v2!G94', wb.FINANCE.getRange(3, 3).getNote(), 'BOM_v2!G94');
    t.assertContains('notes: CFE tariff note cites D12', wb.FINANCE.getRange(16, 4).getNote(), 'BESS_SIMULATION!D12');
    t.assertContains('notes: loan note cites PMT', wb.FINANCE.getRange(7, 9).getNote(), 'PMT');
    // metrics block: discounted-NPV note (header at 48 -> NPV at 52) cites WACC
    t.assertContains('notes: NPV note cites WACC', wb.FINANCE.getRange(52, 3).getNote(), 'INPUT_BAAS!D15');
    t.assertContains('notes: DSCR note explains >1', wb.FINANCE.getRange(57, 3).getNote(), 'DSCR > 1');

    // --- 4. IDEMPOTENT -------------------------------------------------------
    var rep2 = repairFinanceAll(ss);
    t.assertTrue('idempotent: still ok', rep2.ok);
    var headerCount = 0;
    for (var r = 1; r <= wb.FINANCE.getLastRow(); r++)
      if (String(wb.FINANCE.getRange(r, 2).getValue()).trim() === 'MARKET-STANDARD METRICS (PPA -- unlevered project)') headerCount++;
    t.assert('idempotent: metrics header appears once', 1, headerCount);
    t.assertContains('idempotent: CAPEX note still present', wb.FINANCE.getRange(3, 3).getNote(), 'BOM_v2!G94');

    // --- 5. ABORT ------------------------------------------------------------
    var repNoFin = repairFinanceAll(_ffMockSs({ INPUT_BAAS: _ffMockSheet('INPUT_BAAS', []) }));
    t.assertFalse('abort: ok=false when FINANCE missing', repNoFin.ok);
  }
});
