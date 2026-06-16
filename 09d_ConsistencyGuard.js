// =============================================================================
// ARGIA ENGINE -- 09d_ConsistencyGuard.js
// -----------------------------------------------------------------------------
// PHASE 0.3 + hardening: cross-tab consistency guard.
//
// WHAT IT CHECKS (three independent failure modes -> any one = RED):
//   1. FORK      -- a shared figure has two sources that disagree > tolerance.
//   2. ERROR     -- a source cell is a spreadsheet error (#VALUE!/#REF!/...).
//                   (v1 silently DROPPED these and could false-PASS. Fixed.)
//   3. INVARIANT -- a number is internally impossible (base < con-PV bill,
//                   negative PV savings, savings > whole bill). Catches
//                   "consistent but absurd" -- agreement is not correctness.
//
// It is a DETECTOR, not a fixer. It changes no cell. It stamps PASS/FAIL on
// _META and (optionally) throws.
//
// ARCHITECTURE (Node-self-test friendly -- pure core, no Spreadsheet dep):
//   checkConsistency(readings,opts)  -- FORK + ERROR detection. PURE.
//   evalInvariants(primitives)       -- INVARIANT (sanity) checks. PURE.
//   buildConsistencyReadings(prims)  -- prims -> readings array. PURE.
//   resolveConsistencyPrimitives(ss) -- reads the live workbook (rich: value+error).
//   assertCrossTabConsistency(ss)    -- resolve -> check -> log -> return.
//   runConsistencyCheck()            -- menu entry; human alert.
// =============================================================================


// -----------------------------------------------------------------------------
// PURE CORE
// -----------------------------------------------------------------------------

function _consIsNum(v) {
  return typeof v === 'number' && isFinite(v) && !isNaN(v);
}

// Spreadsheet error-string signature, e.g. "#VALUE!", "#REF!", "#N/A".
var _CONS_ERR_RX = /^#(VALUE|REF|N\/A|DIV\/0|NUM|NAME|NULL|ERROR)[!?]?/i;

/** Classify a raw cell value -> { value:Number|NaN, error:String|null }. */
function consClassifyCell(raw) {
  if (typeof raw === 'number' && isFinite(raw)) return { value: raw, error: null };
  var s = (raw === null || raw === undefined) ? '' : String(raw).trim();
  if (s !== '' && _CONS_ERR_RX.test(s)) return { value: NaN, error: s };
  return { value: NaN, error: null }; // blank / non-numeric text = legitimately missing
}

/**
 * FORK + ERROR detection across each figure's sources.
 * A source may carry { name, value, error }. An errored source is a hard
 * violation (never silently dropped). Remaining numeric sources are compared.
 *
 * @return {Object} { ok, checked, skipped, violations:[{type,...}] }
 *   type 'error' : { type, key, label, source, error }
 *   type 'fork'  : { type, key, label, minSource, minVal, maxSource, maxVal,
 *                    deltaAbs, deltaRel, tolRel, tolAbs }
 */
function checkConsistency(readings, opts) {
  opts = opts || {};
  var defaultTolRel = _consIsNum(opts.defaultTolRel) ? opts.defaultTolRel : 0.001;

  var violations = [];
  var checked = 0, skipped = 0;

  for (var i = 0; i < (readings || []).length; i++) {
    var r = readings[i] || {};
    var srcs = [];
    for (var s = 0; s < (r.sources || []).length; s++) {
      var src = r.sources[s];
      if (!src) continue;
      if (src.error) {                          // ERROR -- surface, do not drop
        violations.push({ type: 'error', key: r.key, label: r.label,
                          source: src.name, error: src.error });
        continue;
      }
      if (_consIsNum(src.value)) srcs.push(src);
    }

    if (srcs.length < 2) { skipped++; continue; }
    checked++;

    var minS = srcs[0], maxS = srcs[0];
    for (var j = 1; j < srcs.length; j++) {
      if (srcs[j].value < minS.value) minS = srcs[j];
      if (srcs[j].value > maxS.value) maxS = srcs[j];
    }
    var deltaAbs = Math.abs(maxS.value - minS.value);
    var base     = Math.max(Math.abs(maxS.value), Math.abs(minS.value), 1e-9);
    var deltaRel = deltaAbs / base;
    var tolRel   = _consIsNum(r.tolRel) ? r.tolRel : defaultTolRel;
    var tolAbs   = _consIsNum(r.tolAbs) ? r.tolAbs : 0;

    if (!((deltaAbs <= tolAbs) || (deltaRel <= tolRel))) {
      violations.push({
        type: 'fork', key: r.key, label: r.label,
        minSource: minS.name, minVal: minS.value,
        maxSource: maxS.name, maxVal: maxS.value,
        deltaAbs: deltaAbs, deltaRel: deltaRel, tolRel: tolRel, tolAbs: tolAbs
      });
    }
  }

  return { ok: violations.length === 0, checked: checked, skipped: skipped,
           violations: violations };
}

/**
 * INVARIANT (sanity) checks. PURE. Catches "consistent but absurd".
 * Only evaluates an invariant when its inputs are finite numbers.
 *
 * @param {Object} p { base, conPv, savings }  (NaN/undefined = skip)
 * @return {Array} [{ key, label, ok, detail }]
 */
function evalInvariants(p) {
  p = p || {};
  var out = [];
  var EPS = 1; // 1-peso slack so rounding never trips an invariant

  function add(key, label, applicable, ok, detail) {
    if (!applicable) return;
    out.push({ key: key, label: label, ok: ok, detail: detail });
  }

  var base = p.base, conPv = p.conPv, sav = p.savings;
  var hasBase = _consIsNum(base), hasCon = _consIsNum(conPv), hasSav = _consIsNum(sav);

  add('INV_BASE_GE_CONPV', 'Base (sin-PV) bill must be >= con-PV bill',
      hasBase && hasCon, (base + EPS) >= conPv,
      'base=' + base + '  conPv=' + conPv);

  add('INV_SAVINGS_NONNEG', 'PV savings must not be negative',
      hasSav, sav >= -EPS, 'savings=' + sav);

  add('INV_SAVINGS_LE_BASE', 'PV savings cannot exceed the whole bill',
      hasSav && hasBase, sav <= (base + EPS),
      'savings=' + sav + '  base=' + base);

  add('INV_CONPV_NONNEG', 'Con-PV bill must be >= 0',
      hasCon, conPv >= -EPS, 'conPv=' + conPv);

  return out;
}

/** Pure: primitives -> readings array (sources carry value + error). */
function buildConsistencyReadings(prims) {
  prims = prims || {};
  function v(x) { return x && _consIsNum(x.value) ? x.value : NaN; }
  function e(x) { return x ? (x.error || null) : null; }

  var base   = prims.base   || {};
  var conPv  = prims.conPv  || {};
  var savDir = prims.savDirect || {};
  var sCost  = prims.slideCost || {};
  var sSav   = prims.slideSav  || {};

  var savBillDiff = (_consIsNum(v(sCost)) && _consIsNum(v(conPv)))
                  ? (v(sCost) - v(conPv)) : NaN;
  var offerImplied = (_consIsNum(v(sCost)) && _consIsNum(v(sSav)))
                  ? (v(sCost) - v(sSav)) : NaN;

  return [
    { key: 'cfe_base_sin_pv', label: 'CFE bill — sin PV (annual)', tolRel: 0.005,
      sources: [
        { name: 'BESS_SIMULATION!D12',           value: v(base),  error: e(base) },
        { name: 'SLIDE_DATA[annual_energy_cost]', value: v(sCost), error: e(sCost) }
      ] },
    { key: 'pv_savings_annual', label: 'PV energy savings (annual)', tolRel: 0.005,
      sources: [
        { name: 'CFE_SIMULATION!O41 (direct energy)',   value: v(savDir), error: e(savDir) },
        { name: 'bill-diff (offer base − CFE_SIM!O39)',  value: savBillDiff },
        { name: 'SLIDE_DATA[annual_savings]',            value: v(sSav),   error: e(sSav) }
      ] },
    { key: 'offer_reconciles', label: 'Offer self-reconciles (cost − savings = con-PV bill)',
      tolRel: 0.005,
      sources: [
        { name: 'offer (cost − savings)',      value: offerImplied },
        { name: 'CFE_SIMULATION!O39 (con PV)', value: v(conPv), error: e(conPv) }
      ] }
  ];
}

/** Human-readable report. PURE. Handles error / fork / invariant violations. */
function formatConsistencyReport(result) {
  if (!result) return 'consistency: no result';
  if (result.ok) {
    return 'CONSISTENCY OK -- ' + result.checked + ' figure(s) checked, '
         + result.skipped + ' skipped, '
         + ((result.invariants || []).length) + ' invariant(s) held, 0 problems.';
  }
  var lines = ['CONSISTENCY FAIL -- ' + result.violations.length + ' problem(s):'];
  for (var i = 0; i < result.violations.length; i++) {
    var v = result.violations[i];
    if (v.type === 'error') {
      lines.push('  - [error cell] ' + v.label + ' [' + v.key + ']: '
               + v.source + ' = ' + v.error);
    } else if (v.type === 'invariant') {
      lines.push('  - [impossible] ' + v.label + ' [' + v.key + ']: ' + v.detail);
    } else {
      lines.push('  - [fork] ' + v.label + ' [' + v.key + ']: '
               + v.minSource + ' = ' + _consFmt(v.minVal) + '  vs  '
               + v.maxSource + ' = ' + _consFmt(v.maxVal) + '   Δ=' + _consFmt(v.deltaAbs)
               + ' (' + (v.deltaRel * 100).toFixed(2) + '%, tol '
               + (v.tolRel * 100).toFixed(2) + '%)');
    }
  }
  return lines.join('\n');
}

function _consFmt(n) {
  if (!_consIsNum(n)) return String(n);
  return n.toLocaleString
       ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
       : String(Math.round(n));
}


// -----------------------------------------------------------------------------
// LIVE WORKBOOK RESOLUTION  (Apps Script)
// -----------------------------------------------------------------------------
// Verified addresses (ARGIA_ENGINE__71_, 2026-06-16):
//   BESS_SIMULATION!D12  -> base bill "sin PV"        CFE_SIMULATION!O39 -> con PV
//   CFE_SIMULATION!O41   -> PV energy savings (direct)
//   SLIDE_DATA[annual_energy_cost] / [annual_savings] -> the offer's printed numbers
// -----------------------------------------------------------------------------

/** Rich cell read -> { name, value, error }. Distinguishes error cells from blanks. */
function _consReadCellRich(ss, sheetName, a1, name) {
  try {
    var sh = ss.getSheetByName(sheetName);
    if (!sh) return { name: name, value: NaN, error: null };
    var c = consClassifyCell(sh.getRange(a1).getValue());
    return { name: name, value: c.value, error: c.error };
  } catch (e) { return { name: name, value: NaN, error: null }; }
}

/** Rich SLIDE_DATA read by key in col A (value col B). */
function _consReadSlideRich(ss, key, name) {
  try {
    var sh = ss.getSheetByName('SLIDE_DATA');
    if (!sh) return { name: name, value: NaN, error: null };
    var rng = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
    for (var r = 0; r < rng.length; r++) {
      if (String(rng[r][0]).trim() === key) {
        var c = consClassifyCell(rng[r][1]);
        return { name: name, value: c.value, error: c.error };
      }
    }
    return { name: name, value: NaN, error: null };
  } catch (e) { return { name: name, value: NaN, error: null }; }
}

/** Read all primitives (rich) from the live workbook. */
function resolveConsistencyPrimitives(ss) {
  return {
    base:      _consReadCellRich(ss, 'BESS_SIMULATION', 'D12', 'BESS_SIMULATION!D12'),
    conPv:     _consReadCellRich(ss, 'CFE_SIMULATION',  'O39', 'CFE_SIMULATION!O39'),
    savDirect: _consReadCellRich(ss, 'CFE_SIMULATION',  'O41', 'CFE_SIMULATION!O41'),
    slideCost: _consReadSlideRich(ss, 'annual_energy_cost', 'SLIDE_DATA[annual_energy_cost]'),
    slideSav:  _consReadSlideRich(ss, 'annual_savings',     'SLIDE_DATA[annual_savings]')
  };
}

/** Back-compat thin wrapper. */
function resolveConsistencyReadings(ss) {
  return buildConsistencyReadings(resolveConsistencyPrimitives(ss));
}


// -----------------------------------------------------------------------------
// ORCHESTRATOR
// -----------------------------------------------------------------------------

function assertCrossTabConsistency(ss, opts) {
  opts = opts || {};
  var prims    = resolveConsistencyPrimitives(ss);
  var readings = buildConsistencyReadings(prims);
  var result   = checkConsistency(readings, opts);

  // Sanity invariants from the same primitives.
  var invariants = evalInvariants({
    base:    prims.base.value,
    conPv:   prims.conPv.value,
    savings: prims.savDirect.value
  });
  result.invariants = invariants;
  for (var k = 0; k < invariants.length; k++) {
    if (!invariants[k].ok) {
      result.violations.push({ type: 'invariant', key: invariants[k].key,
                               label: invariants[k].label, detail: invariants[k].detail });
    }
  }
  result.ok = result.violations.length === 0;
  result.report = formatConsistencyReport(result);

  try { if (typeof Logger !== 'undefined') Logger.log(result.report); } catch (e) {}
  try { _consWriteMeta(ss, result); } catch (e) {}

  if (opts.throwOnFork && !result.ok) throw new Error(result.report);
  return result;
}

function _consWriteMeta(ss, result) {
  var sh = ss.getSheetByName('_META');
  if (!sh) return;
  var stamp = result.ok ? 'PASS' : ('FAIL x' + result.violations.length);
  var when  = (typeof Utilities !== 'undefined' && Utilities.formatDate)
            ? Utilities.formatDate(new Date(), 'GMT', "yyyy-MM-dd'T'HH:mm:ss'Z'")
            : new Date().toISOString();
  var row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 2).setValues([['CONSISTENCY_GUARD', stamp + ' @ ' + when]]);
}

function runConsistencyCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = assertCrossTabConsistency(ss, { throwOnFork: false });
  try {
    SpreadsheetApp.getUi().alert(
      result.ok ? 'Consistency: OK' : 'Consistency: PROBLEM DETECTED',
      result.report, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
  return result;
}
