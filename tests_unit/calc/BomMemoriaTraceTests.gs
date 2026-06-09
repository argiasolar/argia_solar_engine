// =============================================================================
// ARGIA TESTS -- tests_unit/calc/BomMemoriaTraceTests.gs
// -----------------------------------------------------------------------------
// Guards the BOM MEMORIA / CÁLCULO trace coverage (BOM_v2 column I).
//
// Background: several BOM lines used to ship with a BLANK MEMORIA column
// (Conduit principal, Tablero/panelboard, Estructura inversores, per-inverter
// EGC/breaker/conduit, Transformador, Monitoreo/permisos). calcLayout() now
// produces a trace string for every one of them. This test locks that in:
// if a future edit drops one of the trace keys, the suite fails instead of
// silently shipping a blank derivation cell again.
//
// Pure logic: calcLayout() only — no spreadsheet I/O.
// =============================================================================

function _bomMemoriaFixture() {
  var inp = {
    panelQty: 960, walkwayFactor: 1.2, layoutRows: 8, layoutCols: 2, rowPitch: 3.0,
    aspectRatio: 1.5, dcStringWireM: 5820, stringsTotal: 31, dcSpareFactor: 1.2,
    groundingLen: 80, acSpareFactor: 1.2, invStations: 1, areaRequired: 0,
    availableSpace: 5000, totalInverters: 5
  };
  var dc = {
    dcLength: 214, panelAreaM2: 2.2, grossArea: 2534.4, arrayLength: 24,
    arrayWidth: 105.6, hasOptimizerTopology: true
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
  id: 'UNIT_BOM_MEMORIA_TRACE_COVERAGE',
  group: 'unit',
  module: 'calc/layout',
  scenarios: [],
  tags: ['calc', 'layout', 'bom', 'memoria', 'trace'],
  source: 'tests_unit/calc/BomMemoriaTraceTests.gs',
  fn: function (t) {
    t.suite('calcLayout -- BOM MEMORIA trace coverage');
    var f   = _bomMemoriaFixture();
    var lay = calcLayout(f.inp, f.dc, f.ac);
    var tr  = (lay.bom && lay.bom.trace) || {};

    // 1) section-level lines that previously shipped blank now carry a trace.
    var required = ['dcCable', 'dcGrounding', 'mc4', 'dcOcpd', 'dcConduit',
                    'feeder', 'mainEgc', 'mainBreaker',
                    'structureInverter', 'mainConduit', 'panelboard',
                    'transformer', 'serviceLine'];
    required.forEach(function (k) {
      t.assertTrue('trace.' + k + ' is a non-empty string',
        typeof tr[k] === 'string' && tr[k].trim().length > 0);
    });

    // 2) per-inverter blocks: cable + EGC + breaker + conduit all traced.
    var per = (lay.bom && lay.bom.acPerInverterBOM) || [];
    t.assertTrue('at least one per-inverter block present', per.length > 0);
    per.forEach(function (b, i) {
      ['trace', 'traceEgc', 'traceBreaker', 'traceConduit'].forEach(function (key) {
        t.assertTrue('per-inverter[' + i + '].' + key + ' non-empty',
          typeof b[key] === 'string' && b[key].trim().length > 0);
      });
    });

    // 3) sanity: the new strings contain real arithmetic / drivers, not a stub.
    t.assertTrue('mainConduit references "tramo"',  tr.mainConduit.indexOf('tramo') >= 0);
    t.assertTrue('panelboard references the breaker', tr.panelboard.indexOf('800') >= 0);
    t.assertTrue('structureInverter references inverters',
      tr.structureInverter.indexOf('5') >= 0);
  }
});
