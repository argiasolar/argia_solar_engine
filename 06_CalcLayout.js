// =============================================================================
// ARGIA ENGINE v7 — File: 06_CalcLayout.gs
// Section 6.0 — Layout scaling & BOM quantity engine.
// Derives cable lengths, conduit runs, and quantities from layout geometry.
// =============================================================================

function calcLayout(inp, dc, ac) {
  const lay = {};

  // ── Array geometry ─────────────────────────────────────────────────────────
  // Total module area (m²) = panel area × qty
  // Panel area precedence: real module dimensions from the panel DB (computed
  // by calcDC as PANEL_LENGTH x PANEL_WIDTH and stashed on dc) > explicit
  // inp.panelAreaM2 override > 2.2 m² last-resort fallback. The old code always
  // hit 2.2 because inp.panelAreaM2 is hardcoded 0 upstream, understating area
  // ~20% for modern >=600W modules and shrinking every area-derived quantity.
  const panelAreaM2   = (dc && dc.panelAreaM2 > 0) ? dc.panelAreaM2
                      : (inp.panelAreaM2 > 0 ? inp.panelAreaM2 : 2.2);
  const grossArea     = panelAreaM2 * inp.panelQty * inp.walkwayFactor;
  lay.grossArea       = grossArea;

  // Array dimensions from aspect ratio W/L
  // If layoutRows/Cols are filled, use them directly to compute actual dimensions
  let arrayWidth, arrayLength;
  if (inp.layoutRows > 0 && inp.layoutCols > 0 && inp.rowPitch > 0) {
    // Rows × pitch = length; Cols × panel_width ≈ width (estimate 1m per col)
    arrayLength = inp.layoutRows * inp.rowPitch;
    arrayWidth  = grossArea / arrayLength;
  } else {
    // Derive from aspect ratio
    arrayLength = Math.sqrt(grossArea / inp.aspectRatio);
    arrayWidth  = grossArea / arrayLength;
  }
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
