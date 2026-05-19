// =============================================================================
// ARGIA ENGINE v7 -- File: 02_LoadDB.gs
// Single source of truth loader. ALL engineering constants come from DB.
// Updated for MASTER_DB v3 field names (April 2026).
//
// KEY FIELD NAME CHANGES vs old DB:
//   INV_STRING_COUNT         -> INV_TOTAL_DC_INPUTS
//   INV_MAX_INPUT_V          -> INV_DC_MAX_VOLTAGE_V
//   INV_MPP_V_MIN            -> INV_MPPT_VOLTAGE_MIN_V
//   INV_MPP_V_MAX            -> INV_MPPT_VOLTAGE_MAX_V
//   INV_MAX_INPUT_CURRENT_A  -> split into three fields (see below)
//   INV_VOLTAGE              -> INV_AC_VOLTAGE_NOMINAL_V
//   INV_MAX_DC_INPUT_KW      -> INV_DC_MAX_INPUT_KW
//
// NEW FIELDS (v3):
//   INV_MAX_INPUTS_PER_MPPT             -- physical inputs sharing one MPPT tracker
//   INV_MAX_OPERATING_CURRENT_PER_MPPT_A -- use for conductor ampacity sizing
//   INV_MAX_SHORT_CIRCUIT_CURRENT_PER_MPPT_A -- use for STR-03 / DC-09 Isc limit check
//   INV_MAX_INPUT_CURRENT_PER_INPUT_A   -- per individual DC input
//   INV_DC_START_VOLTAGE_V              -- minimum voltage for inverter to start
//   INV_TOPOLOGY                        -- STRING | OPTIMIZER | CENTRAL
//   VALID_MDC_READY                     -- VALID | REVIEW | INVALID
//   DATASHEET_CHECK_NOTES               -- datasheet source evidence for MDC
// =============================================================================

// ---------------------------------------------------------------------------
// PANEL DB
// ---------------------------------------------------------------------------
function getAllPanels(ss) {
  var sh = ss.getSheetByName(SH.PANELS_MIRROR);
  if (!sh) throw new Error('Sheet not found: ' + SH.PANELS_MIRROR);
  var data = sh.getDataRange().getValues();
  var hdrs = data[0].map(function(h) { return String(h).trim(); });
  return data.slice(1)
    .filter(function(r) { return r[0] !== '' && r[0] !== null; })
    .map(function(row) {
      var obj = {};
      hdrs.forEach(function(h, i) { obj[h] = row[i]; });
      return obj;
    });
}

function lookupPanel(ss, modelName) {
  var key = String(modelName).trim().toUpperCase();
  var found = getAllPanels(ss).find(function(p) {
    return String(p['PANEL_MODEL'] || '').trim().toUpperCase() === key;
  });
  if (!found) throw new Error(
    'Panel not found in ' + SH.PANELS_MIRROR + ': "' + modelName + '".\n' +
    'Check spelling at ' + inputLocation('panelModel') + '.'
  );
  return found;
}

// ---------------------------------------------------------------------------
// INVERTER DB
// ---------------------------------------------------------------------------
function getAllInverters(ss) {
  var sh = ss.getSheetByName(SH.INV_MIRROR);
  if (!sh) throw new Error('Sheet not found: ' + SH.INV_MIRROR);
  var data = sh.getDataRange().getValues();
  var hdrs = data[0].map(function(h) { return String(h).trim(); });
  return data.slice(1)
    .filter(function(r) { return r[0] !== '' && r[0] !== null; })
    .map(function(row) {
      var obj = {};
      hdrs.forEach(function(h, i) { obj[h] = row[i]; });
      return obj;
    });
}

function lookupInverter(ss, modelName) {
  var key = String(modelName).trim().toUpperCase();
  return getAllInverters(ss).find(function(inv) {
    return String(inv['INV_MODEL'] || '').trim().toUpperCase() === key;
  }) || null;
}

// ---------------------------------------------------------------------------
// BATTERY (BESS) PRODUCT DB   (Increment 4b-2.5a)
// ---------------------------------------------------------------------------
// Reads the 16M_PRODUCTS_BESS mirror tab. That tab is an IMPORTRANGE of the
// Master_DB 16_PRODUCTS_BESS table -- the data is owned elsewhere and the
// structure is frozen, so this reader is the ONLY code that touches the tab
// and keys every field by HEADER NAME, never by column index. A reorder of
// the source columns therefore cannot silently break it.
//
// IMPORTRANGE hazard: while the import is resolving, or if the source link is
// broken, getValues() returns strings like 'Loading...', '#REF!', '#ERROR!'
// or '#N/A' instead of the real data. A battery DB that has not finished
// loading must NOT crash the engine and must NOT be mistaken for valid data.
// _bessCellOk() screens those sentinels; getAllBatteryProducts() drops any
// row whose Battery_ID is unusable. The downstream effect of a missing /
// loading DB is simply that voltage falls back to the INPUT_BESS manual
// cells (Increment 4b-2.5b) -- never a fabricated number.

// True when a raw IMPORTRANGE cell holds usable data (not blank, not a
// loading/error sentinel).
function _bessCellOk(v) {
  if (v === '' || v === null || v === undefined) return false;
  var s = String(v).trim().toUpperCase();
  if (s === '') return false;
  // Spreadsheet error / loading sentinels.
  if (s === 'LOADING...' || s === '#REF!' || s === '#ERROR!' ||
      s === '#N/A' || s === '#NAME?' || s === '#VALUE!' || s === '#DIV/0!') {
    return false;
  }
  return true;
}

// Returns every battery product as a header-keyed object. Rows whose
// Battery_ID is blank or an IMPORTRANGE sentinel are skipped. If the tab is
// missing entirely, returns [] (caller decides whether that is fatal) -- the
// engine's BESS path treats an empty library as "no DB", not an error,
// because a PV-only or CUSTOM_MANUAL project must still run.
function getAllBatteryProducts(ss) {
  var sh = ss.getSheetByName(SH.BESS_MIRROR);
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  if (!data || data.length < 2) return [];
  var hdrs = data[0].map(function(h) { return String(h).trim(); });
  return data.slice(1)
    .filter(function(r) { return _bessCellOk(r[0]); })
    .map(function(row) {
      var obj = {};
      hdrs.forEach(function(h, i) { obj[h] = row[i]; });
      return obj;
    });
}

// Finds one battery product by Battery_ID (case / whitespace tolerant).
// Returns the header-keyed object, or null when the id is not in the DB
// (includes the case where the DB is still loading -> getAll returns []).
function lookupBattery(ss, batteryId) {
  var key = String(batteryId || '').trim().toUpperCase();
  if (key === '') return null;
  return getAllBatteryProducts(ss).find(function(b) {
    return String(b['Battery_ID'] || '').trim().toUpperCase() === key;
  }) || null;
}

// Resolves a battery's nominal DC voltage from its DB row.
// Returns a positive number, or 0 when the product is unknown, the row is
// not loaded, or the stored voltage is blank / non-positive (e.g.
// CUSTOM_MANUAL, whose Nominal_Voltage_V is 0 by design). A 0 return is the
// signal for the caller to fall back to the INPUT_BESS manual voltage cell.
function lookupBatteryVoltage(ss, batteryId) {
  var row = lookupBattery(ss, batteryId);
  if (!row) return 0;
  var raw = row['Nominal_Voltage_V'];
  if (!_bessCellOk(raw)) return 0;
  var v = Number(raw);
  return (isFinite(v) && v > 0) ? v : 0;
}

// Builds typed InverterSpec[] from INPUT_DESIGN bank + MASTER_DB v3 lookup.
// Raises on INVALID entries, warns on REVIEW entries.
function buildInverterBank(ss, inverterBankRaw) {
  return inverterBankRaw.map(function(entry) {
    var db = lookupInverter(ss, entry.model);
    if (!db) throw new Error(
      'Inversor not found in ' + SH.INV_MIRROR + ': "' + entry.model + '".\n' +
      'Check spelling at ' + inputLocation('inverterPrimaryModel') + ' (primary) or invertersSecondary range.\n' +
      'Note: SUN5000-150K-MGO is a legacy alias -- use SUN2000-150K-MG0 instead.'
    );

    // Block on INVALID DB entries
    var mdcReady = String(db['VALID_MDC_READY'] || '').toUpperCase().trim();
    if (mdcReady === 'INVALID') throw new Error(
      'Inversor "' + entry.model + '" is marked INVALID in the DB.\n' +
      'Notes: ' + (db['DATASHEET_CHECK_NOTES'] || 'No notes') + '\n' +
      'Update the model name at ' + inputLocation('inverterPrimaryModel') + ' or invertersSecondary.'
    );

    // Warn on REVIEW entries (logged, not blocking)
    if (mdcReady === 'REVIEW') {
      try {
        engineLog(ss, 'LoadDB', 'WARNING',
          'Inversor "' + entry.model + '" has VALID_MDC_READY=REVIEW. ' +
          'Notes: ' + (db['DATASHEET_CHECK_NOTES'] || '') +
          '. Calculations will run but verify results manually.');
      } catch(e) {}
    }

    // Parse AC voltage
    var voltRaw = db['INV_AC_VOLTAGE_NOMINAL_V'];
    var voltNum = parseFloat(String(voltRaw).replace(/[^0-9.]/g, '')) || 220;

    // Price
    var priceRaw = parseFloat(db['INV_PRICE_PER_UNIT_USD']);
    var priceUsd = (!isNaN(priceRaw) && priceRaw > 0) ? priceRaw : null;

    return {
      // Identity
      model    : entry.model,
      invId    : String(db['INV_ID'] || '').trim(),
      topology : String(db['INV_TOPOLOGY'] || 'STRING').toUpperCase().trim(),
      mdcReady : mdcReady,
      datasheetNotes: String(db['DATASHEET_CHECK_NOTES'] || '').trim(),

      // From INPUT_DESIGN
      qty             : entry.qty,
      stringsAssigned : entry.stringsAssigned,   // total inputs assigned to ALL units of this type

      // AC electrical (v3 field names)
      acKw     : parseFloat(db['INV_AC_POWER_KW'])          || 0,
      voltage  : voltNum,
      phase    : voltNum >= 380 ? 3 : 1,

      // DC voltage limits (v3 field names)
      maxDcKw  : parseFloat(db['INV_DC_MAX_INPUT_KW'])       || 0,
      maxDcV   : parseFloat(db['INV_DC_MAX_VOLTAGE_V'])      || 1000,
      mpptVmin : parseFloat(db['INV_MPPT_VOLTAGE_MIN_V'])    || 200,
      mpptVmax : parseFloat(db['INV_MPPT_VOLTAGE_MAX_V'])    || 1000,
      startV   : parseFloat(db['INV_DC_START_VOLTAGE_V'])    || 200,

      // MPPT structure (v3 new fields)
      mpptCount       : parseInt(db['INV_MPPT_COUNT'])                     || 1,
      inputsPerMppt   : parseInt(db['INV_MAX_INPUTS_PER_MPPT'])            || 1,
      totalDcInputs   : parseInt(db['INV_TOTAL_DC_INPUTS'])                || 1,

      // Current limits (v3 -- split into 3 fields, each used for different NOM check)
      // Use iOpPerMppt for: conductor ampacity sizing (AC-02 / DC-05)
      // Use iScPerMppt for: STR-03 Isc limit check (DC-09)
      // Use iPerInput  for: per-input fuse coordination (DC-11)
      iOpPerMppt  : parseFloat(db['INV_MAX_OPERATING_CURRENT_PER_MPPT_A'])    || 30,
      iScPerMppt  : parseFloat(db['INV_MAX_SHORT_CIRCUIT_CURRENT_PER_MPPT_A'])|| 45,
      iPerInput   : parseFloat(db['INV_MAX_INPUT_CURRENT_PER_INPUT_A'])        || 20,

      // Legacy field -- kept for reference only, not used in calculations
      iLegacy     : parseFloat(db['INV_MAX_INPUT_CURRENT_A_LEGACY'])           || 0,

      // Rapid shutdown
      rsdCompatible: String(db['INV_RAPID_SHUTDOWN_COMPATIBLE'] || '').toUpperCase() === 'YES',

      // Commercial
      priceUsd : priceUsd,
    };
  });
}

// ---------------------------------------------------------------------------
// NOM_DB CONSTANTS LOADER
// ---------------------------------------------------------------------------
function loadNomConstants(ss) {
  var nom = {};
  nom.limits = load61NomLimits(ss);

  var dcF = nom.limits['dc_current_factor'] || 1.25;
  nom.currentFactor1    = dcF;
  nom.currentFactor2    = dcF * dcF;
  nom.bifacialFactor    = nom.limits['project_bifacial_default_factor'] || 1.10;
  nom.transformerMargin = nom.limits['transformer_margin_pct']           || 0.20;
  nom.maxParallelRunA   = nom.limits['max_parallel_run_amps']            || 400;
  nom.cuResistivity     = nom.limits['cu_resistivity_ohm_mm2_per_m']    || 0.0172;
  nom.fillRatioOver2    = nom.limits['conduit_fill_over2_conductors']    || 0.40;
  nom.fillRatio2        = nom.limits['conduit_fill_2_conductors']        || 0.31;
  nom.fillRatio1        = nom.limits['conduit_fill_1_conductor']         || 0.53;
  nom.dcVdropTarget     = nom.limits['project_dc_voltage_drop']          || 0.015;
  nom.dcVdropWarn       = nom.limits['project_dc_voltage_drop_warn']     || 0.020;
  nom.dcVdropHard       = nom.limits['project_dc_voltage_drop_hard']     || 0.030;
  nom.acVdropTarget     = nom.limits['project_ac_voltage_drop']          || 0.020;
  nom.acVdropWarn       = nom.limits['project_ac_voltage_drop_warn']     || 0.030;
  nom.acVdropHard       = nom.limits['project_ac_voltage_drop_hard']     || 0.050;
  nom.dcAcTarget        = nom.limits['project_dc_ac_ratio']              || 1.20;
  nom.dcAcWarn          = nom.limits['project_dc_ac_ratio_warn']         || 1.50;
  nom.dcAcHard          = nom.limits['project_dc_ac_ratio_hard']         || 1.80;
  nom.altitudeTrigger   = nom.limits['project_altitude_derate_trigger_m']|| 2000;
  nom.roofClearanceLow  = nom.limits['project_roof_clearance_low_airflow_mm'] || 91;

  // -- BESS limits (Increment 4a) ------------------------------------------
  // Battery NOM constants. Keys come from 61_NOM_LIMITS rows 20-25. Each has
  // a built-in fallback so a stale mirror never breaks the engine.
  nom.bess = {
    dcCurrentFactor: nom.limits['bess_dc_conductor_current_factor']  || 1.25,
    minWorkClearMm:  nom.limits['bess_min_working_clearance_mm']      || 900,
    fireClearMm:     nom.limits['bess_fire_clearance_mm']             || 1000,
    minSocDefault:   nom.limits['bess_min_soc_default']               || 0.10,
    maxSocDefault:   nom.limits['bess_max_soc_default']               || 0.90,
    rteFloor:        nom.limits['bess_round_trip_efficiency_floor']   || 0.90,
  };

  return nom;
}

// ---------------------------------------------------------------------------
// NOM LIMITS -- JS-only source of truth.
// NOM limits are edited by the management team at release time, in code,
// under test. There is deliberately no spreadsheet mirror: the engine reads
// these values directly from buildNomLimitsDefaults() below. To change a
// NOM limit, edit buildNomLimitsDefaults(), update the affected Phase/Tier
// tests, and release.
// ---------------------------------------------------------------------------
function load61NomLimits(ss) {
  return buildNomLimitsDefaults();
}

function buildNomLimitsDefaults() {
  return {
    'dc_current_factor': 1.25, 'dc_current_factor_warn': 1.25, 'dc_current_factor_hard': 1.25,
    'mppt_isc_safety_margin': 1.00,
    'project_bifacial_default_factor': 1.10, 'project_bifacial_default_factor_hard': 1.15,
    'project_dc_ac_ratio': 1.20, 'project_dc_ac_ratio_warn': 1.50, 'project_dc_ac_ratio_hard': 1.80,
    'project_dc_voltage_drop': 0.015, 'project_dc_voltage_drop_warn': 0.020, 'project_dc_voltage_drop_hard': 0.030,
    'project_ac_voltage_drop': 0.020, 'project_ac_voltage_drop_warn': 0.030, 'project_ac_voltage_drop_hard': 0.050,
    'project_ac_voltage_rise': 0.020, 'project_ac_voltage_rise_warn': 0.020, 'project_ac_voltage_rise_hard': 0.030,
    'project_altitude_derate_trigger_m': 2000, 'project_altitude_derate_trigger_m_hard': 3000,
    'project_roof_clearance_low_airflow_mm': 91, 'project_roof_clearance_low_airflow_mm_hardMin': 13,
    'cu_resistivity_ohm_mm2_per_m': 0.0172,
    'conduit_fill_over2_conductors': 0.40, 'conduit_fill_2_conductors': 0.31, 'conduit_fill_1_conductor': 0.53,
    'transformer_margin_pct': 0.20, 'max_parallel_run_amps': 400,
    'project_thermography_delta_t_review_c': 15, 'project_thermography_delta_t_review_c_hard': 25,
    // -- BESS limits (Increment 4a). Mirror of NOM_DB 61_NOM_LIMITS rows 20-25,
    //    kept here as the JS source of truth. PROPOSED clearances pending PEC.
    'bess_dc_conductor_current_factor': 1.25,
    'bess_min_working_clearance_mm': 900,
    'bess_fire_clearance_mm': 1000,
    'bess_min_soc_default': 0.10,
    'bess_max_soc_default': 0.90,
    'bess_round_trip_efficiency_floor': 0.90,
  };
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}