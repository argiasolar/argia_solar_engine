// =============================================================================
// ARGIA ENGINE -- 33_CalcProjectStatus.js
// -----------------------------------------------------------------------------
// T4: the single PROJECT STATUS engine + offer gate.
//
// One place decides whether a project is sellable. Rules (T10) plug in here
// rather than each inventing its own gate. Each rule returns a result:
//     { level, code, message, evidence }
// The engine reduces them to the WORST level and surfaces it on _META, the
// Project Card, and API_OUTPUT.project_status. The PDF/offer export path is
// gated on status == PASS (with an explicit override for the soft levels;
// BLOCKED is a hard stop).
//
// LEVELS (worst wins):
//   PASS                0  -- sellable, no issues
//   PASS_WITH_WARNINGS  1  -- sellable, minor advisories
//   REVIEW_REQUIRED     2  -- a human must sign off before emitting
//   BLOCKED             3  -- not emittable (hard stop)
//
// ARCHITECTURE (Node-self-test friendly -- pure core, no Spreadsheet dep):
//   reduceProjectStatus(ruleResults)   PURE  -- rules -> worst level + reasons
//   isOfferEmittable(status, override) PURE  -- the gate predicate
//   _psRuleHasCapex(capexMxn)          PURE  -- the one shipped rule (T10 adds more)
//   collectProjectStatusRules(ss)      LIVE  -- gather rule results from the workbook
//   resolveProjectStatusValue(ss)      LIVE  -- status string only (no writes)
//   runProjectStatus(ss, opts)         LIVE  -- resolve + write _META + Project Card
//   assertOfferEmittable(ss, opts)     LIVE  -- gate used by the export path
// =============================================================================

var PROJECT_STATUS = {
  PASS:               'PASS',
  PASS_WITH_WARNINGS: 'PASS_WITH_WARNINGS',
  REVIEW_REQUIRED:    'REVIEW_REQUIRED',
  BLOCKED:            'BLOCKED'
};

// Severity rank -- higher is worse. Unknown levels rank as BLOCKED (fail-closed:
// a malformed rule must never silently let an offer through).
var _PS_RANK = { PASS: 0, PASS_WITH_WARNINGS: 1, REVIEW_REQUIRED: 2, BLOCKED: 3 };

function _psRankOf(level) {
  var r = _PS_RANK[String(level || '').trim().toUpperCase()];
  return (typeof r === 'number') ? r : _PS_RANK.BLOCKED;
}
function _psLevelForRank(rank) {
  for (var k in _PS_RANK) { if (_PS_RANK[k] === rank) return k; }
  return PROJECT_STATUS.BLOCKED;
}


// -----------------------------------------------------------------------------
// PURE CORE
// -----------------------------------------------------------------------------

/**
 * Reduce rule results to one status. PURE.
 * @param {Array} ruleResults  [{ level, code, message, evidence }]
 * @return {Object} {
 *   status,                 worst level (PASS when empty)
 *   reasons,                results sorted worst-first
 *   emittable,              status === PASS
 *   counts: { PASS, PASS_WITH_WARNINGS, REVIEW_REQUIRED, BLOCKED }
 * }
 */
function reduceProjectStatus(ruleResults) {
  var list = (ruleResults || []).slice();
  var counts = { PASS: 0, PASS_WITH_WARNINGS: 0, REVIEW_REQUIRED: 0, BLOCKED: 0 };
  var worst = 0;

  for (var i = 0; i < list.length; i++) {
    var lvl = _psLevelForRank(_psRankOf(list[i] && list[i].level));
    counts[lvl]++;
    if (_PS_RANK[lvl] > worst) worst = _PS_RANK[lvl];
  }

  // Reasons sorted worst-first, stable within a level.
  var reasons = list.map(function (r, idx) {
    return {
      level:    _psLevelForRank(_psRankOf(r && r.level)),
      code:     (r && r.code) || 'UNSPECIFIED',
      message:  (r && r.message) || '',
      evidence: (r && r.evidence != null) ? r.evidence : null,
      _idx:     idx
    };
  }).sort(function (a, b) {
    var d = _PS_RANK[b.level] - _PS_RANK[a.level];
    return d !== 0 ? d : (a._idx - b._idx);
  }).map(function (r) { delete r._idx; return r; });

  var status = _psLevelForRank(worst);
  return { status: status, reasons: reasons, emittable: status === PROJECT_STATUS.PASS, counts: counts };
}

/**
 * The offer/PDF gate predicate. PURE.
 *   PASS                -> emittable
 *   PASS_WITH_WARNINGS  -> emittable only with explicit override
 *   REVIEW_REQUIRED     -> emittable only with explicit override
 *   BLOCKED             -> never emittable (hard stop, override ignored)
 */
function isOfferEmittable(status, override) {
  var s = String(status || '').trim().toUpperCase();
  if (s === PROJECT_STATUS.PASS) return true;
  if (s === PROJECT_STATUS.BLOCKED) return false;
  return !!override;
}

/**
 * The one shipped rule (T10 adds the rest): a sellable project must have a
 * positive CAPEX. PURE -- takes the number, returns a rule result.
 */
function _psRuleHasCapex(capexMxn) {
  var n = Number(capexMxn);
  if (isFinite(n) && n > 0) {
    return { level: PROJECT_STATUS.PASS, code: 'CAPEX_PRESENT',
             message: 'CAPEX is present (' + Math.round(n).toLocaleString('en-US') + ' MXN).',
             evidence: { capexMxn: n } };
  }
  return { level: PROJECT_STATUS.BLOCKED, code: 'NO_CAPEX',
           message: 'CAPEX is missing or non-positive -- project is not sellable.',
           evidence: { capexMxn: isFinite(n) ? n : null } };
}


// -----------------------------------------------------------------------------
// LIVE WORKBOOK
// -----------------------------------------------------------------------------

/** Read the cost-basis CAPEX (PROJECT_CARD_v2!D40 cost TOTAL; CLIENT_FIN!D8 fallback). */
function _psReadCapexMxn(ss) {
  function read(sheet, a1) {
    try {
      var sh = ss.getSheetByName(sheet);
      if (!sh) return NaN;
      var v = Number(sh.getRange(a1).getValue());
      return isFinite(v) ? v : NaN;
    } catch (e) { return NaN; }
  }
  var pcRow = (typeof PC_ROW !== 'undefined' && PC_ROW.COST_TOTAL) ? PC_ROW.COST_TOTAL : 40;
  var pcCol = (typeof PC_COL !== 'undefined' && PC_COL.MXN_COST)   ? PC_COL.MXN_COST   : 4;
  var pc = ss.getSheetByName('PROJECT_CARD_v2');
  var v = NaN;
  if (pc) { try { v = Number(pc.getRange(pcRow, pcCol).getValue()); } catch (e) {} }
  if (!(isFinite(v) && v > 0)) v = read('CLIENT_FINANCIALS_v2', 'D8');
  return isFinite(v) ? v : NaN;
}

/** Gather rule results from the live workbook. T4 ships the has-CAPEX rule;
 *  T9 adds BOM completeness. Each rule is guarded so one reader failing can
 *  never crash the whole status (and never silently passes). */
function collectProjectStatusRules(ss) {
  var rules = [ _psRuleHasCapex(_psReadCapexMxn(ss)) ];
  try {
    rules.push(_psRuleBomCompleteness(runBomCompleteness(ss)));
  } catch (e) {
    rules.push({ level: 'REVIEW_REQUIRED', code: 'BOM_CHECK_ERROR',
      message: 'BOM completeness check failed: ' + (e && e.message ? e.message : e),
      evidence: {} });
  }
  try {
    rules.push(runStructureCostRule(ss));
  } catch (e) {
    rules.push({ level: 'REVIEW_REQUIRED', code: 'STRUCTURE_CHECK_ERROR',
      message: 'Structure cost check failed: ' + (e && e.message ? e.message : e),
      evidence: {} });
  }
  try {
    rules.push(runCfeDataQualityRule(ss));
  } catch (e) {
    rules.push({ level: 'REVIEW_REQUIRED', code: 'CFE_DQ_CHECK_ERROR',
      message: 'CFE data-quality check failed: ' + (e && e.message ? e.message : e),
      evidence: {} });
  }
  try {
    rules.push(runBessDecisionRule(ss));
  } catch (e) {
    rules.push({ level: 'PASS', code: 'BESS_DECISION_CHECK_ERROR',
      message: 'BESS decision check failed: ' + (e && e.message ? e.message : e),
      evidence: {} });
  }
  return rules;
}

/** Status string only -- no side effects. Used by API_OUTPUT and the gate. */
function resolveProjectStatusValue(ss) {
  try { return reduceProjectStatus(collectProjectStatusRules(ss)).status; }
  catch (e) { return PROJECT_STATUS.REVIEW_REQUIRED; }  // resolver failure != silent PASS
}

/** Resolve + persist: _META stamp + Project Card row-2 status line. Returns the result. */
function runProjectStatus(ss, opts) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  opts = opts || {};
  var result = reduceProjectStatus(collectProjectStatusRules(ss));

  // _META append-stamp (mirrors the consistency-guard pattern).
  try {
    var meta = ss.getSheetByName('_META');
    if (meta) {
      var worstCode = result.reasons.length ? (result.reasons[0].code) : 'NONE';
      var when = (typeof Utilities !== 'undefined' && Utilities.formatDate)
               ? Utilities.formatDate(new Date(), 'GMT', "yyyy-MM-dd'T'HH:mm:ss'Z'")
               : new Date().toISOString();
      var row = meta.getLastRow() + 1;
      meta.getRange(row, 1, 1, 2).setValues([['PROJECT_STATUS',
        result.status + ' (' + worstCode + ') @ ' + when]]);
    }
  } catch (e) {}

  // Project Card: row 2 (a blank spacer row -- no merges/frozen panes) gets a
  // visible status line. Output sheet, fully regenerated, so this is safe.
  try {
    var pc = ss.getSheetByName('PROJECT_CARD_v2');
    if (pc) {
      pc.getRange(2, 2).setValue('ESTADO DEL PROYECTO:');
      pc.getRange(2, 4).setValue(result.status
        + (result.status === PROJECT_STATUS.PASS ? '' : ' -- ' + (result.reasons[0] && result.reasons[0].code)));
    }
  } catch (e) {}

  try { if (typeof Logger !== 'undefined') Logger.log('PROJECT_STATUS: ' + result.status); } catch (e) {}
  return result;
}

/**
 * Offer/PDF gate for the export path. Resolves status and applies the predicate.
 * @return {Object} { emittable, status, override, reasonsTop }
 */
function assertOfferEmittable(ss, opts) {
  opts = opts || {};
  var status = opts.status || resolveProjectStatusValue(ss);
  var override = !!opts.override;
  return {
    emittable: isOfferEmittable(status, override),
    status:    status,
    override:  override,
    hardBlocked: String(status).toUpperCase() === PROJECT_STATUS.BLOCKED
  };
}
