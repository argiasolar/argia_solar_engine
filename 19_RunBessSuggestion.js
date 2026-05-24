// =============================================================================
// ARGIA ENGINE -- File: 19_RunBessSuggestion.gs   (BDF-1)
// Orchestrator for the "Suggest BESS" designer flow.
//
// PURPOSE
//   Wire the existing calcBessSizing pure calculator to live spreadsheet
//   inputs and produce a ranked recommendation table. This is the FIRST
//   production caller of calcBessSizing (the calculator existed library-only
//   before BDF-1).
//
// DESIGN
//   - Pure orchestrator. Reads inputs (INPUT_CFE, INPUT_BESS, 16M_PRODUCTS_BESS),
//     assembles opts, calls calcBessSizing, attaches tariff-source provenance,
//     returns the result. Does NOT touch the sheet output (that is the writer's
//     job in step 2 of BDF-1).
//   - Tariff source: auto-derive from INPUT_CFE row 25/27 (already-billed MXN
//     per kWh), with INPUT_BESS override cells taking precedence when set.
//     This avoids building a full CFE tariff resolver for BDF-1 -- a worthy
//     chunk on its own.
//   - Returns null when the project lacks the inputs to size (no INPUT_CFE
//     load data, no battery catalog, etc.). Caller decides how to surface.
//
// CALLER
//   onMenuSuggestBess() in 00_Main.js -- triggered by the "▶ Suggest BESS"
//   menu item. Caller then passes the result to writeBessRecommendations.
//
// TESTS
//   tests_integration/calc/RunBessSuggestionTests.gs (Phase BDF-1)
//   tests_regression/v2/BdfCulliganRecommendationTests.gs (Phase BDF-1 baseline)
// =============================================================================

// ---------------------------------------------------------------------------
// suggestBessSizing(ss, opts?) -> result | null
//
// @param {Spreadsheet} ss
// @param {Object}      [opts]   override knobs for tests (production passes none)
//   opts.puntaWindowHours   number  override punta window (default 4)
//   opts.shaveMode          string  BESS_SHAVE_MODE.* (default AUTO)
//
// @return result | null
//   {
//     siteSummary: { maxMonthlyPuntaKw, avgMonthlyPuntaKwh, monthsAnalyzed },
//     candidates: [ ... ],
//     recommendation: { ... } | null,
//     warnings: [ ... ],
//     tariff: {
//       puntaMxnPerKwh, baseMxnPerKwh, demandChargeMxnPerKw,
//       puntaSource:   'INPUT_BESS_OVERRIDE' | 'INPUT_CFE_DERIVED' | 'MISSING',
//       baseSource:    'INPUT_BESS_OVERRIDE' | 'INPUT_CFE_DERIVED' | 'MISSING',
//       demandSource:  'INPUT_CFE_DERIVED' | 'MISSING',
//       monthsRead,
//     },
//     batteryCatalog: { count, source: '16M_PRODUCTS_BESS' },
//     blocked: false | string  -- if truthy, why suggestion couldn't run
//   }
//   When blocked, candidates/recommendation/warnings are still present but empty.
// ---------------------------------------------------------------------------
function suggestBessSizing(ss, opts) {
  ss = ss || SpreadsheetApp.getActive();
  opts = opts || {};

  // -- Assemble the load profile (from INPUT_CFE) --------------------------
  var profile = buildBessLoadProfileFromInputCfe(ss);
  if (!profile.months || profile.months.length === 0) {
    return _bessBlocked('No usable monthly load data in INPUT_CFE. '
      + 'Need at least one month with kWh punta > 0 and kW punta > 0.');
  }

  // -- Resolve tariff rates (auto-derive then override) --------------------
  var auto     = deriveBessTariffRatesFromInputCfe(ss);
  var override = readInputBessTariffOverride(ss);
  var puntaRate, baseRate, puntaSource, baseSource;
  if (override.punta != null) {
    puntaRate   = override.punta;
    puntaSource = 'INPUT_BESS_OVERRIDE';
  } else if (auto.puntaMxnPerKwh > 0) {
    puntaRate   = auto.puntaMxnPerKwh;
    puntaSource = 'INPUT_CFE_DERIVED';
  } else {
    puntaRate   = 0;
    puntaSource = 'MISSING';
  }
  if (override.base != null) {
    baseRate   = override.base;
    baseSource = 'INPUT_BESS_OVERRIDE';
  } else if (auto.baseMxnPerKwh > 0) {
    baseRate   = auto.baseMxnPerKwh;
    baseSource = 'INPUT_CFE_DERIVED';
  } else {
    baseRate   = 0;
    baseSource = 'MISSING';
  }

  // -- Demand-charge rate (no override mechanism for BDF-1; can add later) -
  var demandInfo = deriveBessDemandChargeFromInputCfe(ss);
  var demandRate    = demandInfo.demandChargeMxnPerKw;
  var demandSource  = demandInfo.provenance === 'INPUT_CFE_DERIVED'
                    ? 'INPUT_CFE_DERIVED' : 'MISSING';

  // -- BDF-2: Interconnection mode + PV surplus ----------------------------
  // Mode comes from INPUT_CFE row 41; PV surplus from CFE_SIMULATION row 42.
  // CFE_SIMULATION may not yet be populated on a fresh project (PV step
  // hasn't run). In that case pvAnnualSurplusKwh = 0 and the BDF-2 math
  // gracefully falls back to grid-base charging (BDF-1 behavior).
  var interconn = readBessInterconnectionFromInputCfe(ss);
  var pvSurplus = readPvAnnualSurplusFromCfeSimulation(ss);

  // -- BDF-3: Min-savings threshold + tariff overrides ---------------------
  // Threshold from INPUT_BESS row 37; tariff overrides (if non-blank) take
  // precedence over auto-derived rates above. Threshold 0 = disabled.
  var thresholdInfo = readBessMinSavingsThreshold(ss);
  var threshold     = thresholdInfo.thresholdMxn;

  // -- Battery catalog (from 16M_PRODUCTS_BESS) ----------------------------
  // getAllBatteryProducts may THROW on critical-duplicate headers in the DB.
  // We let it bubble -- the menu handler will catch and surface to the user.
  var raw = getAllBatteryProducts(ss);
  var lib = raw
    .filter(function(r) {
      return Number(r['Nominal_Capacity_kWh']) > 0
          && Number(r['Power_kW'])             > 0;
    })
    .map(function(r) {
      // BDF-4 stacking: parse Stackable + Max_Stack_Units columns. Defensive
      // defaults: missing/blank/malformed -> NOT stackable. Stackable=YES
      // with blank/0/negative Max_Stack_Units -> NOT stackable (warns via
      // engine but doesn't block). Only Stackable=YES with a positive
      // integer Max_Stack_Units enables stacking for that product.
      var stackableRaw = String(r['Stackable'] || '').trim().toUpperCase();
      var maxStackRaw  = Number(r['Max_Stack_Units']);
      var isStackable  = (stackableRaw === 'YES')
                      && isFinite(maxStackRaw)
                      && maxStackRaw >= 1;
      return {
        batteryId:         String(r['Battery_ID'] || '').trim(),
        capacityKwh:       Number(r['Nominal_Capacity_kWh']) || 0,
        powerKw:           Number(r['Power_kW']) || 0,
        installedCapexMxn: Number(r['Installed_CAPEX_MXN']) || 0,
        stackable:         isStackable,
        maxStackUnits:     isStackable ? Math.floor(maxStackRaw) : 1,
      };
    });
  if (lib.length === 0) {
    return _bessBlocked('No usable battery products in 16M_PRODUCTS_BESS. '
      + 'Check IMPORTRANGE link to MASTER_DB. CUSTOM_MANUAL alone is not enough.');
  }

  // -- Read deration knobs from INPUT_BESS via readInputBess (if available)
  // We use readInputBess if the project has BESS configured, else sane
  // defaults. This way "Suggest BESS" can run even on a fresh project
  // where the designer hasn't filled INPUT_BESS yet.
  var batterySpec;
  try {
    var bess = readInputBess(ss);
    if (bess) {
      batterySpec = {
        minSocPct:        bess.minSoc,
        maxSocPct:        bess.maxSoc,
        rtePct:           bess.rte,
        degradationPct:   bess.degradation,
        backupReservePct: bess.backupReserve,
        cyclesPerDay:     bess.cyclesPerDay || 1,
        puntaWindowHours: opts.puntaWindowHours
                          || bess.puntaWindowHoursWinter
                          || 4,
      };
    }
  } catch (_) { /* fall through to defaults */ }
  if (!batterySpec) {
    batterySpec = {
      minSocPct: 0.05, maxSocPct: 0.95, rtePct: 0.913,
      degradationPct: 0.025, backupReservePct: 0,
      cyclesPerDay: 1.0,
      puntaWindowHours: opts.puntaWindowHours || 4,
    };
  }

  // -- Run the sizer -------------------------------------------------------
  var result = calcBessSizing({
    loadProfile:           profile,
    goal:                  BESS_SIZING_GOAL.PEAK_SHAVING,
    shaveMode:             opts.shaveMode || BESS_SHAVE_MODE.AUTO,
    batterySpec:           batterySpec,
    demandChargeMxnPerKw:  demandRate,
    puntaRateMxnPerKwh:    puntaRate,
    baseRateMxnPerKwh:     baseRate,
    libraryProducts:       lib,
    // BDF-2: mode-aware energy-shift
    interconnMode:         interconn.mode,
    exportPriceMxnPerKwh:  interconn.exportPriceMxnPerKwh,
    pvAnnualSurplusKwh:    pvSurplus.annualSurplusKwh,
    // BDF-3: min-savings threshold
    minAnnualSavingMxn:    threshold,
    // capexMxnPerKwh intentionally omitted -- real prices on each library
    // product are authoritative for BDF-1. The ladder would get 0-cost.
  });

  // Attach the provenance bundle so the writer can display "rate came from X"
  result.tariff = {
    puntaMxnPerKwh:       puntaRate,
    baseMxnPerKwh:        baseRate,
    demandChargeMxnPerKw: demandRate,
    puntaSource:          puntaSource,
    baseSource:           baseSource,
    demandSource:         demandSource,
    monthsRead:           auto.monthsRead || 0,
  };
  // BDF-2 interconnection bundle for the writer
  result.interconnection = {
    mode:                  interconn.mode,
    exportPriceMxnPerKwh:  interconn.exportPriceMxnPerKwh,
    modeProvenance:        interconn.provenance,
    pvAnnualSurplusKwh:    pvSurplus.annualSurplusKwh,
    pvSurplusProvenance:   pvSurplus.provenance,
    pvSurplusMonthsRead:   pvSurplus.monthsRead,
  };
  // BDF-3 threshold bundle for the writer
  result.threshold = {
    thresholdMxn:  threshold,
    provenance:    thresholdInfo.provenance,  // 'INPUT_BESS' or 'DISABLED'
  };
  result.batteryCatalog = { count: lib.length, source: SH.BESS_MIRROR };
  result.blocked = false;
  return result;
}

// Helper: produce a uniform "blocked" result so the writer always knows
// what shape to expect.
function _bessBlocked(reason) {
  return {
    siteSummary:    null,
    candidates:     [],
    recommendation: null,
    warnings:       [],
    tariff:         null,
    batteryCatalog: null,
    blocked:        reason,
  };
}

// ---------------------------------------------------------------------------
// onMenuSuggestBess() -- menu handler for "▶ Suggest BESS"
// ---------------------------------------------------------------------------
// Wired in 00_Main.js onOpen(). Designer clicks once, gets a populated
// BESS_RECOMMENDATIONS sheet (the active sheet switches to it).
//
// On error:
//   - getAllBatteryProducts throwing on duplicate critical headers in
//     16M_PRODUCTS_BESS -> we catch and surface as a Toast + blocked write
//     (so the designer still gets a sheet explaining what's wrong).
//   - Anything else throwing -> caught, surfaced as a Toast (no silent fail).
// ---------------------------------------------------------------------------
function onMenuSuggestBess() {
  var ss = SpreadsheetApp.getActive();
  var result;
  try {
    result = suggestBessSizing(ss);
  } catch (e) {
    result = _bessBlocked('Engine error: ' + (e && e.message ? e.message : String(e)));
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Suggest BESS failed. See BESS_RECOMMENDATIONS sheet.',
      'BESS Suggestion', 8);
  }
  writeBessRecommendations(ss, result);
  // BDF-6: refresh INPUT_BESS C6 picker so the new recommendation labels
  // show up immediately in the dropdown. Quietly skipped if the picker
  // module isn't loaded (older deploy / missing file).
  try {
    if (typeof refreshBessPicker === 'function') refreshBessPicker(ss);
  } catch (pickerErr) {
    // Don't block the suggestion flow on picker plumbing.
  }
  // Jump to the result sheet so the designer sees it without hunting.
  var sh = ss.getSheetByName(BESS_RECOMMENDATIONS_SHEET);
  if (sh) ss.setActiveSheet(sh);
  if (!result.blocked) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'BESS_RECOMMENDATIONS updated.', 'BESS Suggestion', 3);
  }
}

