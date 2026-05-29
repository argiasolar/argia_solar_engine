// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CaptureNetValueTests.gs
// -----------------------------------------------------------------------------
// CHUNK 7 4B regime-netting -- locks 29_CalcCaptureNetValue.js.
//
// Proves the reviewer's interconnection table:
//   NET_METERING (MEDICION_NETA)    -> net LOW  (export already ~1:1 credited)
//   NET_BILLING  (FACTURACION_NETA) -> net HIGH (export was ~0.80)
//   ZERO_EXPORT  (SIN_EXPORTACION)  -> net MAX  (export was worth 0)
// plus the floor-at-zero invariant (capture never shown negative).
//
// COVERAGE (9 tests):
//   1. UNIT_CNV_ZERO_EXPORT_MAX_VALUE
//   2. UNIT_CNV_NET_BILLING_HIGH_VALUE
//   3. UNIT_CNV_NET_METERING_LOW_VALUE
//   4. UNIT_CNV_REGIME_ORDERING                (ZERO > BILLING > METERING)
//   5. UNIT_CNV_FLOOR_AT_ZERO_NEVER_NEGATIVE   (invariant)
//   6. UNIT_CNV_ADDS_VALUE_FLAG
//   7. UNIT_CNV_NET_METERING_ADDS_LITTLE_NOTE
//   8. UNIT_CNV_GROSS_AND_PRIOR_REPORTED
//   9. UNIT_CNV_ZERO_CAPTURE_ZERO_VALUE
// =============================================================================

// Common scenario: 100,000 kWh/yr captured, battery earns 2.50 MXN/kWh
// discharging it. Retail offset rate (for NM) 2.40, export price 0.80.
function _cnvBase(regime, extra) {
  var o = {
    capturedKwh: 100000,
    dischargeValueMxnPerKwh: 2.50,
    interconnMode: regime,
    exportPriceMxnPerKwh: 0.80,
    offsetEnergyRateMxnPerKwh: 2.40
  };
  if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
  return o;
}

registerTest({
  id: 'UNIT_CNV_ZERO_EXPORT_MAX_VALUE', group: 'unit', module: 'calc/capture',
  scenarios: [], tags: ['calc', 'capture', 'chunk7', '4b'],
  source: 'tests_unit/calc/CaptureNetValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/capture: ZERO_EXPORT => prior worth 0 => net = gross (MAX)');
    var r = calcCaptureNetValue(_cnvBase('SIN_EXPORTACION'));
    t.assert('prior worth 0', 0, r.priorExportWorthMxn);
    t.assert('net = gross = 100000 x 2.50 = 250,000', 250000, r.netValueMxn);
    t.assertTrue('adds value', r.addsValue === true);
  }
});

registerTest({
  id: 'UNIT_CNV_NET_BILLING_HIGH_VALUE', group: 'unit', module: 'calc/capture',
  scenarios: [], tags: ['calc', 'capture', 'chunk7', '4b'],
  source: 'tests_unit/calc/CaptureNetValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/capture: NET_BILLING => prior worth = export price => HIGH net');
    var r = calcCaptureNetValue(_cnvBase('FACTURACION_NETA'));
    // gross 250,000 - prior (100000 x 0.80 = 80,000) = 170,000
    t.assert('prior worth 80,000', 80000, r.priorExportWorthMxn);
    t.assert('net 170,000', 170000, r.netValueMxn);
    t.assertTrue('adds value', r.addsValue === true);
  }
});

registerTest({
  id: 'UNIT_CNV_NET_METERING_LOW_VALUE', group: 'unit', module: 'calc/capture',
  scenarios: [], tags: ['calc', 'capture', 'chunk7', '4b'],
  source: 'tests_unit/calc/CaptureNetValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/capture: NET_METERING => prior worth ~retail => LOW net');
    var r = calcCaptureNetValue(_cnvBase('MEDICION_NETA'));
    // gross 250,000 - prior (100000 x 2.40 = 240,000) = 10,000 (LOW)
    t.assert('prior worth 240,000', 240000, r.priorExportWorthMxn);
    t.assert('net 10,000 (low)', 10000, r.netValueMxn);
  }
});

registerTest({
  id: 'UNIT_CNV_REGIME_ORDERING', group: 'unit', module: 'calc/capture',
  scenarios: [], tags: ['calc', 'capture', 'chunk7', '4b', 'invariant'],
  source: 'tests_unit/calc/CaptureNetValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/capture: ZERO_EXPORT > NET_BILLING > NET_METERING (the table)');
    var zero  = calcCaptureNetValue(_cnvBase('SIN_EXPORTACION')).netValueMxn;
    var bill  = calcCaptureNetValue(_cnvBase('FACTURACION_NETA')).netValueMxn;
    var meter = calcCaptureNetValue(_cnvBase('MEDICION_NETA')).netValueMxn;
    t.assertTrue('zero-export is the maximum', zero > bill);
    t.assertTrue('net-billing beats net-metering', bill > meter);
  }
});

registerTest({
  id: 'UNIT_CNV_FLOOR_AT_ZERO_NEVER_NEGATIVE', group: 'unit', module: 'calc/capture',
  scenarios: [], tags: ['calc', 'capture', 'chunk7', '4b', 'invariant'],
  source: 'tests_unit/calc/CaptureNetValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/capture: INVARIANT generous NM (export worth > discharge) => net 0, not negative');
    // offsetRate 3.00 > dischargeVal 2.50 -> raw net negative -> floored to 0.
    var r = calcCaptureNetValue(_cnvBase('MEDICION_NETA', {
      offsetEnergyRateMxnPerKwh: 3.00, dischargeValueMxnPerKwh: 2.50
    }));
    t.assert('net floored to 0 (never negative)', 0, r.netValueMxn);
    t.assertTrue('addsValue false', r.addsValue === false);
    t.assertTrue('net is not negative', r.netValueMxn >= 0);
  }
});

registerTest({
  id: 'UNIT_CNV_ADDS_VALUE_FLAG', group: 'unit', module: 'calc/capture',
  scenarios: [], tags: ['calc', 'capture', 'chunk7', '4b'],
  source: 'tests_unit/calc/CaptureNetValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/capture: addsValue true only when net > 0');
    t.assertTrue('zero-export adds value',
                 calcCaptureNetValue(_cnvBase('SIN_EXPORTACION')).addsValue === true);
    t.assertTrue('break-even NM does not add value',
                 calcCaptureNetValue(_cnvBase('MEDICION_NETA', {
                   offsetEnergyRateMxnPerKwh: 2.50, dischargeValueMxnPerKwh: 2.50
                 })).addsValue === false);
  }
});

registerTest({
  id: 'UNIT_CNV_NET_METERING_ADDS_LITTLE_NOTE', group: 'unit', module: 'calc/capture',
  scenarios: [], tags: ['calc', 'capture', 'chunk7', '4b'],
  source: 'tests_unit/calc/CaptureNetValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/capture: no-value case explains the battery rests on peak-shaving');
    var r = calcCaptureNetValue(_cnvBase('MEDICION_NETA', {
      offsetEnergyRateMxnPerKwh: 3.00
    }));
    t.assertTrue('note points to peak-shaving', r.note.indexOf('peak-shaving') >= 0);
    t.assertTrue('regime label present', r.regimeLabel.indexOf('medición neta') >= 0);
  }
});

registerTest({
  id: 'UNIT_CNV_GROSS_AND_PRIOR_REPORTED', group: 'unit', module: 'calc/capture',
  scenarios: [], tags: ['calc', 'capture', 'chunk7', '4b'],
  source: 'tests_unit/calc/CaptureNetValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/capture: gross + prior worth both reported (transparency)');
    var r = calcCaptureNetValue(_cnvBase('FACTURACION_NETA'));
    t.assert('gross 250,000', 250000, r.grossValueMxn);
    t.assert('prior 80,000', 80000, r.priorExportWorthMxn);
    t.assert('net = gross - prior', r.grossValueMxn - r.priorExportWorthMxn, r.netValueMxn);
  }
});

registerTest({
  id: 'UNIT_CNV_ZERO_CAPTURE_ZERO_VALUE', group: 'unit', module: 'calc/capture',
  scenarios: [], tags: ['calc', 'capture', 'chunk7', '4b'],
  source: 'tests_unit/calc/CaptureNetValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/capture: no captured kWh => zero value, all regimes');
    var regimes = ['SIN_EXPORTACION', 'FACTURACION_NETA', 'MEDICION_NETA'];
    for (var i = 0; i < regimes.length; i++) {
      var r = calcCaptureNetValue(_cnvBase(regimes[i], { capturedKwh: 0 }));
      t.assert('regime ' + regimes[i] + ' net 0', 0, r.netValueMxn);
    }
  }
});
