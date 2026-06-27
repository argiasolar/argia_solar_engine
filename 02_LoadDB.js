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

// ---------------------------------------------------------------------------
// SKU normalization (Pass 6c). Makes product lookups robust to whitespace and
// separator-spacing differences WITHOUT fuzzy matching -- "JAM72D40 - 545 / LB"
// resolves to "JAM72D40-545/LB", but genuinely different SKUs (e.g. HVH vs
// HVHF) stay distinct, so we never silently match the wrong product. Used by
// lookupPanel / lookupInverter / lookupBattery on BOTH sides of the compare.
// ---------------------------------------------------------------------------
function normalizeSku(s) {
  return String(s == null ? '' : s)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')               // collapse internal whitespace
    .replace(/\s*([\/\-])\s*/g, '$1');  // drop spaces around '/' and '-'
}

// ---------------------------------------------------------------------------
// BOM per-line price status (Pass 6a). Classifies how trustworthy a line's
// price is, so the BOM can flag lines that still need a quote. Pure & testable.
//
// Resolution order:
//   1. explicit per-line source tag (future PRICE_SOURCE column / manual flag)
//        CATALOG -> CATALOG_PRICE, SUPPLIER/QUOTED -> SUPPLIER_QUOTED,
//        ESTIMATE(D) -> ESTIMATED, MANUAL/OVERRIDE -> MANUAL_OVERRIDE
//   2. BESS provenance from lookupBatteryPrice:
//        BESS_PRICE_PER_UNIT -> SUPPLIER_QUOTED, CAPEX_FALLBACK -> ESTIMATED,
//        NO_DATA/NO_BATTERY  -> MISSING_PRICE
//   3. plain price presence: a positive product-DB price is treated as
//        CATALOG_PRICE; absence is MISSING_PRICE.
//
// NOTE: distinguishing CATALOG vs SUPPLIER vs ESTIMATED for the non-BESS
// product DBs needs a PRICE_SOURCE column in 11M/12M/13M; until then a present
// DB price defaults to CATALOG_PRICE (override via info.sourceTag).
// @return {'CATALOG_PRICE'|'SUPPLIER_QUOTED'|'ESTIMATED'|'MANUAL_OVERRIDE'|'MISSING_PRICE'}
function classifyBomLinePriceStatus(info) {
  info = info || {};
  var TAG = {
    CATALOG:'CATALOG_PRICE', CATALOGUE:'CATALOG_PRICE',
    SUPPLIER:'SUPPLIER_QUOTED', QUOTED:'SUPPLIER_QUOTED', QUOTE:'SUPPLIER_QUOTED',
    ESTIMATE:'ESTIMATED', ESTIMATED:'ESTIMATED', EST:'ESTIMATED',
    MANUAL:'MANUAL_OVERRIDE', OVERRIDE:'MANUAL_OVERRIDE'
  };
  var tag = String(info.sourceTag || '').trim().toUpperCase();
  if (TAG[tag]) return TAG[tag];
  if (info.manualOverride === true) return 'MANUAL_OVERRIDE';

  var prov = String(info.provenance || '').trim().toUpperCase();
  if (prov === 'BESS_PRICE_PER_UNIT') return 'SUPPLIER_QUOTED';
  if (prov === 'CAPEX_FALLBACK')      return 'ESTIMATED';
  if (prov === 'NO_DATA' || prov === 'NO_BATTERY') return 'MISSING_PRICE';

  var usd = parseFloat(info.priceUsd);
  var mxn = parseFloat(info.priceMxn);
  if ((!isNaN(usd) && usd > 0) || (!isNaN(mxn) && mxn > 0)) return 'CATALOG_PRICE';
  return 'MISSING_PRICE';
}

function lookupPanel(ss, modelName) {
  var key = normalizeSku(modelName);
  var found = getAllPanels(ss).find(function(p) {
    return normalizeSku(p['PANEL_MODEL']) === key;
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
  var key = normalizeSku(modelName);
  return getAllInverters(ss).find(function(inv) {
    return normalizeSku(inv['INV_MODEL']) === key;
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
// engine's BESS path treats an empty catalog as "no DB", not an error,
// because a PV-only or CUSTOM_MANUAL project must still run.
//
// BDF-1 hardening: detects duplicate column headers in the source DB. If the
// schema has two columns with the same name, the second silently overwrites
// the first in the JS object -- which means a swap could zero out prices
// without any error. We now collect duplicates and:
//   - throw HARD if a price-critical column is duplicated (would corrupt sizing)
//   - log (engineLog if available) a soft warning for non-critical duplicates
// The list of price-critical columns is conservative; add to it whenever a
// new engine consumer reads from this DB.
var _BESS_DB_PRICE_CRITICAL_COLS = ['Installed_CAPEX_MXN', 'Nominal_Capacity_kWh',
                                    'Usable_Capacity_kWh', 'Power_kW',
                                    'Nominal_Voltage_V', 'Battery_ID'];

function getAllBatteryProducts(ss) {
  var sh = ss.getSheetByName(SH.BESS_MIRROR);
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  if (!data || data.length < 2) return [];
  var hdrs = data[0].map(function(h) { return String(h).trim(); });

  // -- Duplicate header detection ---------------------------------------
  var hdrCounts = {};
  hdrs.forEach(function(h) {
    if (h) hdrCounts[h] = (hdrCounts[h] || 0) + 1;
  });
  var dups = [];
  for (var h in hdrCounts) {
    if (hdrCounts[h] > 1) dups.push(h);
  }
  if (dups.length > 0) {
    var criticalDups = dups.filter(function(d) {
      return _BESS_DB_PRICE_CRITICAL_COLS.indexOf(d) !== -1;
    });
    if (criticalDups.length > 0) {
      // Hard fail: the engine cannot safely produce sizing/pricing output
      // when a critical column is ambiguous. Fix MASTER_DB schema before
      // running again.
      throw new Error('getAllBatteryProducts: duplicate critical column(s) in '
        + SH.BESS_MIRROR + ': [' + criticalDups.join(', ') + ']. '
        + 'Fix MASTER_DB schema: ensure each of these columns appears EXACTLY once.');
    }
    // Soft warning: non-critical duplicates (like Notes) get a log entry
    // but don't block execution.
    try {
      if (typeof engineLog === 'function') {
        engineLog(ss, 'LoadDB', 'WARNING',
          'getAllBatteryProducts: non-critical duplicate column(s) in ' + SH.BESS_MIRROR
          + ': [' + dups.join(', ') + ']. Last occurrence wins in the result object.');
      }
    } catch (_) { /* engineLog unavailable in pure-test contexts -- OK to swallow */ }
  }

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
  var key = normalizeSku(batteryId);
  if (key === '') return null;
  return getAllBatteryProducts(ss).find(function(b) {
    return normalizeSku(b['Battery_ID']) === key;
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


// ---------------------------------------------------------------------------
// Resolves the per-unit selling price for a battery from 16M_PRODUCTS_BESS.
// BDF-7.
//
// HONEST CAVEAT: This reader assumes the live DB has a column whose header
// matches one of the recognized names below. The exact column position is
// IRRELEVANT — getAllBatteryProducts returns header-keyed objects. As long
// as the column exists with a recognized header, this reader finds it.
//
// Recognized header names (in priority order, case-insensitive comparison):
//   1. BESS_price_per_unit              -- the new column you added
//   2. BESS_PRICE_PER_UNIT
//   3. Price_Per_Unit_MXN
//   4. Installed_CAPEX_MXN              -- legacy fallback (NOT correct
//                                          long-term, since installed CAPEX
//                                          includes installation, but
//                                          better than 0)
//
// Returns:
//   { priceMxn: number, provenance: 'BESS_PRICE_PER_UNIT' | 'CAPEX_FALLBACK' |
//                                   'NO_DATA', headerUsed: '...' }
//   On unknown battery: { priceMxn: 0, provenance: 'NO_BATTERY' }
function lookupBatteryUnitPrice(ss, batteryId) {
  var row = lookupBattery(ss, batteryId);
  if (!row) return { priceMxn: 0, provenance: 'NO_BATTERY', headerUsed: null };
  var candidates = [
    { header: 'BESS_price_per_unit', prov: 'BESS_PRICE_PER_UNIT' },
    { header: 'BESS_PRICE_PER_UNIT', prov: 'BESS_PRICE_PER_UNIT' },
    { header: 'Price_Per_Unit_MXN',  prov: 'BESS_PRICE_PER_UNIT' },
    { header: 'Installed_CAPEX_MXN', prov: 'CAPEX_FALLBACK' },
  ];
  // Build a normalized map of the row's keys for case-insensitive lookup
  var normalized = {};
  for (var k in row) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      normalized[String(k).trim().toLowerCase()] = { key: k, val: row[k] };
    }
  }
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var hit = normalized[c.header.toLowerCase()];
    if (hit && _bessCellOk(hit.val)) {
      var n = Number(hit.val);
      if (isFinite(n) && n >= 0) {
        return { priceMxn: n, provenance: c.prov, headerUsed: hit.key };
      }
    }
  }
  return { priceMxn: 0, provenance: 'NO_DATA', headerUsed: null };
}


// ---------------------------------------------------------------------------
// BESS sizing tariff rates -- BDF-1
// ---------------------------------------------------------------------------
// The sizing engine (calcBessSizing) needs annualized punta and base energy
// rates to estimate the energy-shift component of BESS savings. We derive
// these from the project's own INPUT_CFE bills rather than the catalog
// (20M_CFE_TARIFFS), because:
//   - The catalog requires a tariff-resolver (region, voltage, season, month)
//     which is a chunk of work on its own.
//   - INPUT_CFE already has the actual billed MXN per kWh per month, so the
//     weighted-average over 12 months IS the rate the project pays.
//
// Returns: { puntaMxnPerKwh, baseMxnPerKwh, provenance, monthsRead }
//   provenance: 'INPUT_CFE_DERIVED' when at least 6 months had data,
//               'INSUFFICIENT_DATA' otherwise (returns 0 rates).
//   monthsRead: how many monthly entries contributed.
//
// The INPUT_BESS override step happens AFTER this call -- this function just
// derives the default. Callers compose:
//   var auto     = deriveBessTariffRatesFromInputCfe(ss);
//   var override = readInputBessTariffOverride(ss);  // {punta?, base?}
//   var punta    = override.punta != null ? override.punta : auto.puntaMxnPerKwh;
//   var base     = override.base  != null ? override.base  : auto.baseMxnPerKwh;
function deriveBessTariffRatesFromInputCfe(ss) {
  ss = ss || SpreadsheetApp.getActive();
  if (!ss.getSheetByName('INPUT_CFE')) {
    return { puntaMxnPerKwh: 0, baseMxnPerKwh: 0,
             provenance: 'NO_INPUT_CFE_SHEET', monthsRead: 0 };
  }
  // [A2b] monthly rows via INPUT_MAP range reads (cfeKwhBase C10, cfeKwhPunta
  //   C12, cfeEnergiaBMxn C25, cfeEnergiaPMxn C27; all C..N). Each returns
  //   [[12 values]]; [0][i] for i=0..11 reproduces the old c=3..14 loop, with
  //   the same Number(...)||0 coercion and >0 / months<6 thresholds.
  var kwhBaseRow  = readInput(ss, 'cfeKwhBase')[0];
  var kwhPuntaRow = readInput(ss, 'cfeKwhPunta')[0];
  var energBRow   = readInput(ss, 'cfeEnergiaBMxn')[0];
  var energPRow   = readInput(ss, 'cfeEnergiaPMxn')[0];
  var sumKwhP = 0, sumKwhB = 0, sumEnergP = 0, sumEnergB = 0, months = 0;
  for (var i = 0; i < 12; i++) {
    var kwhP = Number(kwhPuntaRow[i]) || 0;
    var kwhB = Number(kwhBaseRow[i])  || 0;
    var enrP = Number(energPRow[i])   || 0;
    var enrB = Number(energBRow[i])   || 0;
    if (kwhP > 0 && kwhB > 0 && enrP > 0 && enrB > 0) {
      sumKwhP   += kwhP;
      sumKwhB   += kwhB;
      sumEnergP += enrP;
      sumEnergB += enrB;
      months++;
    }
  }
  if (months < 6) {
    return { puntaMxnPerKwh: 0, baseMxnPerKwh: 0,
             provenance: 'INSUFFICIENT_DATA',
             monthsRead: months };
  }
  return {
    puntaMxnPerKwh: sumEnergP / sumKwhP,
    baseMxnPerKwh:  sumEnergB / sumKwhB,
    provenance: 'INPUT_CFE_DERIVED',
    monthsRead: months,
  };
}

// ---------------------------------------------------------------------------
// Full tariff-rate derivation including intermedia -- BDF-5
// ---------------------------------------------------------------------------
// The hourly simulator needs all three bucket rates (base/intermedia/punta).
// The BDF-1 reader above only returns punta+base for backward compat with
// the BESS sizer. This function extends it to include intermedia (INPUT_CFE
// row 26 = Energía I), needed for 8760-hour TOU cost calculation.
//
// Returns { puntaMxnPerKwh, intermediaMxnPerKwh, baseMxnPerKwh, provenance,
//           monthsRead }. Falls back to 0 for any rate with insufficient data.
function deriveFullTariffRatesFromInputCfe(ss) {
  ss = ss || SpreadsheetApp.getActive();
  if (!ss.getSheetByName('INPUT_CFE')) {
    return { puntaMxnPerKwh: 0, intermediaMxnPerKwh: 0, baseMxnPerKwh: 0,
             provenance: 'NO_INPUT_CFE_SHEET', monthsRead: 0 };
  }
  // [A2b] monthly rows via INPUT_MAP range reads:
  //   cfeKwhBase C10, cfeKwhIntermedia C11, cfeKwhPunta C12,
  //   cfeEnergiaBMxn C25, cfeEnergiaIMxn C26, cfeEnergiaPMxn C27 (all C..N).
  //   [0][i] for i=0..11 reproduces the old c=3..14 loop; coercion, the
  //   base+punta month filter, and months<6 threshold are unchanged.
  var rKwhB = readInput(ss, 'cfeKwhBase')[0];
  var rKwhI = readInput(ss, 'cfeKwhIntermedia')[0];
  var rKwhP = readInput(ss, 'cfeKwhPunta')[0];
  var rMxnB = readInput(ss, 'cfeEnergiaBMxn')[0];
  var rMxnI = readInput(ss, 'cfeEnergiaIMxn')[0];
  var rMxnP = readInput(ss, 'cfeEnergiaPMxn')[0];
  var sumKwhP = 0, sumKwhI = 0, sumKwhB = 0;
  var sumMxnP = 0, sumMxnI = 0, sumMxnB = 0;
  var months = 0;
  for (var i = 0; i < 12; i++) {
    var kwhB = Number(rKwhB[i]) || 0;
    var kwhI = Number(rKwhI[i]) || 0;
    var kwhP = Number(rKwhP[i]) || 0;
    var mxnB = Number(rMxnB[i]) || 0;
    var mxnI = Number(rMxnI[i]) || 0;
    var mxnP = Number(rMxnP[i]) || 0;
    // Require at least the base+punta pair to count this month
    if (kwhP > 0 && kwhB > 0 && mxnP > 0 && mxnB > 0) {
      sumKwhP += kwhP; sumKwhI += kwhI; sumKwhB += kwhB;
      sumMxnP += mxnP; sumMxnI += mxnI; sumMxnB += mxnB;
      months++;
    }
  }
  if (months < 6) {
    return { puntaMxnPerKwh: 0, intermediaMxnPerKwh: 0, baseMxnPerKwh: 0,
             provenance: 'INSUFFICIENT_DATA', monthsRead: months };
  }
  return {
    puntaMxnPerKwh:      sumMxnP / sumKwhP,
    intermediaMxnPerKwh: (sumKwhI > 0) ? (sumMxnI / sumKwhI) : 0,
    baseMxnPerKwh:       sumMxnB / sumKwhB,
    provenance: 'INPUT_CFE_DERIVED',
    monthsRead: months,
  };
}

// Reads the BESS tariff override cells from INPUT_BESS (BDF-1 reader,
// row positions updated in BDF-3 when economics section was added).
// Returns { punta, base } where each is null when blank/zero, or a positive
// number when the designer has typed in an override.
function readInputBessTariffOverride(ss) {
  ss = ss || SpreadsheetApp.getActive();
  // [A2b] r38/r39 via readInput/INPUT_MAP (bessPuntaRateOverride C38 /
  // bessBaseRateOverride C39, both map default 0). Sheet guarded first because
  // readInput throws on a missing sheet (the old code returned nulls). The
  // blank/0/negative -> null semantics are preserved exactly: readInput returns
  // 0 on a blank cell and 0 fails the (>0) test, so the result is null just as
  // when Number('') -> 0 before.
  if (!ss.getSheetByName('INPUT_BESS')) return { punta: null, base: null };
  // INPUT_BESS layout (BDF-3 economics section):
  //   row 36 B = "5. ECONOMICS GUARDRAILS" (section header)
  //   row 37 C = min annual savings threshold MXN  (see readBessMinSavingsThreshold)
  //   row 38 C = punta override MXN/kWh   (BESS_PUNTA_RATE_MXN_KWH)
  //   row 39 C = base override MXN/kWh    (BESS_BASE_RATE_MXN_KWH)
  var punta = Number(readInput(ss, 'bessPuntaRateOverride'));
  var base  = Number(readInput(ss, 'bessBaseRateOverride'));
  return {
    punta: (isFinite(punta) && punta > 0) ? punta : null,
    base:  (isFinite(base)  && base  > 0) ? base  : null,
  };
}

// ---------------------------------------------------------------------------
// Min-savings threshold reader -- BDF-3
// ---------------------------------------------------------------------------
// Reads the min annual savings threshold from INPUT_BESS row 37 col C.
// Threshold is in MXN. Returns 0 when:
//   - the sheet doesn't have row 37 yet (pre-BDF-3 workbook), OR
//   - the cell is blank, OR
//   - the cell holds 0 or a negative number (designer explicitly disabled).
// In all "0" cases the engine treats threshold as DISABLED and produces
// behavior identical to BDF-2 -- no regression for pre-BDF-3 callers.
//
// Returns { thresholdMxn, provenance }.
//   provenance: 'INPUT_BESS' when the cell has a positive value,
//               'DISABLED' otherwise.
function readBessMinSavingsThreshold(ss) {
  ss = ss || SpreadsheetApp.getActive();
  if (!ss.getSheetByName('INPUT_BESS')) return { thresholdMxn: 0, provenance: 'DISABLED' };
  // [A2c] now migrated onto readInput. The seed/default split (A2c-0) set
  // bessMinAnnualSavingMxn's `default` to 0, so readInput returns 0 on a blank
  // C37 -> DISABLED, exactly as the old direct read did. The 2,000,000 `seed`
  // only feeds fresh-sheet setup, never the read path (readInput uses `default`).
  var n = Number(readInput(ss, 'bessMinAnnualSavingMxn'));
  if (!isFinite(n) || n <= 0) {
    return { thresholdMxn: 0, provenance: 'DISABLED' };
  }
  return { thresholdMxn: n, provenance: 'INPUT_BESS' };
}

// ---------------------------------------------------------------------------
// Load profile assembly for BESS sizing -- BDF-1
// ---------------------------------------------------------------------------
// calcBessSizing's loadProfile.months expects [{kwhPunta, kwPunta, days}, ...]
// We assemble it from INPUT_CFE rows 12 (kWh punta), 15 (kW punta), 18 (days).
// Months with zero/missing data are excluded -- the sizer warns when fewer
// than 12 are present, so callers don't need to fake months.
function buildBessLoadProfileFromInputCfe(ss) {
  ss = ss || SpreadsheetApp.getActive();
  // [A2b] monthly rows via INPUT_MAP range reads (cfeKwhPunta C12:N12,
  // cfeKwPunta C15:N15, cfeDias C18:N18). Sheet guarded first. Each range read
  // returns [[12 values C..N]]; [0][i] for i=0..11 reproduces the old c=3..14
  // loop, and the per-cell Number(...)||0 / ||30 semantics are unchanged.
  if (!ss.getSheetByName('INPUT_CFE')) return { months: [], provenance: 'NO_INPUT_CFE_SHEET' };
  var kwhPuntaRow = readInput(ss, 'cfeKwhPunta')[0];
  var kwPuntaRow  = readInput(ss, 'cfeKwPunta')[0];
  var diasRow     = readInput(ss, 'cfeDias')[0];
  var months = [];
  for (var i = 0; i < 12; i++) {
    var kwhP = Number(kwhPuntaRow[i]) || 0;
    var kwP  = Number(kwPuntaRow[i])  || 0;
    var days = Number(diasRow[i])     || 30;
    if (kwhP > 0 && kwP > 0) {
      months.push({ kwhPunta: kwhP, kwPunta: kwP, days: days });
    }
  }
  // Provenance follows the same SYNTHESIZED-vs-METERED contract the sizer
  // already documents. Monthly CFE-bill data is always SYNTHESIZED relative
  // to true hourly load (the bill is aggregated). If/when we add a metered
  // 15-min interval path, we'll set 'METERED' here instead.
  return {
    months: months,
    provenance: 'SYNTHESIZED',
  };
}

// ---------------------------------------------------------------------------
// Full-bill reader for hourly simulation -- BDF-5
// ---------------------------------------------------------------------------
// The BESS sizer (BDF-1..4) only needs punta data. The hourly simulator
// (BDF-5) needs ALL THREE tariff buckets (base, intermedia, punta) plus
// the tariff code and region from INPUT_CFE header rows.
//
// Returns { tariff, region, monthlyBill, provenance } where monthlyBill
// is the shape calcHourlySimulation expects:
//   { kwhBase[12], kwhIntermedia[12], kwhPunta[12],
//     kwBase[12], kwIntermedia[12], kwPunta[12] }
//
// On any missing data, the corresponding array entry is 0. The simulator
// handles 0-entries gracefully (no consumption that month -> no cost).
function buildFullBillFromInputCfe(ss) {
  ss = ss || SpreadsheetApp.getActive();
  // [A2b] header scalars (cfeTariff C4 / cfeRegion C5, type text default '')
  // and 6 monthly rows via INPUT_MAP range reads. Sheet guarded first.
  // text reads + String(...||'').trim().toUpperCase() reproduce the old header
  // coercion; the per-cell Number(...)||0 over i=0..11 reproduces the old loop.
  if (!ss.getSheetByName('INPUT_CFE')) return {
    tariff: '', region: '', monthlyBill: null, provenance: 'NO_INPUT_CFE_SHEET'
  };
  // Header
  var tariff = String(readInput(ss, 'cfeTariff') || '').trim().toUpperCase();
  var region = String(readInput(ss, 'cfeRegion') || '').trim().toUpperCase();
  // Bill rows (1-indexed in CFE sheet, 0-indexed in our arrays):
  // r10 = kWh base, r11 = kWh intermedia, r12 = kWh punta
  // r13 = kW base, r14 = kW intermedia, r15 = kW punta
  var rKwhBase  = readInput(ss, 'cfeKwhBase')[0];
  var rKwhInter = readInput(ss, 'cfeKwhIntermedia')[0];
  var rKwhPunta = readInput(ss, 'cfeKwhPunta')[0];
  var rKwBase   = readInput(ss, 'cfeKwBase')[0];
  var rKwInter  = readInput(ss, 'cfeKwIntermedia')[0];
  var rKwPunta  = readInput(ss, 'cfeKwPunta')[0];
  var kwhBase = [], kwhInter = [], kwhPunta = [];
  var kwBase = [], kwInter = [], kwPunta = [];
  for (var i = 0; i < 12; i++) {
    kwhBase.push(Number(rKwhBase[i])  || 0);
    kwhInter.push(Number(rKwhInter[i]) || 0);
    kwhPunta.push(Number(rKwhPunta[i]) || 0);
    kwBase.push(Number(rKwBase[i])   || 0);
    kwInter.push(Number(rKwInter[i])  || 0);
    kwPunta.push(Number(rKwPunta[i])  || 0);
  }
  // Check if we have enough data to be useful
  var totalKwh = 0;
  for (var j = 0; j < 12; j++) totalKwh += kwhBase[j] + kwhInter[j] + kwhPunta[j];
  var provenance = (totalKwh > 0) ? 'INPUT_CFE' : 'EMPTY';
  return {
    tariff: tariff,
    region: region,
    monthlyBill: {
      kwhBase: kwhBase, kwhIntermedia: kwhInter, kwhPunta: kwhPunta,
      kwBase: kwBase, kwIntermedia: kwInter, kwPunta: kwPunta,
    },
    provenance: provenance,
  };
}

// ---------------------------------------------------------------------------
// Full CFE tariff rates reader for hourly simulation -- BDF-5 R2
// ---------------------------------------------------------------------------
// Reads 20M_CFE_TARIFFS for (tariff, region) and returns a per-month rate
// table covering ALL bill components needed to reconstruct a full CFE bill:
//   - ENERGIA BASE / INTERMEDIA / PUNTA  (MXN/kWh, kWh-driven)
//   - TRANSMISION / CENACE / SERVICIOS CONEXOS  (MXN/kWh, kWh-driven)
//   - CAPACIDAD  (MXN/kW-month, demanda-facturable-driven)
//   - DISTRIBUCION  (MXN/kW-month, max-monthly-kW-driven)
//   - SUMINISTRO BASICO  (flat MXN/month)
//
// HONEST CAVEAT: 20M_CFE_TARIFFS' CFE_GDMTH_UNIT column is INCONSISTENT for
// DISTRIBUCION and SUMINISTRO BASICO (labeled MXN/KWH but used as MXN/KW-month
// and flat MXN/month respectively per the INPUT_CFE formulas). We trust the
// FORMULA SEMANTICS in 04a_CalcCFEBill and follow them, not the UNIT column.
//
// Returns:
//   {
//     months: [               // 12 entries (Jan..Dec)
//       {
//         energiaBase: 0.8066, energiaIntermedia: 1.499, energiaPunta: 1.768,
//         transmision: 0.1801, cenace: 0.0076, serviciosConexos: 0.0069,
//         capacidadMxnPerKw: 392.2, distribucionMxnPerKw: 124.4,
//         suministroBasicoMxnFlat: 461.8,
//       },
//       ...
//     ],
//     provenance: '20M_CFE_TARIFFS' | 'MISSING' | 'INCOMPLETE',
//     tariff: 'GDMTH', region: 'GOLFO CENTRO',
//   }
//
// On any missing month / charge, the value is 0 (engine handles 0 gracefully).
function loadCfeTariffRates(ss, tariff, region) {
  var sh = ss.getSheetByName('20M_CFE_TARIFFS');
  if (!sh) {
    return { months: [], provenance: 'MISSING', tariff: tariff, region: region };
  }
  var tariffUc = String(tariff || '').trim().toUpperCase();
  var regionUc = String(region || '').trim().toUpperCase();
  var lastRow = sh.getLastRow();
  // Columns (per header): C=tariff, E=region, G=month, H=charge, J=value
  var data = sh.getRange(2, 1, lastRow - 1, 12).getValues();
  // Spanish month names in column G
  var monthMap = {
    'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
    'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11,
  };
  // Initialize 12 empty months
  var months = [];
  for (var m = 0; m < 12; m++) {
    months.push({
      energiaBase: 0, energiaIntermedia: 0, energiaPunta: 0,
      transmision: 0, cenace: 0, serviciosConexos: 0,
      capacidadMxnPerKw: 0, distribucionMxnPerKw: 0,
      suministroBasicoMxnFlat: 0,
    });
  }
  // Walk the tariff table
  var rowsFound = 0;
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowTariff = String(row[2] || '').trim().toUpperCase();    // col C
    var rowRegion = String(row[4] || '').trim().toUpperCase();    // col E
    var rowMonth  = String(row[6] || '').trim().toUpperCase();    // col G
    var rowCharge = String(row[7] || '').trim().toUpperCase();    // col H
    var rowValue  = Number(row[9]) || 0;                           // col J
    if (rowTariff !== tariffUc) continue;
    if (rowRegion !== regionUc) continue;
    var mIdx = monthMap[rowMonth];
    if (mIdx === undefined) continue;
    rowsFound++;
    switch (rowCharge) {
      case 'ENERGIA BASE':       months[mIdx].energiaBase = rowValue; break;
      case 'ENERGIA INTERMEDIA': months[mIdx].energiaIntermedia = rowValue; break;
      case 'ENERGIA PUNTA':      months[mIdx].energiaPunta = rowValue; break;
      case 'TRANSMISION':        months[mIdx].transmision = rowValue; break;
      case 'CENACE':             months[mIdx].cenace = rowValue; break;
      case 'SERVICIOS CONEXOS':
      case 'SERVICIOS CONEXOS NO MEM':  months[mIdx].serviciosConexos = rowValue; break;
      case 'CAPACIDAD':          months[mIdx].capacidadMxnPerKw = rowValue; break;
      case 'DISTRIBUCION':       months[mIdx].distribucionMxnPerKw = rowValue; break;
      case 'SUMINISTRO BASICO':  months[mIdx].suministroBasicoMxnFlat = rowValue; break;
      // FACTOR DE CARGA and other rows: ignored (informational only)
    }
  }
  var prov;
  if (rowsFound === 0) prov = 'MISSING';
  else if (rowsFound < 60) prov = 'INCOMPLETE';   // expect ~9 charges × 12 months = 108
  else prov = '20M_CFE_TARIFFS';
  return { months: months, provenance: prov, tariff: tariff, region: region };
}


// Reads CFE_SIMULATION row 8 ("Solar kWh" — the monthly PV PRODUCTION,
// not the surplus). The existing PV calc step populates this row before
// the hourly simulator runs.
//
// Returns { kwh: [12 numbers], provenance } where 'CFE_SIMULATION' means
// data was found, 'MISSING' means the sheet/row is empty (sim runs without
// PV, which is fine for pre-PV-step or PV-disabled projects).
function readMonthlyPvFromCfeSimulation(ss) {
  var sh = ss.getSheetByName('CFE_SIMULATION');
  if (!sh) return { kwh: new Array(12).fill(0), provenance: 'NO_SHEET' };
  var rowSolar = 8;  // 'Solar kWh' row
  var firstCol = 3, lastCol = 14;
  var kwh = [];
  for (var c = firstCol; c <= lastCol; c++) {
    kwh.push(Number(sh.getRange(rowSolar, c).getValue()) || 0);
  }
  var hasAny = kwh.some(function(v) { return v > 0; });
  return {
    kwh: kwh,
    provenance: hasAny ? 'CFE_SIMULATION' : 'MISSING',
  };
}

// ---------------------------------------------------------------------------
// Demand-charge rate derivation -- BDF-1
// ---------------------------------------------------------------------------
// calcBessSizing needs MXN/kW for the demand-charge saving. Like the energy
// rates above, we derive this from INPUT_CFE's actual billed "Capacidad"
// line (row 21) divided by demanda facturable (row 19). Weighted-average
// across the months that have valid data.
//
// Returns { demandChargeMxnPerKw, provenance, monthsRead }.
function deriveBessDemandChargeFromInputCfe(ss) {
  ss = ss || SpreadsheetApp.getActive();
  if (!ss.getSheetByName('INPUT_CFE')) {
    return { demandChargeMxnPerKw: 0,
             provenance: 'NO_INPUT_CFE_SHEET', monthsRead: 0 };
  }
  // [A2b] monthly rows via INPUT_MAP range reads (cfeCapacidadMxn C21:N21,
  //   cfeDemandaFacturable C19:N19). [0][i] for i=0..11 == old c=3..14 loop.
  var capRow = readInput(ss, 'cfeCapacidadMxn')[0];
  var demRow = readInput(ss, 'cfeDemandaFacturable')[0];
  var sumKw = 0, sumMxn = 0, months = 0;
  for (var i = 0; i < 12; i++) {
    var capMxn = Number(capRow[i]) || 0;
    var demKw  = Number(demRow[i]) || 0;
    if (capMxn > 0 && demKw > 0) {
      sumMxn += capMxn;
      sumKw  += demKw;
      months++;
    }
  }
  if (months < 6) {
    return { demandChargeMxnPerKw: 0,
             provenance: 'INSUFFICIENT_DATA', monthsRead: months };
  }
  return {
    demandChargeMxnPerKw: sumMxn / sumKw,
    provenance: 'INPUT_CFE_DERIVED',
    monthsRead: months,
  };
}

// ---------------------------------------------------------------------------
// Interconnection mode + export price -- BDF-2
// ---------------------------------------------------------------------------
// Reads INPUT_CFE rows 41-42 to identify how the project interfaces with the
// grid. The CFE Spanish codes (MEDICION_NETA / FACTURACION_NETA /
// SIN_EXPORTACION) map to the BESS_INTERCONN_MODE enum from 17_CalcBessSizing.
//
// Returns { mode, exportPriceMxnPerKwh, provenance }.
//   mode: one of NET_METERING/NET_BILLING/ZERO_EXPORT/UNKNOWN.
//   exportPriceMxnPerKwh: 0 if not applicable.
//   provenance: 'INPUT_CFE' on success, 'MISSING' otherwise.
function readBessInterconnectionFromInputCfe(ss) {
  ss = ss || SpreadsheetApp.getActive();
  // [A2b] coords via INPUT_MAP (cfeInterconnMode C41 / cfeExportPriceMxnPerKwh C42).
  // Sheet guarded first (readInput throws on a missing sheet). The map default
  // for cfeInterconnMode is '' so an empty cell still falls through to UNKNOWN,
  // matching the pre-migration behavior exactly.
  if (!ss.getSheetByName('INPUT_CFE')) return { mode: 'UNKNOWN', exportPriceMxnPerKwh: 0, provenance: 'MISSING' };
  var rawMode = String(readInput(ss, 'cfeInterconnMode') || '').trim().toUpperCase();
  var mode;
  switch (rawMode) {
    case 'MEDICION_NETA':    mode = 'NET_METERING'; break;
    case 'FACTURACION_NETA': mode = 'NET_BILLING';  break;
    case 'SIN_EXPORTACION':  mode = 'ZERO_EXPORT';  break;
    default:                 mode = 'UNKNOWN';
  }
  var exportPrice = Number(readInput(ss, 'cfeExportPriceMxnPerKwh')) || 0;
  return {
    mode: mode,
    exportPriceMxnPerKwh: exportPrice,
    provenance: (mode === 'UNKNOWN') ? 'MISSING' : 'INPUT_CFE',
  };
}

// ---------------------------------------------------------------------------
// PV surplus annual total -- BDF-2
// ---------------------------------------------------------------------------
// Reads CFE_SIMULATION row 42 ("PV Exportado kWh") — the monthly kWh that
// solar produced minus what the load consumed. This is the "available for
// battery charging" pool that the BDF-2 sizing engine uses for NET_BILLING
// and ZERO_EXPORT modes.
//
// HONEST CAVEAT (monthly proxy): in TIME, surplus and battery-charge-need
// don't always align. Treating annual surplus as fully captureable by the
// battery is optimistic when battery is small (it fills up during midday
// surplus, can't capture more) and reasonable when battery is large
// relative to surplus (the CULLIGAN case at 2032 kWh battery vs 900 MWh
// surplus). BDF-5 (hourly synthesizer) will tighten this.
//
// Returns { annualSurplusKwh, monthsRead, provenance }.
function readPvAnnualSurplusFromCfeSimulation(ss) {
  var sh = ss.getSheetByName('CFE_SIMULATION');
  if (!sh) return { annualSurplusKwh: 0, monthsRead: 0, provenance: 'MISSING' };
  var rowPvExportado = 42;
  var firstCol = 3, lastCol = 14;
  var total = 0, monthsRead = 0;
  for (var c = firstCol; c <= lastCol; c++) {
    var v = Number(sh.getRange(rowPvExportado, c).getValue()) || 0;
    if (v > 0) {
      total += v;
      monthsRead++;
    }
  }
  return {
    annualSurplusKwh: total,
    monthsRead: monthsRead,
    provenance: (monthsRead > 0) ? 'CFE_SIMULATION' : 'MISSING',
  };
}


// Builds typed InverterSpec[] from INPUT_DESIGN bank + MASTER_DB v3 lookup.
// Raises on INVALID entries, warns on REVIEW entries.
// Resolve the per-project optimizer-topology override against the catalog
// INV_TOPOLOGY. Pure + side-effect-free so it can be pinned by unit tests.
//
//   mode = AUTO  (default / blank / unrecognized) -> catalog value unchanged
//          ON    -> force 'OPTIMIZER' (run optimizers on a string-catalogued
//                   inverter, e.g. VITALMEX Huawei + MERC). This also makes
//                   CalcDC SKIP the string-window NOM checks (Voc cold, Vmp
//                   hot, STR-01/02/03, DC-09) because the optimizer manages
//                   per-module voltage -- a deliberate engineering assertion.
//          OFF   -> force 'STRING' (suppress optimizers even on an
//                   OPTIMIZER-catalogued inverter)
//
// CARDINAL RULE: AUTO is the default and returns the catalog value byte-for-
// byte, so no existing project changes unless the operator explicitly picks
// ON or OFF.
function resolveInverterTopology(catalogTopology, mode) {
  var cat = String(catalogTopology || 'STRING').toUpperCase().trim();
  var m   = String(mode || 'AUTO').toUpperCase().trim();
  if (m === 'ON')  return 'OPTIMIZER';
  if (m === 'OFF') return 'STRING';
  return cat; // AUTO and any unrecognized value
}

function buildInverterBank(ss, inverterBankRaw) {
  // Per-project optimizer-topology override (INPUT_DESIGN C71,
  // key optimizerTopologyMode). Read once. Default AUTO = use the catalog
  // INV_TOPOLOGY. Read defensively: if the field doesn't exist yet (before a
  // layout repair adds it) or the read fails, fall back to AUTO so behaviour
  // is unchanged. See resolveInverterTopology.
  var _topoMode = 'AUTO';
  try { _topoMode = readInput(ss, 'optimizerTopologyMode') || 'AUTO'; }
  catch (e) { _topoMode = 'AUTO'; }
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
      topology : resolveInverterTopology(db['INV_TOPOLOGY'], _topoMode),
      brand    : String(db['INV_BRAND'] || '').trim(),
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
  // AGS-204 §7 / FR-204-04 DC/AC acceptance band — single source of truth is
  // 00b_AgsRegister.js (DCAC-BAND). AGS reviews 1.35–1.40 and fails >1.40, but
  // per ARGIA policy DC/AC is a DESIGNER decision, never a hard block: the
  // engine flags (advisory) and records the AGS reference, it does not stop the
  // run. The legacy dcAcWarn/dcAcHard remain for any non-AGS consumer; the gate
  // logic (09_Validate DC-10, 04_CalcDC) uses the AGS band below.
  try {
    var _agsDcAc = (typeof agsValue === 'function') ? agsValue('DCAC-BAND') : null;
    if (_agsDcAc) {
      nom.dcAcAgsMin       = _agsDcAc.min;
      nom.dcAcAgsReviewLow = _agsDcAc.reviewLow;
      nom.dcAcAgsMax       = _agsDcAc.max;
    }
  } catch (e) { /* register absent -> fall back to AGS-B literals below */ }
  nom.dcAcAgsMin        = nom.dcAcAgsMin       || 1.10;
  nom.dcAcAgsReviewLow  = nom.dcAcAgsReviewLow || 1.35;
  nom.dcAcAgsMax        = nom.dcAcAgsMax       || 1.40;
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
    // -- Install cost sanity bounds (3.7.8 / Chunk 3). Advisory only — used by
    //    09c_InstallCostSanity.checkInstallCostSanity() to warn when computed
    //    install costs drift outside industry-typical ranges. Tighten these
    //    once 94_INSTALL_BENCHMARKS has historical data.
    //    Sources: NREL 2024 ATB, BloombergNEF 2024, ARGIA market review.
    'install_pv_mxn_per_wp_warn_min': 1.0,      // commercial Mexico floor
    'install_pv_mxn_per_wp_warn_max': 5.0,      // small-job ceiling
    'install_bess_usd_per_kwh_warn_min': 30,    // BoP-only floor
    'install_bess_usd_per_kwh_warn_max': 200,   // BoP-only ceiling
    'install_blended_labor_rate_warn_min': 80,  // non-union helper floor
    'install_blended_labor_rate_warn_max': 400, // specialist subcon ceiling
  };
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}