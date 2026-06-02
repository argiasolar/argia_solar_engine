// =============================================================================
// ARGIA TESTS -- tests_integration/engine/ValidationOptimizerTopologyTests.gs
//
// Regression: runValidation must NOT raise the standard string-MPPT criticals
// STR-02 (strings > DC inputs) and DC-01 (Voc_cold > Vmax) for OPTIMIZER
// topology inverters.
//
// Bug (SolarEdge SE100KUS import, PROLOGIS mxc00107): the engine was BLOCKED by
// two criticals -- STR-02 (30 strings > 15 DC inputs) and DC-01 (Voc_cold
// 1826V > 1000V Vmax) -- even though:
//   * 04_CalcDC.js already skips DC-01/STR-01/STR-03 for OPTIMIZER topology, and
//   * runValidation itself emits INV-08 announcing "standard MPPT voltage/
//     current checks are skipped" for OPTIMIZER.
// The early pre-checks in 09_Validate.js (STR-02, DC-01, DC-02) simply lacked
// the topology guard, so they fired as false-positive blockers. Optimizers
// regulate string voltage and parallel multiple strings per DC input, so both
// checks are physically inapplicable to that architecture.
//
// Fix: STR-02 / DC-01 / DC-02 pre-checks now guard with topology !== 'OPTIMIZER'.
//
// This test locks BOTH directions:
//   * OPTIMIZER  -> STR-02 and DC-01 absent (engine no longer blocked)
//   * STRING     -> STR-02 and DC-01 still present (safety check intact)
//
// group=integration (runValidation reads live NOM via loadNomConstants), same
// classification and fixture shape as INT_ENGINE_VALIDATION_RULES.
// =============================================================================

registerTest({
  id      : 'INT_ENGINE_VALIDATION_OPTIMIZER_TOPOLOGY',
  group   : 'integration',
  module  : 'engine/validation_optimizer',
  scenarios: [],
  tags    : ['engine', 'validation', 'pre-flight', 'optimizer', 'topology',
             'solaredge', 'regression'],
  source  : 'tests_integration/engine/ValidationOptimizerTopologyTests.gs',
  fn: function (t, ctx) {
    t.suite('INT engine/validation: OPTIMIZER topology suppresses STR-02 / DC-01');

    var ss = ctx.ss;

    // Fixture shape mirrors INT_ENGINE_VALIDATION_RULES. Numbers chosen so the
    // standard checks WOULD fire on a STRING inverter:
    //   STR-02: stringsAssigned 30 > totalDcInputs 3 * qty 5 = 15
    //   DC-01:  Voc_cold = 56.31 * 32 = 1801.9V > maxDcV 1000V  (minTemp -1)
    function _baseInp() {
      var helio = [];
      for (var i = 0; i < 12; i++) helio.push({ grid: 1000 + i * 50 });
      return {
        projectName: 'TESTPROJ-OPT', clientName: 'TEST CUSTOMER',
        panelModel: 'JAM72D42-645/LB', panelQty: 960, modsPerString: 32,
        stringsTotal: 30, parallelStrings: 1,
        minTemp: -1, maxTemp: 38, avgTemp: 25,
        dcVdropLimit: 0.015, acVdropLimit: 0.020, powerFactor: 0.90,
        helio: helio, inverterBank: []
      };
    }
    function _basePanel() {
      return { 'PANEL_VOC_V': 52.36, 'PANEL_VMP_V': 44.21, 'PANEL_ISC_A': 14.27,
               'PANEL_TEMP_PMAX': -0.0029, 'PANEL_POWER_W': 585 };
    }
    function _invBank(topology) {
      return [{
        model: 'SE100KUS', qty: 5, stringsAssigned: 30, acKw: 100, voltage: 480,
        maxDcV: 1000, mpptVmin: 200, mpptVmax: 1000, totalDcInputs: 3,
        topology: topology, mdcReady: (topology === 'OPTIMIZER') ? 'REVIEW' : 'VALID'
      }];
    }

    var nom;
    try { nom = loadNomConstants(ss); }
    catch (e) { t.error('setup loadNomConstants', e); return; }

    function runWith(topology) {
      var inp = _baseInp(), panel = _basePanel(), invBank = _invBank(topology);
      inp.inverterBank = invBank;
      return runValidation(ss, inp, panel, invBank, nom);
    }
    function has(arr, code) { return arr.some(function (x) { return x.rule === code; }); }

    // --- OPTIMIZER: the two false-positive criticals must be GONE ------------
    var rOpt = runWith('OPTIMIZER');
    t.assertFalse('OPTIMIZER: STR-02 suppressed', has(rOpt.criticals, 'STR-02'));
    t.assertFalse('OPTIMIZER: DC-01 suppressed',  has(rOpt.criticals, 'DC-01'));
    // The skip is still surfaced to the user, and the DB REVIEW flag still warns.
    t.assertTrue('OPTIMIZER: INV-08 warning present', has(rOpt.warnings, 'INV-08'));
    t.assertTrue('OPTIMIZER: INV-09 major present',   has(rOpt.majors,   'INV-09'));

    // --- STRING control: identical numbers must STILL block -----------------
    var rStr = runWith('STRING');
    t.assertTrue('STRING: STR-02 still fires (safety intact)', has(rStr.criticals, 'STR-02'));
    t.assertTrue('STRING: DC-01 still fires (safety intact)',  has(rStr.criticals, 'DC-01'));
  }
});
