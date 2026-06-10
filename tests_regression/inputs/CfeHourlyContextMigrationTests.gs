// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/CfeHourlyContextMigrationTests.gs
// -----------------------------------------------------------------------------
// [A2b] Locks the extraction + migration of the inline INPUT_CFE block that used
// to live inside runHourlySimulation (20a). It is now the pure helper
// _readCfeMonthlyContextForHourlySim, reading via readInput/INPUT_MAP.
//
// Reuses _mockCfeSs / _arr12 (CfeReadersMigrationTests.gs). Asserts the four
// outputs (demandaFacturableKw, fpByMonth, bajaTensionToggle, kWMaxAnoMovilKw)
// match the old inline block, including:
//   - FP empty-cell default 1.0 (Number||1.0)
//   - the 'YES' toggle comparison (unchanged; dropdown is SI/NO)
//   - BDF-11 global rolling max = max( max(kW rows 13-15), max(row 16) ), and
//     null when there is no kW data at all.
// =============================================================================

registerTest({
  id      : 'REG_MIGRATE_CFE_HOURLY_CONTEXT',
  group   : 'regression',
  module  : 'inputs/migration',
  scenarios: [],
  tags    : ['inputs', 'map', 'cfe', 'a2', 'migration'],
  source  : 'tests_regression/inputs/CfeHourlyContextMigrationTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/migration [A2b]: _readCfeMonthlyContextForHourlySim');

    // -- Case 1: full data; kW rows dominate the rolling max -------------------
    // kwBase=100, kwInter=150, kwPunta=200, kwMax(r16)=180
    //   optionB = max(100,150,200)=200 ; safety = 180 ; rolling = 200
    var c1 = _readCfeMonthlyContextForHourlySim(_mockCfeSs({ monthly: {
      19: _arr12(500), 20: _arr12(0.95),
      13: _arr12(100), 14: _arr12(150), 15: _arr12(200), 16: _arr12(180)
    }}));
    t.assert('demandaFacturableKw length 12', 12,  c1.demandaFacturableKw.length);
    t.assert('demandaFacturableKw[0]',        500, c1.demandaFacturableKw[0]);
    t.assert('fpByMonth[0]',                  0.95, c1.fpByMonth[0]);
    t.assert('rolling max length 12',         12,  c1.kWMaxAnoMovilKw.length);
    t.assert('rolling max = 200 (kW rows win)', 200, c1.kWMaxAnoMovilKw[0]);
    t.assert('toggle false when C7 empty',    false, c1.bajaTensionToggle);

    // -- Case 2: FP empty -> defaults to 1.0 ----------------------------------
    var c2 = _readCfeMonthlyContextForHourlySim(_mockCfeSs({ monthly: {
      19: _arr12(300)  // FP row 20 absent
    }}));
    t.assert('empty FP -> 1.0', 1.0, c2.fpByMonth[0]);
    t.assert('demanda still read', 300, c2.demandaFacturableKw[0]);

    // -- Case 3: baja-tensión toggle semantics (compares to 'YES') ------------
    function toggle(v){ return _readCfeMonthlyContextForHourlySim(
      _mockCfeSs({ scalars: (function(){ var s={}; if(v!==undefined)s[7]=v; return s; })() })
    ).bajaTensionToggle; }
    t.assert("'YES' -> true",       true,  toggle('YES'));
    t.assert("'yes' -> true (upper)",true,  toggle('yes'));
    t.assert("'SI' -> false",       false, toggle('SI'));     // dropdown value, but code checks YES
    t.assert("'NO' -> false",       false, toggle('NO'));
    t.assert('empty (default NO) -> false', false, toggle(undefined));

    // -- Case 4: row 16 safety net dominates ----------------------------------
    var c4 = _readCfeMonthlyContextForHourlySim(_mockCfeSs({ monthly: {
      13: _arr12(50), 14: _arr12(50), 15: _arr12(50), 16: _arr12(300)
    }}));
    t.assert('rolling max = 300 (safety net wins)', 300, c4.kWMaxAnoMovilKw[0]);

    // -- Case 5: no kW data at all -> kWMaxAnoMovilKw null ---------------------
    var c5 = _readCfeMonthlyContextForHourlySim(_mockCfeSs({ monthly: {
      19: _arr12(100)  // demanda only; no kW rows
    }}));
    t.assertTrue('no kW data -> rolling max null', c5.kWMaxAnoMovilKw === null);

    // -- Case 6: no INPUT_CFE sheet -> all defaults ---------------------------
    var c6 = _readCfeMonthlyContextForHourlySim({ getSheetByName: function(){ return null; } });
    t.assertTrue('no sheet -> demanda null', c6.demandaFacturableKw === null);
    t.assertTrue('no sheet -> fp null',      c6.fpByMonth === null);
    t.assert('no sheet -> toggle false',     false, c6.bajaTensionToggle);
    t.assertTrue('no sheet -> rolling null', c6.kWMaxAnoMovilKw === null);
  }
});
