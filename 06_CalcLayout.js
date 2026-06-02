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

  // ── DC cable lengths (scaled) ──────────────────────────────────────────────
  // DC string homerun = distance from string junction to inverter
  // Estimated: station-to-corridor + inverter-to-cabinet distances
  // Total DC cable = strings × 2 conductors × avg string run × spare factor
  const avgStringRunM  = dc.dcLength; // as computed in calcDC
  const totalDCCableM  = inp.stringsTotal * 2 * avgStringRunM * inp.dcSpareFactor;
  lay.avgStringRunM    = avgStringRunM;
  lay.totalDCCableM    = totalDCCableM;

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

  // ── Scaling status ─────────────────────────────────────────────────────────
  const areaOk = lay.bom.areaPass;
  lay.statusScaling = areaOk
    ? `✅ PASS — Área disponible (${inp.availableSpace}m²) ≥ requerida (${inp.areaRequired}m²)`
    : `⚠️ REVIEW — Área disponible (${inp.availableSpace}m²) < requerida (${inp.areaRequired}m²)`;

  return lay;
}
