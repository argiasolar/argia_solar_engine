// =============================================================================
// ARGIA ENGINE -- tests_unit/repairs/RepairFinanceModelTests.gs
// Unit tests for repairFinanceModel (02k). Self-contained mock FINANCE sheet
// driving getDataRange().getFormulas() + getRange().getFormula()/setFormula().
//
// Coverage:
//   1. HAPPY PATH    -- CAPEX G80->G94, production MAX(0,..), CO2 0.438->0.444
//   2. NO COLLATERAL -- C34 (=C3/1.16) and E15 (full-year) are NOT touched
//   3. IDEMPOTENT    -- re-running changes nothing
//   4. PARTIAL       -- already-fixed CAPEX is skipped; the rest still fix
//   5. ABORT         -- missing FINANCE => ok=false, nothing changed
// =============================================================================

// --- mock sheet supporting getDataRange().getFormulas() + single-cell rw -----
function _fmMockSheet(name, cells) {
  // cells: array of { r, c, f } (formula strings)
  var grid = {}; var maxR = 0, maxC = 0;
  cells.forEach(function(x) {
    grid[x.r + ',' + x.c] = { f: x.f || '' };
    if (x.r > maxR) maxR = x.r;
    if (x.c > maxC) maxC = x.c;
  });
  function at(r, c) { var k = r + ',' + c; if (!grid[k]) grid[k] = { f: '' }; return grid[k]; }
  return {
    getName: function() { return name; },
    getDataRange: function() {
      return {
        getRow: function() { return 1; },
        getColumn: function() { return 1; },
        getFormulas: function() {
          var out = [];
          for (var r = 1; r <= maxR; r++) {
            var row = [];
            for (var c = 1; c <= maxC; c++) row.push(at(r, c).f);
            out.push(row);
          }
          return out;
        }
      };
    },
    getRange: function(r, c) {
      var cell = at(r, c);
      return {
        getFormula: function() { return cell.f; },
        setFormula: function(f) { cell.f = f; return this; }
      };
    }
  };
}
function _fmMockSs(sheets) { return { getSheetByName: function(n) { return sheets[n] || null; } }; }

// Build a "dirty" FINANCE with all three bugs present.
//   opts.capexFixed : start C3 already on G94 (partial-fix case)
function _fmBuildFinance(opts) {
  opts = opts || {};
  var bomRef = opts.capexFixed ? 'BOM_v2!G94' : 'BOM_v2!G80';
  return _fmMockSheet('FINANCE', [
    { r: 3,  c: 3, f: '=(INSTALLATION_v2!G9+' + bomRef + ')/(1-INPUT_PROJECT!D35)' }, // C3 CAPEX
    { r: 34, c: 3, f: '=C3/1.16' },                                                    // C34 (must NOT change)
    { r: 15, c: 4, f: '=(12-MONTH(TODAY())-C5)*(SUM(CFE_SIMULATION!O8)/12)/1000' },     // D15 production
    { r: 15, c: 5, f: '=CFE_SIMULATION!O8*(100%-2%)/1000' },                            // E15 (must NOT change)
    { r: 22, c: 4, f: '=0.438*D15' },                                                   // D22 CO2
    { r: 22, c: 5, f: '=0.438*E15' },                                                   // E22 CO2
    { r: 22, c: 6, f: '=0.438*F15' }                                                    // F22 CO2
  ]);
}

registerTest({
  id     : 'UNIT_REPAIR_FINANCE_MODEL',
  group  : 'unit',
  module : 'repairs/finance_model',
  source : 'tests_unit/repairs/RepairFinanceModelTests.gs',
  fn: function (t) {
    t.suite('UNIT repairs/finance_model: CAPEX G80->G94, production MAX(0), CO2 0.444');

    var CAPEX_FIXED = '=(INSTALLATION_v2!G9+BOM_v2!G94)/(1-INPUT_PROJECT!D35)';
    var PROD_FIXED  = '=(MAX(0,12-MONTH(TODAY())-C5))*(SUM(CFE_SIMULATION!O8)/12)/1000';

    // --- 1. HAPPY PATH -------------------------------------------------------
    var fin = _fmBuildFinance();
    var ss = _fmMockSs({ FINANCE: fin });
    var rep = repairFinanceModel(ss);
    t.assertTrue('happy: ok', rep.ok);
    t.assert('happy: changed 5 (1 CAPEX + 1 prod + 3 CO2)', 5, rep.changed);
    t.assert('happy: CAPEX -> G94', CAPEX_FIXED, fin.getRange(3, 3).getFormula());
    t.assert('happy: production floored', PROD_FIXED, fin.getRange(15, 4).getFormula());
    t.assert('happy: CO2 D22 -> 0.444', '=0.444*D15', fin.getRange(22, 4).getFormula());
    t.assert('happy: CO2 E22 -> 0.444', '=0.444*E15', fin.getRange(22, 5).getFormula());
    t.assert('happy: CO2 F22 -> 0.444', '=0.444*F15', fin.getRange(22, 6).getFormula());

    // --- 2. NO COLLATERAL DAMAGE --------------------------------------------
    t.assert('no-collateral: C34 untouched', '=C3/1.16', fin.getRange(34, 3).getFormula());
    t.assert('no-collateral: E15 (full-year prod) untouched',
      '=CFE_SIMULATION!O8*(100%-2%)/1000', fin.getRange(15, 5).getFormula());

    // --- 3. IDEMPOTENT -------------------------------------------------------
    var rep2 = repairFinanceModel(ss);
    t.assert('idempotent: changed 0 on 2nd run', 0, rep2.changed);
    t.assert('idempotent: CAPEX still G94', CAPEX_FIXED, fin.getRange(3, 3).getFormula());
    t.assert('idempotent: production not double-wrapped', PROD_FIXED, fin.getRange(15, 4).getFormula());

    // --- 4. PARTIAL (CAPEX already fixed; prod + CO2 still dirty) ------------
    var fin4 = _fmBuildFinance({ capexFixed: true });
    var rep4 = repairFinanceModel(_fmMockSs({ FINANCE: fin4 }));
    t.assert('partial: changed 4 (CAPEX skipped)', 4, rep4.changed);
    var capRes = rep4.results.filter(function(r){ return r.id.indexOf('CAPEX') === 0; })[0];
    t.assert('partial: CAPEX reported no-change', 0, capRes.changed);
    t.assert('partial: production still fixed', PROD_FIXED, fin4.getRange(15, 4).getFormula());

    // --- 5. ABORT: no FINANCE sheet -----------------------------------------
    var rep5 = repairFinanceModel(_fmMockSs({}));
    t.assertFalse('abort: ok=false when FINANCE missing', rep5.ok);
    t.assert('abort: changed 0', 0, rep5.changed);
  }
});
