// =============================================================================
// ARGIA TESTS -- tests_integration/writers_v2/WriteBessRecommendationsTests.gs
// -----------------------------------------------------------------------------
// BDF-1 -- writeBessRecommendations on a scratch sheet.
//
// PATTERN
//   Same as SetupMdcTemplateTests: unique scratch sheet name, try/finally
//   cleanup. Never touches the live BESS_RECOMMENDATIONS sheet so a "Run
//   Tests" mid-engine-run doesn't blow away the designer's working table.
//
// COVERAGE
//   - Normal path: writer creates the sheet, renders timestamp / tariff /
//     site summary / column headers / ranked rows.
//   - Blocked path: writer surfaces the blocked reason in red.
//   - Idempotency: re-calling on the same sheet doesn't accumulate rows.
//
// CHUNK TAG
//   'bdf1' -- "▶ Run Tests for Current Chunk" picks this up.
// =============================================================================

function _scratchBessRecsName_() {
  return '_BESS_RECS_TEST_' + new Date().getTime();
}
function _deleteSheetIfExists_BR_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh) ss.deleteSheet(sh);
}

// Build a synthetic suggestBessSizing-shaped result we can test against
// without depending on live INPUT_CFE / 16M_PRODUCTS_BESS data.
function _fakeBessSuggestionResult_() {
  return {
    siteSummary: { maxMonthlyPuntaKw: 792, avgMonthlyPuntaKwh: 30896, monthsAnalyzed: 12 },
    candidates: [
      // ranked - LIBRARY product first, smaller ladder rung after
      { label: 'HW_LUNA_2MWH', source: 'LIBRARY',
        capacityKwh: 2032, powerKw: 1016,
        usableKwh: 1782, shavedKw: 445.8, shaveCapableKw: 445.8,
        monthlyThroughputKwh: 49509,
        installedCapexMxn: 20000000,
        annualDemandSavingMxn: 1864210,
        annualEnergyShiftSavingMxn: 369694,
        annualSavingMxn: 2233904,
        netShiftValueMxnPerKwh: 0.622,
        coverageRatio: 0.563, coverageFlag: 'PARTIAL',
        paybackYears: 8.95,
        meetsThreshold: true },     // BDF-3: above $2M threshold (2.23M > 2M)
      { label: '500 kWh', source: 'LADDER',
        capacityKwh: 500, powerKw: null,
        usableKwh: 438.75, shavedKw: 109.7, shaveCapableKw: 109.7,
        monthlyThroughputKwh: 12186,
        installedCapexMxn: 0,
        annualDemandSavingMxn: 458640,
        annualEnergyShiftSavingMxn: 90968,
        annualSavingMxn: 549608,
        netShiftValueMxnPerKwh: 0.622,
        coverageRatio: 0.139, coverageFlag: 'PARTIAL',
        paybackYears: null,
        meetsThreshold: false },    // BDF-3: below $2M threshold (550k < 2M)
    ],
    recommendation: null,  // BDF-1: no recommendation field exposed in UI
    warnings: ['Test warning 1', 'Test warning 2'],
    tariff: {
      puntaMxnPerKwh: 1.529, baseMxnPerKwh: 0.828, demandChargeMxnPerKw: 348.5,
      puntaSource: 'INPUT_CFE_DERIVED',
      baseSource:  'INPUT_CFE_DERIVED',
      demandSource:'INPUT_CFE_DERIVED',
      monthsRead: 12,
    },
    // BDF-2: interconnection bundle (default NET_METERING for the fixture
    // since that's CULLIGAN's real mode; per-mode tests below override).
    interconnection: {
      mode: 'NET_METERING',
      exportPriceMxnPerKwh: 0.8,
      modeProvenance: 'INPUT_CFE',
      pvAnnualSurplusKwh: 900615,
      pvSurplusProvenance: 'CFE_SIMULATION',
      pvSurplusMonthsRead: 12,
    },
    // BDF-3: threshold bundle. Default DISABLED so BDF-1/BDF-2 tests keep
    // passing without modification. Per-test setups override to enable.
    threshold: {
      thresholdMxn: 0,
      provenance: 'DISABLED',
    },
    batteryCatalog: { count: 10, source: '16M_PRODUCTS_BESS' },
    blocked: false,
  };
}


registerTest({
  id      : 'INT_BDF1_WRITE_BESS_RECS_RENDERS_TABLE',
  group   : 'integration',
  module  : 'writers_v2/bess_recs',
  scenarios: [],
  tags    : ['integration', 'bess', 'recommendations', 'bdf1'],
  source  : 'tests_integration/writers_v2/WriteBessRecommendationsTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers_v2/bess_recs: writeBessRecommendations renders table');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchBessRecsName_();

    try {
      writeBessRecommendations(ss, _fakeBessSuggestionResult_(), { sheetName: scratch });
      var sh = ss.getSheetByName(scratch);
      t.assertTrue('scratch sheet exists', sh !== null);
      if (!sh) return;

      // Title row contains the marker
      var title = String(sh.getRange(1, 3).getValue() || '');
      t.assertTrue('row 1 title (C1) contains "BESS RECOMMENDATIONS"',
        title.indexOf('BESS RECOMMENDATIONS') >= 0);

      // Tariff inputs row 3
      t.assert('row 3 col A label', 'Tariff inputs:', sh.getRange(3, 1).getValue());
      t.assertNear('row 3 col C punta value', 1.529, Number(sh.getRange(3, 3).getValue()), 0.001);
      t.assertNear('row 3 col E base value',  0.828, Number(sh.getRange(3, 5).getValue()), 0.001);
      t.assertNear('row 3 col G demand value', 348.5, Number(sh.getRange(3, 7).getValue()), 0.01);

      // Provenance row 4
      var puntaProv = String(sh.getRange(4, 2).getValue() || '');
      t.assertTrue('row 4 col B contains provenance for punta',
        puntaProv.indexOf('INPUT_CFE') >= 0);

      // Site summary row 5
      t.assert('row 5 col C max punta kW', 792, Number(sh.getRange(5, 3).getValue()));
      t.assert('row 5 col E avg punta kWh', 30896, Number(sh.getRange(5, 5).getValue()));
      t.assert('row 5 col G months read', 12, Number(sh.getRange(5, 7).getValue()));

      // Column headers row 7
      t.assert('row 7 col A header = "#"', '#', sh.getRange(7, 1).getValue());
      t.assert('row 7 col B header = "Battery ID"', 'Battery ID', sh.getRange(7, 2).getValue());
      t.assert('row 7 col J header = "Total $/yr"', 'Total $/yr', sh.getRange(7, 10).getValue());
      t.assert('row 7 col L header = "Payback yrs"', 'Payback yrs', sh.getRange(7, 12).getValue());

      // First data row (8) = first ranked candidate (HW_LUNA_2MWH)
      t.assert('row 8 col A rank = 1', 1, Number(sh.getRange(8, 1).getValue()));
      t.assert('row 8 col B = HW_LUNA_2MWH', 'HW_LUNA_2MWH', sh.getRange(8, 2).getValue());
      t.assert('row 8 col C capacity = 2032', 2032, Number(sh.getRange(8, 3).getValue()));
      t.assert('row 8 col D power = 1016', 1016, Number(sh.getRange(8, 4).getValue()));
      t.assertNear('row 8 col F shave = 445.8', 445.8, Number(sh.getRange(8, 6).getValue()), 0.1);
      t.assert('row 8 col G coverage = PARTIAL', 'PARTIAL', sh.getRange(8, 7).getValue());
      t.assert('row 8 col J total saving = 2233904',
        2233904, Math.round(Number(sh.getRange(8, 10).getValue())));
      t.assertNear('row 8 col L payback = 8.95', 9, Number(sh.getRange(8, 12).getValue()), 0.1);
      t.assert('row 8 col M source = LIBRARY', 'LIBRARY', sh.getRange(8, 13).getValue());

      // Second row (9) = ladder rung, payback should be N/A (null)
      t.assert('row 9 col A rank = 2', 2, Number(sh.getRange(9, 1).getValue()));
      t.assert('row 9 col L payback = N/A', 'N/A', sh.getRange(9, 12).getValue());

      // Frozen rows = 7 (so designer can scroll candidates while header stays)
      t.assert('frozen rows = 7', 7, sh.getFrozenRows());
    } finally {
      _deleteSheetIfExists_BR_(ss, scratch);
    }
  }
});


registerTest({
  id      : 'INT_BDF1_WRITE_BESS_RECS_BLOCKED_PATH',
  group   : 'integration',
  module  : 'writers_v2/bess_recs',
  scenarios: [],
  tags    : ['integration', 'bess', 'recommendations', 'bdf1', 'blocked'],
  source  : 'tests_integration/writers_v2/WriteBessRecommendationsTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers_v2/bess_recs: blocked path surfaces reason');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchBessRecsName_();
    try {
      var blocked = {
        siteSummary: null, candidates: [], recommendation: null,
        warnings: [], tariff: null, batteryCatalog: null,
        blocked: 'No usable monthly load data in INPUT_CFE.',
      };
      writeBessRecommendations(ss, blocked, { sheetName: scratch });

      var sh = ss.getSheetByName(scratch);
      t.assertTrue('scratch sheet exists', sh !== null);
      if (!sh) return;

      var reasonCell = String(sh.getRange(3, 1).getValue() || '');
      t.assertTrue('row 3 col A contains "Suggestion blocked"',
        reasonCell.indexOf('Suggestion blocked') >= 0);
      t.assertTrue('row 3 col A contains the reason text',
        reasonCell.indexOf('No usable monthly load data') >= 0);

      // No table headers when blocked (row 7 col A should be empty)
      t.assert('row 7 col A is blank on blocked path',
        '', String(sh.getRange(7, 1).getValue() || ''));
    } finally {
      _deleteSheetIfExists_BR_(ss, scratch);
    }
  }
});


registerTest({
  id      : 'INT_BDF1_WRITE_BESS_RECS_IDEMPOTENT',
  group   : 'integration',
  module  : 'writers_v2/bess_recs',
  scenarios: [],
  tags    : ['integration', 'bess', 'recommendations', 'bdf1', 'idempotent'],
  source  : 'tests_integration/writers_v2/WriteBessRecommendationsTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers_v2/bess_recs: re-writing same sheet is idempotent');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchBessRecsName_();
    try {
      writeBessRecommendations(ss, _fakeBessSuggestionResult_(), { sheetName: scratch });
      var sh = ss.getSheetByName(scratch);
      if (!sh) { t.assertTrue('sheet exists', false); return; }

      var rowCount1 = sh.getLastRow();

      // Run again with a smaller result
      var smaller = _fakeBessSuggestionResult_();
      smaller.candidates = [smaller.candidates[0]];  // only 1 row of data
      smaller.warnings = [];
      writeBessRecommendations(ss, smaller, { sheetName: scratch });

      var rowCount2 = sh.getLastRow();
      t.assertTrue('re-write reduces row count (no leftover rows)',
        rowCount2 < rowCount1);
      // Still has the candidate row at row 8
      t.assert('row 8 col B still = HW_LUNA_2MWH after re-write',
        'HW_LUNA_2MWH', sh.getRange(8, 2).getValue());
    } finally {
      _deleteSheetIfExists_BR_(ss, scratch);
    }
  }
});


// =============================================================================
// BDF-2 additions: writer renders interconnection row.
// =============================================================================

registerTest({
  id      : 'INT_BDF2_WRITE_BESS_RECS_INTERCONNECTION_ROW',
  group   : 'integration',
  module  : 'writers_v2/bess_recs',
  scenarios: [],
  tags    : ['integration', 'bess', 'recommendations', 'bdf2', 'interconnection'],
  source  : 'tests_integration/writers_v2/WriteBessRecommendationsTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers_v2/bess_recs: BDF-2 interconnection row 6');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchBessRecsName_();
    try {
      writeBessRecommendations(ss, _fakeBessSuggestionResult_(), { sheetName: scratch });
      var sh = ss.getSheetByName(scratch);
      t.assertTrue('scratch sheet exists', sh !== null);
      if (!sh) return;

      // Row 6 col A: "Interconnection:"
      t.assert('row 6 col A label', 'Interconnection:', sh.getRange(6, 1).getValue());
      // Row 6 col B: mode (NET_METERING in our fixture)
      t.assert('row 6 col B mode', 'NET_METERING', sh.getRange(6, 2).getValue());
      // Row 6 col C/D: export price label + value
      t.assert('row 6 col C export-price label', 'Export price:',
               sh.getRange(6, 3).getValue());
      t.assertNear('row 6 col D export price value', 0.8,
                   Number(sh.getRange(6, 4).getValue()), 0.01);
      // Row 6 col E/F: PV surplus label + value
      t.assert('row 6 col E PV-surplus label', 'PV surplus/yr:',
               sh.getRange(6, 5).getValue());
      t.assert('row 6 col F PV surplus value', 900615,
               Number(sh.getRange(6, 6).getValue()));

      // Row 6 col G: mode explainer (italic text). Must contain the word
      // "Grid" since fixture is NET_METERING.
      var explainer = String(sh.getRange(6, 7).getValue() || '');
      t.assertTrue('row 6 col G explainer mentions Grid (NET_METERING)',
                   explainer.indexOf('Grid') >= 0);

      // Verify BDF-1 row positions still intact (no shift)
      t.assert('row 1 still has title', true,
               String(sh.getRange(1, 3).getValue()).indexOf('BESS RECOMMENDATIONS') >= 0);
      t.assert('row 3 still has tariff inputs label',
               'Tariff inputs:', sh.getRange(3, 1).getValue());
      t.assert('row 5 still has site summary label',
               'Site:', sh.getRange(5, 1).getValue());
      t.assert('row 7 still has # header',
               '#', sh.getRange(7, 1).getValue());
      t.assert('row 8 still has top candidate',
               'HW_LUNA_2MWH', sh.getRange(8, 2).getValue());
    } finally {
      _deleteSheetIfExists_BR_(ss, scratch);
    }
  }
});


registerTest({
  id      : 'INT_BDF2_WRITE_BESS_RECS_NET_BILLING_EXPLAINER',
  group   : 'integration',
  module  : 'writers_v2/bess_recs',
  scenarios: [],
  tags    : ['integration', 'bess', 'recommendations', 'bdf2', 'interconnection'],
  source  : 'tests_integration/writers_v2/WriteBessRecommendationsTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers_v2/bess_recs: explainer changes per mode');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchBessRecsName_();
    try {
      var nb = _fakeBessSuggestionResult_();
      nb.interconnection.mode = 'NET_BILLING';
      writeBessRecommendations(ss, nb, { sheetName: scratch });
      var sh = ss.getSheetByName(scratch);
      var explainer = String(sh.getRange(6, 7).getValue() || '');
      t.assertTrue('NET_BILLING explainer mentions exports',
                   explainer.indexOf('export') >= 0);
      t.assertTrue('NET_BILLING explainer mentions punta tariff',
                   explainer.indexOf('punta') >= 0);

      var ze = _fakeBessSuggestionResult_();
      ze.interconnection.mode = 'ZERO_EXPORT';
      writeBessRecommendations(ss, ze, { sheetName: scratch });
      var explainerZe = String(sh.getRange(6, 7).getValue() || '');
      t.assertTrue('ZERO_EXPORT explainer mentions curtailed',
                   explainerZe.indexOf('curtailed') >= 0);
    } finally {
      _deleteSheetIfExists_BR_(ss, scratch);
    }
  }
});


// =============================================================================
// BDF-3 additions: threshold verdict banner + per-row threshold styling.
// =============================================================================

registerTest({
  id      : 'INT_BDF3_VERDICT_BANNER_RECOMMENDED',
  group   : 'integration',
  module  : 'writers_v2/bess_recs',
  scenarios: [],
  tags    : ['integration', 'bess', 'recommendations', 'bdf3', 'threshold'],
  source  : 'tests_integration/writers_v2/WriteBessRecommendationsTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers_v2/bess_recs: BDF-3 verdict banner (recommended)');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchBessRecsName_();
    try {
      var fx = _fakeBessSuggestionResult_();
      // Enable threshold + provide a recommendation (the 2MWh in fixture meets)
      fx.threshold = { thresholdMxn: 2000000, provenance: 'INPUT_BESS' };
      fx.recommendation = fx.candidates[0];  // HW_LUNA_2MWH, meetsThreshold=true
      writeBessRecommendations(ss, fx, { sheetName: scratch });
      var sh = ss.getSheetByName(scratch);
      if (!sh) { t.assertTrue('sheet exists', false); return; }

      // Row 2 banner exists and starts with "RECOMMENDED:"
      var banner = String(sh.getRange(2, 1).getValue() || '');
      t.assertTrue('row 2 banner starts with "RECOMMENDED"',
                   banner.indexOf('RECOMMENDED') === 0);
      t.assertTrue('banner names the recommendation',
                   banner.indexOf('HW_LUNA_2MWH') >= 0);
      t.assertTrue('banner shows annual saving',
                   banner.indexOf('2,233,904') >= 0);
      t.assertTrue('banner shows threshold for context',
                   banner.indexOf('2,000,000') >= 0);

      // BDF-1/BDF-2 row positions still intact
      t.assert('row 3 still has tariff inputs',
               'Tariff inputs:', sh.getRange(3, 1).getValue());
      t.assert('row 7 still has # header', '#', sh.getRange(7, 1).getValue());
      t.assert('row 8 still has top candidate',
               'HW_LUNA_2MWH', sh.getRange(8, 2).getValue());
    } finally {
      _deleteSheetIfExists_BR_(ss, scratch);
    }
  }
});

registerTest({
  id      : 'INT_BDF3_VERDICT_BANNER_NO_RECOMMENDATION',
  group   : 'integration',
  module  : 'writers_v2/bess_recs',
  scenarios: [],
  tags    : ['integration', 'bess', 'recommendations', 'bdf3', 'threshold'],
  source  : 'tests_integration/writers_v2/WriteBessRecommendationsTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers_v2/bess_recs: BDF-3 verdict banner (no recommendation)');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchBessRecsName_();
    try {
      var fx = _fakeBessSuggestionResult_();
      // Enable threshold ABOVE all candidates; recommendation=null
      fx.threshold = { thresholdMxn: 99999999, provenance: 'INPUT_BESS' };
      fx.recommendation = null;
      // Mark all as below-threshold so the writer's "best below" logic works
      fx.candidates[0].meetsThreshold = false;
      fx.candidates[1].meetsThreshold = false;
      writeBessRecommendations(ss, fx, { sheetName: scratch });
      var sh = ss.getSheetByName(scratch);
      if (!sh) { t.assertTrue('sheet exists', false); return; }

      var banner = String(sh.getRange(2, 1).getValue() || '');
      t.assertTrue('row 2 banner starts with "NO CANDIDATE"',
                   banner.indexOf('NO CANDIDATE') === 0);
      // Best-below = HW_LUNA_2MWH at 2233904
      t.assertTrue('banner names the best-below candidate',
                   banner.indexOf('HW_LUNA_2MWH') >= 0);
      t.assertTrue('banner shows % of threshold',
                   banner.indexOf('%') >= 0);
    } finally {
      _deleteSheetIfExists_BR_(ss, scratch);
    }
  }
});

registerTest({
  id      : 'INT_BDF3_NO_BANNER_WHEN_DISABLED',
  group   : 'integration',
  module  : 'writers_v2/bess_recs',
  scenarios: [],
  tags    : ['integration', 'bess', 'recommendations', 'bdf3', 'threshold'],
  source  : 'tests_integration/writers_v2/WriteBessRecommendationsTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers_v2/bess_recs: BDF-3 no banner when threshold=0');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchBessRecsName_();
    try {
      // Default fixture has threshold=0 (DISABLED) -> no banner
      writeBessRecommendations(ss, _fakeBessSuggestionResult_(), { sheetName: scratch });
      var sh = ss.getSheetByName(scratch);
      if (!sh) { t.assertTrue('sheet exists', false); return; }

      var bannerCell = String(sh.getRange(2, 1).getValue() || '');
      t.assert('row 2 col A is blank when threshold disabled', '', bannerCell);

      // Row 1 (title) still rendered
      var title = String(sh.getRange(1, 3).getValue() || '');
      t.assertTrue('row 1 title still rendered',
                   title.indexOf('BESS RECOMMENDATIONS') >= 0);
    } finally {
      _deleteSheetIfExists_BR_(ss, scratch);
    }
  }
});


// =============================================================================
// BDF-4 additions: stacking in the writer.
// =============================================================================

registerTest({
  id      : 'INT_BDF4_WRITER_RENDERS_STACK_LABELS',
  group   : 'integration',
  module  : 'writers_v2/bess_recs',
  scenarios: [],
  tags    : ['integration', 'bess', 'recommendations', 'bdf4', 'stacking'],
  source  : 'tests_integration/writers_v2/WriteBessRecommendationsTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers_v2/bess_recs: BDF-4 stacking labels render');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchBessRecsName_();
    try {
      var fx = _fakeBessSuggestionResult_();
      // Override with stacked candidates
      fx.candidates = [
        { label: '5 × HW_LUNA_241 (1205 kWh, 540 kW)', source: 'LIBRARY',
          capacityKwh: 1205, powerKw: 540,
          usableKwh: 1057, shavedKw: 264, shaveCapableKw: 264,
          monthlyThroughputKwh: 29354,
          installedCapexMxn: 16000000,
          annualDemandSavingMxn: 1346400,
          annualEnergyShiftSavingMxn: 219240,
          annualSavingMxn: 1565640,
          netShiftValueMxnPerKwh: 0.622,
          coverageRatio: 0.333, coverageFlag: 'PARTIAL',
          paybackYears: 10.22, meetsThreshold: true,
          stackQty: 5, baseBatteryId: 'HW_LUNA_241',
          baseCapacityKwh: 241, basePowerKw: 108 },
        { label: 'HW_LUNA_2MWH (2032 kWh)', source: 'LIBRARY',
          capacityKwh: 2032, powerKw: 1016,
          usableKwh: 1782, shavedKw: 446, shaveCapableKw: 446,
          monthlyThroughputKwh: 49509,
          installedCapexMxn: 20000000,
          annualDemandSavingMxn: 2245920,
          annualEnergyShiftSavingMxn: 369694,
          annualSavingMxn: 2615614,
          netShiftValueMxnPerKwh: 0.622,
          coverageRatio: 0.563, coverageFlag: 'PARTIAL',
          paybackYears: 7.65, meetsThreshold: true,
          stackQty: 1, baseBatteryId: 'HW_LUNA_2MWH',
          baseCapacityKwh: 2032, basePowerKw: 1016 }
      ];
      fx.recommendation = fx.candidates[1];   // 2MWh, fastest payback
      fx.threshold = { thresholdMxn: 1500000, provenance: 'INPUT_BESS' };

      writeBessRecommendations(ss, fx, { sheetName: scratch });
      var sh = ss.getSheetByName(scratch);
      if (!sh) { t.assertTrue('sheet exists', false); return; }

      // Both candidates render (both meet threshold)
      // Row 8 (fastest payback) = HW_LUNA_2MWH; Row 9 = 5 × HW_LUNA_241
      t.assertContains('row 8 has 2MWh as fastest payback',
                       String(sh.getRange(8, 2).getValue()), 'HW_LUNA_2MWH');
      t.assertContains('row 9 has the stack',
                       String(sh.getRange(9, 2).getValue()), '5 × HW_LUNA_241');

      // Stack row shows full capacity (1205) and power (540)
      t.assert('stack row capacity = 1205',
               1205, Number(sh.getRange(9, 3).getValue()));
      t.assert('stack row power = 540',
               540, Number(sh.getRange(9, 4).getValue()));

      // Stack row CAPEX shows linear scaling
      t.assert('stack row CAPEX = $16M (5 × $3.2M)',
               16000000, Number(sh.getRange(9, 11).getValue()));
    } finally {
      _deleteSheetIfExists_BR_(ss, scratch);
    }
  }
});

registerTest({
  id      : 'INT_BDF4_WRITER_THRESHOLD_FILTERS_TABLE',
  group   : 'integration',
  module  : 'writers_v2/bess_recs',
  scenarios: [],
  tags    : ['integration', 'bess', 'recommendations', 'bdf4', 'threshold'],
  source  : 'tests_integration/writers_v2/WriteBessRecommendationsTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers_v2/bess_recs: BDF-4 threshold display filter');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchBessRecsName_();
    try {
      var fx = _fakeBessSuggestionResult_();
      // candidate[0] meets, candidate[1] fails per the fixture
      // Enable threshold > 0 - writer should filter candidate[1] out of display
      fx.threshold = { thresholdMxn: 2000000, provenance: 'INPUT_BESS' };
      fx.recommendation = fx.candidates[0];

      writeBessRecommendations(ss, fx, { sheetName: scratch });
      var sh = ss.getSheetByName(scratch);
      if (!sh) { t.assertTrue('sheet exists', false); return; }

      // Row 8 = the threshold-meeting HW_LUNA_2MWH (rank 1)
      t.assert('row 8 = HW_LUNA_2MWH (meets threshold)',
               'HW_LUNA_2MWH', sh.getRange(8, 2).getValue());
      t.assert('row 8 rank = 1', 1, Number(sh.getRange(8, 1).getValue()));

      // Row 9 should be EMPTY (the 500 kWh fails threshold and was filtered out)
      t.assert('row 9 col B is empty when threshold filters out other candidates',
               '', String(sh.getRange(9, 2).getValue() || ''));
    } finally {
      _deleteSheetIfExists_BR_(ss, scratch);
    }
  }
});

registerTest({
  id      : 'INT_BDF4_WRITER_THRESHOLD_OFF_SHOWS_ALL',
  group   : 'integration',
  module  : 'writers_v2/bess_recs',
  scenarios: [],
  tags    : ['integration', 'bess', 'recommendations', 'bdf4', 'threshold'],
  source  : 'tests_integration/writers_v2/WriteBessRecommendationsTests.gs',
  fn: function (t, ctx) {
    t.suite('INT writers_v2/bess_recs: BDF-4 threshold=0 shows all candidates');

    var ss = SpreadsheetApp.getActive();
    var scratch = _scratchBessRecsName_();
    try {
      // Default fixture has threshold=0 (DISABLED), 2 candidates
      writeBessRecommendations(ss, _fakeBessSuggestionResult_(), { sheetName: scratch });
      var sh = ss.getSheetByName(scratch);
      if (!sh) { t.assertTrue('sheet exists', false); return; }

      // Both candidates rendered (threshold off = no filter)
      // Order: by payback ascending. HW_LUNA_2MWH (8.95) < 500 kWh (null).
      t.assert('row 8 = HW_LUNA_2MWH',
               'HW_LUNA_2MWH', sh.getRange(8, 2).getValue());
      t.assert('row 9 = 500 kWh',
               '500 kWh', sh.getRange(9, 2).getValue());
    } finally {
      _deleteSheetIfExists_BR_(ss, scratch);
    }
  }
});
