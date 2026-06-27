// =============================================================================
// ARGIA TESTS -- tests_regression/InverterTopologyOverrideTests.gs
// -----------------------------------------------------------------------------
// Per-project optimizer-topology override (resolveInverterTopology, 02_LoadDB).
//
// WHY THIS FILE EXISTS
//   INV_TOPOLOGY is a per-MODEL catalog property, but whether a given project
//   runs that inverter string-only or with optimizers is a per-PROJECT decision
//   (e.g. VITALMEX deploys a Huawei SUN5000 -- catalogued STRING -- WITH Huawei
//   MERC optimizers). resolveInverterTopology() lets INPUT_DESIGN C71
//   (optimizerTopologyMode) override the catalog value when the bank is built,
//   and that single resolved value cascades to the CalcDC NOM-check skips, the
//   aggregate dc.hasOptimizerTopology flag, the BOM optimizer selection, and the
//   RSD suppression.
//
//   CARDINAL RULE: mode AUTO (the default) returns the catalog value byte-for-
//   byte. These asserts fail loudly if a future edit makes AUTO drift, or makes
//   ON/OFF stop forcing the topology -- either of which would silently change a
//   customer-facing BOM (optimizer presence + skipped electrical checks).
//
// CLASSIFICATION
//   group=regression. Targets a pure helper (no spreadsheet access), so it runs
//   in the Node rig and from the ARGIA menu identically.
//
// DEPENDENCIES
//   - resolveInverterTopology (02_LoadDB.gs)
// =============================================================================

registerTest({
  id      : 'UNIT_TOPOLOGY_OVERRIDE_RESOLVE',
  group   : 'regression',
  module  : 'loaddb/topology',
  scenarios: [],
  tags    : ['regression', 'optimizer', 'topology', 'loaddb'],
  source  : 'tests_regression/InverterTopologyOverrideTests.gs',
  fn      : function (t) {
    t.suite('REGRESSION loaddb: per-project optimizer topology override');

    // AUTO / blank / unrecognized -> catalog value passes through unchanged.
    t.assert('AUTO keeps STRING',          'STRING',    resolveInverterTopology('STRING', 'AUTO'));
    t.assert('AUTO keeps OPTIMIZER',       'OPTIMIZER', resolveInverterTopology('OPTIMIZER', 'AUTO'));
    t.assert('blank keeps catalog',        'STRING',    resolveInverterTopology('STRING', ''));
    t.assert('unknown mode keeps catalog', 'OPTIMIZER', resolveInverterTopology('OPTIMIZER', 'MAYBE'));
    t.assert('missing mode keeps catalog', 'STRING',    resolveInverterTopology('STRING', undefined));

    // ON -> force OPTIMIZER even on a string-catalogued inverter (VITALMEX).
    t.assert('ON forces OPTIMIZER from STRING', 'OPTIMIZER', resolveInverterTopology('STRING', 'ON'));
    t.assert('ON stays OPTIMIZER',              'OPTIMIZER', resolveInverterTopology('OPTIMIZER', 'ON'));

    // OFF -> force STRING even on an OPTIMIZER-catalogued inverter.
    t.assert('OFF forces STRING from OPTIMIZER', 'STRING', resolveInverterTopology('OPTIMIZER', 'OFF'));
    t.assert('OFF stays STRING',                 'STRING', resolveInverterTopology('STRING', 'OFF'));

    // Case-insensitive + trims (operator may type lowercase / pad spaces).
    t.assert('lowercase on -> OPTIMIZER', 'OPTIMIZER', resolveInverterTopology('STRING', 'on'));
    t.assert('padded Off  -> STRING',     'STRING',    resolveInverterTopology('OPTIMIZER', '  Off  '));
    t.assert('catalog lowercased AUTO',   'OPTIMIZER', resolveInverterTopology('optimizer', 'AUTO'));

    // Catalog missing -> defaults to STRING under AUTO (never undefined).
    t.assert('null catalog AUTO -> STRING', 'STRING', resolveInverterTopology(null, 'AUTO'));
  }
});
