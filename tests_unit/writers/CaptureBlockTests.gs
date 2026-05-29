// =============================================================================
// ARGIA TESTS -- tests_unit/writers/CaptureBlockTests.gs
// CHUNK 7 4B (writer) -- locks _cfeOutV2_renderCaptureBlock.
// =============================================================================

function _capBlkMockSheet() {
  var written = [];
  function range() {
    var self = {
      breakApart: function () { return self; }, merge: function () { return self; },
      setValue: function (v) { written.push(String(v)); return self; },
      setBackground: function () { return self; }, setFontWeight: function () { return self; },
      setFontSize: function () { return self; }, setFontColor: function () { return self; },
      setFontStyle: function () { return self; }, setWrap: function () { return self; },
      setHorizontalAlignment: function () { return self; },
      setVerticalAlignment: function () { return self; }
    };
    return self;
  }
  return { _written: written, getRange: function () { return range(); },
           setRowHeight: function () {}, getLastRow: function () { return 100; } };
}
function _capBlkText(sh) { return sh._written.join(' || '); }

registerTest({
  id: 'UNIT_CAPBLK_NONE_NOOP', group: 'unit', module: 'writers/capture',
  scenarios: [], tags: ['writer', 'capture', 'chunk7', '4b', 'regression'],
  source: 'tests_unit/writers/CaptureBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/capture: non-4B project => nothing rendered');
    var sh = _capBlkMockSheet();
    var last = _cfeOutV2_renderCaptureBlock(sh, 50,
      { available: false, exportKwh: 0, captureModeled: false });
    t.assert('returns startRow-1', 49, last);
    t.assert('no text written', 0, sh._written.length);
  }
});

registerTest({
  id: 'UNIT_CAPBLK_VALUE_SHOWN', group: 'unit', module: 'writers/capture',
  scenarios: [], tags: ['writer', 'capture', 'chunk7', '4b'],
  source: 'tests_unit/writers/CaptureBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/capture: capture adds value => net value + regime');
    var sh = _capBlkMockSheet();
    _cfeOutV2_renderCaptureBlock(sh, 50, {
      available: true, exportKwh: 200000, captureModeled: true,
      captureNetValue: {
        capturedKwh: 200000, grossValueMxn: 700000, priorExportWorthMxn: 0,
        netValueMxn: 700000, regime: 'SIN_EXPORTACION',
        regimeLabel: 'sin exportación (excedente se perdía)', addsValue: true,
        note: 'Valor incremental.'
      }
    });
    var txt = _capBlkText(sh);
    t.assertTrue('header present', txt.indexOf('CAPTURA DE EXCEDENTE') >= 0);
    t.assertTrue('net 700,000 shown', txt.indexOf('700,000') >= 0);
    t.assertTrue('regime label shown', txt.indexOf('sin exportación') >= 0);
  }
});

registerTest({
  id: 'UNIT_CAPBLK_NO_VALUE_NETMETERING', group: 'unit', module: 'writers/capture',
  scenarios: [], tags: ['writer', 'capture', 'chunk7', '4b'],
  source: 'tests_unit/writers/CaptureBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/capture: net-metering adds no value => $0 + peak-shaving note');
    var sh = _capBlkMockSheet();
    _cfeOutV2_renderCaptureBlock(sh, 50, {
      available: true, exportKwh: 200000, captureModeled: true,
      captureNetValue: {
        capturedKwh: 200000, grossValueMxn: 700000, priorExportWorthMxn: 700000,
        netValueMxn: 0, regime: 'MEDICION_NETA',
        regimeLabel: 'medición neta (excedente ya acreditado ~1:1)',
        addsValue: false,
        note: 'La captura NO agrega valor; la batería se sostiene en peak-shaving.'
      }
    });
    var txt = _capBlkText(sh);
    t.assertTrue('shows no-value text', txt.indexOf('no agrega valor') >= 0);
    t.assertTrue('points to peak-shaving', txt.indexOf('peak-shaving') >= 0);
  }
});

registerTest({
  id: 'UNIT_CAPBLK_DATA_INSUFFICIENT', group: 'unit', module: 'writers/capture',
  scenarios: [], tags: ['writer', 'capture', 'chunk7', '4b'],
  source: 'tests_unit/writers/CaptureBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/capture: export declared, no capture => DATOS INSUFICIENTES');
    var sh = _capBlkMockSheet();
    _cfeOutV2_renderCaptureBlock(sh, 50,
      { available: true, exportKwh: 0, captureModeled: false });
    var txt = _capBlkText(sh);
    t.assertTrue('shows DATOS INSUFICIENTES', txt.indexOf('DATOS INSUFICIENTES') >= 0);
    t.assertTrue('explains data needed',
                 txt.indexOf('exportación') >= 0 || txt.indexOf('producción') >= 0);
    t.assertTrue('reassures peak-shaving', txt.indexOf('peak-shaving') >= 0);
  }
});

registerTest({
  id: 'UNIT_CAPBLK_NEVER_BLEND_NOTE', group: 'unit', module: 'writers/capture',
  scenarios: [], tags: ['writer', 'capture', 'chunk7', '4b', 'invariant'],
  source: 'tests_unit/writers/CaptureBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/capture: INVARIANT value render carries separation note');
    var sh = _capBlkMockSheet();
    _cfeOutV2_renderCaptureBlock(sh, 50, {
      available: true, exportKwh: 200000, captureModeled: true,
      captureNetValue: {
        capturedKwh: 200000, grossValueMxn: 540000, priorExportWorthMxn: 160000,
        netValueMxn: 380000, regime: 'FACTURACION_NETA',
        regimeLabel: 'facturación neta', addsValue: true, note: 'X.'
      }
    });
    var txt = _capBlkText(sh);
    t.assertTrue('header separated from CFE', txt.indexOf('separado del ahorro CFE') >= 0);
    t.assertTrue('note: NOT a CFE bill saving', txt.indexOf('NO es ahorro en el recibo CFE') >= 0);
  }
});

registerTest({
  id: 'UNIT_CAPBLK_GROSS_PRIOR_TRANSPARENCY', group: 'unit', module: 'writers/capture',
  scenarios: [], tags: ['writer', 'capture', 'chunk7', '4b'],
  source: 'tests_unit/writers/CaptureBlockTests.gs',
  fn: function (t) {
    t.suite('UNIT writer/capture: shows gross, prior, net (transparency)');
    var sh = _capBlkMockSheet();
    _cfeOutV2_renderCaptureBlock(sh, 50, {
      available: true, exportKwh: 200000, captureModeled: true,
      captureNetValue: {
        capturedKwh: 200000, grossValueMxn: 700000, priorExportWorthMxn: 160000,
        netValueMxn: 540000, regime: 'FACTURACION_NETA',
        regimeLabel: 'facturación neta', addsValue: true, note: 'X.'
      }
    });
    var txt = _capBlkText(sh);
    t.assertTrue('gross 700,000', txt.indexOf('700,000') >= 0);
    t.assertTrue('prior 160,000', txt.indexOf('160,000') >= 0);
    t.assertTrue('net 540,000', txt.indexOf('540,000') >= 0);
  }
});
