// =============================================================================
// ARGIA TESTS -- tests_regression/inputs/SeedMechanismTests.gs
// -----------------------------------------------------------------------------
// [A2c] Locks the seed/default split:
//   mapEntry.default = value readInput() returns for an EMPTY cell (reader path)
//   mapEntry.seed    = value setup writes into a fresh cell (suggested start)
//
// _seedValueFor(entry) (02e) returns seed -> default -> '' in that order.
// The single most important guarantee: readInput() must keep using `default`,
// never `seed`, so a "suggested starting value" can never leak into the engine's
// read path. The flagship case is bessMinAnnualSavingMxn (default 0 so a blank
// C37 reads as DISABLED, seed 2,000,000 for fresh sheets).
// =============================================================================

registerTest({
  id      : 'REG_INPUT_MAP_SEED_VS_DEFAULT',
  group   : 'regression',
  module  : 'inputs/map',
  scenarios: [],
  tags    : ['inputs', 'map', 'a2', 'seed'],
  source  : 'tests_regression/inputs/SeedMechanismTests.gs',
  fn: function (t, ctx) {
    t.suite('REG inputs/map [A2c]: seed vs default split');

    // ---- _seedValueFor precedence: seed -> default -> '' --------------------
    t.assert('seed present -> seed',          2000000, _seedValueFor({ default: 0, seed: 2000000 }));
    t.assert('no seed -> default',            0.9,     _seedValueFor({ default: 0.9 }));
    t.assert('seed 0 honored (hasOwnProperty)', 0,     _seedValueFor({ default: 5, seed: 0 }));
    t.assert('seed "" honored',               '',      _seedValueFor({ default: 'X', seed: '' }));
    t.assert('neither -> ""',                 '',      _seedValueFor({}));

    // ---- the split's whole point: readInput() uses default, NEVER seed ------
    var ssEmpty = {
      getSheetByName: function (n) {
        return (n === 'INPUT_BESS')
          ? { getRange: function () { return { getValue: function () { return ''; } }; } }
          : null;
      }
    };
    t.assert('readInput on empty C37 -> default 0 (NOT seed 2,000,000)',
      0, Number(readInput(ssEmpty, 'bessMinAnnualSavingMxn')));

    // ---- flagship field carries the split ----------------------------------
    t.assert('bessMinAnnualSavingMxn.default = 0',       0,       INPUT_MAP.bessMinAnnualSavingMxn.default);
    t.assert('bessMinAnnualSavingMxn.seed = 2,000,000',  2000000, INPUT_MAP.bessMinAnnualSavingMxn.seed);

    // ---- every dropdown seed must be a valid option ------------------------
    var dropdownSeeds = [
      ['bessStrategy',        'PEAK_SHAVING'],
      ['cfeInterconnMode',    'SIN_EXPORTACION'],
      ['bessLocation',        'EXTERIOR'],
      ['bessGroundingSystem', 'VARILLA'],
      ['bessCablePath',       'CONDUIT_ENTERRADO']
    ];
    dropdownSeeds.forEach(function (pair) {
      var m = INPUT_MAP[pair[0]];
      t.assertTrue(pair[0] + ' seed "' + pair[1] + '" is a valid dropdown option',
        !!(m && m.seed === pair[1] && m.dropdown && m.dropdown.indexOf(pair[1]) >= 0));
    });

    // ---- dropdown seeds must NOT change the reader fallback (default stays '')
    dropdownSeeds.forEach(function (pair) {
      t.assert(pair[0] + ' default still "" (reader fallback unchanged)',
        '', INPUT_MAP[pair[0]].default);
    });

    // ---- numeric BESS seeds present (voltages + §6) ------------------------
    t.assert('bessDcBusV seed 800', 800, INPUT_MAP.bessDcBusV.seed);
    t.assert('bessAcV seed 480',    480, INPUT_MAP.bessAcV.seed);
    t.assert('bessGecRunM seed 15', 15,  INPUT_MAP.bessGecRunM.seed);
    // and their reader defaults remain 0 (A2b parity intact)
    t.assert('bessDcBusV default still 0', 0, INPUT_MAP.bessDcBusV.default);
  }
});
