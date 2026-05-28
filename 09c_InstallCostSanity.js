// =============================================================================
// ARGIA ENGINE -- File: 09c_InstallCostSanity.gs
// -----------------------------------------------------------------------------
// POST-RUN INSTALL COST SANITY CHECK (v3.7.8, Chunk 3)
//
// PURPOSE
//   After the engine has computed installation costs (Step 12) and written
//   INSTALLATION_v2 (Step 12-v2), this module compares the result against
//   industry-typical ranges. It does NOT block the engine; it surfaces
//   warnings to LOGS and the end-of-run alert so the designer notices
//   when rates / outputs look implausible.
//
// WHY THIS EXISTS
//   The 3.7.8 review found that CULLIGAN ships with install costs roughly
//   2-4x below typical commercial Mexico rates ($0.046/Wp vs market
//   $0.10-0.18/Wp) and BESS BoP install ~10-20x low ($5/kWh vs $60-150/kWh).
//   Ops is correcting the lib rates separately; this module is the
//   defense-in-depth that catches future drift in either direction.
//
// THREE INDEPENDENT CHECKS (all advisory, none blocking):
//   PV install $/Wp        — pvMxnPerWp from non-BESS install lines
//   BESS BoP $/kWh         — bessUsdPerKwh from §BESS install section (if BESS)
//   Blended labor MXN/MH   — directly from result.totals.avgRateMxnMH
//
// BOUNDS COME FROM NOM_DB
//   buildNomLimitsDefaults() in 02_LoadDB.js owns the bounds (3.7.8 added
//   six new keys). Ops can tighten them without code changes once historical
//   benchmarks are populated in 94_INSTALL_BENCHMARKS.
//
// INVOCATION
//   Called from runArgiaEngine Step 14.5 (after output consistency check),
//   wrapped in try/catch matching the rest of the pipeline. A guardrail
//   bug never breaks the engine.
//
// RETURN SHAPE
//   {
//     passed:    boolean,       // false iff any check tripped
//     warnings:  string[],      // human-readable warning lines
//     checks: {
//       pvPerWp:        { value, min, max, status: 'OK'|'LOW'|'HIGH'|'N/A' },
//       bessPerKwh:     { value, min, max, status: 'OK'|'LOW'|'HIGH'|'N/A' },
//       laborRate:      { value, min, max, status: 'OK'|'LOW'|'HIGH'|'N/A' }
//     }
//   }
//
//   PV-only projects get bessPerKwh.status = 'N/A'.
//   Projects without an install result return all 'N/A' and passed=true.
// =============================================================================


/**
 * Run all install cost sanity checks against a fresh engine result.
 *
 * @param {Object} opts
 *   nom            : NOM constants (from loadNomConstants); reads .limits
 *   installResult  : runInstallCost return; reads .totals.{total,perWp,avgRateMxnMH,sectionTotals.BESS}
 *   inp            : engine input; reads .panelQty + panel power (via panel)
 *   bessResult     : { bessEnabled, bess:{capacityKwh} } when BESS engaged
 *   exchangeRate   : MXN per USD (defaults 18.5 if not provided)
 * @return {Object} See file header for shape.
 */
function checkInstallCostSanity(opts) {
  opts = opts || {};
  var nom            = opts.nom || {};
  var installResult  = opts.installResult || null;
  var inp            = opts.inp || {};
  var bessResult     = opts.bessResult || null;
  var exchangeRate   = Number(opts.exchangeRate) || 18.5;

  var limits = (nom.limits) || {};

  // Read bounds (with hardcoded fallback so missing limits never crash)
  var pvMin   = Number(limits['install_pv_mxn_per_wp_warn_min'])    || 1.0;
  var pvMax   = Number(limits['install_pv_mxn_per_wp_warn_max'])    || 5.0;
  var bessMin = Number(limits['install_bess_usd_per_kwh_warn_min']) || 30;
  var bessMax = Number(limits['install_bess_usd_per_kwh_warn_max']) || 200;
  var labMin  = Number(limits['install_blended_labor_rate_warn_min']) || 80;
  var labMax  = Number(limits['install_blended_labor_rate_warn_max']) || 400;

  var warnings = [];
  var checks = {
    pvPerWp:    { value: null, min: pvMin,   max: pvMax,   status: 'N/A' },
    bessPerKwh: { value: null, min: bessMin, max: bessMax, status: 'N/A' },
    laborRate:  { value: null, min: labMin,  max: labMax,  status: 'N/A' }
  };

  // No install result -> nothing to check
  if (!installResult || !installResult.totals) {
    return { passed: true, warnings: warnings, checks: checks };
  }

  var totals = installResult.totals;
  var sectionTotals = installResult.sectionTotals || {};

  // ---- Check 1: PV install MXN/Wp ----------------------------------------
  // Exclude the BESS section so we measure PV install in isolation.
  var bessTotalMxn = (sectionTotals.BESS && Number(sectionTotals.BESS.total)) || 0;
  var pvTotalMxn   = (Number(totals.total) || 0) - bessTotalMxn;
  var projectDcWp  = Number(inp.panelQty || 0) *
                     (inp.panel ? Number(inp.panel.PANEL_POWER_W || 0) : 0);
  // Fallback: derive Wp from totals.perWp if inp.panel wasn't threaded through
  if (!(projectDcWp > 0) && totals.perWp > 0 && totals.total > 0) {
    projectDcWp = totals.total / totals.perWp;
  }

  if (projectDcWp > 0) {
    var pvPerWp = pvTotalMxn / projectDcWp;
    checks.pvPerWp.value = pvPerWp;
    if (pvPerWp < pvMin) {
      checks.pvPerWp.status = 'LOW';
      warnings.push('PV install ' + pvPerWp.toFixed(2) + ' MXN/Wp is below expected min ' +
                    pvMin.toFixed(2) + ' MXN/Wp. Likely under-quoted — verify install lib rates.');
    } else if (pvPerWp > pvMax) {
      checks.pvPerWp.status = 'HIGH';
      warnings.push('PV install ' + pvPerWp.toFixed(2) + ' MXN/Wp is above expected max ' +
                    pvMax.toFixed(2) + ' MXN/Wp. Verify project complexity factors and rates.');
    } else {
      checks.pvPerWp.status = 'OK';
    }
  }

  // ---- Check 2: BESS BoP install USD/kWh ---------------------------------
  // Only runs when BESS is enabled AND we have a BESS section total AND
  // a battery capacity to normalize against.
  var bessEnabled = bessResult && bessResult.bessEnabled === true;
  var bessKwh     = (bessResult && bessResult.bess && Number(bessResult.bess.capacityKwh)) || 0;
  if (bessEnabled && bessTotalMxn > 0 && bessKwh > 0) {
    var bessUsdPerKwh = (bessTotalMxn / exchangeRate) / bessKwh;
    checks.bessPerKwh.value = bessUsdPerKwh;
    if (bessUsdPerKwh < bessMin) {
      checks.bessPerKwh.status = 'LOW';
      warnings.push('BESS BoP install ' + bessUsdPerKwh.toFixed(1) + ' USD/kWh is below expected min ' +
                    bessMin.toFixed(0) + ' USD/kWh. Industry typical 30-200 USD/kWh for commercial BESS BoP. ' +
                    'Verify §BESS rates in 90_INSTALL_LIB.');
    } else if (bessUsdPerKwh > bessMax) {
      checks.bessPerKwh.status = 'HIGH';
      warnings.push('BESS BoP install ' + bessUsdPerKwh.toFixed(1) + ' USD/kWh is above expected max ' +
                    bessMax.toFixed(0) + ' USD/kWh. Verify project complexity and rates.');
    } else {
      checks.bessPerKwh.status = 'OK';
    }
  }

  // ---- Check 3: Blended labor rate MXN/MH --------------------------------
  var avgRate = Number(totals.avgRateMxnMH) || 0;
  if (avgRate > 0) {
    checks.laborRate.value = avgRate;
    if (avgRate < labMin) {
      checks.laborRate.status = 'LOW';
      warnings.push('Blended labor rate ' + avgRate + ' MXN/MH is below expected min ' +
                    labMin + ' MXN/MH. Verify 92_INSTALL_ROLE_RATES — Mexican commercial ' +
                    'electricians typically run 100-250 MXN/MH.');
    } else if (avgRate > labMax) {
      checks.laborRate.status = 'HIGH';
      warnings.push('Blended labor rate ' + avgRate + ' MXN/MH is above expected max ' +
                    labMax + ' MXN/MH. Verify role mix and rates.');
    } else {
      checks.laborRate.status = 'OK';
    }
  }

  return {
    passed:   warnings.length === 0,
    warnings: warnings,
    checks:   checks
  };
}


/**
 * Engine wrapper — runs the check, logs the warnings, returns the result
 * so the caller (runArgiaEngine end-of-run alert) can append to its message.
 *
 * Wrapped in try/catch by the caller (matches Step 14 pattern). This
 * function itself doesn't catch; it returns null if it can't run.
 *
 * @param {Spreadsheet} ss
 * @param {Object} engineResult — { installResult, bessResult, inp, panel }
 * @return {Object|null} sanity result or null on missing data
 */
function runInstallCostSanityCheck(ss, engineResult) {
  if (!engineResult) return null;
  var nom;
  try { nom = loadNomConstants(ss); } catch (e) { nom = { limits: {} }; }

  // Pass panel into inp so we can compute projectDcWp without re-reading the sheet
  var inp = engineResult.inp || {};
  if (engineResult.panel && !inp.panel) inp = Object.assign({}, inp, { panel: engineResult.panel });

  // Exchange rate from BOM_v2!F6, fallback 18.5
  var fx = 18.5;
  try {
    var bom = ss.getSheetByName('BOM_v2');
    if (bom) {
      var v = Number(bom.getRange(6, 6).getValue());
      if (v > 0) fx = v;
    }
  } catch (_) {}

  var result = checkInstallCostSanity({
    nom: nom,
    installResult: engineResult.installResult,
    inp: inp,
    bessResult: engineResult.bessResult,
    exchangeRate: fx
  });

  // Log each warning at WARNING level so the LOGS sheet highlights it yellow
  if (result.warnings.length > 0) {
    result.warnings.forEach(function(w) {
      try { engineLog(ss, 'InstallSanity', 'WARNING', w); } catch (_) {}
    });
  } else {
    try { engineLog(ss, 'InstallSanity', 'OK',
      'Install cost guardrails: PV/Wp, BESS/kWh, labor rate all within expected ranges.'); }
    catch (_) {}
  }

  return result;
}
