// =============================================================================
// ARGIA TESTS -- tests_integration/engine/ValidationRulesTests.gs
// -----------------------------------------------------------------------------
// PASS 20 MIGRATION: runValidation pre-flight rule firings.
//
// SOURCE: testValidationRules in 99_TestRunner.gs (lines 1284-1496).
//         Migrated 2026-05-21 as part of Pass 20.
//
//         FIFTH ORPHAN RESURRECTION of the session. testValidationRules
//         was DEFINED in 99_TestRunner.gs but NEVER CALLED -- grep
//         confirms only the function definition matches "testValidation
//         Rules" anywhere in the codebase. Pre-write analysis missed
//         this orphan classification; cross-check against a parallel
//         draft surfaced it. Running orphan-resurrection total:
//
//           Phase 1.2 FP threshold (Pass 4)                -- 18 asserts
//           testResolveStructure (Pass 10)                 -- 17 asserts
//           testBomLineItems (Pass 18 / Layer 2b)          -- 10 asserts
//           testInstallCostLineItems (Pass 19 / Layer 3b)  --  6 asserts
//           testValidationRules (Pass 20, THIS)            -- 26 asserts
//           =================================================================
//           TOTAL                                          -- 77 asserts
//
// COVERAGE
//   Single registered test with 26 inline sub-tests (one per rule code).
//   Each sub-test calls runValidation with a synthetic fixture mutated
//   to trigger one specific validation rule, then asserts that rule code
//   is present in the result's criticals/majors/warnings array.
//
//   Rule codes verified by group:
//     INPUT COMPLETENESS (8): INP-01, INP-02, INP-03, INP-04, INP-05,
//                             INP-06, INP-07, INP-08
//     PANEL DATA       (5):   PNL-01, PNL-02, PNL-03, PNL-04, PNL-05
//     INVERTER DATA    (6):   INV-01, INV-02, INV-03, INV-06, STR-02, INV-08
//     VOLTAGE PRE-CHECK (1):  DC-01
//     DC/AC RATIO      (1):   DC-10
//     STRING COUNT     (1):   STR-00
//     HELIOSCOPE       (1):   HEL-01
//     DESIGN LIMITS    (3):   LIM-01, LIM-02, LIM-03
//
// CLASSIFICATION
//   group=integration. NOT pure unit because runValidation depends on
//   live NOM constants loaded from NOM_DB via loadNomConstants(ss).
//   NOM hard caps (e.g. dcVdropHard) determine when LIM-01/LIM-02 fire.
//   Using live NOM means tests stay aligned with NOM_DB instead of
//   hardcoding numbers that drift.
//
// SAFETY MODEL
//   No writes. No try/finally needed. runValidation is pure on synthetic
//   inputs; the only sheet interaction is loadNomConstants (read-only).
//
// DEPENDENCIES
//   Engine: runValidation (09_Validate.gs), loadNomConstants (02_LoadDB.gs)
//   Sheets: NOM_DB (read by loadNomConstants)
//
// PATTERN -- the check() helper
//   Local helper inside fn:. Each call:
//     1. Builds fresh _baseInp/_basePanel/_baseInvBank fixtures
//     2. Applies one mutation (e.g. set inp.projectName = '')
//     3. Runs runValidation
//     4. Asserts that EACH expected rule code is present in the result
//
//   The check helper only asserts PRESENCE of expected codes, not
//   ABSENCE of unexpected ones. False positives possible but they would
//   surface in cross-tests; legacy convention preserved.
//
// CO-EXISTENCE
//   Legacy testValidationRules in 99_TestRunner.gs unchanged. Both run
//   the same 26 asserts until the legacy deletion pass.
// =============================================================================


registerTest({
  id      : 'INT_ENGINE_VALIDATION_RULES',
  group   : 'integration',
  module  : 'engine/validation_rules',
  scenarios: [],
  tags    : ['engine', 'validation', 'pre-flight', 'rule-codes',
             'synthetic-fixtures'],
  source  : 'tests_integration/engine/ValidationRulesTests.gs',
  fn: function (t, ctx) {
    t.suite('INT engine/validation_rules: runValidation rule firings');

    var ss = ctx.ss;

    // ----- Baseline fixtures --------------------------------------------
    // Mirror TESTPROJ-001 enough that runValidation runs cleanly. Shaped
    // for the validator's needs (helio array, inverterBank, etc.) rather
    // than the calc functions'.
    function _baseInp() {
      var helio = [];
      for (var i = 0; i < 12; i++) helio.push({ grid: 1000 + i * 50 });
      return {
        projectName:    'TESTPROJ-001',
        clientName:     'TEST CUSTOMER',
        panelModel:     'LR5-72HTH 585M',
        panelQty:       720,
        modsPerString:  18,
        stringsTotal:   40,
        parallelStrings: 1,
        minTemp: -1, maxTemp: 38, avgTemp: 25,
        dcVdropLimit:   0.015,
        acVdropLimit:   0.020,
        powerFactor:    0.90,
        helio:          helio,
        inverterBank:   []     // filled in by run-time mutator from invBank
      };
    }

    function _basePanel() {
      return {
        'PANEL_VOC_V':     52.36,
        'PANEL_VMP_V':     44.21,
        'PANEL_ISC_A':     14.27,
        'PANEL_TEMP_PMAX': -0.0029,
        'PANEL_POWER_W':   585
      };
    }

    function _baseInvBank() {
      return [{
        model:    'SUN2000-100KTL-M2',
        qty:      4,
        stringsAssigned: 40,
        acKw:     100,
        voltage:  480,
        maxDcV:   1100,
        mpptVmin: 200,
        mpptVmax: 1000,
        totalDcInputs: 20,
        topology: 'STRING',
        mdcReady: 'VALID'
      }];
    }

    // ----- Real NOM constants from the active workbook ------------------
    // Hard limits like dcVdropHard come from here. Using live NOM means
    // tests stay aligned with whatever NOM_DB says, instead of hardcoding
    // numbers that drift.
    var nom;
    try { nom = loadNomConstants(ss); }
    catch (e) { t.error('setup', e); return; }

    // ----- check() helper -----------------------------------------------
    // Runs validation with one mutation applied to fresh fixtures, then
    // asserts each expected rule code is present in the result.
    function check(label, mutator, expect) {
      var inp     = _baseInp();
      var panel   = _basePanel();
      var invBank = _baseInvBank();
      inp.inverterBank = invBank;   // validator iterates this
      if (mutator) {
        mutator({ inp: inp, panel: panel, invBank: invBank, nom: nom });
      }

      var r;
      try { r = runValidation(ss, inp, panel, invBank, nom); }
      catch (e) {
        t.error('VAL [' + label + '] threw', e);
        return;
      }

      function has(arr, code) {
        return arr.some(function (x) { return x.rule === code; });
      }

      (expect.criticals || []).forEach(function (code) {
        t.assertTrue('VAL [' + label + '] CRIT ' + code,
                     has(r.criticals, code));
      });
      (expect.majors || []).forEach(function (code) {
        t.assertTrue('VAL [' + label + '] MAJOR ' + code,
                     has(r.majors, code));
      });
      (expect.warnings || []).forEach(function (code) {
        t.assertTrue('VAL [' + label + '] WARN ' + code,
                     has(r.warnings, code));
      });
    }

    // ====================================================================
    // GROUP 1: input completeness (8 rules)
    // ====================================================================
    check('empty projectName',
      function (o) { o.inp.projectName = ''; },
      { majors: ['INP-01'] });

    check('empty clientName',
      function (o) { o.inp.clientName = ''; },
      { majors: ['INP-02'] });

    check('empty panelModel',
      function (o) { o.inp.panelModel = ''; },
      { criticals: ['INP-03'] });

    check('panelQty zero',
      function (o) { o.inp.panelQty = 0; },
      { criticals: ['INP-04'] });

    check('modsPerString zero',
      function (o) { o.inp.modsPerString = 0; },
      { criticals: ['INP-05'] });

    check('no inverters',
      function (o) {
        o.inp.inverterBank = [];
        o.invBank.length = 0;
      },
      { criticals: ['INP-06'] });

    check('both temps zero (likely unentered)',
      function (o) { o.inp.minTemp = 0; o.inp.maxTemp = 0; },
      { majors: ['INP-07'] });

    check('min temp >= max temp',
      function (o) { o.inp.minTemp = 50; o.inp.maxTemp = 38; },
      { criticals: ['INP-08'] });

    // ====================================================================
    // GROUP 2: panel data completeness (5 rules)
    // ====================================================================
    check('panel Voc zero',
      function (o) { o.panel['PANEL_VOC_V'] = 0; },
      { criticals: ['PNL-01'] });

    check('panel Vmp zero',
      function (o) { o.panel['PANEL_VMP_V'] = 0; },
      { criticals: ['PNL-02'] });

    check('panel Isc zero',
      function (o) { o.panel['PANEL_ISC_A'] = 0; },
      { criticals: ['PNL-03'] });

    check('panel temp coeff positive (sign error)',
      function (o) { o.panel['PANEL_TEMP_PMAX'] = 0.001; },
      { majors: ['PNL-04'] });

    check('panel power zero',
      function (o) { o.panel['PANEL_POWER_W'] = 0; },
      { criticals: ['PNL-05'] });

    // ====================================================================
    // GROUP 3: inverter data completeness (6 rules)
    // ====================================================================
    check('inverter maxDcV zero',
      function (o) { o.invBank[0].maxDcV = 0; },
      { criticals: ['INV-01'] });

    check('inverter mpptVmin zero',
      function (o) { o.invBank[0].mpptVmin = 0; },
      { criticals: ['INV-02'] });

    check('inverter mpptVmin >= mpptVmax',
      function (o) {
        o.invBank[0].mpptVmin = 1100;
        o.invBank[0].mpptVmax = 1000;
      },
      { criticals: ['INV-03'] });

    check('inverter qty zero',
      function (o) { o.invBank[0].qty = 0; },
      { criticals: ['INV-06'] });

    // 200 strings assigned > 20 inputs * 4 inverters = 80 max
    check('strings assigned > available DC inputs',
      function (o) { o.invBank[0].stringsAssigned = 200; },
      { criticals: ['STR-02'] });

    check('inverter optimizer topology fires warning',
      function (o) { o.invBank[0].topology = 'OPTIMIZER'; },
      { warnings: ['INV-08'] });

    // ====================================================================
    // GROUP 4: voltage range pre-check (1 rule)
    // ====================================================================
    // At minTemp=-1, vocPerMod = 56.31. maxDcV=1100.
    // 56.31 * 22 = 1238.8 > 1100 so DC-01 fires when modsPerString=22.
    check('DC-01: too many mods/string (Voc cold > Vmax)',
      function (o) { o.inp.modsPerString = 22; },
      { criticals: ['DC-01'] });

    // ====================================================================
    // GROUP 5: DC/AC ratio (1 rule)
    // ====================================================================
    // panelQty 2500 * 585W = 1462.5 kWp / 400 kWac = 3.66 -- way above
    // any sane dcAcHard. Will also cascade to STR-00 (mods derived from
    // strings doesn't match) -- we only assert DC-10.
    check('DC-10: ratio exceeds hard max',
      function (o) { o.inp.panelQty = 2500; },
      { criticals: ['DC-10'] });

    // ====================================================================
    // GROUP 6: string count consistency (1 rule)
    // ====================================================================
    // stringsTotal=50 but only 40 assigned to the inverter -> STR-00 major
    check('STR-00: stringsTotal != sum of assigned',
      function (o) { o.inp.stringsTotal = 50; },
      { majors: ['STR-00'] });

    // ====================================================================
    // GROUP 7: helioscope production (1 rule)
    // ====================================================================
    check('HEL-01: helio incomplete (< 12 months)',
      function (o) { o.inp.helio = [{ grid: 100 }]; },
      { majors: ['HEL-01'] });

    // ====================================================================
    // GROUP 8: design limits (3 rules)
    // ====================================================================
    // 0.10 = 10% DC vdrop, well above any sane NOM hard cap (typically 0.02-0.03)
    check('LIM-01: dcVdropLimit > NOM hard',
      function (o) { o.inp.dcVdropLimit = 0.10; },
      { criticals: ['LIM-01'] });

    // 0.20 = 20% AC vdrop, similarly
    check('LIM-02: acVdropLimit > NOM hard',
      function (o) { o.inp.acVdropLimit = 0.20; },
      { criticals: ['LIM-02'] });

    check('LIM-03: powerFactor out of range',
      function (o) { o.inp.powerFactor = 0.5; },
      { majors: ['LIM-03'] });
  }
});
