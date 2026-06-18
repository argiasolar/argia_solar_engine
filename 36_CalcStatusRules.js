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
