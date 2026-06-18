// =============================================================================
// 35_CalcBomCompleteness.js  —  BOM required-material-families completeness
// -----------------------------------------------------------------------------
// T9 (v4.43.0). Closes G3 ("confident payback on incomplete CAPEX").
//
// A client-facing BOM total can silently omit a required family (transformer,
// protections, ...) or carry a SIN COTIZAR (unpriced) line, yet the financials
// still print a confident payback. This module:
//   1. Defines the required material families.
//   2. Computes a completeness % and lists missing / unpriced families.
//   3. Emits a PROJECT_STATUS rule so a gap shows up as INCOMPLETE (not PASS)
//      on the Project Card and BLOCKS the offer (via the T4 gate).
//
// SIN COTIZAR signal: a family is flagged only when the BOM writer itself
// tinted a UNIT_PRICE cell MISSING_PRICE red (#FDECEA) inside the family's row
// range -- the same authoritative classification that drives the grand-total
// "SIN COTIZAR" label. An intentionally by-others line (e.g. a CFE-supplied
// transformer rendered with no price and no red tint) is NOT a gap.
//
// PURE core (evaluateBomCompleteness, _psRuleBomCompleteness) + LIVE collector.
// =============================================================================

// BOM_v2 row map (mirrors BOM_ROW in 00_Main.js). first..(subtotal-1) is the
// line-item range for the family; `subtotal` is the SUBTOTAL row.
var BOM_COMPLETENESS_FAMILIES = [
  { key: 'PV_MODULES',         label: 'Paneles solares',         core: true,  first: 8,  subtotal: 13 },
  { key: 'INVERTERS',          label: 'Inversores',              core: true,  first: 15, subtotal: 20 },
  { key: 'STRUCTURE',          label: 'Estructura',              core: true,  first: 22, subtotal: 25 },
  { key: 'DC_ELECTRICAL',      label: 'Electrico DC',            core: true,  first: 27, subtotal: 35 },
  { key: 'AC_ELECTRICAL',      label: 'Electrico AC',            core: true,  first: 37, subtotal: 63 },
  { key: 'MONITORING_PERMITS', label: 'Monitoreo y permisos',    core: true,  first: 70, subtotal: 78 },
  { key: 'TRANSFORMER',        label: 'Transformador',           core: false, first: 65, subtotal: 68 },
  { key: 'BESS',               label: 'Almacenamiento / BESS',   core: false, first: 80, subtotal: 92 }
];

var BOM_MISSING_PRICE_TINT = '#FDECEA';   // writer's MISSING_PRICE red tint

// PURE. familyStatus = { KEY: { present: bool, sinCotizar: bool } }.
// A CORE family is always required; a CONDITIONAL family is required only when
// present (a missing optional family is not a gap, an unpriced one is).
function evaluateBomCompleteness(familyStatus) {
  familyStatus = familyStatus || {};
  var required = [], present = [], missing = [], sinCotizar = [];

  BOM_COMPLETENESS_FAMILIES.forEach(function (f) {
    var st = familyStatus[f.key] || { present: false, sinCotizar: false };
    var isRequired = f.core || !!st.present;
    if (!isRequired) return;
    required.push(f.key);
    if (st.present) present.push(f.key); else missing.push(f.key);
    if (st.present && st.sinCotizar) sinCotizar.push(f.key);
  });

  var pct = required.length
    ? Math.round((present.length / required.length) * 1000) / 10
    : 100;
  var complete = (missing.length === 0 && sinCotizar.length === 0);

  return {
    requiredFamilies:   required,
    presentFamilies:    present,
    missingFamilies:    missing,
    sinCotizarFamilies: sinCotizar,
    completenessPct:    pct,
    complete:           complete
  };
}

// LIVE. Read BOM_v2 once -> normalized familyStatus.
function collectBomFamilyStatus(ss) {
  var bom = ss.getSheetByName('BOM_v2');
  if (!bom) return null;
  var last = 0;
  BOM_COMPLETENESS_FAMILIES.forEach(function (f) { if (f.subtotal > last) last = f.subtotal; });

  // One read each: values (qty col 3, total col 6) + UNIT_PRICE backgrounds (col 5).
  var vals = bom.getRange(1, 1, last, 7).getValues();             // 1-indexed via vals[r-1]
  var bgs  = bom.getRange(1, 5, last, 1).getBackgrounds();        // UNIT_PRICE tint
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  var status = {};
  BOM_COMPLETENESS_FAMILIES.forEach(function (f) {
    var anyQty = false, missingPrice = false;
    for (var r = f.first; r < f.subtotal; r++) {
      var row = vals[r - 1] || [];
      if (num(row[2]) > 0) anyQty = true;                          // QTY (col C, idx 2)
      var tint = String((bgs[r - 1] && bgs[r - 1][0]) || '').toUpperCase();
      if (tint === BOM_MISSING_PRICE_TINT) missingPrice = true;    // writer's MISSING_PRICE mark
    }
    var subtotal = num((vals[f.subtotal - 1] || [])[5]);           // SUBTOTAL TOTAL_USD (col F, idx 5)
    var present = (subtotal > 0) || anyQty;
    status[f.key] = { present: present, sinCotizar: present && missingPrice };
  });
  return status;
}

// LIVE. Full completeness result for the workbook (null when no BOM).
function runBomCompleteness(ss) {
  var st = collectBomFamilyStatus(ss);
  if (!st) return null;
  return evaluateBomCompleteness(st);
}

// PURE. completeness result -> PROJECT_STATUS rule {level, code, message, evidence}.
// No data -> NOT_EVALUATED (never a silent PASS, never a false block).
function _psRuleBomCompleteness(c) {
  if (!c) {
    return { level: 'PASS', code: 'BOM_NOT_EVALUATED',
             message: 'BOM completeness not evaluated (BOM_v2 not present).',
             evidence: { evaluated: false } };
  }
  if (c.complete) {
    return { level: 'PASS', code: 'BOM_COMPLETE',
             message: 'BOM completo (' + c.completenessPct + '%).',
             evidence: { completenessPct: c.completenessPct } };
  }
  var parts = [];
  if (c.missingFamilies.length)    parts.push('familias faltantes: ' + c.missingFamilies.join(', '));
  if (c.sinCotizarFamilies.length) parts.push('SIN COTIZAR: ' + c.sinCotizarFamilies.join(', '));
  return {
    level: 'REVIEW_REQUIRED', code: 'BOM_INCOMPLETE',
    message: 'BOM INCOMPLETO (' + c.completenessPct + '%) -- ' + parts.join('; ') +
             '. La oferta no es emitible sin revision.',
    evidence: {
      completenessPct:    c.completenessPct,
      missingFamilies:    c.missingFamilies,
      sinCotizarFamilies: c.sinCotizarFamilies
    }
  };
}
