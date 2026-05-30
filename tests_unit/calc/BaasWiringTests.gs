// =============================================================================
// ARGIA TESTS -- tests_unit/calc/BaasWiringTests.gs
// -----------------------------------------------------------------------------
// CHUNK 6 -- BaaS Economics Engine: wiring tests (Option A, standalone)
//
// Locks the live wiring (30b_RunBaasProjection.js). The CRITICAL tests are
// the FIXED-CELL ANCHOR GUARDS: per the 2026-05-29 decision, BaaS reads CAPEX
// from fixed cells (BOM_v2!G92 + INSTALLATION_v2 row 22), and these tests
// assert the anchor cells still hold what we expect. If someone reorders the
// install template or BOM layout, these go RED and point at the drift --
// instead of the read silently grabbing the wrong section.
//
// Fixture values from ARGIA_ENGINE__44_.xlsx (CULLIGAN, engine v4.3.0):
//   BOM_v2!G92 (BESS materials)      = 29,177,477
//   INSTALLATION_v2!F22 (label)      = "BESS"
//   INSTALLATION_v2!G22 (labor)      =      2,111
//   INSTALLATION_v2!H22 (equip)      =    100,000
//   => BaaS CAPEX                    = 29,279,588
//   CFE_OUTPUT_v2 row19 (con PV)     = 11,279,234
//   CFE_OUTPUT_v2 row31 (con PV+BESS Yr1) = 10,471,312
//   L10 banner steady (Yr-2+)        =  7,721,664
//
// COVERAGE (7 tests):
//   1. UNIT_BAAS_WIRE_CAPEX_SUMS_MATERIALS_AND_INSTALL -- the headline rule
//   2. UNIT_BAAS_WIRE_INSTALL_ANCHOR_GUARD             -- F22 == "BESS" or warn
//   3. UNIT_BAAS_WIRE_CAPEX_MATCHES_CULLIGAN           -- to the peso
//   4. UNIT_BAAS_WIRE_SAVINGS_CON_PV_MINUS_CON_BESS    -- attribution
//   5. UNIT_BAAS_WIRE_SAVINGS_YR1_VS_STEADY_STEP       -- ratchet step surfaced
//   6. UNIT_BAAS_WIRE_BANNER_PARSERS                   -- $ parse + steady parse
//   7. UNIT_BAAS_WIRE_STANDALONE_NO_SOLAR_TAX          -- battery-only => no tax
// =============================================================================

// --- Mock CULLIGAN workbook ------------------------------------------------
function _baasWireMockSs(overrides) {
  overrides = overrides || {};
  var installLabel = overrides.installLabel != null ? overrides.installLabel : 'BESS';

  // CFE monthly rows: distribute the known annual sums across 12 months.
  function spread(annual) {
    var per = annual / 12, arr = {};
    for (var c = 3; c <= 14; c++) arr[c] = per;
    return arr;
  }
  var row19 = spread(overrides.conPv != null ? overrides.conPv : 11279234);
  var row31 = spread(overrides.conBessY1 != null ? overrides.conBessY1 : 10471312);

  function cellSheet(map) {
    return {
      getRange: function (a, b) {
        // getRange(row, col) numeric form
        if (typeof a === 'number') {
          var key = a + ',' + b;
          return { getValue: function () { return map[key] != null ? map[key] : ''; } };
        }
        // getRange('A1') string form
        return { getValue: function () { return map[a] != null ? map[a] : ''; } };
      }
    };
  }

  var bomMap = {};
  bomMap['92,7'] = overrides.materials != null ? overrides.materials : 29177477.3;

  var instMap = {};
  instMap['22,6'] = installLabel;
  instMap['22,7'] = overrides.labor != null ? overrides.labor : 2111;
  instMap['22,8'] = overrides.equip != null ? overrides.equip : 100000;

  var cfeMap = {};
  for (var c = 3; c <= 14; c++) { cfeMap['19,' + c] = row19[c]; cfeMap['31,' + c] = row31[c]; }
  cfeMap['G10'] = 'RECIBO ANUAL CON PV\n$11,279,234';
  cfeMap['L10'] = overrides.l10 != null ? overrides.l10
    : 'RECIBO ANUAL CON PV + BESS\nAño 1: $10,471,312\nAño 2+: $7,721,664';

  var sheets = {
    'BOM_v2':          overrides.noBom ? null : cellSheet(bomMap),
    'INSTALLATION_v2': overrides.noInstall ? null : cellSheet(instMap),
    'CFE_OUTPUT_v2':   cellSheet(cfeMap)
  };
  // Minimal stub sheet for setupInputBaasSheet / writeBaasProjectionV2 to
  // write into headlessly (chainable no-op range).
  function stubRange() {
    var r = {};
    ['merge','breakApart','clear','setValue','setValues','setFontWeight',
     'setFontFamily','setFontSize','setFontStyle','setFontColor','setBackground',
     'setBorder','setNumberFormat','setNote','setWrap','setVerticalAlignment',
     'setHorizontalAlignment'].forEach(function (m) { r[m] = function () { return r; }; });
    r.getValue = function () { return ''; };
    r.getValues = function () { return [[]]; };
    return r;
  }
  function stubSheet(name) {
    return {
      getName: function () { return name; },
      clear: function () {},
      clearNotes: function () {},
      clearConditionalFormatRules: function () {},
      getRange: function () { return stubRange(); },
      // getLastRow = 1 so loadDesignTokens short-circuits without scanning.
      getLastRow: function () { return 1; },
      setRowHeight: function () {}, setColumnWidth: function () {},
      setFrozenRows: function () {}, setHiddenGridlines: function () {},
      getImages: function () { return []; },
      insertSheet: function () {}
    };
  }
  // Seeded _DESIGN_TOKENS stub so token()/tokenNum() resolve (the engine's
  // token() fails loud on a missing key -- an empty stub is not enough).
  var TOKEN_ROWS = [
    ['TEXT_PRIMARY','#111111'],['TEXT_SECONDARY','#767676'],['TEXT_MUTED','#B0B0B0'],
    ['BG_PAGE','#FAFAF7'],['BG_INPUT_CELL','#FDFBF6'],['BG_SUBTOTAL','#F5F3EE'],
    ['BG_CALLOUT','#FFF8E1'],['STATUS_WARN','#B88728'],['STATUS_FAIL','#B8404C'],
    ['DIVIDER_STRONG','#111111'],['FONT_FAMILY','Inter'],['FONT_SIZE_TITLE','22'],
    ['FONT_SIZE_BODY','10'],['FONT_SIZE_SMALL','8'],['FONT_WEIGHT_EMPHASIS','bold'],
    ['ROW_H_TITLE','42']
  ];
  function designTokensStub() {
    return {
      getName: function () { return '_DESIGN_TOKENS'; },
      getLastRow: function () { return TOKEN_ROWS.length + 1; },
      getRange: function (row, col, numRows, numCols) {
        return {
          getValue: function () { return ''; },
          getValues: function () {
            if (row === 2 && col === 1 && numCols === 2) return TOKEN_ROWS.slice(0, numRows);
            return [[]];
          },
          setValue: function () { return this; }, setValues: function () { return this; },
          setFontWeight: function () { return this; }, setBackground: function () { return this; }
        };
      },
      setColumnWidth: function () {}, setFrozenRows: function () {}, insertSheet: function () {}
    };
  }
  return {
    getSheetByName: function (n) {
      if (n === '_DESIGN_TOKENS') return designTokensStub();
      if (sheets[n] !== undefined) return sheets[n];
      return null;   // INPUT_BAAS, BAAS_PROJECTION_v2 absent -> created via insertSheet
    },
    insertSheet: function (n) {
      if (n === '_DESIGN_TOKENS') return designTokensStub();
      return stubSheet(n);
    }
  };
}


registerTest({
  id      : 'UNIT_BAAS_WIRE_CAPEX_SUMS_MATERIALS_AND_INSTALL',
  group   : 'unit',
  module  : 'calc/baas-wiring',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6', 'wiring'],
  source  : 'tests_unit/calc/BaasWiringTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT baas-wiring: CAPEX = BESS materials + BESS installation');

    var ss = _baasWireMockSs({ materials: 1000000, labor: 30000, equip: 70000 });
    var capex = _baasReadCapexMxn(ss);
    t.assert('materials read', 1000000, capex.materialsMxn);
    t.assert('install = labor + equip', 100000, capex.installMxn);
    t.assert('total = materials + install', 1100000, capex.totalMxn);
    t.assertTrue('ok flag true', capex.ok === true);
  }
});


registerTest({
  id      : 'UNIT_BAAS_WIRE_INSTALL_ANCHOR_GUARD',
  group   : 'unit',
  module  : 'calc/baas-wiring',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6', 'wiring', 'anchor'],
  source  : 'tests_unit/calc/BaasWiringTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT baas-wiring: INSTALLATION_v2!F22 anchor MUST be "BESS"');

    // Happy path: label is "BESS" -> install added, no warning.
    var ok = _baasReadCapexMxn(_baasWireMockSs({ installLabel: 'BESS' }));
    t.assert('install added when anchor correct', 102111, ok.installMxn);
    t.assertTrue('no anchor warning', ok.warnings.join(' ').indexOf('expected "BESS"') < 0);

    // Drift path: someone reordered sections, F22 now says something else.
    // The guard must REFUSE to add the install cost and warn loudly.
    var drift = _baasReadCapexMxn(_baasWireMockSs({ installLabel: 'INDIRECT' }));
    t.assert('install NOT added on anchor drift', 0, drift.installMxn);
    t.assertTrue('anchor drift warns', drift.warnings.join(' ').indexOf('expected "BESS"') >= 0);
    t.assertTrue('warning names the cell', drift.warnings.join(' ').indexOf('F22') >= 0);
  }
});


registerTest({
  id      : 'UNIT_BAAS_WIRE_CAPEX_MATCHES_CULLIGAN',
  group   : 'unit',
  module  : 'calc/baas-wiring',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6', 'wiring'],
  source  : 'tests_unit/calc/BaasWiringTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT baas-wiring: CULLIGAN BaaS CAPEX = 29,279,588 to the peso');

    var capex = _baasReadCapexMxn(_baasWireMockSs());   // real CULLIGAN values
    t.assertNear('materials = 29,177,477', 29177477.3, capex.materialsMxn, 1);
    t.assertNear('install = 102,111',          102111, capex.installMxn, 1);
    t.assertNear('BaaS CAPEX = 29,279,588',  29279588, capex.totalMxn, 1);
  }
});


registerTest({
  id      : 'UNIT_BAAS_WIRE_SAVINGS_CON_PV_MINUS_CON_BESS',
  group   : 'unit',
  module  : 'calc/baas-wiring',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6', 'wiring'],
  source  : 'tests_unit/calc/BaasWiringTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT baas-wiring: BESS savings = con-PV - con-PV+BESS');

    var sav = _baasReadBessSavings(_baasWireMockSs());
    // Yr-1: 11,279,234 - 10,471,312 = 807,922  (matches CFE row 30 sum)
    t.assertNear('con PV annual = 11,279,234', 11279234, sav.conPvMxn, 2);
    t.assertNear('Yr-1 BESS saving = 807,922',   807922, sav.year1Mxn, 2);
    // Yr-2+ steady: 11,279,234 - 7,721,664 = 3,557,570
    t.assertNear('Yr-2+ BESS saving = 3,557,570', 3557570, sav.steadyMxn, 2);
    t.assertTrue('ok flag true', sav.ok === true);
  }
});


registerTest({
  id      : 'UNIT_BAAS_WIRE_SAVINGS_YR1_VS_STEADY_STEP',
  group   : 'unit',
  module  : 'calc/baas-wiring',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6', 'wiring'],
  source  : 'tests_unit/calc/BaasWiringTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT baas-wiring: Yr-1 vs Yr-2+ ratchet step is detected');

    var sav = _baasReadBessSavings(_baasWireMockSs());
    // The step is real (ratchet floor): Yr-2+ saving > Yr-1 saving here.
    t.assertTrue('steady saving differs from Yr-1 (ratchet step exists)',
                 Math.abs(sav.steadyMxn - sav.year1Mxn) > 1);
    t.assertTrue('steady > Yr-1 for CULLIGAN', sav.steadyMxn > sav.year1Mxn);
  }
});


registerTest({
  id      : 'UNIT_BAAS_WIRE_BANNER_PARSERS',
  group   : 'unit',
  module  : 'calc/baas-wiring',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6', 'wiring'],
  source  : 'tests_unit/calc/BaasWiringTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT baas-wiring: banner parsers (first $ and steady $)');

    t.assertNear('parse first $ from G10', 11279234,
                 _baasParseBanner('RECIBO ANUAL CON PV\n$11,279,234'), 1);
    t.assertNear('parse steady (last) $ from L10', 7721664,
                 _baasParseBannerSteady(
                   'RECIBO ANUAL CON PV + BESS\nAño 1: $10,471,312\nAño 2+: $7,721,664'), 1);
    t.assert('steady parser returns 0 when only one figure', 0,
             _baasParseBannerSteady('Single: $5,000,000'));
  }
});


registerTest({
  id      : 'UNIT_BAAS_WIRE_STANDALONE_NO_SOLAR_TAX',
  group   : 'unit',
  module  : 'calc/baas-wiring',
  scenarios: [],
  tags    : ['calc', 'baas', 'chunk6', 'wiring', 'tax'],
  source  : 'tests_unit/calc/BaasWiringTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT baas-wiring: standalone battery lease has no solar tax benefit');

    // runBaasProjection sets solarCapexMxn = 0 for the standalone battery
    // model, so even a FINANCIERO lease shows no tax benefit (tax is for the
    // SOLAR installation, which the battery lease does not include).
    var ss = _baasWireMockSs();
    // Stub the input + writer so runBaasProjection can execute headless.
    var ret = runBaasProjection(ss);
    t.assertTrue('result produced', !!ret.result);
    t.assertTrue('tax does NOT apply (no solar capex in standalone BaaS)',
                 ret.result.taxApplies === false);
    t.assertTrue('CAPEX flowed through (materials + install)',
                 ret.capex.totalMxn > 29000000);
  }
});
