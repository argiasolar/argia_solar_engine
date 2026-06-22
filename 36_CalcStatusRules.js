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

// -----------------------------------------------------------------------------
// RULE: BESS-decision transparency  (reads BESS_RECOMMENDATIONS + BOM_v2)
// If the engine recommends a battery but the project excludes it, the offer
// silently leaves peak-shaving / arbitrage savings on the table. Surface it:
// record the reason + the omitted annual savings so the designer makes a
// conscious call. Advisory (PASS_WITH_WARNINGS) — disclosure, not a hard block.
//   recommended & included  -> PASS  (BESS_RECOMMENDED_INCLUDED)
//   recommended & excluded  -> PASS_WITH_WARNINGS (BESS_RECOMMENDED_EXCLUDED)
//   not recommended         -> PASS  (BESS_NOT_RECOMMENDED)
//   no recommendations sheet -> NOT_EVALUATED
// -----------------------------------------------------------------------------

// PURE. d = { recommended, included, recommendedLabel, omittedSavingsAnnualMxn,
//             omittedSavingsPct }  (null -> not evaluated).
function _psRuleBessDecision(d) {
  if (!d) {
    return { level: 'PASS', code: 'BESS_DECISION_NOT_EVALUATED',
             message: 'Decision BESS no evaluada (sin BESS_RECOMMENDATIONS).',
             evidence: { evaluated: false } };
  }
  if (d.recommended !== true) {
    return { level: 'PASS', code: 'BESS_NOT_RECOMMENDED',
             message: 'Sin bateria recomendada para este perfil -- nada que divulgar.',
             evidence: { recommended: false } };
  }
  if (d.included) {
    return { level: 'PASS', code: 'BESS_RECOMMENDED_INCLUDED',
             message: 'Bateria recomendada e incluida en la propuesta.',
             evidence: { recommended: true, included: true } };
  }
  // recommended but excluded -> disclose.
  var savTxt = (d.omittedSavingsAnnualMxn > 0)
    ? ' Ahorro anual omitido ~$' + Math.round(d.omittedSavingsAnnualMxn).toLocaleString('en-US') + ' MXN'
      + (d.omittedSavingsPct != null ? ' (~' + d.omittedSavingsPct + '% de la factura CFE base sin PV).' : '.')
    : '.';
  return {
    level: 'PASS_WITH_WARNINGS', code: 'BESS_RECOMMENDED_EXCLUDED',
    message: 'Bateria recomendada (' + (d.recommendedLabel || 'ver BESS_RECOMMENDATIONS')
           + ') pero EXCLUIDA de la propuesta.' + savTxt
           + ' Decision consciente: divulgar en tarjeta/oferta.',
    evidence: {
      recommended: true, included: false,
      recommendedLabel: d.recommendedLabel || null,
      omittedSavingsAnnualMxn: d.omittedSavingsAnnualMxn || null,
      omittedSavingsPct: (d.omittedSavingsPct != null ? d.omittedSavingsPct : null)
    }
  };
}

// LIVE. Build the decision from BESS_RECOMMENDATIONS (row-2 banner + candidate
// table) and BOM_v2 (BESS subtotal). null when no recommendations sheet.
function collectBessDecision(ss) {
  var rec = ss.getSheetByName('BESS_RECOMMENDATIONS');
  if (!rec) return null;

  var banner = '';
  try { banner = String(rec.getRange(2, 1).getValue() || ''); } catch (e) {}
  var recommended = /RECOMMENDED:/i.test(banner);
  var recommendedLabel = recommended
    ? banner.replace(/^.*RECOMMENDED:\s*/i, '').split('  ')[0].trim()
    : null;

  // included = BOM BESS subtotal > 0 (BOM_ROW.SUBTOTAL_BESS = 92, TOTAL_USD = 6).
  var included = false;
  try {
    var bom = ss.getSheetByName('BOM_v2');
    if (bom) included = (Number(bom.getRange(92, 6).getValue()) || 0) > 0;
  } catch (e) {}

  var omittedAnnual = 0, omittedPct = null;
  if (recommended && !included) {
    // Best candidate Total $/yr (col 10), rows 8..last — robust numeric read.
    try {
      var last = rec.getLastRow();
      if (last >= 8) {
        var col = rec.getRange(8, 10, last - 7, 1).getValues();
        for (var i = 0; i < col.length; i++) {
          var v = Number(col[i][0]) || 0;
          if (v > omittedAnnual) omittedAnnual = v;
        }
      }
    } catch (e) {}
    // % of the CFE base (sin-PV) bill — authoritative at BESS_SIMULATION!D12.
    try {
      var sim = ss.getSheetByName('BESS_SIMULATION');
      var sinPv = sim ? Number(sim.getRange('D12').getValue()) : 0;
      if (sinPv > 0 && omittedAnnual > 0) omittedPct = Math.round((omittedAnnual / sinPv) * 1000) / 10;
    } catch (e) {}
  }

  return { recommended: recommended, included: included, recommendedLabel: recommendedLabel,
           omittedSavingsAnnualMxn: omittedAnnual, omittedSavingsPct: omittedPct };
}

// LIVE wrapper.
function runBessDecisionRule(ss) {
  return _psRuleBessDecision(collectBessDecision(ss));
}


// -----------------------------------------------------------------------------
// A3a -- AGS-802 §5.3 human/field hard-block gates (DRO, UVIE, H-point, HSE,
// Cat-1). These are real hard-blocks, but at their downstream STAGE (construction
// / commissioning / interconnection), not at the proposal stage the Engine
// produces -- and they require a human/field sign-off the Engine cannot perform.
// Per AGS-801 R6 / AGS-802 R3 the Engine must surface them explicitly as
// NOT_EVALUATED (rendered PASS-level: visible, never a false block, never a
// silent pass) so the proposal can never quietly assume them satisfied.
// The gate list itself is the single source of truth in 37_AgsOracleMap.js.
// -----------------------------------------------------------------------------

// PURE. gates = agsHumanGates(); evidence = { 'AGS-206': true, ... } recorded sign-offs.
function _psRuleHumanGates(gates, evidence) {
  gates = gates || [];
  evidence = evidence || {};
  if (gates.length === 0) {
    return { level: 'PASS', code: 'HUMAN_GATES_NONE',
             message: 'No human/field gates defined.', evidence: { gates: [] } };
  }
  var detail = gates.map(function (g) {
    return { ref: g.ref, stage: g.stage || '', category: g.category,
             condition: g.condition, recorded: evidence[g.ref] === true };
  });
  var pending = detail.filter(function (g) { return !g.recorded; });
  if (pending.length === 0) {
    return { level: 'PASS', code: 'HUMAN_GATES_RECORDED',
             message: 'All ' + gates.length + ' downstream human/field sign-offs are recorded.',
             evidence: { gates: detail, pending: 0 } };
  }
  var refs = pending.map(function (g) { return g.ref; }).join(', ');
  return {
    level: 'PASS',   // NOT_EVALUATED -> PASS-level: visible advisory, not a proposal-stage block
    code: 'HUMAN_GATES_NOT_EVALUATED',
    message: pending.length + ' downstream AGS-802 §5.3 hard-block gate(s) require human/field '
           + 'sign-off and are NOT evaluated by the Engine (decision-support, not self-certification): '
           + refs + '. Each must be signed off before its stage (construction / commissioning / '
           + 'interconnection); the proposal must not assume them satisfied.',
    evidence: { gates: detail, pending: pending.length, pendingRefs: refs }
  };
}

// LIVE. Reads recorded sign-offs if a source exists; none is wired yet, so every
// gate is honestly reported NOT_EVALUATED (never silently passed). A future
// enhancement can populate evidence from a SIGN_OFFS section.
function collectHumanGatesEvidence(ss) {
  return {};
}

function runHumanGatesRule(ss) {
  return _psRuleHumanGates(
    (typeof agsHumanGates === 'function') ? agsHumanGates() : [],
    collectHumanGatesEvidence(ss));
}


// -----------------------------------------------------------------------------
// A3b (advisory mode) -- engine-evaluable AGS-802 §5.3 blocks that are not yet
// wired as real hard-blocks because their data source is missing/partial (see
// the 2026-06 audit in 37_AgsOracleMap.js). Per the "no hard blocks at this
// moment" decision, they are surfaced NOT_EVALUATED (PASS-level: visible, never
// a silent pass, never a block), each annotated with what data it is waiting on.
// When a block's field is wired, it moves out of this advisory into a real rule.
// -----------------------------------------------------------------------------

// PURE. blocks = agsEnginePendingBlocks(); wired = { 'AGS-303': true, ... } refs
// already promoted to a real rule; waitingOnFn(ref) -> audit note string.
function _psRuleEngineBlocks(blocks, wired, waitingOnFn) {
  blocks = blocks || [];
  wired = wired || {};
  waitingOnFn = waitingOnFn || function () { return ''; };
  var pending = blocks.filter(function (b) { return wired[b.ref] !== true; });
  if (pending.length === 0) {
    return { level: 'PASS', code: 'ENGINE_BLOCKS_ALL_WIRED',
             message: 'All engine-evaluable §5.3 hard-blocks are wired.',
             evidence: { pending: 0 } };
  }
  var detail = pending.map(function (b) {
    return { ref: b.ref, category: b.category, condition: b.condition,
             timeGated: b.timeGated === true, waitingOn: waitingOnFn(b.ref) };
  });
  var refs = pending.map(function (b) { return b.ref; }).join(', ');
  return {
    level: 'PASS',   // NOT_EVALUATED -> PASS-level advisory, never a block
    code: 'ENGINE_BLOCKS_NOT_EVALUATED',
    message: pending.length + ' engine-evaluable AGS-802 §5.3 hard-block(s) are recognised but '
           + 'NOT yet wired (no data source / partial): ' + refs + '. They are surfaced, not '
           + 'enforced -- the proposal must not assume them satisfied. See per-block "waitingOn".',
    evidence: { blocks: detail, pending: pending.length, pendingRefs: refs }
  };
}

// LIVE. None wired yet -> every engine-evaluable block is reported NOT_EVALUATED.
function runEngineBlocksRule(ss) {
  return _psRuleEngineBlocks(
    (typeof agsEnginePendingBlocks === 'function') ? agsEnginePendingBlocks() : [],
    {},   // wired refs -- none yet
    (typeof agsBlockWaitingOn === 'function') ? agsBlockWaitingOn : null);
}
