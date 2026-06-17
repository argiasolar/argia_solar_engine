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
  var known = result.knownForks || [];
  var knownLine = known.length
    ? ('\n  (known forks, pending fix: ' + known.map(function (v) {
        return (v.label || v.key) + (v.deltaRel ? ' Δ' + (v.deltaRel * 100).toFixed(1) + '%' : '');
      }).join('; ') + ')')
    : '';
  if (result.ok) {
    return 'CONSISTENCY OK -- ' + result.checked + ' figure(s) checked, '
         + result.skipped + ' skipped, '
         + ((result.invariants || []).length) + ' invariant(s) held, 0 problems.'
         + knownLine;
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
  return lines.join('\n') + knownLine;
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
// SHARED-FIGURE REGISTRY  (T3 -- the single-source contract, as data)
// -----------------------------------------------------------------------------
// Each figure: one canonical owner + every consumer that must agree with it.
// The guard reads all sources and forks if any disagree beyond tolerance.
// Addresses verified against ARGIA_ENGINE__74_ (CULLIGAN E2E, 2026-06-17).
//
// `enforced:false` figures (e.g. interconnection mode, a string pending T5) are
// reported as KNOWN FORKS but do NOT flip the guard red -- the plan expects the
// T5/T6 forks to surface here until those tasks land.
//
// source kinds: cell | api | slide | banner (parse $/number from text) |
//   rowsum (sum C:N, optional scale) | diff (cellA - cellB) | cellstr (string).
// -----------------------------------------------------------------------------
var SHARED_FIGURE_REGISTRY = [
  { key: 'cfe_bill_sin_pv', label: 'CFE bill - sin PV (annual)', tolRel: 0.001, enforced: true,
    sources: [
      { name: 'BESS_SIMULATION!D12 (owner)',      kind: 'cell',   sheet: 'BESS_SIMULATION', a1: 'D12' },
      { name: 'CFE_OUTPUT_v2!B10 banner',         kind: 'banner', sheet: 'CFE_OUTPUT_v2',   a1: 'B10' },
      { name: 'SLIDE_DATA[annual_energy_cost]',   kind: 'slide',  key: 'annual_energy_cost' },
      { name: 'API_OUTPUT[cfe_bill_sin_pv_mxn]',  kind: 'api',    key: 'cfe_bill_sin_pv_mxn' }
    ] },
  { key: 'cfe_bill_con_pv', label: 'CFE bill - con PV (annual)', tolRel: 0.001, enforced: true,
    sources: [
      { name: 'BESS_SIMULATION!D14 (owner)',      kind: 'cell',   sheet: 'BESS_SIMULATION', a1: 'D14' },
      { name: 'CFE_SIMULATION!O39',               kind: 'cell',   sheet: 'CFE_SIMULATION',  a1: 'O39' },
      { name: 'CFE_OUTPUT_v2 row19 sum',          kind: 'rowsum', sheet: 'CFE_OUTPUT_v2',   row: 19 },
      { name: 'API_OUTPUT[cfe_bill_con_pv_mxn]',  kind: 'api',    key: 'cfe_bill_con_pv_mxn' }
    ] },
  { key: 'cfe_bill_con_bess', label: 'CFE bill - con PV+BESS (annual)', tolRel: 0.001, enforced: true,
    sources: [
      { name: 'BESS_SIMULATION!D18 (owner)',      kind: 'cell',   sheet: 'BESS_SIMULATION', a1: 'D18' },
      { name: 'CFE_OUTPUT_v2 row31 sum',          kind: 'rowsum', sheet: 'CFE_OUTPUT_v2',   row: 31 },
      { name: 'API_OUTPUT[cfe_bill_con_bess_mxn]', kind: 'api',   key: 'cfe_bill_con_bess_mxn' }
    ] },
  { key: 'pv_energy_savings', label: 'PV energy savings (annual)', tolRel: 0.001, enforced: true,
    sources: [
      { name: 'BESS_SIMULATION D12-D14 (owner)',  kind: 'diff',   sheet: 'BESS_SIMULATION', a1: 'D12', sheetB: 'BESS_SIMULATION', a1B: 'D14' },
      { name: 'CFE_SIMULATION!O41',               kind: 'cell',   sheet: 'CFE_SIMULATION',  a1: 'O41' },
      { name: 'CFE_OUTPUT_v2 row20 sum',          kind: 'rowsum', sheet: 'CFE_OUTPUT_v2',   row: 20 },
      { name: 'SLIDE_DATA[annual_savings]',       kind: 'slide',  key: 'annual_savings' },
      { name: 'API_OUTPUT[pv_only_savings_year1_mxn]', kind: 'api', key: 'pv_only_savings_year1_mxn' }
    ] },
  { key: 'bess_savings', label: 'BESS savings (annual)', tolRel: 0.001, enforced: true,
    sources: [
      { name: 'BESS_SIMULATION D14-D18 (owner)',  kind: 'diff',   sheet: 'BESS_SIMULATION', a1: 'D14', sheetB: 'BESS_SIMULATION', a1B: 'D18' },
      { name: 'CFE_OUTPUT_v2 row30 sum (Ahorro BESS TOTAL)', kind: 'rowsum', sheet: 'CFE_OUTPUT_v2', row: 30 }
    ] },
  { key: 'capex_cost', label: 'CAPEX - cost (MXN)', tolRel: 0.001, enforced: true,
    sources: [
      { name: 'API_OUTPUT[capex_cost_mxn] (owner)', kind: 'api',  key: 'capex_cost_mxn' },
      { name: 'CLIENT_FINANCIALS_v2!D8',          kind: 'cell',   sheet: 'CLIENT_FINANCIALS_v2', a1: 'D8' },
      { name: 'PROJECT_CARD_v2!D40 (cost TOTAL)', kind: 'cell',   sheet: 'PROJECT_CARD_v2', a1: 'D40' }
    ] },
  { key: 'offer_price', label: 'Offer price - sell (MXN)', tolRel: 0.001, enforced: true,
    sources: [
      { name: 'API_OUTPUT[offer_price_mxn] (owner)', kind: 'api', key: 'offer_price_mxn' },
      { name: 'PROJECT_CARD_v2!I40 (sell TOTAL)', kind: 'cell',   sheet: 'PROJECT_CARD_v2', a1: 'I40' },
      { name: 'FINANCE!C3',                       kind: 'cell',   sheet: 'FINANCE',         a1: 'C3' },
      { name: 'SLIDE_DATA[capex_total]',          kind: 'slide',  key: 'capex_total' }
    ] },
  { key: 'system_size_kwp', label: 'System size - DC (kWp)', tolRel: 0.005, enforced: true,
    sources: [
      { name: 'MDC_v2!C15 (owner)',               kind: 'cell',   sheet: 'MDC_v2',          a1: 'C15' },
      { name: 'API_OUTPUT[system_kwp_dc]',        kind: 'api',    key: 'system_kwp_dc' },
      { name: 'SLIDE_DATA[system_kwp]',           kind: 'slide',  key: 'system_kwp' },
      { name: 'PROJECT_CARD_v2!H14',              kind: 'banner', sheet: 'PROJECT_CARD_v2', a1: 'H14' }
    ] },
  { key: 'annual_pv_generation_mwh', label: 'Annual PV generation (MWh)', tolRel: 0.005, enforced: true,
    sources: [
      { name: 'API_OUTPUT[annual_generation_mwh] (owner)', kind: 'api', key: 'annual_generation_mwh' },
      { name: 'CFE_OUTPUT_v2 row15 sum /1000',    kind: 'rowsum', sheet: 'CFE_OUTPUT_v2',   row: 15, scale: 0.001 }
    ] },
  // Interconnection mode is STRING-valued; the numeric guard skips it (1 source,
  // string). Kept here as the documented single-source contract. T5 will add the
  // CFE_SIMULATION / BESS mode-derived sources and a string comparator.
  { key: 'interconnection_mode', label: 'Interconnection mode', tolRel: 0, enforced: false, pendingTask: 'T5',
    sources: [
      { name: 'INPUT_CFE!C41 (owner)',            kind: 'cellstr', sheet: 'INPUT_CFE',      a1: 'C41' }
    ] }
];


// -----------------------------------------------------------------------------
// REGISTRY READERS  (Apps Script)  -- dispatch on source.kind.
// -----------------------------------------------------------------------------

/** API_OUTPUT key -> value (col A key, col B value). Rich. */
function _consReadApiRich(ss, key, name) {
  try {
    var sh = ss.getSheetByName('API_OUTPUT');
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

/** Parse the first number out of a text cell ("$12,838,765", "864.0 kWp"). Rich. */
function _consParseNumber(raw) {
  if (typeof raw === 'number' && isFinite(raw)) return raw;
  var s = (raw === null || raw === undefined) ? '' : String(raw);
  var m = s.match(/-?[\d,]*\.?\d+/);
  if (!m) return NaN;
  var n = parseFloat(m[0].replace(/,/g, ''));
  return isFinite(n) ? n : NaN;
}
function _consReadBannerRich(ss, sheetName, a1, name) {
  try {
    var sh = ss.getSheetByName(sheetName);
    if (!sh) return { name: name, value: NaN, error: null };
    var raw = sh.getRange(a1).getValue();
    var cls = consClassifyCell(raw);
    if (cls.error) return { name: name, value: NaN, error: cls.error };
    return { name: name, value: _consParseNumber(raw), error: null };
  } catch (e) { return { name: name, value: NaN, error: null }; }
}

/** Sum a row's C:N (optionally scaled, e.g. kWh -> MWh). Rich. */
function _consReadRowSumRich(ss, sheetName, row, scale, name) {
  try {
    var sh = ss.getSheetByName(sheetName);
    if (!sh) return { name: name, value: NaN, error: null };
    var vals = sh.getRange(row, 3, 1, 12).getValues()[0];
    var sum = 0, any = false, errStr = null;
    for (var i = 0; i < vals.length; i++) {
      var c = consClassifyCell(vals[i]);
      if (c.error) { errStr = c.error; break; }
      if (_consIsNum(c.value)) { sum += c.value; any = true; }
    }
    if (errStr) return { name: name, value: NaN, error: errStr };
    if (!any) return { name: name, value: NaN, error: null };
    return { name: name, value: sum * (_consIsNum(scale) ? scale : 1), error: null };
  } catch (e) { return { name: name, value: NaN, error: null }; }
}

/** Dispatch a registry source descriptor -> rich reading. */
function _consReadSource(ss, src) {
  switch (src.kind) {
    case 'cell':   return _consReadCellRich(ss, src.sheet, src.a1, src.name);
    case 'api':    return _consReadApiRich(ss, src.key, src.name);
    case 'slide':  return _consReadSlideRich(ss, src.key, src.name);
    case 'banner': return _consReadBannerRich(ss, src.sheet, src.a1, src.name);
    case 'rowsum': return _consReadRowSumRich(ss, src.sheet, src.row, src.scale, src.name);
    case 'diff': {
      var a = _consReadCellRich(ss, src.sheet,  src.a1,  src.name + ' [A]');
      var b = _consReadCellRich(ss, src.sheetB, src.a1B, src.name + ' [B]');
      if (a.error) return { name: src.name, value: NaN, error: a.error };
      if (b.error) return { name: src.name, value: NaN, error: b.error };
      if (!_consIsNum(a.value) || !_consIsNum(b.value)) return { name: src.name, value: NaN, error: null };
      return { name: src.name, value: a.value - b.value, error: null };
    }
    case 'cellstr': // string-valued -> not numerically comparable; numeric guard skips it
    default:        return { name: src.name, value: NaN, error: null };
  }
}

/** Resolve the registry into checkConsistency-shaped readings (carry enforced flag). */
function resolveRegistryReadings(ss, registry) {
  registry = registry || SHARED_FIGURE_REGISTRY;
  var out = [];
  for (var i = 0; i < registry.length; i++) {
    var fig = registry[i];
    var sources = [];
    for (var s = 0; s < fig.sources.length; s++) sources.push(_consReadSource(ss, fig.sources[s]));
    out.push({ key: fig.key, label: fig.label, tolRel: fig.tolRel, tolAbs: fig.tolAbs,
               sources: sources, enforced: (fig.enforced !== false), pendingTask: fig.pendingTask || null });
  }
  return out;
}

/**
 * Partition fork/error violations into hard (enforced) vs known (pending). PURE.
 * @param {Array} violations  from checkConsistency
 * @param {Array} registry    SHARED_FIGURE_REGISTRY (for the enforced flag)
 * @return {Object} { hard:[], known:[] }
 */
function partitionConsistencyViolations(violations, registry) {
  var enforced = {};
  (registry || []).forEach(function (f) { enforced[f.key] = (f.enforced !== false); });
  var hard = [], known = [];
  (violations || []).forEach(function (v) {
    if (enforced[v.key] === false) known.push(v); else hard.push(v);
  });
  return { hard: hard, known: known };
}


// -----------------------------------------------------------------------------
// ORCHESTRATOR
// -----------------------------------------------------------------------------

function assertCrossTabConsistency(ss, opts) {
  opts = opts || {};
  var registry = opts.registry || SHARED_FIGURE_REGISTRY;

  // Registry-driven figure checks (FORK + ERROR across every consumer).
  var readings = resolveRegistryReadings(ss, registry);
  var result   = checkConsistency(readings, opts);

  // Split: enforced violations flip the guard red; pending ones (T5/T6) are
  // surfaced as KNOWN FORKS but do not fail.
  var split = partitionConsistencyViolations(result.violations, registry);
  result.violations = split.hard;
  result.knownForks = split.known;

  // Sanity invariants (always enforced) from the canonical primitives.
  var prims = resolveConsistencyPrimitives(ss);
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
  var offending = '';
  if (!result.ok && result.violations.length) {
    offending = ' | first: ' + (result.violations[0].label || result.violations[0].key);
  }
  var known = (result.knownForks && result.knownForks.length)
            ? ' | known-forks: ' + result.knownForks.length : '';
  var stamp = (result.ok ? 'PASS' : ('FAIL x' + result.violations.length)) + offending + known;
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
