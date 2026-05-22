// =============================================================================
// ARGIA TESTS -- tests_regression/baseline/CulliganBaselineTests.gs
// -----------------------------------------------------------------------------
// CULLIGAN real-project baseline regression test.
//
// PURPOSE
//   Locks the headline numbers from the CULLIGAN reference run (engine v2.3.5,
//   2026-05-22). Used as the safety-net assertion across cleanup refactors:
//   if any structural change shifts a single locked value, this test fails
//   and the cleanup step must be reverted or the change consciously accepted
//   with a new lock.
//
// SCOPE (Option A: READ-ONLY ASSERTION ON CURRENT WORKBOOK STATE)
//   This test does NOT write fixture inputs and does NOT run the engine.
//   It asserts on whatever is currently sitting in MDC / BOM / INSTALLATION
//   / PROJECT_CARD. The caller is responsible for running
//   `runArgiaEngine()` against CULLIGAN inputs IMMEDIATELY BEFORE invoking
//   this test.
//
//   If the workbook holds outputs from a different project (e.g. after a
//   different engine run or after legacy regression tests overwrote outputs),
//   THIS TEST WILL FAIL FOR THE WRONG REASON. Read the failure message --
//   the first assertion (project name == CULLIGAN) will indicate this.
//
// FUTURE WORK
//   When the test framework gains output-sheet backup/restore (Item 2 of
//   the cleanup plan), promote this test to a self-contained fixture-driven
//   regression: write CULLIGAN inputs, run engine, assert, restore. At that
//   point the fixture moves to test/TestProjects.gs as CULLIGAN_BASELINE
//   and this test becomes idempotent like REG_BESS_SIM_FORMULAS.
//
// LOCK SOURCE
//   Workbook ARGIA_ENGINE__31_.xlsx, _META.calculated_at = 2026-05-22T03:02:58Z,
//   engine v2.3.5, DB 2026.05. Real CULLIGAN inputs (1350 panels, 5 inverters,
//   864 kWdc, 700 kWac, PPA_ROOF business case, MONTERREY).
//
// CLASSIFICATION
//   group=regression. Locked real-project numbers. Should drift only with an
//   explicit CHANGELOG entry explaining the cause and the new locked values.
// =============================================================================


registerTest({
  id      : 'REG_CULLIGAN_BASELINE',
  group   : 'regression',
  module  : 'regression/baseline/culligan',
  scenarios: [],
  tags    : ['regression', 'baseline', 'culligan', 'real-project', 'read-only'],
  source  : 'tests_regression/baseline/CulliganBaselineTests.gs',
  fn: function (t, ctx) {
    t.suite('REG regression/baseline/culligan: CULLIGAN reference numbers');

    var ss = ctx.ss;
    if (!ss) { t.info('skipped', 'no spreadsheet context'); return; }

    // -- Operator warning --------------------------------------------------
    // Read-only test: validity depends on the workbook currently holding
    // a CULLIGAN engine run. State this loudly in the INFO trail so a
    // failure is interpretable.
    t.info('caveat',
      'Read-only assertion. Run "Generate MDC and BOM" against CULLIGAN ' +
      'inputs IMMEDIATELY before running this test. Failures on the ' +
      'project-name assertion indicate the workbook holds a different run.');

    // -- Required sheets ---------------------------------------------------
    var required = ['MDC', 'BOM', 'INSTALLATION', 'PROJECT_CARD', '_META'];
    for (var i = 0; i < required.length; i++) {
      if (!ss.getSheetByName(required[i])) {
        t.fail('required sheet missing',
               required[i] + ' -- aborting baseline check');
        return;
      }
    }

    // =====================================================================
    // BLOCK 1: IDENTITY (must match before any number is meaningful)
    // =====================================================================
    var mdc = ss.getSheetByName('MDC');
    var mdcProj = String(mdc.getRange('C7').getValue() || '').trim();
    if (mdcProj !== 'CULLIGAN') {
      t.fail('MDC.C7 project name (CULLIGAN required)',
             'got "' + mdcProj + '" -- this workbook is NOT holding a ' +
             'CULLIGAN run. Re-run "Generate MDC and BOM" against CULLIGAN ' +
             'inputs, then re-run this test. Subsequent asserts skipped.');
      return;
    }
    t.assert('MDC.C7 project name',  'CULLIGAN',       mdcProj);
    t.assert('MDC.C8 client name',   'CULLIGAN TEST',
             String(mdc.getRange('C8').getValue() || '').trim());

    var bom = ss.getSheetByName('BOM');
    // BOM title cell A4 carries a long banner -- assert it CONTAINS CULLIGAN
    // rather than locking the exact string, which varies with module power.
    var bomTitle = String(bom.getRange('A4').getValue() || '');
    t.assertContains('BOM.A4 title carries project name', bomTitle, 'CULLIGAN');

    var pc = ss.getSheetByName('PROJECT_CARD');
    t.assert('PROJECT_CARD.C4 customer', 'CULLIGAN TEST',
             String(pc.getRange('C4').getValue() || '').trim());
    t.assert('PROJECT_CARD.C5 project',  'CULLIGAN',
             String(pc.getRange('C5').getValue() || '').trim());

    // =====================================================================
    // BLOCK 2: SCALE (panel count, inverter count, kWp -- must agree
    // across all four sheets; mismatch here = the very bug this baseline
    // exists to prevent)
    // =====================================================================
    var inst = ss.getSheetByName('INSTALLATION');

    t.assert('MDC.C11 module count',          1350,  mdc.getRange('C11').getValue());
    t.assert('MDC.C12 inverter count',           5,  mdc.getRange('C12').getValue());
    t.assert('INSTALL.B8 module count',       1350,  inst.getRange('B8').getValue());
    t.assert('INSTALL.B9 inverter count',        5,  inst.getRange('B9').getValue());
    t.assert('INSTALL.B6 DC kWp',              864,  inst.getRange('B6').getValue());
    t.assert('INSTALL.B7 AC kW',               700,  inst.getRange('B7').getValue());

    // =====================================================================
    // BLOCK 3: MDC ENGINEERING DECISIONS (the calc outputs --
    // any drift here means the calc layer changed)
    // =====================================================================
    var TOL_RATIO = 0.001;   // dimensionless 3-decimal lock
    var TOL_CUR   = 0.05;    // amps, 2-decimal lock
    var TOL_V     = 0.5;     // volts, 1-decimal lock
    var TOL_PCT   = 0.0005;  // voltage drops are very small, 4-decimal lock

    t.assertNear('MDC.C17 DC/AC ratio',         1.234, mdc.getRange('C17').getValue(), TOL_RATIO);
    t.assertNear('MDC.C22 design current (A)',  23.64, mdc.getRange('C22').getValue(), TOL_CUR);

    // DC conductor / OCPD / DC voltage drop -- string locks (string values
    // include unit suffix like "10 AWG", "25 A", so compare as strings).
    t.assertContains('MDC.C26 DC conductor includes 10 AWG',
                     String(mdc.getRange('C26').getValue()), '10 AWG');
    t.assertContains('MDC.C28 DC OCPD includes 25',
                     String(mdc.getRange('C28').getValue()), '25');
    t.assertNear('MDC.C30 DC voltage drop pct',
                 0.0136, mdc.getRange('C30').getValue(), TOL_PCT);

    // String voltages
    var vocColdRaw = String(mdc.getRange('C35').getValue() || '');
    var vmpHotRaw  = String(mdc.getRange('C36').getValue() || '');
    t.assertContains('MDC.C35 Voc cold ≈ 1031.9 V', vocColdRaw, '1031.9');
    t.assertContains('MDC.C36 Vmp hot ≈ 752.8 V',   vmpHotRaw,  '752.8');

    // AC main / breaker / transformer
    var acMainRaw    = String(mdc.getRange('C56').getValue() || '');
    var breakerRaw   = String(mdc.getRange('C57').getValue() || '');
    var transRaw     = String(mdc.getRange('C66').getValue() || '');
    t.assertContains('MDC.C56 AC main current ≈ 842 A', acMainRaw,  '842');
    t.assertContains('MDC.C57 main breaker = 1250 A',   breakerRaw, '1250');
    t.assertContains('MDC.C66 transformer = 1000 kVA',  transRaw,   '1000');

    // Emission status -- this can flip between PASS and OBSERVATIONS as
    // validation rules tighten; lock the current state explicitly so any
    // future tightening or relaxation is intentional.
    t.assert('MDC.C72 emission status',
             'EMITTABLE WITH OBSERVATIONS',
             String(mdc.getRange('C72').getValue() || '').trim());

    // Layout / geometry
    var areaRaw      = String(mdc.getRange('C88').getValue() || '');
    var dcCableRaw   = String(mdc.getRange('C91').getValue() || '');
    t.assertContains('MDC.C88 array area = 3564 m2', areaRaw,    '3564');
    t.assertContains('MDC.C91 DC cable total = 12600 m', dcCableRaw, '12600');

    // =====================================================================
    // BLOCK 4: BOM TOTALS (the customer-facing cost numbers)
    // =====================================================================
    var TOL_USD = 1.0;   // BOM grand totals locked to nearest dollar
    var TOL_MXN = 50.0;  // MXN locked to nearest 50 pesos (FX rounding noise)

    // Section subtotals (col F = USD)
    t.assertNear('BOM.F13 SUBTOTAL panels USD',     128736.00,  bom.getRange('F13').getValue(), TOL_USD);
    t.assertNear('BOM.F20 SUBTOTAL inverters USD',   31200.00,  bom.getRange('F20').getValue(), TOL_USD);
    t.assertNear('BOM.F25 SUBTOTAL structure USD',   24300.00,  bom.getRange('F25').getValue(), TOL_USD);
    t.assertNear('BOM.F35 SUBTOTAL DC USD',          58377.77,  bom.getRange('F35').getValue(), TOL_USD);
    t.assertNear('BOM.F63 SUBTOTAL AC USD',          78315.41,  bom.getRange('F63').getValue(), TOL_USD);
    t.assertNear('BOM.F78 SUBTOTAL monitoring USD',   6724.32,  bom.getRange('F78').getValue(), TOL_USD);

    // Grand total (col F = USD, col G = MXN)
    t.assertNear('BOM.F80 GRAND TOTAL USD',         327653.51,  bom.getRange('F80').getValue(), TOL_USD);
    t.assertNear('BOM.G80 GRAND TOTAL MXN',        6061589.91,  bom.getRange('G80').getValue(), TOL_MXN);

    // =====================================================================
    // BLOCK 5: INSTALLATION TOTALS
    // =====================================================================
    t.assertNear('INSTALL.G5 TOTAL LABOR MXN',   97320.06,  inst.getRange('G5').getValue(), TOL_MXN);
    t.assertNear('INSTALL.G6 TOTAL EQUIP MXN',   66880.00,  inst.getRange('G6').getValue(), TOL_MXN);
    t.assertNear('INSTALL.G7 TOTAL OTHER MXN', 352605.20,   inst.getRange('G7').getValue(), TOL_MXN);
    t.assertNear('INSTALL.G9 GRAND TOTAL MXN', 516805.26,   inst.getRange('G9').getValue(), TOL_MXN);
    t.assertNear('INSTALL.G10 MXN per kWp',       598.00,   inst.getRange('G10').getValue(), 1.0);

    // =====================================================================
    // BLOCK 6: PROJECT CARD TOTALS (the deliverable the salesperson sees)
    // =====================================================================
    t.assertNear('PROJECT_CARD.C36 total cost USD',  355589.0,  pc.getRange('C36').getValue(), TOL_USD);
    t.assertNear('PROJECT_CARD.D36 total cost MXN', 6578395.0,  pc.getRange('D36').getValue(), TOL_MXN);
    t.assertNear('PROJECT_CARD.H39 gross profit USD', 62751.0,  pc.getRange('H39').getValue(), TOL_USD);

    // Sell price has a string format ("0.484 USD/Wp | 484 USD/kWp")
    var sellRaw = String(pc.getRange('H17').getValue() || '');
    t.assertContains('PROJECT_CARD.H17 sell USD/Wp includes 0.484',
                     sellRaw, '0.484');

    // =====================================================================
    // BLOCK 7: ENGINE VERSION (the meta -- if engine version differs,
    // baseline numbers may legitimately change; warn explicitly)
    // =====================================================================
    var meta = ss.getSheetByName('_META');
    var engineVer = String(meta.getRange('B4').getValue() || '');
    if (engineVer !== '2.3.5') {
      t.info('engine version drift',
        'Baseline was locked at engine v2.3.5. Current engine v' + engineVer +
        '. If asserts above pass, the baseline carries forward cleanly. ' +
        'If they fail, audit which numbers changed and update the lock ' +
        'with an explicit CHANGELOG entry.');
    } else {
      t.assert('engine version matches baseline', '2.3.5', engineVer);
    }
  }
});
