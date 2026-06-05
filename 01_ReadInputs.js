// =============================================================================
// ARGIA ENGINE v7 -- File: 01_ReadInputs.gs
// Reads INPUT_GENERAL, INPUT_PROJECT, INPUT_INSTALL, INPUT_DESIGN by
// logical keys via readInput() / INPUT_MAP. Returns a flat 'inputs' object
// used by all calc functions.
// =============================================================================

// ---------------------------------------------------------------------------
// resolveBessCoupling -- normalize the INPUT_DESIGN!C17 coupling value.
// 'AC_COUPLED' (case/whitespace tolerant) -> 'AC_COUPLED'.
// Anything else -- blank, unknown, null -> 'DC_COUPLED' (the safe default:
// battery on the shared PV DC bus, no extra AC busbar contribution).
// Pure function, no spreadsheet I/O, so it is directly unit-testable.
// ---------------------------------------------------------------------------
function resolveBessCoupling(raw) {
  var v = String(raw || '').trim().toUpperCase();
  return (v === 'AC_COUPLED') ? 'AC_COUPLED' : 'DC_COUPLED';
}

function readInputs(ss) {
  // -- INPUT_PROJECT -- via INPUT_MAP / readInput() --------------------------
  // Migrated from legacy INPUT_GENERAL col C on 2026-04-24 (Track A, Path C2).
  // Legacy INPUT_GENERAL sheet still exists and is still populated by the
  // fixture for backwards compatibility with ProjectCard / RFQ writers that
  // read it directly. When those writers migrate, INPUT_GENERAL can be retired.

  const projectName   = readInput(ss, 'projectName')   || '';
  const clientName    = readInput(ss, 'clientName')    || '';
  const contact       = readInput(ss, 'contact')       || '';
  const street        = readInput(ss, 'street')        || '';
  const city          = readInput(ss, 'city')          || '';
  const state         = readInput(ss, 'state')         || '';
  const dateCreation  = readInput(ss, 'dateOffer')     || new Date();
  const bizManager    = readInput(ss, 'bizManager')    || '';
  const designer      = readInput(ss, 'designer')      || '';
  const businessType  = readInput(ss, 'businessType')  || 'PPA_ROOF';

  // -- INPUT_DESIGN -- Helioscope monthly table via range read --------------
  // New layout (Phase 2a, 2026-04-24): rows 43-54, cols B-G.
  //   col B=abbr, C=ghi, D=poa, E=shaded, F=nameplateKwh, G=gridKwh
  const months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  const monthlyRows = readInput(ss, 'helioscopeMonthly');   // 12 × 6 array
  const helio = monthlyRows.map(function(r, i) {
    return {
      month     : r[0] || months[i],
      ghi       : r[1],
      poa       : r[2],
      shaded    : r[3],
      nameplate : r[4],
      grid      : r[5]
    };
  });
  const annualProduction = readInput(ss, 'annualKwh') || 0;

  // -- INPUT_DESIGN -- engine electrical inputs via readInput() --------------
  // New layout (Phase 2a): compact two-column grid rows 8-28.
  //   Left column  (col C):  §01 AMBIENTE, §02 ELÉCTRICOS, §03 DISTANCIAS
  //   Right column (col I):  §04 GEOMETRÍA, §05 LAYOUT OVERRIDE, §06 BOM

  const minTemp          = readInput(ss, 'minTemp');
  const maxTemp          = readInput(ss, 'maxTemp');
  const avgTemp          = readInput(ss, 'avgTemp');
  const roofClearanceMm  = readInput(ss, 'roofClearanceMm');

  const _xfmrRaw = readInput(ss, 'supplyTransformer');
  const supplyTransformer = (parseFloat(_xfmrRaw) !== 0) ? 1 : 0;

  const dcVdropLimit     = readInput(ss, 'dcVdropLimit');
  const acVdropLimit     = readInput(ss, 'acVdropLimit');
  const powerFactor      = readInput(ss, 'powerFactor');
  const tempCoeffOverride= readInput(ss, 'tempCoeffVocOverride');

  // BESS coupling (INPUT_DESIGN C17). Blank/unknown -> DC_COUPLED (the safe
  // default: a battery on the shared PV DC bus, no extra AC busbar load).
  const bessCoupling     = resolveBessCoupling(readInput(ss, 'bessCoupling'));

  // Pass 5a: vertical roof->inverter cable drop (m). Optional INPUT_DESIGN
  // field; when blank/0 the layout calc falls back to ROOF_TO_INVERTER_DROP_M.
  const roofToInverterDropM = readInput(ss, 'roofToInverterDropM');
  const dcStringWireM    = readInput(ss, 'dcStringWireM');

  const distInverter     = readInput(ss, 'distInverter');
  const distAcProt       = readInput(ss, 'distAcProt');
  const distGrid         = readInput(ss, 'distGrid');
  const groundingLen     = readInput(ss, 'groundingLen');

  const areaRequired     = readInput(ss, 'areaRequired');
  const availableSpace   = readInput(ss, 'availableSpace');
  const aspectRatio      = readInput(ss, 'aspectRatio');
  const invStations      = readInput(ss, 'invStations');
  const rowPitch         = readInput(ss, 'rowPitch');
  const walkwayFactor    = readInput(ss, 'walkwayFactor');
  const dcSpareFactor    = readInput(ss, 'dcSpareFactor');
  const acSpareFactor    = readInput(ss, 'acSpareFactor');
  const feederExtraM     = readInput(ss, 'feederExtraM');
  const stationCorridorM = readInput(ss, 'stationCorridorM');
  const projectType      = String(readInput(ss, 'projectType') || 'ROOF').trim();
  const roofType         = String(readInput(ss, 'roofType') || '').trim();
  const structure        = String(readInput(ss, 'structure') || '').trim();
  const structure2       = String(readInput(ss, 'structureSecondary') || '').trim();

  const layoutRows       = readInput(ss, 'layoutRows');
  const layoutCols       = readInput(ss, 'layoutCols');

  // Mid/end distances: deprecated in new layout. Default to 0. (Was legacy
  // INPUT_DESIGN!N42/N43 — removed in new layout. Engine fallback behaviour
  // is the same as it has always been when these were blank.)
  const layoutMidDist    = 0;
  const layoutEndDist    = 0;

  // -- INPUT_DESIGN -- Equipment block: panels ------------------------------
  // Primary panel at row 50 (C=model, D=qty, E=Wp).
  // Secondary panels at rows 51-54 (up to 4 more types, info only).
  const panelModel   = readInput(ss, 'panelModel');
  const panelQty     = parseInt(readInput(ss, 'panelQty')) || 0;
  const panelPowerW  = parseFloat(readInput(ss, 'panelPowerW')) || 0;
  const panelAreaM2  = 0;  // deprecated: legacy col H slot, not in new layout

  const secondaryPanelRows = readInput(ss, 'panelsSecondary');  // 4 × 3 array
  const secondaryPanels = [];
  secondaryPanelRows.forEach(function(row) {
    var model = row[0];
    var qty   = parseInt(row[1]) || 0;
    var wp    = parseFloat(row[2]) || 0;
    if (model && qty > 0) {
      secondaryPanels.push({ model: model, qty: qty, powerW: wp });
    }
  });

  // -- INPUT_DESIGN -- Equipment block: inverters ---------------------------
  // Primary inverter at row 58 (C=model, D=qty, E=kW, F=strings).
  // Secondary inverters at rows 59-62 (up to 4 more types).
  // Totals at row 63 (D=totalInverters, E=totalStrings).
  const inverterBank = [];
  const primModel = readInput(ss, 'inverterPrimaryModel');
  const primQty   = parseInt(readInput(ss, 'inverterPrimaryQty')) || 0;
  const primKw    = parseFloat(readInput(ss, 'inverterPrimaryKw')) || 0;
  const primStr   = parseInt(readInput(ss, 'inverterPrimaryStrings')) || 0;
  if (primModel && primQty > 0) {
    inverterBank.push({ label: '', model: primModel, qty: primQty, powerKw: primKw, stringsAssigned: primStr });
  }

  const secondaryInverterRows = readInput(ss, 'invertersSecondary');  // 4 × 4 array
  secondaryInverterRows.forEach(function(row) {
    var model = row[0];
    var qty   = parseInt(row[1]) || 0;
    var kw    = parseFloat(row[2]) || 0;
    var strs  = parseInt(row[3]) || 0;
    if (model && qty > 0) {
      inverterBank.push({ label: '', model: model, qty: qty, powerKw: kw, stringsAssigned: strs });
    }
  });

  const totalInverters = parseInt(readInput(ss, 'totalInverters')) || 0;
  const totalStrings   = parseInt(readInput(ss, 'totalStrings')) || 0;

  // -- INPUT_DESIGN -- String config -----------------------------------------
  const stringsTotal     = parseInt(readInput(ss, 'stringsTotal')) || 0;
  const modsPerString    = parseInt(readInput(ss, 'modsPerString')) || 0;
  const parallelStrings  = parseInt(readInput(ss, 'parallelStrings')) || 1;

  // String wire name / length were helioscope extras — in new layout these
  // are part of the secondary inverter notes (col G). Not user-editable.
  // Default to empty/zero. BOM writer doesn't rely on them currently.
  const stringWireName    = '';
  const stringWireLengthM = 0;

  return {
    // Identity
    projectName, clientName, contact, street, city, state,
    dateCreation, bizManager, designer, businessType,

    // Panel
    panelModel, panelQty, panelPowerW, panelAreaM2, secondaryPanels,

    // Inverters
    inverterBank, totalInverters, totalStrings,

    // String config
    stringsTotal, modsPerString, parallelStrings,
    stringWireName, stringWireLengthM,

    // Environment
    minTemp, maxTemp, avgTemp, roofClearanceMm, projectType, roofType, structure, structure2,

    // BOM config flags
    supplyTransformer,
    tempCoeffOverride,

    // Electrical design limits
    dcVdropLimit, acVdropLimit, powerFactor,
    bessCoupling,

    // Distances (metres)
    distInverter, distAcProt, distGrid, groundingLen, roofToInverterDropM, dcStringWireM,

    // Layout
    areaRequired, availableSpace, aspectRatio,
    invStations, layoutRows, layoutCols,
    rowPitch, walkwayFactor, dcSpareFactor, acSpareFactor,
    feederExtraM, stationCorridorM,
    layoutMidDist, layoutEndDist,

    // Production
    helio, annualProduction,
  };
}