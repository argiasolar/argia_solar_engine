// =============================================================================
// ARGIA ENGINE -- tests_unit/repairs/FinanceMarketMetricsTests.gs
// Unit tests for repairFinanceMarketMetrics (02l). Self-contained mock FINANCE
// sheet driving getLastRow + getRange().getValues()/setValues().
//
// These verify the WRITER produces the correct formula block (placement,
// idempotency, formula strings). The numeric results of NPV/IRR/DSCR are Google
// Sheets functions and are verified live; see the README worked example for the
// reference numbers.
//
// Coverage:
//   1. APPEND      -- fresh sheet: block appended after last content row
//   2. FORMULAS    -- NPV / IRR / DSCR / debt-service / discount-rate formulas
//   3. CASHFLOW    -- t0 = -C3, then =D30..=X30 across the row
//   4. IDEMPOTENT  -- re-run rewrites in place, header not duplicated
//   5. ABORT       -- missing FINANCE or INPUT_BAAS => ok=false, nothing written
// =============================================================================

function _mmMockSheet(name, labelCells) {
  // labelCells: array of {r,c,v}. Tracks a formula/value grid + lastRow.
  var grid = {}; var maxR = 0;
  (labelCells || []).forEach(function(x) {
    grid[x.r + ',' + x.c] = x.v; if (x.r > maxR) maxR = x.r;
  });
  function at(r, c) { var k = r + ',' + c; return (k in grid) ? grid[k] : ''; }
  return {
    getName: function() { return name; },
    getLastRow: function() { return maxR; },
    getRange: function(r, c, nr, nc) {
      if (nr === undefined) {
        return {
          getValue: function() { return at(r, c); },
          getFormula: function() { var v = at(r, c); return (typeof v === 'string' && v.charAt(0) === '=') ? v : ''; }
        };
      }
      return {
        getValues: function() {
          var out = [];
          for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(at(r + i, c + j)); out.push(row); }
          return out;
        },
        setValues: function(vals) {
          for (var i = 0; i < vals.length; i++)
            for (var j = 0; j < vals[i].length; j++) {
              grid[(r + i) + ',' + (c + j)] = vals[i][j];
              if (r + i > maxR) maxR = r + i;
            }
          return this;
        }
      };
    }
  };
}
function _mmMockSs(sheets) { return { getSheetByName: function(n) { return sheets[n] || null; } }; }

// A minimal FINANCE with content through row 46 (like the real template).
function _mmFinance() {
  return _mmMockSheet('FINANCE', [
    { r: 3,  c: 2, v: 'CAPEX' },
    { r: 30, c: 2, v: 'ARGIA Annual Payment' },
    { r: 46, c: 2, v: 'Average Zone Value' }   // last content row
  ]);
}
function _mmCell(sh, a1) {
  var col = a1.charCodeAt(0) - 64; var row = parseInt(a1.slice(1), 10);
  return sh.getRange(row, col).getFormula();
}

registerTest({
  id     : 'UNIT_FINANCE_MARKET_METRICS',
  group  : 'unit',
  module : 'repairs/finance_market_metrics',
  source : 'tests_unit/repairs/FinanceMarketMetricsTests.gs',
  fn: function (t) {
    t.suite('UNIT repairs/finance_market_metrics: discounted NPV / IRR / DSCR block');

    // --- 1. APPEND after last content row -----------------------------------
    var fin = _mmFinance();
    var ss = _mmMockSs({ FINANCE: fin, INPUT_BAAS: _mmMockSheet('INPUT_BAAS', []) });
    var rep = repairFinanceMarketMetrics(ss);
    t.assertTrue('append: ok', rep.ok);
    t.assert('append: 10-row block', 10, rep.changed);
    // content ends at row 46 -> blank separator at 47 -> header at 48
    t.assert('append: header at row 48', 48, rep.headerRow);
    t.assert('append: header text in B48', 'MARKET-STANDARD METRICS (PPA -- unlevered project)',
      fin.getRange(48, 2).getValue());

    // --- 2. KEY FORMULAS -----------------------------------------------------
    t.assert('formula: discount rate', '=INPUT_BAAS!D15', _mmCell(fin, 'C49'));
    t.assert('formula: target IRR',    '=INPUT_BAAS!D14', _mmCell(fin, 'C50'));
    t.assert('formula: discounted NPV', '=-C3+NPV(INPUT_BAAS!D15,D30:X30)', _mmCell(fin, 'C52'));
    t.assert('formula: IRR over cashflow row 51', '=IFERROR(IRR(C51:X51),"n/a")', _mmCell(fin, 'C53'));
    t.assert('formula: IRR margin vs target', '=IFERROR(C53-INPUT_BAAS!D14,"n/a")', _mmCell(fin, 'C54'));
    t.assert('formula: annual debt service', '=I7*12', _mmCell(fin, 'C55'));
    t.assert('formula: DSCR D56 gated by F7', '=IF(COLUMN()-COLUMN($D$56)<$F$7,D30/$C$55,"")', _mmCell(fin, 'D56'));
    t.assert('formula: DSCR K56 references K30', '=IF(COLUMN()-COLUMN($D$56)<$F$7,K30/$C$55,"")', _mmCell(fin, 'K56'));
    t.assert('formula: Min DSCR', '=IFERROR(MIN(D56:X56),"n/a")', _mmCell(fin, 'C57'));
    t.assert('formula: Avg DSCR', '=IFERROR(AVERAGE(D56:X56),"n/a")', _mmCell(fin, 'D57'));

    // --- 3. CASHFLOW ROW (t0 = -C3, then =D30..=X30) ------------------------
    t.assert('cashflow: t0 = -C3', '=-C3', _mmCell(fin, 'C51'));
    t.assert('cashflow: D51 = =D30', '=D30', _mmCell(fin, 'D51'));
    t.assert('cashflow: X51 = =X30', '=X30', _mmCell(fin, 'X51'));

    // --- 4. IDEMPOTENT (re-run rewrites in place; no duplicate header) -------
    var rep2 = repairFinanceMarketMetrics(ss);
    t.assert('idempotent: header still row 48', 48, rep2.headerRow);
    // scan column B for the header -- must appear exactly once
    var count = 0;
    for (var r = 1; r <= fin.getLastRow(); r++)
      if (String(fin.getRange(r, 2).getValue()).trim() === 'MARKET-STANDARD METRICS (PPA -- unlevered project)') count++;
    t.assert('idempotent: header appears exactly once', 1, count);

    // --- 5. ABORT ------------------------------------------------------------
    var repNoFin = repairFinanceMarketMetrics(_mmMockSs({ INPUT_BAAS: _mmMockSheet('INPUT_BAAS', []) }));
    t.assertFalse('abort: ok=false when FINANCE missing', repNoFin.ok);
    var repNoBaas = repairFinanceMarketMetrics(_mmMockSs({ FINANCE: _mmFinance() }));
    t.assertFalse('abort: ok=false when INPUT_BAAS missing', repNoBaas.ok);
    t.assert('abort: changed 0', 0, repNoBaas.changed);
  }
});
