// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcLayoutDcWireTests.gs
// -----------------------------------------------------------------------------
// DC string/PV-wire quantity source selection in calcLayout() (06_CalcLayout.gs).
//
// The BOM DC-cable quantity now PREFERS the Helioscope-measured total conductor
// length (inp.dcStringWireM, cell C29) used directly × DC_WIRE_WASTE_FACTOR.
// When no Helioscope wire length is present it FALLS BACK to the geometry
// estimate (strings × 2 × estimateDcRunM × spare) — the Pass 2 behaviour, left
// untouched so estimateArrayGeometry/estimateDcRunM and their regression suite
// are unaffected.
//
// PROLOGIS MXC02304 reference: Helioscope measured 5,820 m; the geometry estimate
// produced ~15,900 m on the same job (solid-rectangle assumption vs a dispersed
// two-azimuth layout). These are pure-logic tests: no spreadsheet I/O.
// =============================================================================


// Minimal inp/dc/ac trio for calcLayout. dc carries the geometry stash (as calcDC
// does) plus dcLength=estimateDcRunM, so calcLayout takes the dc-geometry branch.
function _layoutDcWireFixture(dcStringWireM) {
  var inp = {
    panelQty: 960, walkwayFactor: 1.2, layoutRows: 8, layoutCols: 2, rowPitch: 3.0,
    aspectRatio: 1.5, dcStringWireM: dcStringWireM, stringsTotal: 31, dcSpareFactor: 1.2,
    groundingLen: 80, acSpareFactor: 1.2, invStations: 1, areaRequired: 0, availableSpace: 5000
  };
  var dc = {
    dcLength: 214,                      // estimateDcRunM(inp, geo) for this job
    panelAreaM2: 2.2, grossArea: 2534.4, arrayLength: 24, arrayWidth: 105.6,
    hasOptimizerTopology: true
  };
  var ac = {
    perInverter: [{ model: 'SE100KUS', qty: 5, acLenInv: 200, ocpd: 175,
                    conductor: '1/0', egc: '6', conduit: '2 1/2' }],
    parallelRuns: 1, feederLen: 100, mainBreaker: 800, condMain: '400 kcmil',
    egcMain: '1/0', conduitMain: '4', transformer: 750, iTotalAC: 601.4
  };
  return { inp: inp, dc: dc, ac: ac };
}


registerTest({
  id: 'UNIT_CALC_LAYOUT_DC_WIRE_HELIOSCOPE',
  group: 'unit',
  module: 'calc/layout',
  scenarios: [],
  tags: ['calc', 'layout', 'bom', 'dc', 'helioscope'],
  source: 'tests_unit/calc/CalcLayoutDcWireTests.gs',
  fn: function (t) {
    t.suite('calcLayout DC wire -- HELIOSCOPE measured path');
    var f = _layoutDcWireFixture(5820);
    var lay = calcLayout(f.inp, f.dc, f.ac);

    t.assert('basis is HELIOSCOPE', 'HELIOSCOPE', lay.bom.dcCableBasis);
    // Used directly × DC_WIRE_WASTE_FACTOR (1.05); NOT × 2, NOT × strings.
    t.assert('dcCableM = ceil(5820 x 1.05)', Math.ceil(5820 * DC_WIRE_WASTE_FACTOR), lay.bom.dcCableM);
    t.assert('dcWireSourceM preserved', 5820, lay.dcWireSourceM);
    // Guard against the geometry over-count reappearing on this dispersed job.
    t.assertTrue('measured well below geometry estimate', lay.bom.dcCableM < 8000);

    // MEMORIA / CÁLCULO trace layer: every derived line must carry real arithmetic.
    t.suite('calcLayout BOM trace (MEMORIA / CÁLCULO)');
    t.assertTrue('trace.dcCable cites Helioscope source m',
                 lay.bom.trace.dcCable.indexOf('5820') >= 0);
    t.assertTrue('trace.dcCable cites computed total m',
                 lay.bom.trace.dcCable.indexOf(String(lay.bom.dcCableM)) >= 0);
    t.assertTrue('trace.feeder cites feeder length',
                 lay.bom.trace.feeder.indexOf('100') >= 0 &&
                 lay.bom.trace.feeder.indexOf(String(lay.bom.mainFeederCableM)) >= 0);
    t.assertTrue('trace.mainBreaker shows I_total x 1.25 -> standard',
                 lay.bom.trace.mainBreaker.indexOf('601') >= 0 &&
                 lay.bom.trace.mainBreaker.indexOf('751.75') >= 0 &&
                 lay.bom.trace.mainBreaker.indexOf('800') >= 0);
    t.assertTrue('per-inverter trace cites cable m + OCPD',
                 lay.bom.acPerInverterBOM[0].trace.indexOf('OCPD') >= 0);
  }
});


registerTest({
  id: 'UNIT_CALC_LAYOUT_DC_WIRE_FALLBACK',
  group: 'unit',
  module: 'calc/layout',
  scenarios: [],
  tags: ['calc', 'layout', 'bom', 'dc', 'fallback'],
  source: 'tests_unit/calc/CalcLayoutDcWireTests.gs',
  fn: function (t) {
    t.suite('calcLayout DC wire -- geometry ESTIMATE fallback');
    var f = _layoutDcWireFixture(0);     // no Helioscope wire length
    var lay = calcLayout(f.inp, f.dc, f.ac);

    t.assert('basis is ESTIMATE', 'ESTIMATE', lay.bom.dcCableBasis);
    // Pass 2 formula preserved verbatim: strings × 2 × estimateDcRunM × spare.
    t.assert('dcCableM = geometry estimate',
             Math.ceil(31 * 2 * 214 * 1.2), lay.bom.dcCableM);
  }
});
