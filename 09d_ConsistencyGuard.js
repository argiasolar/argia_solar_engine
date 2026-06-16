// =============================================================================
// ARGIA ENGINE -- 09d_ConsistencyGuard.js
// -----------------------------------------------------------------------------
// PHASE 0.3 of the Master Build Plan: cross-tab consistency guard.
//
// PURPOSE
//   Every number that appears in more than one place must agree everywhere.
//   This module reads each shared figure from all of its sources in the live
//   workbook and FAILS LOUDLY if two sources disagree beyond tolerance.
//
//   It is a DETECTOR, not a fixer. It changes no cell. It is meant to go RED
//   on the current CFE base-bill / PV-savings fork, and GREEN once Phase 0.1
//   (single CFE bill engine) lands. After 0.1 it stands as a permanent guard
//   that stops the silent-split bug class from ever recurring.
//
// ARCHITECTURE (so it is Node-self-test friendly)
//   checkConsistency(readings, opts)   -- PURE. No Spreadsheet dependency.
//                                         Unit-tested headless in full_selftest.
//   resolveConsistencyReadings(ss)     -- reads the live workbook into readings.
//   assertCrossTabConsistency(ss,opts) -- resolve -> check -> log -> return.
//   runConsistencyCheck()              -- menu entry; alerts a human summary.
//
// SAFETY
//   Any source that cannot be read (sheet missing / blank / NaN) is DROPPED,
//   never errored. A figure with fewer than 2 readable sources is skipped.
//   The guard can only ever report on what it can actually read.
// =============================================================================


// -----------------------------------------------------------------------------
// PURE CORE  (no Apps Script -- safe to unit test in Node)
// -----------------------------------------------------------------------------

/**
 * @param {number} v
 * @return {boolean} true for a finite, non-NaN number.
 */
function _consIsNum(v) {
  return typeof v === 'number' && isFinite(v) && !isNaN(v);
}

/**
 * Compare every shared figure across its sources.
 *
 * @param {Array}  readings  [{ key, label, tolRel, tolAbs,
 *                              sources:[{name, value}, ...] }, ...]
 * @param {Object} opts      { defaultTolRel } default relative tolerance (0.001 = 0.1%)
 * @return {Object} {
 *   ok:        boolean,                 // true iff no violations
 *   checked:   number,                  // figures with >=2 readable sources
 *   skipped:   number,                  // figures with <2 readable sources
 *   violations:[{ key, label, minSource, minVal, maxSource, maxVal,
 *                 deltaAbs, deltaRel, tolRel, tolAbs }]
 * }
 */
function checkConsistency(readings, opts) {
  opts = opts || {};
  var defaultTolRel = _consIsNum(opts.defaultTolRel) ? opts.defaultTolRel : 0.001; // 0.1%

  var violations = [];
  var checked = 0;
  var skipped = 0;

  for (var i = 0; i < (readings || []).length; i++) {
    var r = readings[i] || {};
    var srcs = [];
    for (var s = 0; s < (r.sources || []).length; s++) {
      var src = r.sources[s];
      if (src && _consIsNum(src.value)) srcs.push(src);
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

    var tolRel = _consIsNum(r.tolRel) ? r.tolRel : defaultTolRel;
    var tolAbs = _consIsNum(r.tolAbs) ? r.tolAbs : 0;

    var ok = (deltaAbs <= tolAbs) || (deltaRel <= tolRel);
    if (!ok) {
      violations.push({
        key:       r.key,
        label:     r.label,
        minSource: minS.name, minVal: minS.value,
        maxSource: maxS.name, maxVal: maxS.value,
        deltaAbs:  deltaAbs,
        deltaRel:  deltaRel,
        tolRel:    tolRel,
        tolAbs:    tolAbs
      });
    }
  }

  return {
    ok: violations.length === 0,
    checked: checked,
    skipped: skipped,
    violations: violations
  };
}

/**
 * Human-readable one-line-per-violation report. Pure.
 * @param {Object} result  output of checkConsistency
 * @return {string}
 */
function formatConsistencyReport(result) {
  if (!result) return 'consistency: no result';
  if (result.ok) {
    return 'CONSISTENCY OK -- ' + result.checked + ' figure(s) checked, '
         + result.skipped + ' skipped (insufficient sources), 0 forks.';
  }
  var lines = ['CONSISTENCY FORK -- ' + result.violations.length
             + ' figure(s) disagree across tabs:'];
  for (var i = 0; i < result.violations.length; i++) {
    var v = result.violations[i];
    lines.push(
      '  - ' + v.label + ' [' + v.key + ']: '
      + v.minSource + ' = ' + _consFmt(v.minVal) + '  vs  '
      + v.maxSource + ' = ' + _consFmt(v.maxVal) + '   '
      + 'Δ=' + _consFmt(v.deltaAbs)
      + ' (' + (v.deltaRel * 100).toFixed(2) + '%, tol '
      + (v.tolRel * 100).toFixed(2) + '%)'
    );
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
// LIVE WORKBOOK RESOLUTION  (Apps Script -- needs a real `ss`)
// -----------------------------------------------------------------------------
//
// REGISTRY ADDRESSES (verified against ARGIA_ENGINE__71_ on 2026-06-16):
//   BESS_SIMULATION!D12  -> CFE base bill, "sin PV" (the bsim_reciboBase scalar)
//   CFE_SIMULATION!O39   -> CFE bill "con PV"  (annual, incl. IVA)
//   CFE_SIMULATION!O41   -> PV ENERGY SAVINGS, direct-energy method (annual)
//   SLIDE_DATA[annual_energy_cost] -> base bill the offer prints
//   SLIDE_DATA[annual_savings]     -> savings the offer prints
//
// If a future template moves any of these, fix the address HERE only.
// -----------------------------------------------------------------------------

/** Read a single A1 cell as a number, or NaN if unreadable. */
function _consReadCell(ss, sheetName, a1) {
  try {
    var sh = ss.getSheetByName(sheetName);
    if (!sh) return NaN;
    var v = sh.getRange(a1).getValue();
    return (typeof v === 'number') ? v : NaN;
  } catch (e) { return NaN; }
}

/** Read a SLIDE_DATA value by its key in column A (value in column B). Robust to row shifts. */
function _consReadSlideKey(ss, key) {
  try {
    var sh = ss.getSheetByName('SLIDE_DATA');
    if (!sh) return NaN;
    var last = sh.getLastRow();
    var rng = sh.getRange(1, 1, last, 2).getValues(); // cols A,B
    for (var r = 0; r < rng.length; r++) {
      if (String(rng[r][0]).trim() === key) {
        var v = rng[r][1];
        return (typeof v === 'number') ? v : NaN;
      }
    }
    return NaN;
  } catch (e) { return NaN; }
}

/**
 * Build the readings array for checkConsistency() from the live workbook.
 * Each figure lists every independent way the workbook expresses it.
 *
 * @param {Spreadsheet} ss
 * @return {Array} readings
 */
function resolveConsistencyReadings(ss) {
  // ---- primitives -----------------------------------------------------------
  var d12        = _consReadCell(ss, 'BESS_SIMULATION', 'D12'); // base, sin PV
  var conPv      = _consReadCell(ss, 'CFE_SIMULATION',  'O39'); // con PV (incl IVA)
  var savDirect  = _consReadCell(ss, 'CFE_SIMULATION',  'O41'); // PV savings, direct
  var slideCost  = _consReadSlideKey(ss, 'annual_energy_cost'); // base the offer prints
  var slideSav   = _consReadSlideKey(ss, 'annual_savings');     // savings the offer prints

  // ---- derived --------------------------------------------------------------
  // PV savings via the bill-difference method = base(offer) - conPV.
  var savBillDiff = (_consIsNum(slideCost) && _consIsNum(conPv))
                  ? (slideCost - conPv) : NaN;
  // What the offer's own (cost - savings) implies the new bill should be.
  var offerImpliedConPv = (_consIsNum(slideCost) && _consIsNum(slideSav))
                  ? (slideCost - slideSav) : NaN;

  return [
    {
      key: 'cfe_base_sin_pv',
      label: 'CFE bill — sin PV (annual)',
      tolRel: 0.005, // 0.5%
      sources: [
        { name: 'BESS_SIMULATION!D12',          value: d12 },
        { name: 'SLIDE_DATA[annual_energy_cost]', value: slideCost }
      ]
    },
    {
      key: 'pv_savings_annual',
      label: 'PV energy savings (annual)',
      tolRel: 0.005,
      sources: [
        { name: 'CFE_SIMULATION!O41 (direct energy)',     value: savDirect },
        { name: 'bill-diff (offer base − CFE_SIM!O39)',   value: savBillDiff },
        { name: 'SLIDE_DATA[annual_savings]',             value: slideSav }
      ]
    },
    {
      key: 'offer_reconciles',
      label: 'Offer self-reconciles (cost − savings = con-PV bill)',
      tolRel: 0.005,
      sources: [
        { name: 'offer (cost − savings)',     value: offerImpliedConPv },
        { name: 'CFE_SIMULATION!O39 (con PV)', value: conPv }
      ]
    }
  ];
}


// -----------------------------------------------------------------------------
// ORCHESTRATOR  (Apps Script)
// -----------------------------------------------------------------------------

/**
 * Resolve -> check -> log -> return. Call at the end of every engine run.
 *
 * @param {Spreadsheet} ss
 * @param {Object} opts  { throwOnFork:boolean, defaultTolRel:number }
 * @return {Object} checkConsistency result, plus .report (string)
 */
function assertCrossTabConsistency(ss, opts) {
  opts = opts || {};
  var readings = resolveConsistencyReadings(ss);
  var result   = checkConsistency(readings, opts);
  result.report = formatConsistencyReport(result);

  // Best-effort logging -- never let logging throw.
  try { if (typeof Logger !== 'undefined') Logger.log(result.report); } catch (e) {}
  try { _consWriteMeta(ss, result); } catch (e) {}

  if (opts.throwOnFork && !result.ok) {
    throw new Error(result.report);
  }
  return result;
}

/** Stamp the result onto _META so it is visible in the workbook. */
function _consWriteMeta(ss, result) {
  var sh = ss.getSheetByName('_META');
  if (!sh) return;
  var stamp = result.ok ? 'PASS' : ('FORK x' + result.violations.length);
  var when  = (typeof Utilities !== 'undefined' && Utilities.formatDate)
            ? Utilities.formatDate(new Date(), 'GMT', "yyyy-MM-dd'T'HH:mm:ss'Z'")
            : new Date().toISOString();
  // Append a single status row at the bottom of _META (non-destructive).
  var row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 2).setValues([['CONSISTENCY_GUARD', stamp + ' @ ' + when]]);
}

/** Menu entry: run the guard and show a human-readable alert. */
function runConsistencyCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = assertCrossTabConsistency(ss, { throwOnFork: false });
  try {
    SpreadsheetApp.getUi().alert(
      result.ok ? 'Consistency: OK' : 'Consistency: FORK DETECTED',
      result.report,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // headless / no UI -- the result is already logged + stamped.
  }
  return result;
}
