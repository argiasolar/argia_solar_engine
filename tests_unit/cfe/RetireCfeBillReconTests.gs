// =============================================================================
// tests_unit/cfe/RetireCfeBillReconTests.gs
// 4.51.0 — retire of the legacy INPUT_CFE bill reconstruction (rows 30-37).
// =============================================================================

registerTest({
  id: 'UNIT_CFE_BILL_RECON_RANGE',
  group: 'unit', module: 'cfe/retire_recon',
  scenarios: [], tags: ['cfe', 'retire', 'input_cfe'],
  source: 'tests_unit/cfe/RetireCfeBillReconTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT cfe/retire_recon: clear range is INPUT_CFE B30:N37');
    var r = cfeBillReconClearRange();
    t.assert('sheet', 'INPUT_CFE', r.sheet);
    t.assert('first row', 30, r.firstRow);
    t.assert('last row', 37, r.lastRow);
    t.assert('first col B', 2, r.firstCol);
    t.assert('last col N', 14, r.lastCol);
    t.assert('a1', 'B30:N37', r.a1);
    t.assert('8 label rows', 8, r.labels.length);
    // Must NOT reach into the pasted components (<=29) or PV block (>=39).
    t.assertTrue('does not touch components (>=30)', r.firstRow >= 30);
    t.assertTrue('does not touch PV interconnection (<=37)', r.lastRow <= 37);
  }
});

registerTest({
  id: 'UNIT_CFE_OUT_SRC_NO_DEAD_KEYS',
  group: 'unit', module: 'cfe/retire_recon',
  scenarios: [], tags: ['cfe', 'retire', 'source_map'],
  source: 'tests_unit/cfe/RetireCfeBillReconTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT cfe/retire_recon: dead source-map keys removed');
    // input_facturacion (row 35) + input_total (row 37) pointed at the retired
    // reconstruction. No consumer requested them; they must be gone.
    t.assertFalse('input_facturacion removed', CFE_OUT_SRC_V2.hasOwnProperty('input_facturacion'));
    t.assertFalse('input_total removed',       CFE_OUT_SRC_V2.hasOwnProperty('input_total'));
    // The live component keys the engine DOES use must remain.
    t.assertTrue('input_demandaFact kept', CFE_OUT_SRC_V2.hasOwnProperty('input_demandaFact'));
  }
});
