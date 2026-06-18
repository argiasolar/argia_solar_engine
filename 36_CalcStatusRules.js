// =============================================================================
// 36_CalcStatusRules.js  —  PROJECT_STATUS rules pack
// -----------------------------------------------------------------------------
// T10 (wires into the T4 engine in 33_CalcProjectStatus.js). Each rule is a
// PURE function returning { level, code, message, evidence } and a thin LIVE
// reader that feeds it from the workbook. collectProjectStatusRules() gathers
// them; reduceProjectStatus() takes the worst.
//
// Hard contract (plan): a rule whose data source has not landed returns
// NOT_EVALUATED (rendered as a PASS-level advisory) -- NEVER a false BLOCK.
//
// T10a (this chunk): STRUCTURE-COST-PRESENT (reads T7). The BOM-completeness
// rule (T9, in 35_) gained its BLOCKED band here too. Remaining rules
// (install-benchmark, CFE data-quality, BESS-decision) land in later chunks as
// their verification completes.
// =============================================================================

// -----------------------------------------------------------------------------
// RULE: structure cost present  (reads T7 — structure pricelist)
// A structure priced at $0 (null roof factor / SIN COTIZAR / silently dropped)
// means the racking is not really costed. That is a hard stop, stricter than
// the BOM-completeness "family present" check: structure_cost == 0 ⇒ BLOCKED.
// -----------------------------------------------------------------------------

// PURE. usd = structure subtotal in USD (number), or null/NaN when unknown.
function _psRuleStructureCost(usd) {
  var n = Number(usd);
  if (usd === null || usd === undefined || !isFinite(n)) {
    return { level: 'PASS', code: 'STRUCTURE_NOT_EVALUATED',
             message: 'Costo de estructura no evaluado (BOM_v2 sin subtotal de estructura).',
             evidence: { evaluated: false } };
  }
  if (n > 0) {
    return { level: 'PASS', code: 'STRUCTURE_COST_PRESENT',
             message: 'Costo de estructura presente (' + Math.round(n).toLocaleString('en-US') + ' USD).',
             evidence: { structureCostUsd: n } };
  }
  return { level: 'BLOCKED', code: 'STRUCTURE_COST_ZERO',
           message: 'Costo de estructura = $0 (estructura SIN COTIZAR o no incluida). '
                  + 'El CAPEX omite el racking -- oferta no emitible.',
           evidence: { structureCostUsd: n } };
}

// LIVE. Read BOM_v2 SUBTOTAL_STRUCTURE (USD). null when BOM/cell absent.
function _psReadStructureCostUsd(ss) {
  var bom = ss.getSheetByName('BOM_v2');
  if (!bom) return null;
  // BOM_ROW.SUBTOTAL_STRUCTURE = 25, BOM_COL.TOTAL_USD = 6 (see 00_Main.js).
  var v;
  try { v = Number(bom.getRange(25, 6).getValue()); } catch (e) { return null; }
  return isFinite(v) ? v : null;
}

// LIVE wrapper.
function runStructureCostRule(ss) {
  return _psRuleStructureCost(_psReadStructureCostUsd(ss));
}

// -----------------------------------------------------------------------------
// RULE: CFE data-quality  (reads INPUT_CFE)
// A confident bill model needs complete billing history. Score five dimensions
// — tariff code, and the 12-month presence of kWh, kW, power factor and billing
// days — then band the average. Configurable thresholds; below them the offer
// is over-confident on thin data.
//   score >= REVIEW_PCT  -> PASS
//   BLOCK_PCT..REVIEW_PCT -> REVIEW_REQUIRED
//   < BLOCK_PCT          -> BLOCKED
// -----------------------------------------------------------------------------
var CFE_DQ_REVIEW_PCT     = 80;   // below this -> REVIEW_REQUIRED
var CFE_DQ_BLOCK_PCT      = 60;   // below this -> BLOCKED
var CFE_DQ_MONTHS_EXPECTED = 12;

// PURE. snap = { tariffPresent, kwhMonths, kwMonths, pfMonths, billingMonths,
//                monthsExpected }. Returns { scorePct, dimensions }.
function scoreCfeDataQuality(snap) {
  if (!snap) return null;
  var exp = Number(snap.monthsExpected) || CFE_DQ_MONTHS_EXPECTED;
  function frac(m) { var n = Number(m) || 0; if (exp <= 0) return 0; return Math.max(0, Math.min(1, n / exp)); }
  var dims = {
    tariff:  snap.tariffPresent ? 1 : 0,
    kwh:     frac(snap.kwhMonths),
    kw:      frac(snap.kwMonths),
    pf:      frac(snap.pfMonths),
    billing: frac(snap.billingMonths)
  };
  var keys = ['tariff', 'kwh', 'kw', 'pf', 'billing'];
  var sum = 0;
  keys.forEach(function (k) { sum += dims[k]; });
  var scorePct = Math.round((sum / keys.length) * 1000) / 10;
  return { scorePct: scorePct, dimensions: dims, monthsExpected: exp };
}

// PURE. score result -> rule.
function _psRuleCfeDataQuality(scoreResult) {
  if (!scoreResult) {
    return { level: 'PASS', code: 'CFE_DQ_NOT_EVALUATED',
             message: 'Calidad de datos CFE no evaluada (INPUT_CFE ausente).',
             evidence: { evaluated: false } };
  }
  var p = scoreResult.scorePct;
  var ev = { scorePct: p, reviewPct: CFE_DQ_REVIEW_PCT, blockPct: CFE_DQ_BLOCK_PCT,
             dimensions: scoreResult.dimensions };
  if (p >= CFE_DQ_REVIEW_PCT) {
    return { level: 'PASS', code: 'CFE_DATA_OK',
             message: 'Datos CFE completos (' + p + '%).', evidence: ev };
  }
  if (p >= CFE_DQ_BLOCK_PCT) {
    return { level: 'REVIEW_REQUIRED', code: 'CFE_DATA_LOW',
             message: 'Datos CFE incompletos (' + p + '%, umbral ' + CFE_DQ_REVIEW_PCT
                    + '%). El modelo de factura es preliminar -- revisar antes de emitir.',
             evidence: ev };
  }
  return { level: 'BLOCKED', code: 'CFE_DATA_CRITICAL',
           message: 'Datos CFE criticamente incompletos (' + p + '%, por debajo de '
                  + CFE_DQ_BLOCK_PCT + '%). El modelo de factura no es confiable -- oferta bloqueada.',
           evidence: ev };
}

// LIVE. Read INPUT_CFE: tariff C4; 12-month presence (cols 3..14) of kWh
// (r10-12), kW (r13-15), PF (r20), billing days (r18). null when sheet absent.
function collectCfeDataQuality(ss) {
  var cfe = ss.getSheetByName('INPUT_CFE');
  if (!cfe) return null;
  var FIRST_COL = 3, MONTHS = CFE_DQ_MONTHS_EXPECTED;     // C..N
  var vals = cfe.getRange(1, 1, 20, FIRST_COL + MONTHS - 1).getValues();
  function cell(r, c) { return (vals[r - 1] || [])[c - 1]; }
  function num(r, c) { var n = Number(cell(r, c)); return isFinite(n) ? n : 0; }

  var tariff = cell(4, FIRST_COL);
  var tariffPresent = !!(tariff && String(tariff).trim());

  var kwh = 0, kw = 0, pf = 0, billing = 0;
  for (var i = 0; i < MONTHS; i++) {
    var c = FIRST_COL + i;
    if ((num(10, c) + num(11, c) + num(12, c)) > 0) kwh++;
    if ((num(13, c) + num(14, c) + num(15, c)) > 0) kw++;
    if (num(20, c) > 0) pf++;
    if (num(18, c) > 0) billing++;
  }
  return { tariffPresent: tariffPresent, kwhMonths: kwh, kwMonths: kw,
           pfMonths: pf, billingMonths: billing, monthsExpected: MONTHS };
}

// LIVE wrapper.
function runCfeDataQualityRule(ss) {
  return _psRuleCfeDataQuality(scoreCfeDataQuality(collectCfeDataQuality(ss)));
}
