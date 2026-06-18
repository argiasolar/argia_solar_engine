// =============================================================================
// 34_CalcStructureCost.js  —  Structure cost engine (roof-type $/kWp pricelist)
// -----------------------------------------------------------------------------
// T7 (v4.41.0).
//
// Structure cost = system_kWp × roof_factor($/kWp), where roof_factor comes from
// a pricelist keyed by canonical roof type. Replaces the fragile per-product
// (USD/panel from 13M_PRODUCTS_STRUCTURES) lookup as the COST source — the
// product table still supplies the display NAME in the BOM, but the price is now
// driven by the same roofType input that already drives install labor.
//
// A null/blank factor (roof type with no quote) surfaces as SIN COTIZAR, which
// propagates to the BOM subtotal label, the Project Card, and (T9/T10) the
// offer gate.
//
// PURE — no SpreadsheetApp. Fully unit-testable.
//
// ⚠ PLACEHOLDERS — two things in this file are inferred and MUST be confirmed by
//   the user before relying on non-KR18 projects:
//     1. STRUCTURE_PRICELIST factors for TR36 / RT37 / FLAT (placeholders).
//        KR18 is calibrated to the CULLIGAN reference (24,300 USD / 864 kWp).
//     2. ROOF_TYPE_ALIASES (team naming → code) — a best-effort guess.
// =============================================================================

// Canonical roof types = the code enum already used by INPUT (02c_InputMap
// roofType dropdown) and install labor (appliesToRoofType). All other naming
// maps onto these.
var STRUCTURE_CANONICAL_ROOF_TYPES = ['KR18', 'TR36', 'RT37', 'FLAT', 'OTHER'];

// $/kWp by canonical roof type. usdPerKwp === null  ⇒ SIN COTIZAR.
// quoteDate is informational (when the factor was last set / quoted).
var STRUCTURE_PRICELIST = {
  // Calibrated so CULLIGAN (864 kWp, KR18) = 24,300 USD exactly (28.125 × 864).
  // This is a CALIBRATED PLACEHOLDER, not a real quote — replace with a supplier
  // quote and the CULLIGAN golden moves by design (acknowledge then).
  KR18:  { usdPerKwp: 28.125, quoteDate: '2026-06-17', note: 'CALIBRATED to CULLIGAN reference (24,300 USD / 864 kWp). Placeholder — replace with supplier quote.' },
  TR36:  { usdPerKwp: 26.00,  quoteDate: '2026-06-17', note: 'PLACEHOLDER $/kWp — confirm with supplier quote.' },
  RT37:  { usdPerKwp: 30.00,  quoteDate: '2026-06-17', note: 'PLACEHOLDER $/kWp — confirm with supplier quote.' },
  FLAT:  { usdPerKwp: 22.00,  quoteDate: '2026-06-17', note: 'PLACEHOLDER $/kWp — ballast/flat — confirm with supplier quote.' },
  // OTHER has no factor on purpose → SIN COTIZAR (a roof type we have not priced).
  OTHER: { usdPerKwp: null,   quoteDate: null,         note: 'No factor — structure must be quoted (SIN COTIZAR).' }
};

// Best-effort team-naming → canonical code. ⚠ INFERRED — confirm before trusting
// for non-KR18 projects. Unknown inputs fall through to OTHER (→ SIN COTIZAR),
// which is the safe (loud) default.
var ROOF_TYPE_ALIASES = {
  'STANDING-SEAM': 'KR18', 'STANDING SEAM': 'KR18', 'STANDINGSEAM': 'KR18',
  'CONCRETE':      'RT37',
  'BALLASTED':     'FLAT',  'BALLAST': 'FLAT',
  'GROUND':        'OTHER', 'GROUND-MOUNT': 'OTHER', 'GROUND MOUNT': 'OTHER'
};

// PURE: normalize any roof-type string (code or team name) to a canonical code.
// Blank/unknown → 'OTHER' (the safe SIN COTIZAR default).
function canonicalRoofType(raw) {
  var s = String(raw == null ? '' : raw).trim().toUpperCase();
  if (s === '') return 'OTHER';
  if (STRUCTURE_CANONICAL_ROOF_TYPES.indexOf(s) !== -1) return s;
  if (ROOF_TYPE_ALIASES.hasOwnProperty(s)) return ROOF_TYPE_ALIASES[s];
  return 'OTHER';
}

// PURE: the $/kWp factor for a roof type, or null when unpriced (→ SIN COTIZAR).
// Accepts raw or canonical input (normalizes internally).
function structureFactorUsdPerKwp(roofType) {
  var code = canonicalRoofType(roofType);
  var row  = STRUCTURE_PRICELIST[code];
  if (!row) return null;
  var f = row.usdPerKwp;
  return (typeof f === 'number' && isFinite(f) && f > 0) ? f : null;
}

// PURE: structure cost for a project.
//   calcStructureCost(roofType, kWp) -> {
//     roofType,           // canonical code used
//     usdPerKwp,          // factor applied (null if unpriced)
//     usdTotal,           // kWp × factor (0 when SIN COTIZAR)
//     sinCotizar,         // true ⇒ no factor / no kWp ⇒ must be quoted
//     quoteDate, note     // provenance for the BOM note
//   }
function calcStructureCost(roofType, kWp) {
  var code = canonicalRoofType(roofType);
  var row  = STRUCTURE_PRICELIST[code] || { usdPerKwp: null, quoteDate: null, note: '' };
  var factor = structureFactorUsdPerKwp(code);
  var kwpNum = Number(kWp);
  var haveKwp = isFinite(kwpNum) && kwpNum > 0;

  if (factor === null || !haveKwp) {
    return {
      roofType: code, usdPerKwp: factor, usdTotal: 0, sinCotizar: true,
      quoteDate: row.quoteDate || null,
      note: factor === null
        ? ('Estructura SIN COTIZAR — tipo de techo "' + code + '" sin factor en STRUCTURE_PRICELIST. ' + (row.note || ''))
        : ('Estructura SIN COTIZAR — kWp no disponible para el cálculo.')
    };
  }
  return {
    roofType: code, usdPerKwp: factor, usdTotal: factor * kwpNum, sinCotizar: false,
    quoteDate: row.quoteDate || null,
    note: 'Estructura = ' + kwpNum.toFixed(2) + ' kWp × $' + factor + '/kWp (' + code +
          ') = $' + (factor * kwpNum).toFixed(0) + ' USD. ' + (row.note || '')
  };
}
