// =============================================================================
// ARGIA TESTS -- tests_regression/v2/CulliganBaselineV2Tests.gs
// -----------------------------------------------------------------------------
// CHUNK 1 — v2 regression baseline (MDC_v2 only, for now).
//
// PURPOSE
//   Mirrors REG_CULLIGAN_BASELINE but reads from MDC_v2 instead of MDC. As
//   each subsequent chunk migrates a writer (BOM_v2 in Chunk 2, PROJECT_CARD_v2
//   in Chunk 3, INSTALLATION_v2 in Chunk 4, etc.) we ADD blocks to this test.
//   At cutover (Chunk 11) this test becomes the new REG_CULLIGAN_BASELINE.
//
// SCOPE (read-only, same as legacy)
//   This test does NOT write fixture inputs and does NOT run the engine. It
//   asserts on whatever is currently in MDC_v2. The caller is responsible for
//   running `runArgiaEngine()` against CULLIGAN inputs IMMEDIATELY BEFORE
//   invoking this test.
//
// LOCK SOURCE
//   Same baseline run as legacy: engine v2.3.5, DB 2026.05, real CULLIGAN
//   inputs. The MDC_v2 sheet is written by writeMdcV2() inside the same
//   engine pass that writes the legacy MDC; the cells locked here should be
//   identical to the legacy MDC's locks for the same rows.
//
// NOT-YET-COVERED (will land in future chunks)
//   - BOM_v2 totals (Chunk 2)
//   - PROJECT_CARD_v2 totals (Chunk 3)
//   - INSTALLATION_v2 totals (Chunk 4)
//   These are intentionally OMITTED here, not stubbed as TODOs, because a
//   failing assertion against a sheet that doesn't exist yet would be noise.
//
// CHUNK TAG
//   'chunk1' so the per-chunk runner picks it up while we're on Chunk 1.
//   When Chunk 2 lands, retain 'chunk1' (still locks MDC_v2) and ALSO add a
//   second registerTest below for BOM_v2 with tag 'chunk2'. The Chunk 11
//   cutover then consolidates everything.
// =============================================================================


registerTest({
  id      : 'REG_CULLIGAN_BASELINE_V2',
  group   : 'regression',
  module  : 'regression/v2/culligan',
  scenarios: [],
  tags    : ['regression', 'baseline', 'culligan', 'v2', 'read-only', 'chunk1'],
  source  : 'tests_regression/v2/CulliganBaselineV2Tests.gs',
  fn: function (t, ctx) {
    t.suite('REG regression/v2/culligan: CULLIGAN reference numbers on MDC_v2');

    var ss = ctx.ss;
    if (!ss) { t.info('skipped', 'no spreadsheet context'); return; }

    t.info('caveat',
      'Read-only assertion against MDC_v2. Run "Generate MDC and BOM" against ' +
      'CULLIGAN inputs IMMEDIATELY before running this test. The same engine ' +
      'pass that updates MDC also writes MDC_v2 (Step 10-v2). Failures on the ' +
      'project-name assertion indicate the workbook holds a different run.');

    // -- Required sheets ---------------------------------------------------
    if (!ss.getSheetByName('MDC_v2')) {
      t.fail('required sheet missing',
             'MDC_v2 -- aborting v2 baseline check. The v2 sheet is created ' +
             'by setupMdcTemplate() during Step 10-v2 of runArgiaEngine. If ' +
             'the engine ran but the sheet is missing, the v2 try/catch ' +
             'swallowed an error -- check the engine log.');
      return;
    }
    if (!ss.getSheetByName('_META')) {
      t.fail('required sheet missing', '_META');
      return;
    }

    var mdc = ss.getSheetByName('MDC_v2');

    // =====================================================================
    // BLOCK 1: IDENTITY (must match before any number is meaningful)
    // =====================================================================
    var mdcProj = String(mdc.getRange('C7').getValue() || '').trim();
    if (mdcProj !== 'CULLIGAN') {
      t.fail('MDC_v2.C7 project name (CULLIGAN required)',
             'got "' + mdcProj + '" -- this workbook is NOT holding a ' +
             'CULLIGAN run. Re-run "Generate MDC and BOM" against CULLIGAN ' +
             'inputs, then re-run this test. Subsequent asserts skipped.');
      return;
    }
    t.assert('MDC_v2.C7 project name', 'CULLIGAN', mdcProj);
    t.assert('MDC_v2.C8 client name',  'CULLIGAN TEST',
             String(mdc.getRange('C8').getValue() || '').trim());

    // =====================================================================
    // BLOCK 2: SCALE (panel count, inverter count, kW)
    // =====================================================================
    t.assert('MDC_v2.C11 module count',     1350, mdc.getRange('C11').getValue());
    t.assert('MDC_v2.C12 inverter count',      5, mdc.getRange('C12').getValue());

    // =====================================================================
    // BLOCK 3: MDC ENGINEERING DECISIONS
    // Mirrors REG_CULLIGAN_BASELINE block 3, same tolerances.
    // =====================================================================
    var TOL_RATIO = 0.001;
    var TOL_CUR   = 0.05;
    var TOL_PCT   = 0.0005;

    t.assertNear('MDC_v2.C17 DC/AC ratio',
                 1.234, mdc.getRange('C17').getValue(), TOL_RATIO);
    t.assertNear('MDC_v2.C22 design current (A)',
                 23.64, mdc.getRange('C22').getValue(), TOL_CUR);

    t.assertContains('MDC_v2.C26 DC conductor includes 10 AWG',
                     String(mdc.getRange('C26').getValue()), '10 AWG');
    t.assertContains('MDC_v2.C28 DC OCPD includes 25',
                     String(mdc.getRange('C28').getValue()), '25');
    t.assertNear('MDC_v2.C30 DC voltage drop pct',
                 0.0136, mdc.getRange('C30').getValue(), TOL_PCT);

    var vocColdRaw = String(mdc.getRange('C35').getValue() || '');
    var vmpHotRaw  = String(mdc.getRange('C36').getValue() || '');
    t.assertContains('MDC_v2.C35 Voc cold ≈ 1031.9 V', vocColdRaw, '1031.9');
    t.assertContains('MDC_v2.C36 Vmp hot ≈ 752.8 V',   vmpHotRaw,  '752.8');

    var acMainRaw   = String(mdc.getRange('C56').getValue() || '');
    var breakerRaw  = String(mdc.getRange('C57').getValue() || '');
    var transRaw    = String(mdc.getRange('C66').getValue() || '');
    t.assertContains('MDC_v2.C56 AC main current ≈ 842 A', acMainRaw,  '842');
    t.assertContains('MDC_v2.C57 main breaker = 1250 A',   breakerRaw, '1250');
    t.assertContains('MDC_v2.C66 transformer = 1000 kVA',  transRaw,   '1000');

    t.assert('MDC_v2.C72 emission status',
             'EMITTABLE WITH OBSERVATIONS',
             String(mdc.getRange('C72').getValue() || '').trim());

    var areaRaw    = String(mdc.getRange('C88').getValue() || '');
    var dcCableRaw = String(mdc.getRange('C91').getValue() || '');
    t.assertContains('MDC_v2.C88 array area = 3564 m2',     areaRaw,    '3564');
    t.assertContains('MDC_v2.C91 DC cable total = 12600 m', dcCableRaw, '12600');

    // =====================================================================
    // BLOCK 4: PARITY CHECK (v2 should match legacy MDC cell-for-cell on
    // the headline numbers). This is the differentiator vs the legacy
    // baseline -- if v2 ever drifts from legacy during the migration, this
    // assertion catches it BEFORE it lands in front of a customer.
    // =====================================================================
    var legacy = ss.getSheetByName('MDC');
    if (legacy) {
      var checkParity = function(cell, label) {
        var v2  = mdc.getRange(cell).getValue();
        var leg = legacy.getRange(cell).getValue();
        // Use loose string equality for cells with units ("10 AWG" vs 10), tight
        // numeric equality otherwise.
        var v2s  = String(v2  === null ? '' : v2);
        var legs = String(leg === null ? '' : leg);
        t.assert('PARITY ' + cell + ' (' + label + ')', legs, v2s);
      };
      checkParity('C7',  'project');
      checkParity('C8',  'client');
      checkParity('C11', 'module count');
      checkParity('C12', 'inverter count');
      checkParity('C26', 'DC conductor');
      checkParity('C57', 'main breaker');
      checkParity('C66', 'transformer');
      checkParity('C72', 'emission status');
    } else {
      t.info('parity skipped', 'legacy MDC sheet not present');
    }

    // =====================================================================
    // BLOCK 5: ENGINE VERSION
    // =====================================================================
    var meta = ss.getSheetByName('_META');
    var engineVer = String(meta.getRange('B4').getValue() || '');
    if (engineVer !== '2.3.5') {
      t.info('engine version drift',
        'Baseline was locked at engine v2.3.5. Current engine v' + engineVer +
        '. If asserts above pass, the baseline carries forward cleanly.');
    } else {
      t.assert('engine version matches v2 baseline', '2.3.5', engineVer);
    }
  }
});
