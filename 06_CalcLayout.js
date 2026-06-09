// =============================================================================
// ARGIA ENGINE v7 — File: 06_CalcLayout.gs
// Section 6.0 — Layout scaling & BOM quantity engine.
// Derives cable lengths, conduit runs, and quantities from layout geometry.
// =============================================================================

// ---------------------------------------------------------------------------
// Pass 2 / Pass 4 shared, PURE geometry + BOM helpers. Defined at module scope
// so calcDC (04) and calcAC (05) can use them too -- the run lengths must be
// geometry-aware in those files for the voltage-drop sizing, not only in the
// BOM. No spreadsheet access, so all four are unit-testable.
// ---------------------------------------------------------------------------

// Vertical rise from the array plane to the inverter / electrical room. The old
// flat distance model ignored it entirely. Code default; promote to a per-
// project INPUT_DESIGN field (roofToInverterDropM) in a later pass if needed --
// it is already honoured here when present on inp.
var ROOF_TO_INVERTER_DROP_M = 5;

// Optimizers (MLPE) per module for OPTIMIZER-topology inverters. SolarEdge
// commercial is commonly 1 optimizer per module; some S-series cover 2. Tune to
// the selected optimizer model.
var OPTIMIZER_MODULES_PER_UNIT = 1;

// Procurement waste/slack applied to the Helioscope-measured DC wire length when
// it is used directly for the BOM (cuts, terminations, routing not in the model).
// Tunable like the constants above; promote to an INPUT field later if needed.
var DC_WIRE_WASTE_FACTOR = 1.05;

// Array footprint and dimensions from the real module area. Single source of
// truth used by calcDC (stash), calcAC and calcLayout.
function estimateArrayGeometry(inp, panelAreaM2) {
  var area      = (panelAreaM2 > 0) ? panelAreaM2 : 2.2;
  var grossArea = area * (Number(inp.panelQty) || 0) * (Number(inp.walkwayFactor) || 1);
  var arrayLength, arrayWidth;
  if (inp.layoutRows > 0 && inp.layoutCols > 0 && inp.rowPitch > 0) {
    arrayLength = inp.layoutRows * inp.rowPitch;          // rows x pitch
    arrayWidth  = arrayLength > 0 ? grossArea / arrayLength : 0;
  } else {
    arrayLength = Math.sqrt(grossArea / (Number(inp.aspectRatio) || 1));
    arrayWidth  = arrayLength > 0 ? grossArea / arrayLength : 0;
  }
  return { grossArea: grossArea, arrayLength: arrayLength, arrayWidth: arrayWidth,
           perimeterM: 2 * (arrayWidth + arrayLength) };
}

// Average DC string home-run length (m): flat to-inverter/corridor base + the
// vertical rise + the average in-array cabling distance, which scales with
// array size. The old model was a flat distInverter + stationCorridorM that
// ignored both, so far strings on a large roof were badly under-measured.
function estimateDcRunM(inp, geo) {
  var base    = (Number(inp.distInverter) || 0) + (Number(inp.stationCorridorM) || 0);
  var drop    = (inp.roofToInverterDropM > 0) ? Number(inp.roofToInverterDropM) : ROOF_TO_INVERTER_DROP_M;
  var walkway = (Number(inp.walkwayFactor) || 1);
  var inArray = (((geo.arrayLength || 0) + (geo.arrayWidth || 0)) / 4) * walkway;
  return base + drop + inArray;
}

// Average AC branch length per inverter (m): inverter->AC panel base + vertical
// rise + a spread term (inverter stations are distributed across the array, so
// the average branch grows with array length and shrinks with station count).
function estimateAcRunM(inp, geo) {
  var base     = (Number(inp.distInverter) || 0) + (Number(inp.distAcProt) || 0);
  var drop     = (inp.roofToInverterDropM > 0) ? Number(inp.roofToInverterDropM) : ROOF_TO_INVERTER_DROP_M;
  var stations = Math.max(Number(inp.invStations) || 1, 1);
  var spread   = ((geo.arrayLength || 0) / 2) * (Number(inp.walkwayFactor) || 1) / stations;
  return base + drop + spread;
}

// Optimizer (MLPE) unit count for the BOM. 0 unless an OPTIMIZER-topology
// inverter is present; otherwise ceil(modules / modulesPerUnit).
function computeOptimizerUnits(hasOptimizer, panelQty, modulesPerUnit) {
  if (!hasOptimizer) return 0;
  var per = (modulesPerUnit > 0) ? modulesPerUnit : 1;
  return Math.ceil((Number(panelQty) || 0) / per);
}

function calcLayout(inp, dc, ac) {
  const lay = {};

  // ── Array geometry ─────────────────────────────────────────────────────────
  // Total module area (m²) = panel area × qty
  // Array geometry: prefer the values computed once in calcDC (single source of
  // truth, built from the real panel area). Fall back to a local estimate for
  // any caller that doesn't stash geometry on dc.
  const _geo = (dc && dc.arrayLength > 0)
    ? { grossArea: dc.grossArea, arrayLength: dc.arrayLength, arrayWidth: dc.arrayWidth }
    : estimateArrayGeometry(inp, (dc && dc.panelAreaM2 > 0) ? dc.panelAreaM2
                                 : (inp.panelAreaM2 > 0 ? inp.panelAreaM2 : 2.2));
  const grossArea  = _geo.grossArea;
  const arrayLength = _geo.arrayLength;
  const arrayWidth  = _geo.arrayWidth;
  lay.grossArea   = grossArea;
  lay.arrayWidth  = arrayWidth;
  lay.arrayLength = arrayLength;

  // ── DC string / PV-wire length ─────────────────────────────────────────────
  // PREFERRED: total conductor length measured by Helioscope (inp.dcStringWireM,
  //   from C29). It already reflects the real array geometry, stringing strategy
  //   and inverter placement — which the geometry estimate cannot capture on
  //   dispersed layouts. It is the TOTAL conductor (return path included), so it
  //   is used directly × a small waste factor — NOT × 2 and NOT × stringsTotal.
  // FALLBACK (no Helioscope wire length): geometry estimate, flagged ESTIMATE.
  //   strings × 2 × estimateDcRunM × spare. dc.dcLength is estimateDcRunM(inp,geo)
  //   from calcDC, left unchanged so voltage-drop / Pass 2 behaviour is preserved.
  const avgStringRunM  = dc.dcLength; // estimateDcRunM — drives vdrop + fallback
  let totalDCCableM, dcCableBasis;
  if (inp.dcStringWireM > 0) {
    totalDCCableM = inp.dcStringWireM * DC_WIRE_WASTE_FACTOR;
    dcCableBasis  = 'HELIOSCOPE';
  } else {
    totalDCCableM = inp.stringsTotal * 2 * avgStringRunM * inp.dcSpareFactor;
    dcCableBasis  = 'ESTIMATE';
  }
  lay.avgStringRunM    = avgStringRunM;
  lay.totalDCCableM    = totalDCCableM;
  lay.dcCableBasis     = dcCableBasis;
  lay.dcWireSourceM    = inp.dcStringWireM || 0;

  // DC grounding cable: perimeter of array × spare factor
  const perimeterM     = 2 * (arrayWidth + arrayLength);
  const groundingDCM   = perimeterM * inp.dcSpareFactor;
  lay.perimeterM       = perimeterM;
  lay.groundingDCM     = inp.groundingLen > 0 ? inp.groundingLen : groundingDCM;

  // ── AC cable lengths (scaled) ──────────────────────────────────────────────
  // AC per inverter: inverter → AC panel → grid
  // Total AC cable = inverter_types × qty × phases × run_length × spare
  const invTypes     = ac.perInverter.length;
  let totalACCableM  = 0;
  ac.perInverter.forEach(inv => {
    const invObj  = { acLenInv: inv.acLenInv || 0 };
    const phases  = 3; // all inverters in this system are 3-phase or we count 3 conductors
    totalACCableM += inv.qty * phases * inv.acLenInv * inp.acSpareFactor;
  });
  lay.totalACCableM = totalACCableM;

  // Main feeder cable: from AC panel to grid. Three phase conductors PER
  // parallel run. calcAC already sizes the conductor/conduit for
  // ac.parallelRuns; the cable QUANTITY must include the same multiplier or the
  // most expensive copper in the BOM is undercounted by the run factor.
  const parallelRuns = ac.parallelRuns || 1;
  const feederCableM = ac.feederLen * 3 * parallelRuns * inp.acSpareFactor;
  lay.feederCableM   = feederCableM;

  // ── Conduit lengths (scaled) ───────────────────────────────────────────────
  // DC conduit: trench from array to inverter stations
  const dcConduitM  = (avgStringRunM * inp.invStations) * inp.dcSpareFactor;
  lay.dcConduitM    = dcConduitM;

  // AC conduit: inverter stations to AC panel
  const acConduitM  = ac.feederLen * inp.acSpareFactor;
  lay.acConduitM    = acConduitM;

  // ── BOM quantities summary ─────────────────────────────────────────────────
  lay.bom = {
    // DC
    dcCableM        : Math.ceil(totalDCCableM),
    dcCableBasis    : dcCableBasis,        // 'HELIOSCOPE' | 'ESTIMATE'
    dcGroundingM    : Math.ceil(lay.groundingDCM),
    dcConduitM      : Math.ceil(dcConduitM),
    dcOcpdUnits     : inp.stringsTotal,  // 1 OCPD per string
    mc4Pairs        : inp.stringsTotal,  // 1 pair per string end
    rsdRequired     : inp.projectType === 'ROOF',
    optimizerUnits  : computeOptimizerUnits(dc && dc.hasOptimizerTopology,
                                            inp.panelQty, OPTIMIZER_MODULES_PER_UNIT),

    // AC per inverter type
    acPerInverterBOM: ac.perInverter.map(inv => ({
      model          : inv.model,
      qty            : inv.qty,
      ocpdA          : inv.ocpd,
      conductorSize  : inv.conductor,
      egcSize        : inv.egc,
      conduitSize    : inv.conduit,
      cableM         : Math.ceil(inv.qty * 3 * inv.acLenInv * inp.acSpareFactor),
      egcM           : Math.ceil(inv.qty * inv.acLenInv * inp.acSpareFactor),
    })),

    // Main feeder
    mainBreakerA    : ac.mainBreaker,
    mainConductor   : ac.condMain,
    mainEgc         : ac.egcMain,
    mainConduit     : ac.conduitMain,
    mainFeederCableM: Math.ceil(feederCableM),
    mainEgcM        : Math.ceil(ac.feederLen * (ac.parallelRuns || 1) * inp.acSpareFactor),
    transformer     : ac.transformer,

    // Layout check
    areaRequired    : inp.areaRequired,
    availableSpace  : inp.availableSpace,
    areaPass        : inp.availableSpace >= inp.areaRequired || inp.areaRequired === 0,
  };

  // ── Derivation traces (MEMORIA / CÁLCULO) ──────────────────────────────────
  // Human-readable "why this number" per derived BOM line, mirroring the MDC
  // formula column. Built here where every intermediate is in scope so the BOM
  // writer renders real arithmetic, not hand-waving.
  function _r(x) { return Math.round((Number(x) || 0) * 100) / 100; }
  lay.bom.trace = {
    dcCable: (dcCableBasis === 'HELIOSCOPE')
      ? 'Helioscope ' + _r(inp.dcStringWireM) + ' m × ' + DC_WIRE_WASTE_FACTOR +
        ' merma = ' + Math.ceil(totalDCCableM) + ' m'
      : inp.stringsTotal + ' strings × 2 × ' + _r(avgStringRunM) + ' m/run × ' +
        inp.dcSpareFactor + ' merma = ' + Math.ceil(totalDCCableM) +
        ' m (geometría — sin import Helioscope)',
    dcGrounding: (inp.groundingLen > 0)
      ? 'Puesta a tierra INPUT_DESIGN = ' + inp.groundingLen + ' m (override)'
      : 'Perímetro 2×(' + _r(arrayWidth) + '+' + _r(arrayLength) + ') m × ' +
        inp.dcSpareFactor + ' merma = ' + Math.ceil(groundingDCM) + ' m',
    mc4:    inp.stringsTotal + ' strings → 1 par MC4 por string',
    dcOcpd: inp.stringsTotal + ' strings → 1 fusible por string',
    dcConduit: _r(avgStringRunM) + ' m/run × ' + inp.invStations + ' estación(es) × ' +
        inp.dcSpareFactor + ' merma = ' + Math.ceil(dcConduitM) + ' m → ÷ 3 m/tramo',
    feeder: 'L_feeder ' + _r(ac.feederLen) + ' m × 3 fases × ' + parallelRuns +
        ' corrida(s) × ' + inp.acSpareFactor + ' merma = ' + Math.ceil(feederCableM) + ' m',
    mainEgc: 'L_feeder ' + _r(ac.feederLen) + ' m × ' + parallelRuns +
        ' corrida(s) × ' + inp.acSpareFactor + ' merma = ' + Math.ceil(lay.bom.mainEgcM) + ' m',
    mainBreaker: (ac.iTotalAC > 0)
      ? 'I_total ' + _r(ac.iTotalAC) + ' A × 1.25 = ' + _r(ac.iTotalAC * 1.25) +
        ' A → estándar ' + ac.mainBreaker + ' A'
      : 'Estándar ≥ I_total × 1.25 = ' + ac.mainBreaker + ' A',
    // ── newly traced lines (previously blank MEMORIA) ──────────────────────
    structureInverter: (inp.totalInverters || (ac.perInverter ? ac.perInverter.length : 0)) +
        ' inversores → 1 estructura/rack de montaje por inversor',
    mainConduit: 'Cable alim. ' + Math.ceil(feederCableM) + ' m ÷ 3 fases = ' +
        Math.ceil(feederCableM / 3) + ' m físicos ÷ 3 m/tramo',
    panelboard: '1 tablero AC; marco ≥ breaker principal ' + ac.mainBreaker + ' A',
    transformer: '1 unidad — suministro de transformador (INPUT_DESIGN config); ' +
        'capacidad ≥ kVA del proyecto',
    serviceLine: 'Línea fija de servicio — 1 por proyecto',
  };
  lay.bom.acPerInverterBOM.forEach(function (b) {
    var lInv = _r(b.cableM / ((b.qty || 1) * 3 * (inp.acSpareFactor || 1)));
    b.trace = b.qty + ' inv × 3 fases × ' + lInv + ' m/inv × ' + inp.acSpareFactor +
              ' merma = ' + b.cableM + ' m  |  OCPD ' + b.ocpdA + ' A (I_AC × 1.25 → estándar)';
    b.traceEgc     = 'EGC NOM 250.122 (' + b.egcSize + ') — ' + b.qty + ' inv × ' +
                     lInv + ' m/inv × ' + inp.acSpareFactor + ' merma = ' + b.egcM + ' m';
    b.traceBreaker = 'OCPD ' + b.ocpdA + ' A (I_AC × 1.25 → estándar) — ' + b.qty + ' pcs';
    b.traceConduit = 'Conduit ' + b.conduitSize + '" — ' + lInv +
                     ' m físicos/inv × ' + b.qty + ' inv ÷ 3 m/tramo';
  });

  // ── Scaling status ─────────────────────────────────────────────────────────
  const areaOk = lay.bom.areaPass;
  lay.statusScaling = areaOk
    ? `✅ PASS — Área disponible (${inp.availableSpace}m²) ≥ requerida (${inp.areaRequired}m²)`
    : `⚠️ REVIEW — Área disponible (${inp.availableSpace}m²) < requerida (${inp.areaRequired}m²)`;

  return lay;
}
