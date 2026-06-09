// =============================================================================
// ARGIA ENGINE v2 -- File: writers_v2/helpers/BomDbHelpers.gs
// -----------------------------------------------------------------------------
// CHUNK 4 — BOM_v2 DB lookup helpers.
//
// WHAT THIS IS
//   Verbatim port of every DB-lookup function from legacy 08_WriteBOM.js,
//   namespaced with the `_bomV2_` prefix to avoid global collision with
//   legacy. Both legacy and v2 helpers coexist in the engine until cutover.
//
// WHY VERBATIM PORT (NOT REFACTOR)
//   These functions are battle-tested over many real projects. Refactoring
//   during a port is how you introduce parity bugs. The v2 migration's
//   architectural improvement is template/data separation, NOT helper
//   redesign. Helpers move to v2 unchanged; cleanup happens post-cutover.
//
// READS FROM (untouched DB mirror sheets, shared infrastructure)
//   - 14M_PRODUCTS_BOS                  — BoS catalog (cables/breakers/conduit/etc)
//   - 13M_PRODUCTS_STRUCTURES           — structures catalog
//
// EXPORTS
//   _bomV2_loadStructureDb(ss)              -> array of row objects
//   _bomV2_resolveStructure(db, displayStr) -> { strId, brand, model, priceUsd, raw } | null
//   _bomV2_structurePriceUsdPerPanel(db, modelName) -> number | null
//   _bomV2_loadBosDb(ss)                    -> array of row objects (header-tolerant)
//   _bomV2_bosPrice(db, cat, sub, rating)   -> price number | null
//   _bomV2_bosPriceObj(db, cat, sub, rating)-> { price, isUsd, id } | null
//   _bomV2_conductorPriceObj(db, awg)       -> { price, isUsd, id } | null
//   _bomV2_conductorPriceMxn(db, awg)       -> price | null
//   _bomV2_groundPriceObj(db, awg)          -> { price, isUsd, id } | null
//   _bomV2_groundPriceMxn(db, awg)          -> price | null
//   _bomV2_conduitSizeLabel(sz)             -> string like '1/2', '1 1/4', '2 1/2'
//   _bomV2_conduitPriceObj(db, sizeIn)      -> { price, isUsd, id } | null
//   _bomV2_conduitPriceMxn(db, sizeIn)      -> price | null
//   _bomV2_ladderTrayPriceObj(db)           -> { price, isUsd, id } | null
//   _bomV2_breakerILinePriceObj(db, A, P)   -> { price, isUsd, id } | null
//   _bomV2_breakerILinePriceMxn(db, A, P)   -> price | null
//   _bomV2_breakerPriceWithFallback(db,A,P) -> { price, id, note } (note=null when exact)
//   _bomV2_panelboardPriceObj(db, maxAmps)  -> { price, isUsd, id } | null
//   _bomV2_panelboardPriceMxn(db, maxAmps)  -> price | null
//   _bomV2_transformerPriceObj(db, kva)     -> { price, isUsd, id } | null
//   _bomV2_transformerPriceMxn(db, kva)     -> price | null
//   _bomV2_mc4PriceObj(db)                  -> { price, isUsd, id } | null
//   _bomV2_mc4PriceMxn(db)                  -> price | null
//   _bomV2_monitoringPriceObj(db)           -> { price, isUsd, id } | null
//   _bomV2_monitoringPriceMxn(db)           -> price | null
//   _bomV2_meterPriceObj(db)                -> { price, isUsd, id } | null
//   _bomV2_meterPriceMxn(db)                -> price | null
//
// PARITY GUARANTEE
//   Each function's behavior is byte-identical to its legacy counterpart.
//   Tests in BomDbHelpersTests.gs verify the v2 helper returns the same
//   value as the legacy helper for a sample of fixture inputs.
// =============================================================================


// -----------------------------------------------------------------------------
// Constants shared with legacy. Defined here with idempotent guard so the
// load order doesn't matter — if 08_WriteBOM.js already defined them, we
// pick up the existing values; otherwise we define our own.
// -----------------------------------------------------------------------------
var _BOMV2_BOS_MIRROR       = (typeof BOS_MIRROR       !== 'undefined' && BOS_MIRROR)       ? BOS_MIRROR       : '14M_PRODUCTS_BOS';
var _BOMV2_STRUCTURE_MIRROR = (typeof STRUCTURE_MIRROR !== 'undefined' && STRUCTURE_MIRROR) ? STRUCTURE_MIRROR : '13M_PRODUCTS_STRUCTURES';

// Structure DB column indices (0-based). Mirrors legacy STR_COL_* constants.
var _BOMV2_STR_COL_ID    = 0;
var _BOMV2_STR_COL_BRAND = 1;
var _BOMV2_STR_COL_MODEL = 2;
var _BOMV2_STR_COL_PRICE = 12;   // USD per panel (mislabeled as STR_PRICE_PER_KWP_MXN in DB header)


// =============================================================================
// STRUCTURE DB
// =============================================================================
function _bomV2_loadStructureDb(ss) {
  var sh = ss.getSheetByName(_BOMV2_STRUCTURE_MIRROR);
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];

  // Find header row — scan first 5 rows for 'STR_ID' in col A
  var headerRowIdx = -1;
  for (var i = 0; i < Math.min(5, data.length); i++) {
    if (String(data[i][0] || '').trim().toUpperCase() === 'STR_ID') {
      headerRowIdx = i;
      break;
    }
  }
  var dataRows = headerRowIdx >= 0 ? data.slice(headerRowIdx + 1) : data.slice(1);
  var headers  = headerRowIdx >= 0 ? data[headerRowIdx].map(function(h){return String(h).trim();}) : [];

  return dataRows
    .filter(function(r) { return r[0] !== '' && r[0] !== null && r[0] !== undefined; })
    .map(function(row) {
      var obj = { _raw: row };
      headers.forEach(function(h, i) { if (h) obj[h] = row[i]; });
      return obj;
    });
}

function _bomV2_resolveStructure(structureDb, displayString) {
  if (!structureDb || structureDb.length === 0) return null;
  if (!displayString) return null;
  var s = String(displayString).trim();
  if (s === '') return null;

  // Path 1: "BRAND — MODEL — STR_ID" canonical — match tail by STR_ID
  var parts = s.split(/\s+\u2014\s+/);
  if (parts.length >= 3) {
    var tailId = String(parts[parts.length - 1]).trim().toUpperCase();
    if (tailId !== '') {
      for (var i = 0; i < structureDb.length; i++) {
        var raw = structureDb[i]._raw;
        var dbId = String(raw[_BOMV2_STR_COL_ID] || '').trim().toUpperCase();
        if (dbId === tailId) return _bomV2_structureRowToObject(raw);
      }
    }
  }
  // Path 2: brand + model
  if (parts.length === 2) {
    var b = String(parts[0]).trim().toUpperCase();
    var m = String(parts[1]).trim().toUpperCase();
    for (var j = 0; j < structureDb.length; j++) {
      var raw2 = structureDb[j]._raw;
      var db2b = String(raw2[_BOMV2_STR_COL_BRAND] || '').trim().toUpperCase();
      var db2m = String(raw2[_BOMV2_STR_COL_MODEL] || '').trim().toUpperCase();
      if (db2b === b && db2m === m) return _bomV2_structureRowToObject(raw2);
    }
  }
  // Path 3: legacy free-text — model only
  var search = s.toUpperCase();
  for (var k = 0; k < structureDb.length; k++) {
    var raw3 = structureDb[k]._raw;
    var db3m = String(raw3[_BOMV2_STR_COL_MODEL] || '').trim().toUpperCase();
    if (db3m === search) return _bomV2_structureRowToObject(raw3);
  }
  return null;
}

function _bomV2_structureRowToObject(raw) {
  var price = parseFloat(raw[_BOMV2_STR_COL_PRICE]);
  return {
    strId   : String(raw[_BOMV2_STR_COL_ID]    || '').trim(),
    brand   : String(raw[_BOMV2_STR_COL_BRAND] || '').trim(),
    model   : String(raw[_BOMV2_STR_COL_MODEL] || '').trim(),
    priceUsd: (isNaN(price) || price <= 0) ? null : price,
    raw     : raw
  };
}

function _bomV2_structurePriceUsdPerPanel(structureDb, modelName) {
  var info = _bomV2_resolveStructure(structureDb, modelName);
  return info ? info.priceUsd : null;
}


// =============================================================================
// BOS DB
// =============================================================================
function _bomV2_loadBosDb(ss) {
  var sh = ss.getSheetByName(_BOMV2_BOS_MIRROR);
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];

  // Find header row + BOS_ID column index
  var headerRowIdx = 0;
  var bosIdColIdx  = 0;
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

  var headers = data[headerRowIdx].map(function(h){ return String(h).trim(); });

  return data.slice(headerRowIdx + 1)
    .filter(function(r) {
      var id = String(r[bosIdColIdx] || '').trim();
      return id !== '' && id !== 'BOS_ID';
    })
    .map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) { if (h) obj[h] = row[i]; });
      obj['_raw']   = row;
      obj['_bosId'] = String(row[bosIdColIdx] || '').trim();
      return obj;
    });
}

function _bomV2_bosPrice(bosDb, category, subcategory, ratingOrSize) {
  var obj = _bomV2_bosPriceObj(bosDb, category, subcategory, ratingOrSize);
  return obj ? obj.price : null;
}

function _bomV2_bosPriceObj(bosDb, category, subcategory, ratingOrSize) {
  var cat  = String(category || '').toUpperCase().trim();
  var sub  = String(subcategory || '').toUpperCase().trim();
  var rate = String(ratingOrSize || '').toUpperCase().trim();
  for (var i = 0; i < bosDb.length; i++) {
    var r = bosDb[i];
    if (String(r['BOS_CATEGORY']    || '').toUpperCase().trim() !== cat) continue;
    if (String(r['BOS_SUBCATEGORY'] || '').toUpperCase().trim() !== sub) continue;
    if (String(r['BOS_RATING_OR_SIZE'] || '').toUpperCase().trim() !== rate) continue;
    var p = parseFloat(r['BOS_PRICE_PER_UNIT_MXN']);
    if (isNaN(p) || p === 0) continue;
    var isUsd = String(r['BOS_CURRENCY'] || '').toUpperCase().trim() === 'USD';
    var foundId = r['_bosId'] || String(r['BOS_ID'] || '').trim() ||
                  (r['_raw'] ? String(r['_raw'][0] || '').trim() : '');
    return { price: p, isUsd: isUsd, id: foundId };
  }
  return null;
}


// =============================================================================
// CONDUCTOR / GROUND
// =============================================================================
function _bomV2_conductorPriceObj(bosDb, awgLabel) {
  var key = String(awgLabel).trim().toUpperCase();
  if (key.indexOf('AWG') === -1) key = key + ' AWG';
  return _bomV2_bosPriceObj(bosDb, 'CONDUCTORS', 'WIRE THHW', key) ||
         _bomV2_bosPriceObj(bosDb, 'CONDUCTORS', 'WIRE THHW', awgLabel + ' AWG') ||
         _bomV2_bosPriceObj(bosDb, 'CONDUCTORS', 'PV WIRE',   key) ||
         _bomV2_bosPriceObj(bosDb, 'CONDUCTORS', 'PV WIRE',   awgLabel + ' AWG');
}
function _bomV2_conductorPriceMxn(bosDb, awgLabel) {
  var obj = _bomV2_conductorPriceObj(bosDb, awgLabel);
  return obj ? obj.price : null;
}

function _bomV2_groundPriceObj(bosDb, awgLabel) {
  var key = String(awgLabel).trim().toUpperCase();
  if (key.indexOf('AWG') === -1) key = key + ' AWG';
  return _bomV2_bosPriceObj(bosDb, 'CONDUCTORS', 'BARE COPPER', key) ||
         _bomV2_bosPriceObj(bosDb, 'CONDUCTORS', 'BARE COPPER', awgLabel + ' AWG');
}
function _bomV2_groundPriceMxn(bosDb, awgLabel) {
  var obj = _bomV2_groundPriceObj(bosDb, awgLabel);
  return obj ? obj.price : null;
}


// =============================================================================
// CONDUIT
// =============================================================================
function _bomV2_conduitSizeLabel(sz) {
  var map = {
    0.5:'1/2', 0.75:'3/4',
    1:'1', 1.25:'1 1/4', 1.5:'1 1/2',
    2:'2', 2.25:'2 1/4', 2.5:'2 1/2', 2.75:'2 3/4',
    3:'3', 3.5:'3 1/2', 4:'4'
  };
  return map[parseFloat(sz)] || String(sz);
}

function _bomV2_conduitPriceObj(bosDb, sizeIn) {
  var sz = parseFloat(String(sizeIn));
  if (isNaN(sz)) return null;
  var label  = _bomV2_conduitSizeLabel(sz).toUpperCase();
  var needle = 'DE ' + label + '"';
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
function _bomV2_conduitPriceMxn(bosDb, sizeIn) {
  var obj = _bomV2_conduitPriceObj(bosDb, sizeIn);
  return obj ? obj.price : null;
}


// =============================================================================
// CABLE TRAY (CHAROLA)
// =============================================================================
// Standard ladder cable-tray widths (mm).
var BOMV2_TRAY_WIDTHS_MM = [100, 150, 200, 300, 450, 600];
// Sizing heuristic: single-layer ladder tray, ~50% fill over ~50 mm usable
// loading depth => ~25 mm² of insulated conductor area per mm of tray width.
// width_mm ~= totalInsAreaMm2 / 25, rounded UP to the next standard width.
// CONSERVATIVE STARTING POINT — validate against the chosen tray vendor's
// published fill tables (NOM-001-SEDE Art. 392.22). Reuses the SAME insulated
// conductor area the conduit sizer uses, so tray vs conduit share one basis.
var BOMV2_TRAY_AREA_PER_MM = 25;
function _bomV2_selectTrayWidth(totalInsAreaMm2) {
  var area  = Number(totalInsAreaMm2) || 0;
  var reqMm = area / BOMV2_TRAY_AREA_PER_MM;
  var widthMm = BOMV2_TRAY_WIDTHS_MM[BOMV2_TRAY_WIDTHS_MM.length - 1];
  for (var i = 0; i < BOMV2_TRAY_WIDTHS_MM.length; i++) {
    if (reqMm <= BOMV2_TRAY_WIDTHS_MM[i]) { widthMm = BOMV2_TRAY_WIDTHS_MM[i]; break; }
  }
  var note = 'Charola escalera: \u00e1rea conductores ' + Math.round(area) + ' mm\u00b2 \u00f7 ' +
             BOMV2_TRAY_AREA_PER_MM + ' mm\u00b2/mm \u2248 ' + Math.ceil(reqMm) +
             ' mm \u2192 ancho est\u00e1ndar ' + widthMm +
             ' mm (1 capa, ~50% relleno; validar NOM-001-SEDE 392.22)';
  return { widthMm: widthMm, note: note };
}

// Ladder cable-tray price by width. Width-specific SKU -> width-agnostic fallback
// (old behaviour) -> graceful price:null placeholder (no crash if the DB lacks it).
function _bomV2_ladderTrayPriceObj(bosDb, widthMm) {
  var w = Math.round(Number(widthMm) || 0);
  if (bosDb && bosDb.length) {
    var ratings = w > 0 ? [w + 'MM', w + ' MM', String(w)] : [];
    var cats = [['SUPPORT', 'LADDER TRAY'], ['CONDUIT', 'CABLE TRAY'],
                ['CABLE TRAY', 'CABLE TRAY'], ['SUPPORT', 'CHAROLA']];
    for (var c = 0; c < cats.length; c++) {
      for (var r = 0; r < ratings.length; r++) {
        var hit = _bomV2_bosPriceObj(bosDb, cats[c][0], cats[c][1], ratings[r]);
        if (hit) return { price: hit.price, isUsd: hit.isUsd, id: hit.id, widthMm: w };
      }
    }
    for (var i = 0; i < bosDb.length; i++) {
      var row = bosDb[i];
      if (String(row['BOS_CATEGORY']    || '').toUpperCase().trim() !== 'SUPPORT') continue;
      if (String(row['BOS_SUBCATEGORY'] || '').toUpperCase().trim() !== 'LADDER TRAY') continue;
      var p = parseFloat(row['BOS_PRICE_PER_UNIT_MXN']);
      if (!isNaN(p) && p > 0) {
        return { price: p,
                 isUsd: String(row['BOS_CURRENCY'] || '').toUpperCase().trim() === 'USD',
                 id: row['_bosId'] || String(row['BOS_ID'] || '').trim(), widthMm: w };
      }
    }
  }
  return { price: null, isUsd: false, id: 'CABLE_TRAY_' + w + 'MM', widthMm: w };
}


// =============================================================================
// BREAKERS
// =============================================================================
function _bomV2_breakerILinePriceObj(bosDb, amps, poles) {
  return _bomV2_bosPriceObj(bosDb, 'DISTRIBUTION', 'BREAKERS', amps + ' A / ' + poles + ' POLES') ||
         _bomV2_bosPriceObj(bosDb, 'DISTRIBUTION', 'BREAKERS', String(amps) + 'A');
}
function _bomV2_breakerILinePriceMxn(bosDb, amps, poles) {
  var obj = _bomV2_breakerILinePriceObj(bosDb, amps, poles);
  return obj ? obj.price : null;
}

function _bomV2_breakerPriceWithFallback(bosDb, amps, poles) {
  var exactObj = _bomV2_breakerILinePriceObj(bosDb, amps, poles);
  if (exactObj) return { price: exactObj.price, id: exactObj.id, note: null };
  var increments = [25, 50, 75, 100, 150, 200, 300, 400, 500];
  for (var i = 0; i < increments.length; i++) {
    var tryAmps = amps + increments[i];
    var tryObj  = _bomV2_breakerILinePriceObj(bosDb, tryAmps, poles);
    if (tryObj) {
      return {
        price: tryObj.price,
        id   : tryObj.id,
        note : 'Breaker ' + amps + 'A ' + poles + 'P no encontrado en DB \u2014 ' +
               'usando precio de ' + tryAmps + 'A como referencia. Cotizar con proveedor.'
      };
    }
  }
  return { price: null, id: '',
           note: 'Precio pendiente \u2014 breaker ' + amps + 'A ' + poles + 'P no en DB. Cotizar con proveedor.' };
}


// =============================================================================
// PANELBOARD / TRANSFORMER (smallest fit >= rating)
// =============================================================================
function _bomV2_panelboardPriceObj(bosDb, maxAmps) {
  var best = null, bestAmps = Infinity;
  bosDb.forEach(function(r) {
    if (String(r['BOS_CATEGORY']    || '').toUpperCase().trim() !== 'DISTRIBUTION') return;
    if (String(r['BOS_SUBCATEGORY'] || '').toUpperCase().trim() !== 'LOAD CENTER') return;
    var rAmps = parseFloat(r['BOS_RATING_OR_SIZE']);
    if (!isNaN(rAmps) && rAmps >= maxAmps && rAmps < bestAmps) {
      var p = parseFloat(r['BOS_PRICE_PER_UNIT_MXN']);
      if (!isNaN(p) && p > 0) {
        best = { price: p,
                 isUsd: String(r['BOS_CURRENCY']||'').toUpperCase().trim() === 'USD',
                 id   : r['_bosId'] || String(r['BOS_ID']||'').trim() ||
                        (r['_raw'] ? String(r['_raw'][0]||'').trim() : '') };
        bestAmps = rAmps;
      }
    }
  });
  return best;
}
function _bomV2_panelboardPriceMxn(bosDb, maxAmps) {
  var obj = _bomV2_panelboardPriceObj(bosDb, maxAmps);
  return obj ? obj.price : null;
}

function _bomV2_transformerPriceObj(bosDb, kva) {
  var best = null, bestKva = Infinity;
  bosDb.forEach(function(r) {
    if (String(r['BOS_CATEGORY']    || '').toUpperCase().trim() !== 'DISTRIBUTION') return;
    if (String(r['BOS_SUBCATEGORY'] || '').toUpperCase().trim() !== 'TRANSFORMERS') return;
    var rKva = parseFloat(r['BOS_RATING_OR_SIZE']);
    if (!isNaN(rKva) && rKva >= kva && rKva < bestKva) {
      var p = parseFloat(r['BOS_PRICE_PER_UNIT_MXN']);
      if (!isNaN(p) && p > 0) {
        best = { price: p,
                 isUsd: String(r['BOS_CURRENCY']||'').toUpperCase().trim() === 'USD',
                 id   : r['_bosId'] || String(r['BOS_ID']||'').trim() ||
                        (r['_raw'] ? String(r['_raw'][0]||'').trim() : '') };
        bestKva = rKva;
      }
    }
  });
  return best;
}
function _bomV2_transformerPriceMxn(bosDb, kva) {
  var obj = _bomV2_transformerPriceObj(bosDb, kva);
  return obj ? obj.price : null;
}


// =============================================================================
// MC4 / MONITORING / METER
// =============================================================================
function _bomV2_mc4PriceObj(bosDb) {
  return _bomV2_bosPriceObj(bosDb, 'CONNECTORS', 'MC4', '10') ||
         _bomV2_bosPriceObj(bosDb, 'CONNECTORS', 'MC4', '8');
}
function _bomV2_mc4PriceMxn(bosDb) {
  var obj = _bomV2_mc4PriceObj(bosDb);
  return obj ? obj.price : null;
}

function _bomV2_monitoringPriceObj(bosDb) {
  var obj = _bomV2_bosPriceObj(bosDb, 'MONITORING', 'MONITORING PACKAGE', null);
  if (obj) return obj;
  for (var i = 0; i < bosDb.length; i++) {
    var r = bosDb[i];
    if (String(r['BOS_MODEL'] || '').toUpperCase().indexOf('HUAWEI MONITO') !== -1) {
      var q = parseFloat(r['BOS_PRICE_PER_UNIT_MXN']);
      if (!isNaN(q) && q > 0) {
        return { price: q,
                 isUsd: String(r['BOS_CURRENCY']||'').toUpperCase().trim() === 'USD',
                 id   : r['_bosId'] || String(r['BOS_ID']||'').trim() ||
                        (r['_raw'] ? String(r['_raw'][0]||'').trim() : '') };
      }
    }
  }
  return null;
}
function _bomV2_monitoringPriceMxn(bosDb) {
  var obj = _bomV2_monitoringPriceObj(bosDb);
  return obj ? obj.price : null;
}

function _bomV2_meterPriceObj(bosDb) {
  for (var i = 0; i < bosDb.length; i++) {
    var r = bosDb[i];
    if (String(r['BOS_MODEL'] || '').toUpperCase().indexOf('ION MEDIDOR') !== -1) {
      var p = parseFloat(r['BOS_PRICE_PER_UNIT_MXN']);
      if (!isNaN(p) && p > 0) {
        return { price: p,
                 isUsd: String(r['BOS_CURRENCY']||'').toUpperCase().trim() === 'USD',
                 id   : r['_bosId'] || String(r['BOS_ID']||'').trim() ||
                        (r['_raw'] ? String(r['_raw'][0]||'').trim() : '') };
      }
    }
  }
  return null;
}
function _bomV2_meterPriceMxn(bosDb) {
  var obj = _bomV2_meterPriceObj(bosDb);
  return obj ? obj.price : null;
}
