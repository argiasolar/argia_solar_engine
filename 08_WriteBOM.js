// =============================================================================
// ARGIA ENGINE v7 -- File: 08_WriteBOM.gs
// Fixed-row BOM: every section writes to a predetermined row.
// Formatting is done ONCE manually in the template sheet.
// Engine only writes values -- clearContent() preserves formatting.
//
// FIXED ROW MAP (127 rows total):
//   1       : Title
//   2       : Column headers
//   3       : FX rate (TC USD/MXN in F3)
//   4       : Section header -- 1. PANELES SOLARES
//   5-9     : Panel types 1-5
//   10      : SUBTOTAL PANELES  =SUM(F5:F9)
//   11      : Section header -- 2. INVERSORES
//   12-16   : Inverter types 1-5
//   17      : SUBTOTAL INVERSORES  =SUM(F12:F16)
//   18      : Section header -- 3. ESTRUCTURA
//   19-21   : Structure items
//   22      : SUBTOTAL ESTRUCTURA  =SUM(F19:F21)
//   23      : Section header -- 4. ELECTRICO DC
//   24-31   : DC items (cable, tierra, MC4, OCPD, conduit, RSD, 2 spare)
//   32      : SUBTOTAL ELECTRICO DC  =SUM(F24:F31)
//   33      : Section header -- 5. ELECTRICO AC
//   34-38   : AC per inverter type (1 combined row per type, max 5)
//   39-45   : Feeder cable, tierra, breaker, conduit, panelboard, 2 spare
//   46      : SUBTOTAL ELECTRICO AC  =SUM(F34:F45)
//   47      : Section header -- 6. TRANSFORMADOR
//   48-49   : Transformer + spare
//   50      : SUBTOTAL TRANSFORMADOR  =SUM(F48:F49)
//   51      : Section header -- 7. MONITOREO
//   52-58   : Monitoring items (6 fixed + 1 spare)
//   59      : SUBTOTAL MONITOREO  =SUM(F52:F58)
//   60      : blank buffer
//   61      : TOTAL  =F10+F17+F22+F32+F46+F50+F59
//   62-63   : blank buffer
//   64      : Section header -- FALLAS
//   65      : Failure column headers
//   66-94   : Failure rows (max 29)
//   95      : blank buffer
//   96      : Section header -- NOM RESUMEN
//   97      : NOM column headers
//   98-126  : NOM rule rows (29 rules)
//   127     : Timestamp
// =============================================================================

var BOS_MIRROR       = '14M_PRODUCTS_BOS';
var STRUCTURE_MIRROR = '13M_PRODUCTS_STRUCTURES';

// =============================================================================
// STRUCTURE PRICE LOOKUP
// Column STR_PRICE_PER_KWP_MXN (col M = index 12) stores USD per panel.
// The column name is a legacy mislabel \u2014 values are USD/panel not MXN/kWp.
//
// ROBUST HEADER DETECTION:
// IMPORTRANGE mirrors sometimes have a blank or title row at row 0, pushing
// the real header row to row 1. We scan the first 5 rows for the header
// (identified by containing 'STR_ID') and fall back to column index if needed.
// Col index constants (0-based): MODEL=2 (col C), PRICE=12 (col M)
// =============================================================================
var STR_COL_ID    = 0;   // col A \u2014 STR_ID
var STR_COL_BRAND = 1;   // col B \u2014 STR_BRAND
var STR_COL_MODEL = 2;   // col C \u2014 STR_MODEL
var STR_COL_PRICE = 12;  // col M \u2014 USD per panel (mislabeled as STR_PRICE_PER_KWP_MXN)

// Display separator used in the dropdown composite "BRAND \u2014 MODEL \u2014 STR_ID".
// Em-dash with surrounding spaces. Kept here so resolver and dropdown formula
// stay in sync. If you change one, change the other (_DROPDOWNS!A2 formula in
// 02e_InputSetup.gs).
var STR_DROPDOWN_SEP = ' \u2014 ';

function loadStructureDb(ss) {
  var sh = ss.getSheetByName(STRUCTURE_MIRROR);
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];

  // Find the header row \u2014 look for 'STR_ID' in column A within first 5 rows
  var headerRowIdx = -1;
  for (var i = 0; i < Math.min(5, data.length); i++) {
    if (String(data[i][0] || '').trim().toUpperCase() === 'STR_ID') {
      headerRowIdx = i;
      break;
    }
  }

  // Build rows array \u2014 everything after the header row
  var dataRows = headerRowIdx >= 0
    ? data.slice(headerRowIdx + 1)
    : data.slice(1);  // fallback: assume row 0 is header

  // Build header map if found, otherwise use index-based access only
  var headers = headerRowIdx >= 0
    ? data[headerRowIdx].map(function(h) { return String(h).trim(); })
    : [];

  return dataRows
    .filter(function(r) { return r[0] !== '' && r[0] !== null && r[0] !== undefined; })
    .map(function(row) {
      var obj = { _raw: row };  // keep raw row for index-based fallback
      headers.forEach(function(h, i) { if (h) obj[h] = row[i]; });
      return obj;
    });
}

// =============================================================================
// resolveStructure -- canonical resolver for the structure dropdown
// =============================================================================
// Takes whatever string is in INPUT_DESIGN!C15 (the structure dropdown cell)
// and resolves it to a concrete DB row.
//
// Resolution order:
//   1. Canonical "BRAND \u2014 MODEL \u2014 STR_ID" format from the dropdown:
//      tail token after the last em-dash is the STR_ID. Match by STR_ID
//      directly. Most robust against brand/model rename in DB.
//   2. Legacy free-text fallback: match by STR_MODEL only (case-insensitive,
//      trimmed). Preserves existing projects whose C15 still says
//      "STRUCTURE KR18" before the user picks from the new dropdown.
//   3. Brand+Model fallback: split on em-dash with 2 parts and match by
//      brand+model combo. Catches a partial paste of the dropdown text.
//
// Returns:
//   { strId, brand, model, priceUsd, raw }   on success
//   null                                     when no row matches
//
// Notes:
//   - priceUsd may be null even when the row resolves (price column blank).
//   - Resolver is permissive: returns the first match in DB order. With the
//     STR_ID path this is unambiguous by construction. The model-only
//     fallback is the only place collisions can happen, and that path only
//     fires for legacy data.
// =============================================================================
function resolveStructure(structureDb, displayString) {
  if (!structureDb || structureDb.length === 0) return null;
  if (!displayString) return null;

  var s = String(displayString).trim();
  if (s === '') return null;

  // ---- Path 1: canonical "BRAND \u2014 MODEL \u2014 STR_ID" -------------------
  // Split on em-dash with surrounding whitespace. STR_ID is the tail token.
  var parts = s.split(/\s+\u2014\s+/);
  if (parts.length >= 3) {
    var tailId = String(parts[parts.length - 1]).trim().toUpperCase();
    if (tailId !== '') {
      for (var i = 0; i < structureDb.length; i++) {
        var raw = structureDb[i]._raw;
        var dbId = String(raw[STR_COL_ID] || '').trim().toUpperCase();
        if (dbId === tailId) return _structureRowToObject(raw);
      }
      // Tail looked like an STR_ID but didn't match the DB. Fall through to
      // brand+model match in case the DB row was renumbered.
    }
  }

  // ---- Path 2: brand + model (2-part split) -----------------------------
  if (parts.length === 2) {
    var b = String(parts[0]).trim().toUpperCase();
    var m = String(parts[1]).trim().toUpperCase();
    for (var j = 0; j < structureDb.length; j++) {
      var raw2 = structureDb[j]._raw;
      var db2b = String(raw2[STR_COL_BRAND] || '').trim().toUpperCase();
      var db2m = String(raw2[STR_COL_MODEL] || '').trim().toUpperCase();
      if (db2b === b && db2m === m) return _structureRowToObject(raw2);
    }
  }

  // ---- Path 3: legacy free-text \u2014 model only ---------------------------
  var search = s.toUpperCase();
  for (var k = 0; k < structureDb.length; k++) {
    var raw3 = structureDb[k]._raw;
    var db3m = String(raw3[STR_COL_MODEL] || '').trim().toUpperCase();
    if (db3m === search) return _structureRowToObject(raw3);
  }

  return null;
}

function _structureRowToObject(raw) {
  var price = parseFloat(raw[STR_COL_PRICE]);
  return {
    strId   : String(raw[STR_COL_ID]    || '').trim(),
    brand   : String(raw[STR_COL_BRAND] || '').trim(),
    model   : String(raw[STR_COL_MODEL] || '').trim(),
    priceUsd: (isNaN(price) || price <= 0) ? null : price,
    raw     : raw
  };
}

// Backward-compat wrapper. Existing call sites pass a model string and want
// USD/panel back. New code should call resolveStructure() directly to also
// get the STR_ID for traceability.
function structurePriceUsdPerPanel(structureDb, modelName) {
  var info = resolveStructure(structureDb, modelName);
  return info ? info.priceUsd : null;
}
function loadBosDb(ss) {
  var sh = ss.getSheetByName(BOS_MIRROR);
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];

  // Scan first 5 rows to find the header row and BOS_ID column index.
  // IMPORTRANGE mirrors can have a blank row at top, shifting headers to row 2.
  var headerRowIdx = 0;
  var bosIdColIdx  = 0;  // fallback: assume col A
  for (var hri = 0; hri < Math.min(5, data.length); hri++) {
    for (var ci = 0; ci < data[hri].length; ci++) {
      if (String(data[hri][ci]).trim().toUpperCase() === 'BOS_ID') {
        headerRowIdx = hri;
        bosIdColIdx  = ci;
        break;
      }
    }
    if (bosIdColIdx > 0 || String(data[hri][0]).trim().toUpperCase() === 'BOS_ID') break;
  }

  var headers = data[headerRowIdx].map(function(h) { return String(h).trim(); });

  return data.slice(headerRowIdx + 1)
    .filter(function(r) {
      var id = String(r[bosIdColIdx] || '').trim();
      return id !== '' && id !== 'BOS_ID';  // skip blank rows and any repeated header rows
    })
    .map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) { if (h) obj[h] = row[i]; });
      // Store raw row AND BOS_ID by both column index and header name.
      // This survives any header shift or column reordering in IMPORTRANGE mirrors.
      obj['_raw']   = row;
      obj['_bosId'] = String(row[bosIdColIdx] || '').trim();
      return obj;
    });
}
// Returns raw price number (legacy — use bosPriceObj for new code).
// Currency depends on BOS_CURRENCY column — check with bosPriceObj.
function bosPrice(bosDb, category, subcategory, ratingOrSize) {
  var obj = bosPriceObj(bosDb, category, subcategory, ratingOrSize);
  return obj ? obj.price : null;
}

// Returns {price, isUsd} or null. isUsd=true when BOS_CURRENCY='USD'.
// Use isUsd to decide which wp() parameter to pass the price to:
//   isUsd=true  → wp(row, null, price)  — direct USD unit price
//   isUsd=false → wp(row, price, null)  — MXN unit price (formula divides by TC)
function bosPriceObj(bosDb, category, subcategory, ratingOrSize) {
  var cat  = String(category || '').toUpperCase().trim();
  var sub  = String(subcategory || '').toUpperCase().trim();
  var rate = String(ratingOrSize || '').toUpperCase().trim();
  for (var i = 0; i < bosDb.length; i++) {
    var r = bosDb[i];
    if (String(r['BOS_CATEGORY']    || '').toUpperCase().trim() !== cat) continue;
    if (String(r['BOS_SUBCATEGORY'] || '').toUpperCase().trim() !== sub) continue;
    if (String(r['BOS_RATING_OR_SIZE'] || '').toUpperCase().trim() !== rate) continue;
    var p = parseFloat(r['BOS_PRICE_PER_UNIT_MXN']);
    if (isNaN(p) || p === 0) continue;  // skip zero-price rows, keep searching
    var isUsd = String(r['BOS_CURRENCY'] || '').toUpperCase().trim() === 'USD';
    // Read BOS_ID in priority order:
    // 1. _bosId: set by column index during loadBosDb (most reliable)
    // 2. BOS_ID: set by header name during loadBosDb (may fail if header shifted)
    // 3. _raw[0]: raw column A value (fallback — BOS_ID is always in col A)
    var foundId = r['_bosId'] || String(r['BOS_ID'] || '').trim() ||
                  (r['_raw'] ? String(r['_raw'][0] || '').trim() : '');
    return { price: p, isUsd: isUsd, id: foundId };
  }
  return null;
}
function conductorPriceObj(bosDb, awgLabel) {
  var key = String(awgLabel).trim().toUpperCase();
  if (key.indexOf('AWG') === -1) key = key + ' AWG';
  return bosPriceObj(bosDb, 'CONDUCTORS', 'WIRE THHW', key) ||
         bosPriceObj(bosDb, 'CONDUCTORS', 'WIRE THHW', awgLabel + ' AWG') ||
         bosPriceObj(bosDb, 'CONDUCTORS', 'PV WIRE',   key) ||
         bosPriceObj(bosDb, 'CONDUCTORS', 'PV WIRE',   awgLabel + ' AWG');
}
function conductorPriceMxn(bosDb, awgLabel) {
  var obj = conductorPriceObj(bosDb, awgLabel);
  return obj ? obj.price : null;
}
function groundPriceObj(bosDb, awgLabel) {
  var key = String(awgLabel).trim().toUpperCase();
  if (key.indexOf('AWG') === -1) key = key + ' AWG';
  return bosPriceObj(bosDb, 'CONDUCTORS', 'BARE COPPER', key) ||
         bosPriceObj(bosDb, 'CONDUCTORS', 'BARE COPPER', awgLabel + ' AWG');
}
function groundPriceMxn(bosDb, awgLabel) {
  var obj = groundPriceObj(bosDb, awgLabel);
  return obj ? obj.price : null;
}
// Converts decimal conduit size to the fractional label in DB model strings.
// e.g.  0.5->'1/2',  1.25->'1 1/4',  2.5->'2 1/2'
function conduitSizeLabel(sz) {
  var map = {
    0.5:'1/2', 0.75:'3/4',
    1:'1', 1.25:'1 1/4', 1.5:'1 1/2',
    2:'2', 2.25:'2 1/4', 2.5:'2 1/2', 2.75:'2 3/4',
    3:'3', 3.5:'3 1/2', 4:'4',
  };
  return map[parseFloat(sz)] || String(sz);
}

// Returns {price, isUsd} for a TUBO CONDUIT IMC 3m stick, or null if not found.
// DB model pattern: "TUBO CONDUIT IMC  DE {fraction}" X 3M"
// Match: search for 'DE {label}"' in the model string — avoids false matches where
// label '1' would hit 'DE 1/2"' (which contains '1' but not 'DE 1"').
function conduitPriceObj(bosDb, sizeIn) {
  var sz = parseFloat(String(sizeIn));
  if (isNaN(sz)) return null;
  var label = conduitSizeLabel(sz).toUpperCase();
  var needle = 'DE ' + label + '"';  // e.g. 'DE 1"', 'DE 1 1/4"', 'DE 2 1/2"'
  for (var i = 0; i < bosDb.length; i++) {
    var r = bosDb[i];
    if (String(r['BOS_CATEGORY']    || '').toUpperCase().trim() !== 'CONDUIT') continue;
    if (String(r['BOS_SUBCATEGORY'] || '').toUpperCase().trim() !== 'RIGID IMC') continue;
    var model = String(r['BOS_MODEL'] || '').toUpperCase();
    if (model.indexOf('TUBO') === -1) continue;
    if (model.indexOf(needle) === -1) continue;
    var p = parseFloat(r['BOS_PRICE_PER_UNIT_MXN']);
    if (isNaN(p) || p <= 0) continue;
    var isUsd = String(r['BOS_CURRENCY'] || '').toUpperCase().trim() === 'USD';
    var cid = r['_bosId'] || String(r['BOS_ID']||'').trim() ||
              (r['_raw'] ? String(r['_raw'][0]||'').trim() : '');
    return { price: p, isUsd: isUsd, id: cid };
  }
  return null;
}

// Legacy wrapper — delegates to conduitPriceObj
function conduitPriceMxn(bosDb, sizeIn) {
  var obj = conduitPriceObj(bosDb, sizeIn);
  return obj ? obj.price : null;
}

// Returns first SUPPORT / LADDER TRAY item with price > 0
function ladderTrayPriceObj(bosDb) {
  for (var _lt = 0; _lt < bosDb.length; _lt++) {
    var _lr = bosDb[_lt];
    if (String(_lr['BOS_CATEGORY']    || '').toUpperCase().trim() !== 'SUPPORT') continue;
    if (String(_lr['BOS_SUBCATEGORY'] || '').toUpperCase().trim() !== 'LADDER TRAY') continue;
    var _lp = parseFloat(_lr['BOS_PRICE_PER_UNIT_MXN']);
    if (!isNaN(_lp) && _lp > 0)
      return { price: _lp,
               isUsd: String(_lr['BOS_CURRENCY']||'').toUpperCase().trim()==='USD',
               id: _lr['_bosId'] || String(_lr['BOS_ID']||'').trim() };
  }
  return null;
}

function breakerILinePriceObj(bosDb, amps, poles) {
  return bosPriceObj(bosDb, 'DISTRIBUTION', 'BREAKERS', amps + ' A / ' + poles + ' POLES') ||
         bosPriceObj(bosDb, 'DISTRIBUTION', 'BREAKERS', String(amps) + 'A');
}
function breakerILinePriceMxn(bosDb, amps, poles) {
  var obj = breakerILinePriceObj(bosDb, amps, poles);
  return obj ? obj.price : null;
}

// Breaker price with fallback to next available size up.
// Returns {price, note} where note is null if exact match found,
// or a message explaining which size was used as reference.
function breakerPriceWithFallback(bosDb, amps, poles) {
  var exactObj = breakerILinePriceObj(bosDb, amps, poles);
  if (exactObj) return { price: exactObj.price, id: exactObj.id, note: null };
  var increments = [25, 50, 75, 100, 150, 200, 300, 400, 500];
  for (var i = 0; i < increments.length; i++) {
    var tryAmps = amps + increments[i];
    var tryObj  = breakerILinePriceObj(bosDb, tryAmps, poles);
    if (tryObj) {
      return {
        price: tryObj.price,
        id   : tryObj.id,
        note : 'Breaker ' + amps + 'A ' + poles + 'P no encontrado en DB \u2014 ' +
               'usando precio de ' + tryAmps + 'A como referencia. Cotizar con proveedor.'
      };
    }
  }
  return { price: null, id: '', note: 'Precio pendiente \u2014 breaker ' + amps + 'A ' + poles + 'P no en DB. Cotizar con proveedor.' };
}
function panelboardPriceObj(bosDb, maxAmps) {
  var best = null, bestAmps = Infinity;
  bosDb.forEach(function(r) {
    if (String(r['BOS_CATEGORY']    || '').toUpperCase().trim() !== 'DISTRIBUTION') return;
    if (String(r['BOS_SUBCATEGORY'] || '').toUpperCase().trim() !== 'LOAD CENTER') return;
    var rAmps = parseFloat(r['BOS_RATING_OR_SIZE']);
    if (!isNaN(rAmps) && rAmps >= maxAmps && rAmps < bestAmps) {
      var p = parseFloat(r['BOS_PRICE_PER_UNIT_MXN']);
      if (!isNaN(p) && p > 0) {
        best = { price: p, isUsd: String(r['BOS_CURRENCY']||'').toUpperCase().trim()==='USD', id: r['_bosId'] || String(r['BOS_ID']||'').trim() || (r['_raw'] ? String(r['_raw'][0]||'').trim() : '') };
        bestAmps = rAmps;
      }
    }
  });
  return best;
}
function panelboardPriceMxn(bosDb, maxAmps) {
  var obj = panelboardPriceObj(bosDb, maxAmps);
  return obj ? obj.price : null;
}
function transformerPriceObj(bosDb, kva) {
  var best = null, bestKva = Infinity;
  bosDb.forEach(function(r) {
    if (String(r['BOS_CATEGORY']    || '').toUpperCase().trim() !== 'DISTRIBUTION') return;
    if (String(r['BOS_SUBCATEGORY'] || '').toUpperCase().trim() !== 'TRANSFORMERS') return;
    var rKva = parseFloat(r['BOS_RATING_OR_SIZE']);
    if (!isNaN(rKva) && rKva >= kva && rKva < bestKva) {
      var p = parseFloat(r['BOS_PRICE_PER_UNIT_MXN']);
      if (!isNaN(p) && p > 0) {
        best = { price: p, isUsd: String(r['BOS_CURRENCY']||'').toUpperCase().trim()==='USD', id: r['_bosId'] || String(r['BOS_ID']||'').trim() || (r['_raw'] ? String(r['_raw'][0]||'').trim() : '') };
        bestKva = rKva;
      }
    }
  });
  return best;
}
function transformerPriceMxn(bosDb, kva) {
  var obj = transformerPriceObj(bosDb, kva);
  return obj ? obj.price : null;
}
function mc4PriceObj(bosDb) {
  return bosPriceObj(bosDb, 'CONNECTORS', 'MC4', '10') ||
         bosPriceObj(bosDb, 'CONNECTORS', 'MC4', '8');
}
function mc4PriceMxn(bosDb) {
  var obj = mc4PriceObj(bosDb);
  return obj ? obj.price : null;
}
function monitoringPriceObj(bosDb) {
  var obj = bosPriceObj(bosDb, 'MONITORING', 'MONITORING PACKAGE', null);
  if (obj) return obj;
  for (var i = 0; i < bosDb.length; i++) {
    var r = bosDb[i];
    if (String(r['BOS_MODEL'] || '').toUpperCase().indexOf('HUAWEI MONITO') !== -1) {
      var q = parseFloat(r['BOS_PRICE_PER_UNIT_MXN']);
      if (!isNaN(q) && q > 0) return { price: q, isUsd: String(r['BOS_CURRENCY']||'').toUpperCase().trim()==='USD', id: r['_bosId'] || String(r['BOS_ID']||'').trim() || (r['_raw'] ? String(r['_raw'][0]||'').trim() : '') };
    }
  }
  return null;
}
function monitoringPriceMxn(bosDb) {
  var obj = monitoringPriceObj(bosDb);
  return obj ? obj.price : null;
}
function meterPriceObj(bosDb) {
  for (var i = 0; i < bosDb.length; i++) {
    var r = bosDb[i];
    if (String(r['BOS_MODEL'] || '').toUpperCase().indexOf('ION MEDIDOR') !== -1) {
      var p = parseFloat(r['BOS_PRICE_PER_UNIT_MXN']);
      if (!isNaN(p) && p > 0) return { price: p, isUsd: String(r['BOS_CURRENCY']||'').toUpperCase().trim()==='USD', id: r['_bosId'] || String(r['BOS_ID']||'').trim() || (r['_raw'] ? String(r['_raw'][0]||'').trim() : '') };
    }
  }
  return null;
}
function meterPriceMxn(bosDb) {
  var obj = meterPriceObj(bosDb);
  return obj ? obj.price : null;
}

// =============================================================================
// MAIN WRITE FUNCTION -- FIXED ROWS
// =============================================================================
function writeBOM(ss, inp, panel, invBank, dc, ac, lay, nom, bessResult) {
  var bom = ss.getSheetByName(SH.BOM);
  if (!bom) bom = ss.insertSheet(SH.BOM);

  // Clear values+notes only -- preserves all formatting set by setupBOMTemplate.
  // Starts at row 4 (PROJECT_META) to preserve banner title/subtitle at rows 2-3.
  // BDF-7: extended clear range to GRAND_TOTAL (row 94) to cover §8 BESS.
  var clearRows = BOM_ROW.GRAND_TOTAL - BOM_ROW.PROJECT_META + 1;
  bom.getRange(BOM_ROW.PROJECT_META, 1, clearRows, 8).clearContent();
  bom.getRange(BOM_ROW.PROJECT_META, 1, clearRows, 8).clearNote();

  var bosDb       = loadBosDb(ss);
  var structureDb = loadStructureDb(ss);
  var C_WARN = '#fffde7'; var C_FAIL = '#fce4ec'; var C_PASS = '#f1f8e9'; var C_LIGHT = '#eceff1';
  var itemNo = 1;

  // -- Write value to fixed cell (skip if empty) --
  function w(r, c, val) {
    if (val !== null && val !== undefined && val !== '') {
      bom.getRange(r, c).setValue(val);
    }
  }

  // -- Write price formulas at a fixed row --
  // priceMxn: raw MXN amount (will be divided by $F$<EXCHANGE_RATE> for USD)
  // priceUsd: already-USD amount (panels, inverters)
  function wp(r, priceMxn, priceUsd) {
    if (priceUsd && priceUsd > 0) {
      bom.getRange(r, 5).setValue(priceUsd).setNumberFormat('#,##0.00');
    } else if (priceMxn && priceMxn > 0) {
      bom.getRange(r, 5).setFormula('=' + priceMxn.toFixed(4) + '/$F$' + BOM_ROW.EXCHANGE_RATE).setNumberFormat('#,##0.00');
    }
    bom.getRange(r, 6).setFormula('=C' + r + '*E' + r).setNumberFormat('#,##0.00');
    bom.getRange(r, 7).setFormula('=F' + r + '*$F$' + BOM_ROW.EXCHANGE_RATE).setNumberFormat('#,##0');
  }

  // -- Style helpers for visually distinguishing section header / subtotal /
  // grand total rows from regular item rows. Backgrounds use light cream
  // tones so PDF export stays clean (no jarring colored bars).

  // Section header row (rows like "1. PANELES SOLARES")
  // Bold, light-grey background, slightly larger font
  function styleSectionHeader(r) {
    bom.getRange(r, 1, 1, 8)
      .setBackground('#f5f5f5')
      .setFontWeight('bold')
      .setFontSize(11);
    bom.setRowHeight(r, 24);
  }

  // Subtotal row (rows like "SUBTOTAL PANELES SOLARES")
  // Bold label + bold totals + light cream background + top border
  function styleSubtotal(r) {
    bom.getRange(r, 1, 1, 8)
      .setBackground('#fff8e1')
      .setFontWeight('bold')
      .setBorder(true, null, null, null, null, null, '#bdbdbd', SpreadsheetApp.BorderStyle.SOLID);
    bom.setRowHeight(r, 22);
  }

  // Grand total row — strongest emphasis: bold large font + thicker border
  function styleGrandTotal(r) {
    bom.getRange(r, 1, 1, 8)
      .setBackground('#fffde7')
      .setFontWeight('bold')
      .setFontSize(12)
      .setBorder(true, null, true, null, null, null, '#424242', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    bom.setRowHeight(r, 28);
  }

  // -- Write subtotal with fixed SUM range --
  // Writes label to col B (description), formulas to col F (USD) + G (MXN),
  // and applies subtotal row styling.
  function ws(r, r1, r2, label) {
    if (label) w(r, BOM_COL.DESCRIPTION, label);
    bom.getRange(r, BOM_COL.TOTAL_USD).setFormula('=SUM(F' + r1 + ':F' + r2 + ')').setNumberFormat('#,##0.00');
    bom.getRange(r, BOM_COL.TOTAL_MXN).setFormula('=F' + r + '*$F$' + BOM_ROW.EXCHANGE_RATE).setNumberFormat('#,##0');
    styleSubtotal(r);
  }

  //  ROWS 1-3: Header 
  w(BOM_ROW.PROJECT_META, BOM_COL.ITEM, 'BOM -- ' + inp.projectName + ' | ' + inp.clientName +
    ' | ' + inp.panelQty + ' mod x ' + panel['PANEL_POWER_W'] +
    'W = ' + dc.dcKwp.toFixed(2) + ' kWp / ' + dc.acKwTotal + ' kWac');
  ['#','DESCRIPCION','QTY','UNIDAD','PRECIO U (USD)','TOTAL (USD)','TOTAL (MXN)','REFERENCIA']
    .forEach(function(h, i) { w(BOM_ROW.HEADERS, i+1, h); });
  w(BOM_ROW.EXCHANGE_RATE, BOM_COL.UNIT_PRICE, 'TC USD/MXN:');
  bom.getRange(BOM_ROW.EXCHANGE_RATE, BOM_COL.TOTAL_USD).setValue(18.50).setNumberFormat('#,##0.00')
    .setNote('Actualiza el tipo de cambio USD/MXN aqui. Todas las formulas MXN usan $F$<EXCHANGE_RATE>.');

  // Cable tray metres — read via readInput (logical key). Points at INPUT_INSTALL
  // D16 per INPUT_MAP. Historically read directly from legacy INPUT_DESIGN!M51;
  // migrated 2026-04-24 Phase 2a so fixture's install.trayM value is honored
  // and test isolation is preserved (no silent dependency on sheet state).
  var trayM = parseFloat(readInput(ss, 'trayM')) || 0;

  //  ROWS 4-10: Section 1 -- PANELES 
  w(BOM_ROW.SEC_PANELS, BOM_COL.DESCRIPTION, '1. PANELES SOLARES');
  styleSectionHeader(BOM_ROW.SEC_PANELS);

  // Primary panel (row 5)
  var panelPriceWp = parseFloat(panel['PANEL_PRICE_Wp_USD']) || null;
  var panelUsdUnit = panelPriceWp ? panelPriceWp * parseFloat(panel['PANEL_POWER_W']) : null;
  w(BOM_ROW.PANEL_PRIMARY, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.PANEL_PRIMARY, BOM_COL.DESCRIPTION, (panel['PANEL_BRAND'] + ' ' + panel['PANEL_MODEL'] + ' ' +
    panel['PANEL_POWER_W'] + 'W ' + (panel['PANEL_TECHNOLOGY'] || '') +
    ' ' + (panel['PANEL_CELL_TYPE'] || '')).trim());
  w(BOM_ROW.PANEL_PRIMARY, BOM_COL.QTY, inp.panelQty); w(BOM_ROW.PANEL_PRIMARY, BOM_COL.UNIT, 'pcs'); w(BOM_ROW.PANEL_PRIMARY, BOM_COL.REFERENCE, panel['PROD_ID'] || '');
  wp(BOM_ROW.PANEL_PRIMARY, null, panelUsdUnit);
  if (!panelUsdUnit) bom.getRange(BOM_ROW.PANEL_PRIMARY, BOM_COL.UNIT_PRICE).setNote('Precio pendiente -- PANEL_PRICE_Wp_USD no definido en DB');

  // Secondary panels (rows after PANEL_PRIMARY, from inp.secondaryPanels)
  if (inp.secondaryPanels && inp.secondaryPanels.length > 0) {
    inp.secondaryPanels.slice(0, 4).forEach(function(sp, si) {
      var r = BOM_ROW.PANEL_PRIMARY + 1 + si;
      w(r, BOM_COL.ITEM, itemNo++);
      w(r, BOM_COL.DESCRIPTION, '[SECUNDARIO] ' + sp.model + ' ' + sp.powerW + 'W');
      w(r, BOM_COL.QTY, sp.qty); w(r, BOM_COL.UNIT, 'pcs');
      w(r, BOM_COL.REFERENCE, 'NOM calcs usan panel primario (fila ' + BOM_ROW.PANEL_PRIMARY + ')');
      bom.getRange(r, BOM_COL.UNIT_PRICE).setNote('Panel secundario -- cotizar por separado');
      bom.getRange(r, BOM_COL.TOTAL_USD).setFormula('=C' + r + '*E' + r).setNumberFormat('#,##0.00');
      bom.getRange(r, BOM_COL.TOTAL_MXN).setFormula('=F' + r + '*$F$' + BOM_ROW.EXCHANGE_RATE).setNumberFormat('#,##0');
    });
  }
  ws(BOM_ROW.SUBTOTAL_PANELS,    BOM_ROW.PANEL_PRIMARY,    BOM_ROW.SUBTOTAL_PANELS - 1, 'SUBTOTAL PANELES SOLARES');

  //  Section 2 -- INVERSORES
  w(BOM_ROW.SEC_INVERTERS, BOM_COL.DESCRIPTION, '2. INVERSORES');
  styleSectionHeader(BOM_ROW.SEC_INVERTERS);
  invBank.slice(0, 5).forEach(function(inv, i) {
    var r = BOM_ROW.INVERTER_PRIMARY + i;
    w(r, BOM_COL.ITEM, itemNo++);
    w(r, BOM_COL.DESCRIPTION, inv.model + ' ' + inv.acKw + 'kW -- ' + inv.voltage + 'V ' + (inv.phase===3?'3F':'1F'));
    w(r, BOM_COL.QTY, inv.qty); w(r, BOM_COL.UNIT, 'pcs'); w(r, BOM_COL.REFERENCE, inv.invId || '');
    var priceUsd = (inv.priceUsd && inv.priceUsd > 0) ? inv.priceUsd : null;
    wp(r, null, priceUsd);
    if (!priceUsd) bom.getRange(r, BOM_COL.UNIT_PRICE).setNote('Precio pendiente de cotizacion');
  });
  ws(BOM_ROW.SUBTOTAL_INVERTERS, BOM_ROW.INVERTER_PRIMARY, BOM_ROW.SUBTOTAL_INVERTERS - 1, 'SUBTOTAL INVERSORES');

  //  ROWS 18-22: Section 3 -- ESTRUCTURA 
  w(BOM_ROW.SEC_STRUCTURE, BOM_COL.DESCRIPTION, '3. ESTRUCTURA');
  styleSectionHeader(BOM_ROW.SEC_STRUCTURE);

  // Primary structure: resolve via dropdown text "BRAND — MODEL — STR_ID"
  // (or legacy free-text fallback). resolveStructure() returns null when no
  // match, in which case we fall back to a "Cotizar" placeholder.
  var strRaw       = inp.structure || '';
  var strInfo      = resolveStructure(structureDb, strRaw);
  var strPriceUsd  = strInfo ? strInfo.priceUsd : null;
  var strUsdTotal  = strPriceUsd ? strPriceUsd * inp.panelQty : null;
  var strDisplay   = strInfo
    ? (strInfo.brand + ' ' + strInfo.model)
    : (strRaw || 'Estructura de montaje (ver INPUT_DESIGN)');
  var strRefText   = 'INPUT_DESIGN:C15 / 13M_PRODUCTS_STRUCTURES' +
                     (strInfo ? ' / ' + strInfo.strId : '');

  w(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.DESCRIPTION, strDisplay);
  w(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.QTY, inp.panelQty);
  w(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.UNIT, 'pcs');
  w(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.REFERENCE, strRefText);
  if (strUsdTotal) {
    // Price is already USD — pass as priceUsd so PRECIO_U shows USD/panel directly
    wp(BOM_ROW.STRUCTURE_PRIMARY, null, strPriceUsd);
    bom.getRange(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.UNIT_PRICE).setNote(
      'USD/panel from 13M_PRODUCTS_STRUCTURES col M.\n' +
      strInfo.strId + ' (' + strInfo.brand + ' / ' + strInfo.model + '): $' +
      strPriceUsd + ' USD/panel × ' + inp.panelQty + ' panels = $' +
      strUsdTotal.toFixed(0) + ' USD\n' +
      'Note: may need rail/accessory rows below if system requires separate rail profile.'
    );
  } else if (strInfo) {
    // Row resolved but price is blank — row exists in DB, just unpriced
    bom.getRange(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.UNIT_PRICE).setNote(
      'Estructura resuelta (' + strInfo.strId + ') pero precio no cargado en ' +
      'DB col M. Cotizar con proveedor.'
    );
  } else {
    bom.getRange(BOM_ROW.STRUCTURE_PRIMARY, BOM_COL.UNIT_PRICE).setNote(
      'No se pudo resolver la estructura "' + strRaw + '" en ' +
      '13M_PRODUCTS_STRUCTURES.\n' +
      'Selecciona un valor del dropdown en INPUT_DESIGN!C15 ' +
      '(formato: "BRAND — MODEL — STR_ID").\n' +
      'Cotizar con proveedor.'
    );
  }

  // Row 20: second structure component (e.g. rail for clip-and-rail systems)
  // For KR-18 standing seam: clip (STR_004) + rail (STR_006 RIEL KR18) are typically both needed.
  // The engine checks if INPUT_DESIGN M42 has a second structure component.
  var strModel2    = String(inp.structure2 || '').trim();
  if (strModel2) {
    var strPrice2  = structurePriceUsdPerPanel(structureDb, strModel2);
    w(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.ITEM, itemNo++);
    w(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.DESCRIPTION, strModel2);
    w(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.QTY, inp.panelQty);
    w(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.UNIT, 'pcs');
    w(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.REFERENCE, 'INPUT_DESIGN:M42 / 13M_PRODUCTS_STRUCTURES');
    if (strPrice2) {
      wp(BOM_ROW.STRUCTURE_SECONDARY, null, strPrice2);
      bom.getRange(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.UNIT_PRICE).setNote('$' + strPrice2 + ' USD/panel from DB');
    } else {
      bom.getRange(BOM_ROW.STRUCTURE_SECONDARY, BOM_COL.UNIT_PRICE).setNote('Precio pendiente: "' + strModel2 + '" no encontrado en 13M_PRODUCTS_STRUCTURES. Cotizar con proveedor.');
    }
  }

  // Row 21: inverter mounting structure (wall/pad mount per inverter)
  var invCount = invBank.reduce(function(s, inv) { return s + inv.qty; }, 0);
  w(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.ITEM, itemNo++);
  w(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.DESCRIPTION, 'Estructura montaje inversores (rack / soporte mural)');
  w(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.QTY, invCount > 0 ? invCount : 1);
  w(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.UNIT, invCount > 1 ? 'pcs' : 'lot');
  w(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.REFERENCE, 'Cotizar con proveedor');
  bom.getRange(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.UNIT_PRICE).setNote(
    'Precio a cotizar con proveedor.\n' +
    'Precio de mercado estándar: $600–$1,500 USD/inversor según modelo y tipo de montaje.\n' +
    '(soporte mural, pedestal, rack IP65 para inversores 100–150 kW)'
  );
  bom.getRange(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.TOTAL_USD).setFormula('=C' + BOM_ROW.STRUCTURE_INVERTER + '*E' + BOM_ROW.STRUCTURE_INVERTER).setNumberFormat('#,##0.00');
  bom.getRange(BOM_ROW.STRUCTURE_INVERTER, BOM_COL.TOTAL_MXN).setFormula('=F' + BOM_ROW.STRUCTURE_INVERTER + '*$F$' + BOM_ROW.EXCHANGE_RATE).setNumberFormat('#,##0');

  ws(BOM_ROW.SUBTOTAL_STRUCTURE, BOM_ROW.STRUCTURE_PRIMARY, BOM_ROW.STRUCTURE_INVERTER, 'SUBTOTAL ESTRUCTURA');

  //  ROWS 23-32: Section 4 -- ELECTRICO DC 
  w(BOM_ROW.SEC_DC, BOM_COL.DESCRIPTION, '4. ELECTRICO DC');
  styleSectionHeader(BOM_ROW.SEC_DC);

  // FIX: use actual project cable size (dc.conductorDC), not hardcoded '10 AWG'
  var pvWireObj = bosPriceObj(bosDb, 'CONDUCTORS', 'PV WIRE', dc.conductorDC + ' AWG');
  w(BOM_ROW.DC_CABLE, BOM_COL.ITEM, itemNo++); w(BOM_ROW.DC_CABLE, BOM_COL.DESCRIPTION, 'Cable DC ' + dc.conductorDC + ' ' + conductorUnit(dc.conductorDC) + ' PV WIRE Cu (string homeruns)');
  w(BOM_ROW.DC_CABLE, BOM_COL.QTY, lay.bom.dcCableM); w(BOM_ROW.DC_CABLE, BOM_COL.UNIT, 'm');
  w(BOM_ROW.DC_CABLE, BOM_COL.REFERENCE, 'DC-05 / NOM 690.8(b)' + (pvWireObj && pvWireObj.id ? ' | ' + pvWireObj.id : ''));
  wp(BOM_ROW.DC_CABLE, null, pvWireObj ? pvWireObj.price : null);
  if (!pvWireObj) bom.getRange(BOM_ROW.DC_CABLE, BOM_COL.UNIT_PRICE).setNote('PV WIRE ' + dc.conductorDC + ' ' + conductorUnit(dc.conductorDC) + ' no encontrado en 14M_PRODUCTS_BOS');

  var egcDcKey = String(dc.egcDC || '').trim().toUpperCase();
  if (egcDcKey.indexOf('AWG') === -1) egcDcKey += ' AWG';
  var egcDcObj = groundPriceObj(bosDb, egcDcKey);
  w(BOM_ROW.DC_GROUNDING, BOM_COL.ITEM, itemNo++); w(BOM_ROW.DC_GROUNDING, BOM_COL.DESCRIPTION, 'Cable tierra DC ' + dc.egcDC + ' ' + conductorUnit(dc.egcDC) + ' Cu desnudo');
  w(BOM_ROW.DC_GROUNDING, BOM_COL.QTY, lay.bom.dcGroundingM); w(BOM_ROW.DC_GROUNDING, BOM_COL.UNIT, 'm'); w(BOM_ROW.DC_GROUNDING, BOM_COL.REFERENCE, 'DC-06 / NOM 690.45' + (egcDcObj && egcDcObj.id ? ' | ' + egcDcObj.id : ''));
  if (egcDcObj) { if (egcDcObj.isUsd) { wp(BOM_ROW.DC_GROUNDING, null, egcDcObj.price); } else { wp(BOM_ROW.DC_GROUNDING, egcDcObj.price, null); } }

  var mc4Obj = mc4PriceObj(bosDb);
  w(BOM_ROW.DC_MC4, BOM_COL.ITEM, itemNo++); w(BOM_ROW.DC_MC4, BOM_COL.DESCRIPTION, 'Conector MC4 par ' + dc.conductorDC + ' ' + conductorUnit(dc.conductorDC));
  w(BOM_ROW.DC_MC4, BOM_COL.QTY, lay.bom.mc4Pairs); w(BOM_ROW.DC_MC4, BOM_COL.UNIT, 'par');
  w(BOM_ROW.DC_MC4, BOM_COL.REFERENCE, 'String termination' + (mc4Obj && mc4Obj.id ? ' | ' + mc4Obj.id : ''));
  wp(BOM_ROW.DC_MC4, null, mc4Obj ? mc4Obj.price : null);

  var dcFuseObj = bosPriceObj(bosDb, 'PROTECTION', 'DC FUSES', '20A 10X38MM') ||
                  bosPriceObj(bosDb, 'PROTECTION', 'DC FUSES', '30A 10X38MM');
  w(BOM_ROW.DC_OCPD, BOM_COL.ITEM, itemNo++); w(BOM_ROW.DC_OCPD, BOM_COL.DESCRIPTION, 'OCPD DC string ' + dc.ocpdDC + 'A (fusible 10x38mm)');
  w(BOM_ROW.DC_OCPD, BOM_COL.QTY, lay.bom.dcOcpdUnits); w(BOM_ROW.DC_OCPD, BOM_COL.UNIT, 'pcs');
  w(BOM_ROW.DC_OCPD, BOM_COL.REFERENCE, 'DC-04 / NOM 690.9' + (dcFuseObj && dcFuseObj.id ? ' | ' + dcFuseObj.id : ''));
  if (dcFuseObj) {
    if (dcFuseObj.isUsd) { wp(BOM_ROW.DC_OCPD, null, dcFuseObj.price); }
    else                 { wp(BOM_ROW.DC_OCPD, dcFuseObj.price, null); }
  }

  var condSzDC    = parseFloat(dc.conduitDC);
  var condObjDC   = conduitPriceObj(bosDb, condSzDC);
  var condSticksDC = Math.ceil(lay.bom.dcConduitM / 3);
  w(BOM_ROW.DC_CONDUIT, BOM_COL.ITEM, itemNo++);
  if (trayM > 0) {
    // Cable tray: DC horizontal homerun route
    var trayObjDC    = ladderTrayPriceObj(bosDb);
    var trayTramosDC = Math.ceil(trayM / 3);
    w(BOM_ROW.DC_CONDUIT, BOM_COL.DESCRIPTION, 'Charola tipo escalera (DC homerun horizontal) ' + trayM + 'm');
    w(BOM_ROW.DC_CONDUIT, BOM_COL.QTY, trayTramosDC); w(BOM_ROW.DC_CONDUIT, BOM_COL.UNIT, 'tramo');
    w(BOM_ROW.DC_CONDUIT, BOM_COL.REFERENCE, 'DC-08-TRAY' + (trayObjDC && trayObjDC.id ? ' | ' + trayObjDC.id : ''));
    if (trayObjDC) { wp(BOM_ROW.DC_CONDUIT, trayObjDC.price, null); }
    else bom.getRange(BOM_ROW.DC_CONDUIT, BOM_COL.UNIT_PRICE).setNote('Precio charola pendiente — cotizar con proveedor');
  } else {
    w(BOM_ROW.DC_CONDUIT, BOM_COL.DESCRIPTION, 'Conduit IMC ' + conduitSizeLabel(dc.conduitDC) + '\u0022 x 3m (DC)');
    w(BOM_ROW.DC_CONDUIT, BOM_COL.QTY, condSticksDC); w(BOM_ROW.DC_CONDUIT, BOM_COL.UNIT, 'pza');
    w(BOM_ROW.DC_CONDUIT, BOM_COL.REFERENCE, 'DC-08 / Ch9 Table 1' + (condObjDC && condObjDC.id ? ' | ' + condObjDC.id : ''));
    if (condObjDC) {
      if (condObjDC.isUsd) { wp(BOM_ROW.DC_CONDUIT, null, condObjDC.price); }
      else                 { wp(BOM_ROW.DC_CONDUIT, condObjDC.price, null); }
    }
  }

  var rsdQty = lay.bom.rsdRequired ? Math.ceil(inp.stringsTotal / 5) : 0;
  w(BOM_ROW.DC_RSD, BOM_COL.ITEM, itemNo++); w(BOM_ROW.DC_RSD, BOM_COL.DESCRIPTION, 'Dispositivo apagado rapido RSD (ROOF)');
  w(BOM_ROW.DC_RSD, BOM_COL.QTY, rsdQty > 0 ? rsdQty : ''); w(BOM_ROW.DC_RSD, BOM_COL.UNIT, 'pcs'); w(BOM_ROW.DC_RSD, BOM_COL.REFERENCE, 'SAFE-01 / NOM 690.12');
  if (rsdQty > 0) {
    wp(BOM_ROW.DC_RSD, null, 2500);  // $2,500 USD default per unit
    bom.getRange(BOM_ROW.DC_RSD, BOM_COL.UNIT_PRICE).setNote(
      'Precio referencia $2,500 USD/unidad \u2014 confirmar con proveedor.\n' +
      'NOM 690.12 requiere RSD en instalaciones de azotea.'
    );
  }
  // Rows 30-31: spare DC
  ws(BOM_ROW.SUBTOTAL_DC,        BOM_ROW.DC_CABLE,         BOM_ROW.SUBTOTAL_DC - 1, 'SUBTOTAL ELECTRICO DC');

  //  ROWS 33-77: Section 5 -- ELECTRICO AC (fixed layout, 5 inverter slots × 4 rows)
  //
  //  Per-inverter (rows 34-53): slot n occupies rows (34 + n*4) through (37 + n*4)
  //    row+0: AC cable THHW (metres)
  //    row+1: EGC bare copper (metres)
  //    row+2: OCPD breaker (pcs) \u2014 fallback to next size up if exact not found
  //    row+3: Conduit IMC (sticks)
  //  Empty slots stay blank (cleared by clearContent at start of function).
  //  Main feeder (rows 54-58): cable, EGC, breaker, conduit, panelboard
  //  AC SUBTOTAL: row 60  =SUM(F34:F59)
  //  TRANSFORMER: rows 61-65 (header/item/2 spare/subtotal)
  //  MONITORING:  rows 66-75 (header/datalogger/meter/4 services/1 spare/subtotal)
  //  GRAND TOTAL: row 77  =F10+F17+F22+F32+F60+F65+F75

  w(BOM_ROW.SEC_AC, BOM_COL.DESCRIPTION, '5. ELECTRICO AC');
  styleSectionHeader(BOM_ROW.SEC_AC);


  // Main feeder first (rows 34-38) — always present regardless of inverter count
  var mCableObj = conductorPriceObj(bosDb, ac.condMain);
  w(BOM_ROW.AC_FEEDER, BOM_COL.ITEM, itemNo++); w(BOM_ROW.AC_FEEDER, BOM_COL.DESCRIPTION, 'Cable alimentador principal ' + ac.condMain + ' ' + conductorUnit(ac.condMain) + ' THHW Cu');
  w(BOM_ROW.AC_FEEDER, BOM_COL.QTY, lay.bom.mainFeederCableM); w(BOM_ROW.AC_FEEDER, BOM_COL.UNIT, 'm'); w(BOM_ROW.AC_FEEDER, BOM_COL.REFERENCE, 'AC-02 / main feeder' + (mCableObj && mCableObj.id ? ' | ' + mCableObj.id : ''));
  if (mCableObj) { if (mCableObj.isUsd) { wp(BOM_ROW.AC_FEEDER, null, mCableObj.price); } else { wp(BOM_ROW.AC_FEEDER, mCableObj.price, null); } }
  else bom.getRange(BOM_ROW.AC_FEEDER, BOM_COL.UNIT_PRICE).setNote('Precio pendiente \u2014 cotizar con proveedor');

  var mEgcObj = groundPriceObj(bosDb, ac.egcMain);
  w(BOM_ROW.AC_EGC, BOM_COL.ITEM, itemNo++); w(BOM_ROW.AC_EGC, BOM_COL.DESCRIPTION, 'Cable tierra principal ' + ac.egcMain + ' ' + conductorUnit(ac.egcMain) + ' Cu desnudo');
  w(BOM_ROW.AC_EGC, BOM_COL.QTY, lay.bom.mainEgcM); w(BOM_ROW.AC_EGC, BOM_COL.UNIT, 'm'); w(BOM_ROW.AC_EGC, BOM_COL.REFERENCE, 'AC-03 / NOM 250.122' + (mEgcObj && mEgcObj.id ? ' | ' + mEgcObj.id : ''));
  if (mEgcObj) { if (mEgcObj.isUsd) { wp(BOM_ROW.AC_EGC, null, mEgcObj.price); } else { wp(BOM_ROW.AC_EGC, mEgcObj.price, null); } }
  else bom.getRange(BOM_ROW.AC_EGC, BOM_COL.UNIT_PRICE).setNote('Precio pendiente \u2014 cotizar con proveedor');

  var mBrkResult = breakerPriceWithFallback(bosDb, ac.mainBreaker, 3);
  w(BOM_ROW.AC_BREAKER, BOM_COL.ITEM, itemNo++); w(BOM_ROW.AC_BREAKER, BOM_COL.DESCRIPTION, 'Breaker principal I-LINE ' + ac.mainBreaker + 'A 3P');
  w(BOM_ROW.AC_BREAKER, BOM_COL.QTY, 1); w(BOM_ROW.AC_BREAKER, BOM_COL.UNIT, 'pcs');
  w(BOM_ROW.AC_BREAKER, BOM_COL.REFERENCE, 'AC-01 / main' + (mBrkResult && mBrkResult.id ? ' | ' + mBrkResult.id : ''));
  wp(BOM_ROW.AC_BREAKER, null, mBrkResult.price || null);
  if (mBrkResult.note) bom.getRange(BOM_ROW.AC_BREAKER, BOM_COL.UNIT_PRICE).setNote(mBrkResult.note);

  var mCondSz   = parseFloat(ac.conduitMain);
  var mCondObj  = conduitPriceObj(bosDb, mCondSz);
  // FIX (2026-04-27): mainFeederCableM is total cable across 3 phases × spare.
  // Conduit/tray length = run length, not cable length, so divide by 3 phases
  // before converting to 3 m sticks/tramos. Matches per-inverter pattern at
  // line ~756 (Math.ceil(invBom.cableM / 3 / 3)).
  // Was: ceil(cableM / 3)         → overcounted ~3× (e.g. 78 sticks for 65 m run)
  // Now: ceil(cableM / 3 / 3)     → correct (e.g. 26 sticks for 65 m run)
  var mCondStks = Math.ceil(lay.bom.mainFeederCableM / 3 / 3);
  if (trayM > 0) {
    // Cable tray: main AC horizontal feeder route
    var trayObjAC    = ladderTrayPriceObj(bosDb);
    // Same divisor fix as conduit: run length = cableM / 3 phases, then / 3 m per tramo.
    var trayTramosAC = Math.ceil(lay.bom.mainFeederCableM / 3 / 3);
    w(BOM_ROW.AC_CONDUIT, BOM_COL.DESCRIPTION, 'Charola tipo escalera (alimentador AC horizontal) ' + lay.bom.mainFeederCableM + 'm');
    w(BOM_ROW.AC_CONDUIT, BOM_COL.QTY, trayTramosAC); w(BOM_ROW.AC_CONDUIT, BOM_COL.UNIT, 'tramo');
    w(BOM_ROW.AC_CONDUIT, BOM_COL.REFERENCE, 'AC-05-TRAY' + (trayObjAC && trayObjAC.id ? ' | ' + trayObjAC.id : ''));
    if (trayObjAC) { wp(BOM_ROW.AC_CONDUIT, trayObjAC.price, null); }
    else bom.getRange(BOM_ROW.AC_CONDUIT, BOM_COL.UNIT_PRICE).setNote('Precio charola pendiente — cotizar con proveedor');
  } else {
    w(BOM_ROW.AC_CONDUIT, BOM_COL.ITEM, itemNo++); w(BOM_ROW.AC_CONDUIT, BOM_COL.DESCRIPTION, 'Conduit principal IMC ' + conduitSizeLabel(ac.conduitMain) + '" x 3m');
    w(BOM_ROW.AC_CONDUIT, BOM_COL.QTY, mCondStks); w(BOM_ROW.AC_CONDUIT, BOM_COL.UNIT, 'pza');
    w(BOM_ROW.AC_CONDUIT, BOM_COL.REFERENCE, 'AC-05' + (mCondObj && mCondObj.id ? ' | ' + mCondObj.id : ''));
    if (mCondObj) { if (mCondObj.isUsd) { wp(BOM_ROW.AC_CONDUIT, null, mCondObj.price); } else { wp(BOM_ROW.AC_CONDUIT, mCondObj.price, null); } } else { bom.getRange(BOM_ROW.AC_CONDUIT, BOM_COL.UNIT_PRICE).setNote('Precio pendiente \u2014 cotizar con proveedor'); }
  }

  var pbObj = panelboardPriceObj(bosDb, ac.mainBreaker);
  w(BOM_ROW.AC_PANELBOARD, BOM_COL.ITEM, itemNo++); w(BOM_ROW.AC_PANELBOARD, BOM_COL.DESCRIPTION, 'Tablero I-LINE AC (panelboard) >= ' + ac.mainBreaker + 'A');
  w(BOM_ROW.AC_PANELBOARD, BOM_COL.QTY, 1); w(BOM_ROW.AC_PANELBOARD, BOM_COL.UNIT, 'pcs'); w(BOM_ROW.AC_PANELBOARD, BOM_COL.REFERENCE, 'AC interconnection' + (pbObj && pbObj.id ? ' | ' + pbObj.id : ''));
  if (pbObj) { if (pbObj.isUsd) { wp(BOM_ROW.AC_PANELBOARD, null, pbObj.price); } else { wp(BOM_ROW.AC_PANELBOARD, pbObj.price, null); } }
  else bom.getRange(BOM_ROW.AC_PANELBOARD, BOM_COL.UNIT_PRICE).setNote('Precio pendiente \u2014 cotizar con proveedor');

  // Per-inverter slots: AC_INV_BLOCK_PER_INV rows per slot, up to 5 slots
  // Slot n starts at AC_INV_BLOCK_START + n * AC_INV_BLOCK_PER_INV.
  // Empty slots stay blank (cleared by clearContent).
  var AC_INV_START = BOM_ROW.AC_INV_BLOCK_START;

  lay.bom.acPerInverterBOM.slice(0, 5).forEach(function(invBom, slotIdx) {
    var base = AC_INV_START + slotIdx * 4;
    var invObj = invBank.find(function(x) { return x.model === invBom.model; });
    var poles  = (invObj && invObj.phase === 3) ? 3 : 2;
    var label  = invBom.model + ' x' + invBom.qty;

    // row+0: AC cable THHW
    var cableObj = conductorPriceObj(bosDb, invBom.conductorSize);
    w(base, 1, itemNo++);
    w(base, 2, label + ' \u2014 Cable ' + invBom.conductorSize + ' ' + conductorUnit(invBom.conductorSize) + ' THHW Cu (' + invBom.cableM + 'm)');
    w(base, 3, invBom.cableM); w(base, 4, 'm'); w(base, 8, 'AC-01 / NOM 690.8' + (cableObj && cableObj.id ? ' | ' + cableObj.id : ''));
    if (cableObj) { if (cableObj.isUsd) { wp(base, null, cableObj.price); } else { wp(base, cableObj.price, null); } }
    else bom.getRange(base, 5).setNote('Precio pendiente \u2014 cotizar con proveedor');

    // row+1: EGC grounding cable
    var egcObj = groundPriceObj(bosDb, invBom.egcSize);
    w(base+1, 1, itemNo++);
    w(base+1, 2, label + ' \u2014 Cable tierra ' + invBom.egcSize + ' ' + conductorUnit(invBom.egcSize) + ' Cu desnudo (' + invBom.egcM + 'm)');
    w(base+1, 3, invBom.egcM); w(base+1, 4, 'm'); w(base+1, 8, 'AC-03 / NOM 250.122' + (egcObj && egcObj.id ? ' | ' + egcObj.id : ''));
    if (egcObj) { if (egcObj.isUsd) { wp(base+1, null, egcObj.price); } else { wp(base+1, egcObj.price, null); } }
    else bom.getRange(base+1, 5).setNote('Precio pendiente \u2014 cotizar con proveedor');

    // row+2: breaker with fallback
    var brkResult = breakerPriceWithFallback(bosDb, invBom.ocpdA, poles);
    w(base+2, 1, itemNo++);
    w(base+2, 2, label + ' \u2014 Breaker I-LINE ' + invBom.ocpdA + 'A ' + poles + 'P');
    w(base+2, 3, invBom.qty); w(base+2, 4, 'pcs');
    w(base+2, 8, 'AC-04 / NOM 690.9' + (brkResult && brkResult.id ? ' | ' + brkResult.id : ''));
    wp(base+2, null, brkResult.price || null);
    if (brkResult.note) bom.getRange(base+2, 5).setNote(brkResult.note);

    // row+3: conduit
    var condSz    = parseFloat(invBom.conduitSize);
    var condObj   = conduitPriceObj(bosDb, condSz);
    var condStks  = Math.ceil(invBom.cableM / 3 / 3);
    w(base+3, 1, itemNo++);
    w(base+3, 2, label + ' \u2014 Conduit IMC ' + conduitSizeLabel(invBom.conduitSize) + '" x 3m');
    w(base+3, 3, condStks); w(base+3, 4, 'pza');
    w(base+3, 8, 'AC-05 / Ch9 Table 1' + (condObj && condObj.id ? ' | ' + condObj.id : ''));
    if (condObj) { if (condObj.isUsd) { wp(base+3, null, condObj.price); } else { wp(base+3, condObj.price, null); } } else { bom.getRange(base+3, 5).setNote('Precio pendiente \u2014 cotizar con proveedor'); }
  });

  ws(BOM_ROW.SUBTOTAL_AC,        BOM_ROW.AC_FEEDER,        BOM_ROW.SUBTOTAL_AC - 1, 'SUBTOTAL ELECTRICO AC');

  //  ROWS 61-65: Section 6 -- TRANSFORMADOR 
  w(BOM_ROW.SEC_TRANSFORMER, BOM_COL.DESCRIPTION, '6. TRANSFORMADOR');
  styleSectionHeader(BOM_ROW.SEC_TRANSFORMER);
  if (inp.supplyTransformer !== 0) {
    // 1 (default) = Argia supplies transformer
    var xfmrObj = transformerPriceObj(bosDb, ac.transformer);
    w(BOM_ROW.TRANSFORMER, BOM_COL.ITEM, itemNo++);
    w(BOM_ROW.TRANSFORMER, BOM_COL.DESCRIPTION, 'Transformador seco ' + ac.transformer + ' kVA (' + ac.apparentPower.toFixed(0) + ' kVA base +20%)');
    w(BOM_ROW.TRANSFORMER, BOM_COL.QTY, 1); w(BOM_ROW.TRANSFORMER, BOM_COL.UNIT, 'pcs'); w(BOM_ROW.TRANSFORMER, BOM_COL.REFERENCE, 'TRANS-01 / NOM Art.450' + (xfmrObj && xfmrObj.id ? ' | ' + xfmrObj.id : ''));
    if (xfmrObj) { if (xfmrObj.isUsd) { wp(BOM_ROW.TRANSFORMER, null, xfmrObj.price); } else { wp(BOM_ROW.TRANSFORMER, xfmrObj.price, null); } }
    else bom.getRange(BOM_ROW.TRANSFORMER, BOM_COL.UNIT_PRICE).setNote('Precio pendiente \u2014 cotizar con proveedor');
  } else {
    // 0 = client supplies transformer — note in BOM, no price
    w(BOM_ROW.TRANSFORMER, BOM_COL.DESCRIPTION, 'Transformador seco ' + ac.transformer + ' kVA — suministro del cliente');
    w(BOM_ROW.TRANSFORMER, BOM_COL.QTY, 1); w(BOM_ROW.TRANSFORMER, BOM_COL.UNIT, 'pcs');
    bom.getRange(BOM_ROW.TRANSFORMER, BOM_COL.UNIT_PRICE).setNote('Excluido del costo: INPUT_DESIGN M85=0');
  }
  ws(BOM_ROW.SUBTOTAL_TRANSFORMER, BOM_ROW.TRANSFORMER,    BOM_ROW.SUBTOTAL_TRANSFORMER - 1, 'SUBTOTAL TRANSFORMADOR');

  //  ROWS 66-75: Section 7 -- MONITOREO 
  w(BOM_ROW.SEC_MONITORING, BOM_COL.DESCRIPTION, '7. MONITOREO, PERMISOS Y PUESTA EN MARCHA');
  styleSectionHeader(BOM_ROW.SEC_MONITORING);
  var monObj   = monitoringPriceObj(bosDb);
  var meterObj = meterPriceObj(bosDb);

  w(BOM_ROW.MON_DATALOGGER, BOM_COL.ITEM, itemNo++); w(BOM_ROW.MON_DATALOGGER, BOM_COL.DESCRIPTION, 'Sistema monitoreo / datalogger + cloud');
  w(BOM_ROW.MON_DATALOGGER, BOM_COL.QTY, 1); w(BOM_ROW.MON_DATALOGGER, BOM_COL.UNIT, 'pcs'); w(BOM_ROW.MON_DATALOGGER, BOM_COL.REFERENCE, monObj ? monObj.id : 'BOS_0258');
  if (monObj) { if (monObj.isUsd) { wp(BOM_ROW.MON_DATALOGGER, null, monObj.price); } else { wp(BOM_ROW.MON_DATALOGGER, monObj.price, null); } }
  else bom.getRange(BOM_ROW.MON_DATALOGGER, BOM_COL.UNIT_PRICE).setNote('Precio pendiente \u2014 cotizar con proveedor');

  w(BOM_ROW.MON_METER, BOM_COL.ITEM, itemNo++); w(BOM_ROW.MON_METER, BOM_COL.DESCRIPTION, 'Medidor bidireccional ION / CFE compatible');
  w(BOM_ROW.MON_METER, BOM_COL.QTY, 1); w(BOM_ROW.MON_METER, BOM_COL.UNIT, 'pcs'); w(BOM_ROW.MON_METER, BOM_COL.REFERENCE, meterObj ? meterObj.id : 'BOS_0229');
  if (meterObj) { if (meterObj.isUsd) { wp(BOM_ROW.MON_METER, null, meterObj.price); } else { wp(BOM_ROW.MON_METER, meterObj.price, null); } }
  else bom.getRange(BOM_ROW.MON_METER, BOM_COL.UNIT_PRICE).setNote('Precio pendiente \u2014 cotizar con proveedor');

  // Services rows: $1,500 USD default — confirm with proveedor
  var svcItems = [
    [BOM_ROW.MON_UVIE,          'Gestion UVIE / UIIE ante PEC',     'DOC-01'],
    [BOM_ROW.MON_CFE,           'Tramitacion CFE interconexion',     'DOC-01'],
    [BOM_ROW.MON_COMMISSIONING, 'Puesta en marcha y commissioning',  'QA-01..03'],
    [BOM_ROW.MON_THERMOGRAPHY,  'Termografia post-instalacion',      'ENV testing'],
  ];
  svcItems.forEach(function(svc) {
    var r = svc[0];
    w(r, BOM_COL.ITEM, itemNo++); w(r, BOM_COL.DESCRIPTION, svc[1]);
    w(r, BOM_COL.QTY, 1); w(r, BOM_COL.UNIT, 'servicio'); w(r, BOM_COL.REFERENCE, svc[2]);
    wp(r, null, 1500);
    bom.getRange(r, BOM_COL.UNIT_PRICE).setNote('Precio referencia $1,500 USD \u2014 confirmar con proveedor');
  });

  ws(BOM_ROW.SUBTOTAL_MONITORING, BOM_ROW.MON_DATALOGGER, BOM_ROW.SUBTOTAL_MONITORING - 1, 'SUBTOTAL MONITOREO + PERMISOS');

  // ============================================================
  // §8 BESS — BDF-7
  // ============================================================
  // Pulls from bessResult.bos (calcBessBosQuantities output).
  // Map BOS line "code" -> fixed BOM row, then write qty + price + nom.
  // When bessResult is missing or BoS is blocked, leave §8 mostly empty
  // with a clear "pendiente" note on the section header.
  w(BOM_ROW.SEC_BESS, BOM_COL.DESCRIPTION, '8. ALMACENAMIENTO / BESS');
  styleSectionHeader(BOM_ROW.SEC_BESS);

  // BDF-8: reset row heights across the entire §8 block (rows
  // BESS_BATTERY_LINE..BESS_COMMISSIONING). When a prior run left taller
  // rows (description wrap auto-grow), this normalizes them. Populated
  // rows are reset to 26 inside the loop below.
  //
  // BDF-9: also reset background + font weight + font size. The BDF-7 R1
  // fallback path wrote "Sistema BESS — pendiente" on row 80 with bold +
  // light-grey background (visually section-header-like). When BDF-7.1
  // replaced that with real line items, the cosmetic styling persisted.
  // Reset here so each §8 row starts as a plain item row.
  //
  // BDF-11.1: previous resets only normalized background / font weight /
  // font size. Rows 80-91 had additional cosmetic inconsistencies inherited
  // from the template: column A alignment, column H font color, vertical
  // alignment, and font size on some columns. This caused row 80 to look
  // visibly different from rows 81-91 (row 80 was "right" per user, others
  // were wrong). Fix: do a FULL formatting normalization on each row,
  // matching row 80's style across all 8 columns.
  //
  // Style per column (matching what row 80 displays):
  //   A  ITEM       — right-aligned, middle vertical, 10pt, black
  //   B  DESCRIPTION— left-aligned,  middle vertical, 10pt, black, wrapped
  //   C  QTY        — right-aligned, middle vertical, 10pt, black
  //   D  UNIT       — left-aligned,  middle vertical, 10pt, black
  //   E  UNIT_PRICE — right-aligned, middle vertical, 10pt, black
  //   F  TOTAL_USD  — right-aligned, middle vertical, 10pt, black
  //   G  TOTAL_MXN  — right-aligned, middle vertical, 10pt, black
  //   H  REFERENCE  — left-aligned,  middle vertical, 10pt, GREY (#999999)
  for (var resetR = BOM_ROW.BESS_BATTERY_LINE;
           resetR <= BOM_ROW.BESS_COMMISSIONING; resetR++) {
    bom.setRowHeight(resetR, 22);
    // Whole row: baseline style
    bom.getRange(resetR, 1, 1, 8)
       .setBackground(null)
       .setFontWeight('normal')
       .setFontSize(10)
       .setFontFamily('Inter')
       .setFontColor('#000000')
       .setVerticalAlignment('middle')
       .setWrap(true);
    // Per-column horizontal alignment
    bom.getRange(resetR, 1).setHorizontalAlignment('right');   // ITEM (#)
    bom.getRange(resetR, 2).setHorizontalAlignment('left');    // DESCRIPTION
    bom.getRange(resetR, 3).setHorizontalAlignment('right');   // QTY
    bom.getRange(resetR, 4).setHorizontalAlignment('left');    // UNIT
    bom.getRange(resetR, 5).setHorizontalAlignment('right');   // UNIT_PRICE
    bom.getRange(resetR, 6).setHorizontalAlignment('right');   // TOTAL_USD
    bom.getRange(resetR, 7).setHorizontalAlignment('right');   // TOTAL_MXN
    bom.getRange(resetR, 8).setHorizontalAlignment('left');    // REFERENCE
    // BDF-11.1: REFERENCE column (H) uses light-grey font, matching the
    // PV-side rows (e.g. row 80 currently shows "BESS-01" in light grey).
    bom.getRange(resetR, 8).setFontColor('#999999');
    // Clear any inherited borders so the section reads as a clean table.
    bom.getRange(resetR, 1, 1, 8)
       .setBorder(false, false, false, false, false, false);
  }

  var hasBessLines = bessResult && bessResult.bos && !bessResult.bos.blocked
                  && bessResult.bos.lines && bessResult.bos.lines.length > 0;
  if (!hasBessLines) {
    // BESS not configured OR BoS calculation blocked. Write a single
    // explanatory line and leave §8 rows empty.
    var bessReason = (bessResult && bessResult.bos && bessResult.bos.reason)
                     ? bessResult.bos.reason
                     : (bessResult && !bessResult.bessEnabled
                        ? 'BESS no habilitado en INPUT_PROJECT'
                        : 'BoS pendiente — completar §6 distancias en INPUT_BESS');
    w(BOM_ROW.BESS_BATTERY_LINE, BOM_COL.ITEM, itemNo++);
    w(BOM_ROW.BESS_BATTERY_LINE, BOM_COL.DESCRIPTION,
      'Sistema BESS — pendiente (' + bessReason + ')');
    w(BOM_ROW.BESS_BATTERY_LINE, BOM_COL.QTY, '');
    w(BOM_ROW.BESS_BATTERY_LINE, BOM_COL.UNIT, '');
    w(BOM_ROW.BESS_BATTERY_LINE, BOM_COL.REFERENCE, 'BDF-7');
    bom.getRange(BOM_ROW.BESS_BATTERY_LINE, BOM_COL.UNIT_PRICE)
       .setNote('§8 BESS pendiente. ' + bessReason);
  } else {
    // Map each calc-output line.code to the BOM row reserved for it
    var bessRowByCode = {
      'BESS-01': BOM_ROW.BESS_BATTERY_LINE,
      'BESS-02': BOM_ROW.BESS_DC_CABLE,
      'BESS-03': BOM_ROW.BESS_DC_EGC,
      'BESS-04': BOM_ROW.BESS_AC_CABLE,
      'BESS-05': BOM_ROW.BESS_AC_EGC,
      'BESS-06': BOM_ROW.BESS_DC_CONDUIT,
      'BESS-07': BOM_ROW.BESS_AC_CONDUIT,
      'BESS-08': BOM_ROW.BESS_DC_OCPD,
      'BESS-09': BOM_ROW.BESS_AC_OCPD,
      'BESS-10': BOM_ROW.BESS_AC_DISCONNECT,
      'BESS-11': BOM_ROW.BESS_GEC_LINE,
      'BESS-12': BOM_ROW.BESS_COMMISSIONING,
    };
    bessResult.bos.lines.forEach(function(bosLine) {
      var rowIdx = bessRowByCode[bosLine.code];
      if (!rowIdx) return;   // unknown code, skip silently

      w(rowIdx, BOM_COL.ITEM, itemNo++);
      w(rowIdx, BOM_COL.DESCRIPTION, bosLine.description);
      w(rowIdx, BOM_COL.QTY, bosLine.qty);
      w(rowIdx, BOM_COL.UNIT, bosLine.unit);
      w(rowIdx, BOM_COL.REFERENCE, bosLine.nomCite || bosLine.code);

      // BDF-8: visual consistency on §8 rows -----------------------------
      // The legacy BOM uses fixed-row layout with default row heights set
      // by the template. BDF-7 R1 description text overflowed the column
      // and Sheets auto-grew JUST those rows, making §8 look uneven.
      // Here we set a consistent row height and ensure description wrap
      // so the section reads cleanly.
      // BDF-10: dropped from 26 to 22 px to match PV-side row heights
      // (image showed §8 rows visually taller than §7 monitoring rows).
      // Descriptions are short post-BDF-8 so 22 fits comfortably.
      bom.setRowHeight(rowIdx, 22);
      bom.getRange(rowIdx, BOM_COL.DESCRIPTION).setWrap(true)
        .setVerticalAlignment('middle');
      // Engineering detail (parallels × meters × etc) goes into a cell
      // note rather than overflowing the visible description.
      if (bosLine.detail) {
        bom.getRange(rowIdx, BOM_COL.DESCRIPTION).setNote(bosLine.detail);
      }

      // Price resolution depends on category. Battery line uses
      // lookupBatteryUnitPrice (header-tolerant DB read).
      if (bosLine.productCategory === 'BESS_BATTERY' && bosLine.productSpec
          && bosLine.productSpec.batteryId) {
        var priceInfo = lookupBatteryUnitPrice(ss, bosLine.productSpec.batteryId);
        if (priceInfo.priceMxn > 0) {
          wp(rowIdx, priceInfo.priceMxn, null);
          if (priceInfo.provenance === 'CAPEX_FALLBACK') {
            bom.getRange(rowIdx, BOM_COL.UNIT_PRICE).setNote(
              'Precio derivado de Installed_CAPEX_MXN (fallback). ' +
              'Considere agregar columna BESS_price_per_unit en 16M_PRODUCTS_BESS ' +
              'para precio unitario real.');
          }
        } else {
          bom.getRange(rowIdx, BOM_COL.UNIT_PRICE).setNote(
            'Precio batería pendiente — agregar columna BESS_price_per_unit ' +
            'en 16M_PRODUCTS_BESS para Battery_ID ' +
            bosLine.productSpec.batteryId);
        }
      } else if (bosLine.productCategory === 'COMMISSIONING') {
        // Commissioning is a flat fee already in MXN on the productSpec
        var commPrice = bosLine.productSpec ? bosLine.productSpec.flatPriceMxn : 0;
        if (commPrice > 0) wp(rowIdx, commPrice, null);
      } else if (bosLine.productCategory === 'CONDUCTORS'
              || bosLine.productCategory === 'CONDUIT'
              || bosLine.productCategory === 'DISTRIBUTION') {
        // BDF-9: wire real price resolution via existing PV-side helpers
        // (conductorPriceObj / groundPriceObj / conduitPriceObj /
        // breakerPriceWithFallback). When no price found, fall back to
        // the "pendiente" note so designer knows to add the SKU.
        //
        // wp(r, priceMxn, priceUsd):
        //   priceUsd > 0   -> direct USD price (no exchange-rate divide)
        //   priceMxn > 0   -> formula-divides by $F$<EXCHANGE_RATE>
        // bosPriceObj returns { price, isUsd, id } — we route accordingly.
        var priceObj = _resolveBessBosPrice(bosLine, bosDb, ss);
        if (priceObj && priceObj.price > 0) {
          if (priceObj.isUsd) {
            wp(rowIdx, null, priceObj.price);
          } else {
            wp(rowIdx, priceObj.price, null);
          }
          // Reference column shows the resolved BOS_ID for traceability
          if (priceObj.id) {
            w(rowIdx, BOM_COL.REFERENCE,
              (bosLine.nomCite || bosLine.code) + ' | ' + priceObj.id);
          }
          // If breaker fallback was used (next-larger size), surface that
          // as a cell note alongside the engineering detail.
          if (priceObj.note) {
            var existingNote = bosLine.detail ? bosLine.detail + '\n\n' : '';
            bom.getRange(rowIdx, BOM_COL.UNIT_PRICE)
               .setNote(existingNote + priceObj.note);
          }
        } else {
          // No SKU found. Append note explaining why so designer can
          // add the SKU to 14M_PRODUCTS_BOS.
          var noteExisting = bosLine.detail ? bosLine.detail + '\n\n' : '';
          bom.getRange(rowIdx, BOM_COL.DESCRIPTION).setNote(
            noteExisting +
            'PRECIO: pendiente — sin SKU en 14M_PRODUCTS_BOS para ' +
            bosLine.productCategory + ' / spec ' +
            JSON.stringify(bosLine.productSpec || {}));
        }
      }
    });
  }
  // §8 subtotal: sum of rows BESS_BATTERY_LINE .. (SUBTOTAL_BESS - 1)
  ws(BOM_ROW.SUBTOTAL_BESS, BOM_ROW.BESS_BATTERY_LINE,
     BOM_ROW.SUBTOTAL_BESS - 1, 'SUBTOTAL §8 BESS');

  //  GRAND TOTAL (fixed row references to section subtotals)
  w(BOM_ROW.GRAND_TOTAL, BOM_COL.DESCRIPTION, 'TOTAL MATERIAL + SERVICIOS (USD)');
  styleGrandTotal(BOM_ROW.GRAND_TOTAL);
  bom.getRange(BOM_ROW.GRAND_TOTAL, BOM_COL.TOTAL_USD).setFormula(
    '=F' + BOM_ROW.SUBTOTAL_PANELS + '+F' + BOM_ROW.SUBTOTAL_INVERTERS +
    '+F' + BOM_ROW.SUBTOTAL_STRUCTURE + '+F' + BOM_ROW.SUBTOTAL_DC +
    '+F' + BOM_ROW.SUBTOTAL_AC + '+F' + BOM_ROW.SUBTOTAL_TRANSFORMER +
    '+F' + BOM_ROW.SUBTOTAL_MONITORING + '+F' + BOM_ROW.SUBTOTAL_BESS
  ).setNumberFormat('#,##0.00');
  bom.getRange(BOM_ROW.GRAND_TOTAL, BOM_COL.TOTAL_MXN).setFormula('=F' + BOM_ROW.GRAND_TOTAL + '*$F$' + BOM_ROW.EXCHANGE_RATE).setNumberFormat('#,##0');
  SpreadsheetApp.flush();
}


// =============================================================================
// BDF-9: BoS price resolution for BESS §8 lines
// =============================================================================
// Given a calc-output line (productCategory + productSpec) and the loaded
// BoS DB, returns a priceObj { price, isUsd, id } or null.
//
// Routes by category:
//   CONDUCTORS side=DC / AC          -> conductorPriceObj (THHW or PV WIRE)
//   CONDUCTORS side=DC_EGC / AC_EGC  -> groundPriceObj (BARE COPPER)
//   CONDUCTORS side=GEC              -> groundPriceObj (BARE COPPER), sized
//                                       from calcBessNomChecks if available
//   CONDUIT                          -> conduitPriceObj with selectConduit
//                                       (NOM 358) to pick size from cuArea
//   DISTRIBUTION side=DC/AC/DISCONNECT_AC -> breakerPriceWithFallback
//
// Returns null when:
//   - awg/rating is missing from productSpec
//   - the relevant helper returns null (no SKU in DB)
//
// PURE-ish: reads ss only for tbls (conduit table). bosDb passed in.
function _resolveBessBosPrice(bosLine, bosDb, ss) {
  var spec = bosLine.productSpec || {};
  var cat = bosLine.productCategory;

  if (cat === 'CONDUCTORS') {
    var awgRaw = String(spec.awg || '').trim();
    if (!awgRaw) return null;
    // Strip "AWG " prefix if present — helper adds it back internally
    var awg = awgRaw.replace(/^AWG\s+/i, '');

    if (spec.side === 'DC' || spec.side === 'AC') {
      // Phase conductors: THHW or PV WIRE
      return conductorPriceObj(bosDb, awg);
    }
    if (spec.side === 'DC_EGC' || spec.side === 'AC_EGC'
     || spec.side === 'GEC') {
      // Ground conductors: bare copper
      return groundPriceObj(bosDb, awg);
    }
    return null;
  }

  if (cat === 'CONDUIT') {
    // Pick conduit size via NOM 358 fill rule.
    // Total insulated area = condCount × insAreaMm2 per conductor.
    var ca = Number(spec.condCuAreaMm2) || 0;
    var ia = Number(spec.condInsAreaMm2) || 0;
    var n  = Number(spec.condCount) || 0;
    if (ia <= 0 || n <= 0) return null;
    var totalInsArea = ia * n;
    var tbls;
    try {
      tbls = readElecTables(ss);
    } catch (e) {
      return null;
    }
    // fillRatio: NOM Ch9 default 0.40 for >2 conductors (selectConduit handles default)
    var sizeIn = selectConduit(totalInsArea, 0.40, tbls);
    return conduitPriceObj(bosDb, sizeIn);
  }

  if (cat === 'DISTRIBUTION') {
    var amps = Number(spec.ratingA) || 0;
    var poles = Number(spec.poles) || 1;
    if (amps <= 0) return null;
    // breakerPriceWithFallback returns {price, id, note} but DROPS isUsd
    // (a quirk of the existing PV-side helper). We re-look-up isUsd via
    // breakerILinePriceObj directly when there was an exact match, else
    // assume MXN as the safe default.
    var breakerResult = breakerPriceWithFallback(bosDb, amps, poles);
    if (!breakerResult || !breakerResult.price) return null;
    // Try to get isUsd from the exact-match price obj
    var exactObj = breakerILinePriceObj(bosDb, amps, poles);
    var isUsd = exactObj ? !!exactObj.isUsd : false;
    return {
      price: breakerResult.price,
      isUsd: isUsd,
      id: breakerResult.id,
      note: breakerResult.note,
    };
  }

  return null;
}
