// =============================================================================
// ARGIA TESTS -- tests_unit/engine/InstallCostSanityTests.gs
// -----------------------------------------------------------------------------
// CHUNK 3 (v3.7.8) — Unit tests for checkInstallCostSanity.
//
// CONTEXT
//   09c_InstallCostSanity.js is the post-engine sanity check that warns
//   when computed install cost drifts outside industry-typical ranges.
//   Bounds come from NOM_DB defaults; advisory only — never blocks.
//
// SCOPE
//   Pure-function tests over checkInstallCostSanity({nom,installResult,inp,bessResult}).
//   No spreadsheet needed; we construct synthetic engine result objects
//   shaped like what runInstallCost / runBessStep produce.
//
// COVERAGE
//   1. In-range happy path → no warnings, all checks OK
//   2. PV install MXN/Wp below floor → LOW warning fires
//   3. PV install MXN/Wp above ceiling → HIGH warning fires
//   4. BESS BoP USD/kWh below floor → LOW warning fires (when BESS enabled)
//   5. BESS BoP USD/kWh above ceiling → HIGH warning fires
//   6. Blended labor MXN/MH below floor → LOW warning fires
//   7. PV-only project → bessPerKwh.status = 'N/A', no BESS warning
//   8. Missing installResult → passed=true, all 'N/A', graceful
//   9. CULLIGAN reproduction: 0.86 MXN/Wp + $5.30/kWh BESS → both LOW fire
// =============================================================================


// ---------------------------------------------------------------------------
// Synthetic engine results matching the shape that runInstallCost returns.
// We only populate fields checkInstallCostSanity reads.
// ---------------------------------------------------------------------------

function _icsNom() {
  // Matches buildNomLimitsDefaults() 3.7.8 install_* keys.
  return {
    limits: {
      'install_pv_mxn_per_wp_warn_min':    1.0,
      'install_pv_mxn_per_wp_warn_max':    5.0,
      'install_bess_usd_per_kwh_warn_min': 30,
      'install_bess_usd_per_kwh_warn_max': 200,
      'install_blended_labor_rate_warn_min': 80,
      'install_blended_labor_rate_warn_max': 400
    }
  };
}

// projectDcWp is derived inside checkInstallCostSanity from inp.panel.PANEL_POWER_W
// × inp.panelQty (with fallback to totals.total/totals.perWp). The inp/panel
// objects here are deliberately minimal — only the two fields needed.
function _icsInp(panelQty, panelW) {
  return { panelQty: panelQty, panel: { PANEL_POWER_W: panelW } };
}

// Build a synthetic installResult with given headline numbers.
//   totalMxn      : install grand total (MXN)
//   bessSectionMxn: BESS subsection total (MXN); 0 for PV-only
//   avgRateMxnMH  : blended labor rate
function _icsInstallResult(totalMxn, bessSectionMxn, avgRateMxnMH, projectDcWp) {
  return {
    totals: {
      total:          totalMxn,
      perWp:          (projectDcWp > 0) ? (totalMxn / projectDcWp) : 0,
      avgRateMxnMH:   avgRateMxnMH
    },
    sectionTotals: {
      AC:               { labor:0, equip:0, other:0, total: 0 },
      DC:               { labor:0, equip:0, other:0, total: 0 },
      'RACKING SYSTEM': { labor:0, equip:0, other:0, total: 0 },
      CONNECTION:       { labor:0, equip:0, other:0, total: 0 },
      SAFETY:           { labor:0, equip:0, other:0, total: 0 },
      'GENERAL SITE':   { labor:0, equip:0, other:0, total: 0 },
      EQUIPMENT:        { labor:0, equip:0, other:0, total: 0 },
      BESS:             { labor:0, equip:0, other:0, total: bessSectionMxn },
      INDIRECT:         { labor:0, equip:0, other:0, total: 0 }
    }
  };
}

function _icsBessEnabled(capacityKwh) {
  return { bessEnabled: true, bess: { capacityKwh: capacityKwh } };
}


// ---------------------------------------------------------------------------
// CASE 1: In-range happy path
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_INSTALL_SANITY_IN_RANGE_NO_WARNINGS',
  group   : 'unit',
  module  : 'engine/install_sanity',
  scenarios: [],
  tags    : ['engine', 'install_sanity', 'happy_path', 'chunk3'],
  source  : 'tests_unit/engine/InstallCostSanityTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/install_sanity: in-range project, all OK');

    // 864 kWp project at 2.0 MXN/Wp = 1,728,000 MXN total.
    // BESS 2169 kWh at 100 USD/kWh × 18.5 = 4,013,650 MXN for BESS section.
    // Total install = 1.728M PV + 4.014M BESS = 5.742M MXN.
    // perWp = 5.742M / 864,000 = 6.6 MXN/Wp (but we exclude BESS from the
    // PV/Wp check, so the actual figure used is 1.728M / 864,000 = 2.0 MXN/Wp).
    var totalMxn = 1728000 + 4013650;
    var result = checkInstallCostSanity({
      nom:           _icsNom(),
      installResult: _icsInstallResult(totalMxn, 4013650, 150, 864000),
      inp:           _icsInp(1350, 640),
      bessResult:    _icsBessEnabled(2169),
      exchangeRate:  18.5
    });

    t.assertTrue('passed=true',         result.passed);
    t.assert('zero warnings',           0, result.warnings.length);
    t.assert('PV check OK',             'OK', result.checks.pvPerWp.status);
    t.assert('BESS check OK',           'OK', result.checks.bessPerKwh.status);
    t.assert('Labor check OK',          'OK', result.checks.laborRate.status);
    // Sanity: actual PV MXN/Wp must round to 2.00
    t.assertNear('pvPerWp ~ 2.00',      2.0, result.checks.pvPerWp.value, 0.01);
  }
});


// ---------------------------------------------------------------------------
// CASE 2: PV install MXN/Wp below floor (the CULLIGAN bug class)
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_INSTALL_SANITY_PV_TOO_LOW',
  group   : 'unit',
  module  : 'engine/install_sanity',
  scenarios: [],
  tags    : ['engine', 'install_sanity', 'warning', 'chunk3'],
  source  : 'tests_unit/engine/InstallCostSanityTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/install_sanity: PV/Wp below floor → LOW warning');

    // 864 kWp at 0.50 MXN/Wp (well below 1.0 floor) = 432,000 MXN PV install,
    // no BESS. perWp = 0.50.
    var result = checkInstallCostSanity({
      nom:           _icsNom(),
      installResult: _icsInstallResult(432000, 0, 150, 864000),
      inp:           _icsInp(1350, 640),
      bessResult:    null,
      exchangeRate:  18.5
    });

    t.assertFalse('passed=false',                         result.passed);
    t.assertTrue('at least one warning',                  result.warnings.length >= 1);
    t.assert('PV check is LOW',                           'LOW', result.checks.pvPerWp.status);
    t.assertContains('warning mentions PV install',       result.warnings.join(' | '), 'PV install');
    t.assertContains('warning mentions below expected',   result.warnings.join(' | '), 'below expected');
  }
});


// ---------------------------------------------------------------------------
// CASE 3: PV install MXN/Wp above ceiling
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_INSTALL_SANITY_PV_TOO_HIGH',
  group   : 'unit',
  module  : 'engine/install_sanity',
  scenarios: [],
  tags    : ['engine', 'install_sanity', 'warning', 'chunk3'],
  source  : 'tests_unit/engine/InstallCostSanityTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/install_sanity: PV/Wp above ceiling → HIGH warning');

    // 864 kWp at 8.0 MXN/Wp (well above 5.0 ceiling) = 6,912,000 MXN.
    var result = checkInstallCostSanity({
      nom:           _icsNom(),
      installResult: _icsInstallResult(6912000, 0, 150, 864000),
      inp:           _icsInp(1350, 640),
      bessResult:    null
    });

    t.assertFalse('passed=false',                         result.passed);
    t.assert('PV check is HIGH',                          'HIGH', result.checks.pvPerWp.status);
    t.assertContains('warning mentions above expected',   result.warnings.join(' | '), 'above expected');
  }
});


// ---------------------------------------------------------------------------
// CASE 4: BESS BoP USD/kWh below floor (the CULLIGAN BESS bug class)
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_INSTALL_SANITY_BESS_BOP_TOO_LOW',
  group   : 'unit',
  module  : 'engine/install_sanity',
  scenarios: [],
  tags    : ['engine', 'install_sanity', 'warning', 'bess', 'chunk3'],
  source  : 'tests_unit/engine/InstallCostSanityTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/install_sanity: BESS BoP USD/kWh below floor → LOW warning');

    // 2169 kWh BESS at $5.30/kWh BoP (CULLIGAN actuals) = $11,496 USD = 212,676 MXN.
    // PV install kept in-range so only the BESS check fires.
    var totalMxn = 1728000 + 212676; // PV in-range + low BESS
    var result = checkInstallCostSanity({
      nom:           _icsNom(),
      installResult: _icsInstallResult(totalMxn, 212676, 150, 864000),
      inp:           _icsInp(1350, 640),
      bessResult:    _icsBessEnabled(2169),
      exchangeRate:  18.5
    });

    t.assertFalse('passed=false',                              result.passed);
    t.assert('BESS check is LOW',                              'LOW', result.checks.bessPerKwh.status);
    t.assertNear('bessPerKwh ~ 5.30 USD/kWh',                  5.30, result.checks.bessPerKwh.value, 0.1);
    t.assertContains('warning mentions BESS BoP',              result.warnings.join(' | '), 'BESS BoP');
    t.assertContains('warning mentions 30-200 USD/kWh range',  result.warnings.join(' | '), '30-200');
  }
});


// ---------------------------------------------------------------------------
// CASE 5: BESS BoP USD/kWh above ceiling
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_INSTALL_SANITY_BESS_BOP_TOO_HIGH',
  group   : 'unit',
  module  : 'engine/install_sanity',
  scenarios: [],
  tags    : ['engine', 'install_sanity', 'warning', 'bess', 'chunk3'],
  source  : 'tests_unit/engine/InstallCostSanityTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/install_sanity: BESS BoP USD/kWh above ceiling → HIGH warning');

    // 2169 kWh BESS at $300/kWh BoP = $650,700 USD = 12,037,950 MXN BESS section.
    var totalMxn = 1728000 + 12037950;
    var result = checkInstallCostSanity({
      nom:           _icsNom(),
      installResult: _icsInstallResult(totalMxn, 12037950, 150, 864000),
      inp:           _icsInp(1350, 640),
      bessResult:    _icsBessEnabled(2169),
      exchangeRate:  18.5
    });

    t.assertFalse('passed=false',         result.passed);
    t.assert('BESS check is HIGH',        'HIGH', result.checks.bessPerKwh.status);
  }
});


// ---------------------------------------------------------------------------
// CASE 6: Blended labor MXN/MH below floor
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_INSTALL_SANITY_LABOR_TOO_LOW',
  group   : 'unit',
  module  : 'engine/install_sanity',
  scenarios: [],
  tags    : ['engine', 'install_sanity', 'warning', 'labor', 'chunk3'],
  source  : 'tests_unit/engine/InstallCostSanityTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/install_sanity: blended labor below floor → LOW warning');

    // PV cost in-range, BESS in-range, but blended labor = 50 MXN/MH (below 80 floor).
    var result = checkInstallCostSanity({
      nom:           _icsNom(),
      installResult: _icsInstallResult(1728000, 0, 50, 864000),
      inp:           _icsInp(1350, 640),
      bessResult:    null
    });

    t.assertFalse('passed=false',                  result.passed);
    t.assert('Labor check is LOW',                 'LOW', result.checks.laborRate.status);
    t.assertContains('warning mentions labor rate', result.warnings.join(' | '), 'labor rate');
  }
});


// ---------------------------------------------------------------------------
// CASE 7: PV-only project — BESS check is N/A, not LOW
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_INSTALL_SANITY_PV_ONLY_NO_BESS_CHECK',
  group   : 'unit',
  module  : 'engine/install_sanity',
  scenarios: [],
  tags    : ['engine', 'install_sanity', 'pv_only', 'chunk3'],
  source  : 'tests_unit/engine/InstallCostSanityTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/install_sanity: PV-only project skips BESS check');

    var result = checkInstallCostSanity({
      nom:           _icsNom(),
      installResult: _icsInstallResult(1728000, 0, 150, 864000),
      inp:           _icsInp(1350, 640),
      bessResult:    null    // PV-only
    });

    t.assertTrue('passed=true',           result.passed);
    t.assert('PV check ran (OK)',         'OK',  result.checks.pvPerWp.status);
    t.assert('BESS check did not run',    'N/A', result.checks.bessPerKwh.status);
    t.assert('Labor check ran (OK)',      'OK',  result.checks.laborRate.status);
    t.assertTrue('bessPerKwh value null', result.checks.bessPerKwh.value === null);
  }
});


// ---------------------------------------------------------------------------
// CASE 8: No install result → graceful return, no crash
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_INSTALL_SANITY_NO_INSTALL_RESULT_GRACEFUL',
  group   : 'unit',
  module  : 'engine/install_sanity',
  scenarios: [],
  tags    : ['engine', 'install_sanity', 'graceful', 'chunk3'],
  source  : 'tests_unit/engine/InstallCostSanityTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/install_sanity: missing installResult returns N/A gracefully');

    var result = checkInstallCostSanity({
      nom:           _icsNom(),
      installResult: null,
      inp:           _icsInp(1350, 640),
      bessResult:    null
    });

    t.assertTrue('passed=true',            result.passed);
    t.assert('zero warnings',              0, result.warnings.length);
    t.assert('PV check is N/A',            'N/A', result.checks.pvPerWp.status);
    t.assert('BESS check is N/A',          'N/A', result.checks.bessPerKwh.status);
    t.assert('Labor check is N/A',         'N/A', result.checks.laborRate.status);
  }
});


// ---------------------------------------------------------------------------
// CASE 9: CULLIGAN reproduction — both PV and BESS guardrails fire (the
// real-world failure mode that motivated this whole chunk)
// ---------------------------------------------------------------------------

registerTest({
  id      : 'UNIT_INSTALL_SANITY_CULLIGAN_REPRODUCES_BOTH_LOW',
  group   : 'unit',
  module  : 'engine/install_sanity',
  scenarios: [],
  tags    : ['engine', 'install_sanity', 'regression', 'culligan', 'chunk3'],
  source  : 'tests_unit/engine/InstallCostSanityTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT engine/install_sanity: CULLIGAN reproduction fires PV LOW + BESS LOW');

    // CULLIGAN actuals (verified from ARGIA_ENGINE__42_.xlsx):
    //   Grand total install         = 743,006 MXN
    //   BESS section                = 212,511 MXN
    //   PV-only install             = 743,006 - 212,511 = 530,495 MXN
    //   864,000 Wp -> 0.61 MXN/Wp PV (FLOOR=1.0, so LOW)
    //   BESS BoP: 212,511 / 18.5 / 2169 = 5.30 USD/kWh (FLOOR=30, so LOW)
    //   Blended labor 114 MXN/MH (in 80-400 range, so OK)
    var result = checkInstallCostSanity({
      nom:           _icsNom(),
      installResult: _icsInstallResult(743006, 212511, 114, 864000),
      inp:           _icsInp(1350, 640),
      bessResult:    _icsBessEnabled(2169),
      exchangeRate:  18.5
    });

    t.assertFalse('passed=false',                       result.passed);
    t.assert('PV is LOW',                               'LOW', result.checks.pvPerWp.status);
    t.assert('BESS is LOW',                             'LOW', result.checks.bessPerKwh.status);
    t.assert('Labor is OK',                             'OK',  result.checks.laborRate.status);
    t.assertTrue('two warnings minimum',                result.warnings.length >= 2);
    // Numeric sanity on the computed values
    t.assertNear('PV ~ 0.61 MXN/Wp',                    0.614, result.checks.pvPerWp.value, 0.01);
    t.assertNear('BESS ~ 5.30 USD/kWh',                 5.30,  result.checks.bessPerKwh.value, 0.1);
    t.assert('Labor = 114 MXN/MH',                      114,   result.checks.laborRate.value);
  }
});
