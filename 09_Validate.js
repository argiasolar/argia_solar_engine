// =============================================================================
// ARGIA ENGINE v7 -- File: 09_Validate.gs
// Pre-calculation validation layer. Runs BEFORE any calc function.
// Blocks engine execution on critical input errors.
// Returns structured ValidationResult consumed by runArgiaEngine().
//
// DATA CONTRACT:
//   Input:  ss, inp (from readInputs), panel (PanelSpec), invBank (InverterSpec[]), nom (NomConstants)
//   Output: { passed: bool, criticals: [], majors: [], warnings: [], summary: string }
// =============================================================================

function runValidation(ss, inp, panel, invBank, nom) {
  var result = {
    passed   : true,
    criticals: [],
    majors   : [],
    warnings : [],
  };

  function critical(rule, msg, fix) {
    result.criticals.push({ rule: rule, msg: msg, fix: fix });
    result.passed = false;
    engineLog(ss, 'Validate', 'CRITICAL', '[' + rule + '] ' + msg);
  }
  function major(rule, msg, fix) {
    result.majors.push({ rule: rule, msg: msg, fix: fix });
    engineLog(ss, 'Validate', 'MAJOR', '[' + rule + '] ' + msg);
  }
  function warn(rule, msg) {
    result.warnings.push({ rule: rule, msg: msg });
    engineLog(ss, 'Validate', 'WARNING', '[' + rule + '] ' + msg);
  }

  // =========================================================================
  // GROUP 1: INPUT COMPLETENESS
  // =========================================================================

  // Phase A (2026-04-28): INP-01/INP-02 messages use inputLocation() instead
  // of hardcoded INPUT_GENERAL coords. Field lives on INPUT_PROJECT now.
  if (!inp.projectName || inp.projectName === '')
    major('INP-01', 'Project name is empty.',
      'Fill PROJECT NAME at ' + inputLocation('projectName') + '.');

  if (!inp.clientName || inp.clientName === '')
    major('INP-02', 'Client name is empty.',
      'Fill CUSTOMER NAME at ' + inputLocation('clientName') + '.');

  if (!inp.panelModel || inp.panelModel === '')
    critical('INP-03', 'Panel model not set at ' + inputLocation('panelModel') + '.',
      'Enter exact panel model matching 11M_PRODUCTS_PANELS column PANEL_MODEL.');

  if (inp.panelQty <= 0)
    critical('INP-04', 'Panel quantity is 0 or missing at ' + inputLocation('panelQty') + '.',
      'Enter number of modules.');

  if (inp.modsPerString <= 0)
    critical('INP-05', 'Modules per string is 0 at ' + inputLocation('modsPerString') + '.',
      'Enter modules per string.');

  if (inp.inverterBank.length === 0)
    critical('INP-06', 'No inverters defined (INPUT_DESIGN §09 EQUIPO — INVERSORES).',
      'Enter at least one inverter model, qty and strings at ' + inputLocation('inverterPrimaryModel') + '.');

  if (inp.minTemp === 0 && inp.maxTemp === 0)
    major('INP-07', 'Site temperatures are both 0 -- likely not entered.',
      'Set MIN SITE TEMP at ' + inputLocation('minTemp') + ' and MAX AMBIENT TEMP at ' + inputLocation('maxTemp') + '.');

  if (inp.minTemp >= inp.maxTemp)
    critical('INP-08',
      'Min temp (' + inp.minTemp + 'C) >= Max temp (' + inp.maxTemp + 'C). Impossible range.',
      'Verify MIN SITE TEMP and MAX AMBIENT TEMP values.');

  // =========================================================================
  // GROUP 2: PANEL DATA COMPLETENESS
  // =========================================================================

  var pVoc  = parseFloat(panel['PANEL_VOC_V'])    || 0;
  var pVmp  = parseFloat(panel['PANEL_VMP_V'])    || 0;
  var pIsc  = parseFloat(panel['PANEL_ISC_A'])    || 0;
  var pTc   = parseFloat(panel['PANEL_TEMP_PMAX'])|| 0;
  var pPwr  = parseFloat(panel['PANEL_POWER_W'])  || 0;

  if (pVoc <= 0)
    critical('PNL-01', 'Panel Voc is 0 or missing in DB for: ' + inp.panelModel,
      'Update PANEL_VOC_V in 11M_PRODUCTS_PANELS.');
  if (pVmp <= 0)
    critical('PNL-02', 'Panel Vmp is 0 or missing in DB.',
      'Update PANEL_VMP_V in 11M_PRODUCTS_PANELS.');
  if (pIsc <= 0)
    critical('PNL-03', 'Panel Isc is 0 or missing in DB.',
      'Update PANEL_ISC_A in 11M_PRODUCTS_PANELS.');
  if (pTc >= 0)
    major('PNL-04',
      'Panel temp coefficient (PANEL_TEMP_PMAX) = ' + pTc +
      ' -- should be negative (e.g. -0.0026). Check DB entry.',
      'Confirm sign of PANEL_TEMP_PMAX in 11M_PRODUCTS_PANELS. NOM uses negative value/C.');
  if (pPwr <= 0)
    critical('PNL-05', 'Panel power is 0 or missing.',
      'Update PANEL_POWER_W in 11M_PRODUCTS_PANELS.');

  // =========================================================================
  // GROUP 3: INVERTER DATA COMPLETENESS
  // =========================================================================

  invBank.forEach(function(inv) {
    var prefix = 'INV-' + inv.model + ': ';
    if (inv.maxDcV <= 0)
      critical('INV-01', prefix + 'Max DC voltage is 0.',
        'Update INV_DC_MAX_VOLTAGE_V in 12M_PRODUCTS_INVERTERS (v3 field name).');
    if (inv.mpptVmin <= 0)
      critical('INV-02', prefix + 'MPPT Vmin is 0.',
        'Update INV_MPPT_VOLTAGE_MIN_V in 12M_PRODUCTS_INVERTERS (v3 field name).');
    if (inv.mpptVmin >= inv.mpptVmax)
      critical('INV-03', prefix + 'MPPT Vmin (' + inv.mpptVmin + ') >= Vmax (' + inv.mpptVmax + ').',
        'Check INV_MPPT_VOLTAGE_MIN_V and INV_MPPT_VOLTAGE_MAX_V (v3 field names).');
    if (inv.acKw <= 0)
      critical('INV-04', prefix + 'AC power is 0.',
        'Update INV_AC_POWER_KW in 12M_PRODUCTS_INVERTERS.');
    if (inv.voltage <= 0)
      major('INV-05', prefix + 'Voltage not parsed (INV_VOLTAGE in DB).',
        'Check INV_AC_VOLTAGE_NOMINAL_V format -- expected numeric e.g. 480 (v3 field name).');
    if (inv.qty <= 0)
      critical('INV-06', prefix + 'Quantity is 0 in INPUT_DESIGN.',
        'Enter qty at ' + inputLocation('inverterPrimaryQty') + ' (primary) or invertersSecondary range.');
    // STR-02 early check using v3 totalDcInputs.
    // OPTIMIZER topology parallels multiple optimizer strings per DC input, so
    // the standard "strings <= DC inputs" rule does not apply. CalcDC and the
    // INV-08 warning already treat optimizer topology this way; mirror it here.
    var availableInputs = inv.totalDcInputs * inv.qty;
    if (inv.topology !== 'OPTIMIZER' &&
        inv.stringsAssigned > 0 && availableInputs > 0 && inv.stringsAssigned > availableInputs) {
      critical('STR-02', prefix + 'Strings assigned (' + inv.stringsAssigned +
        ') > total DC inputs available (' + availableInputs + ' = ' + inv.totalDcInputs +
        ' inputs/inv x ' + inv.qty + ' inv). INV_TOTAL_DC_INPUTS from DB.',
        'Reduce strings assigned or add more inverters of this type.');
    }
    if (inv.stringsAssigned <= 0)
      major('INV-07', prefix + 'Strings assigned is 0 in INPUT_DESIGN.',
        'Enter strings per inverter at ' + inputLocation('inverterPrimaryStrings') + ' (primary) or col F of invertersSecondary range.');
    if (inv.topology === 'OPTIMIZER') {
      warn('INV-08', prefix + 'Topology=OPTIMIZER. Standard MPPT voltage/current checks are skipped. ' +
        'Verify optimizer compatibility with selected panel manually.');
    }
    if (inv.mdcReady === 'REVIEW') {
      major('INV-09', prefix + 'VALID_MDC_READY=REVIEW in DB. ' + (inv.datasheetNotes || '') +
        '. Results may be unreliable.',
        'Verify inverter datasheet and update DB before issuing MDC.');
    }
  });

  // =========================================================================
  // GROUP 4: VOLTAGE RANGE PRE-CHECK (DC-01 / DC-02 early warning)
  // =========================================================================

  if (pVoc > 0 && pTc < 0 && inp.modsPerString > 0) {
    var vocColdMod = pVoc * (1 + pTc * (inp.minTemp - 25));
    var vocColdStr = vocColdMod * inp.modsPerString;
    var hotTemp    = inp.maxTemp + 30; // conservative: assume worst-case roof adder until LAY-01 runs
    var vmpHotMod  = pVmp * (1 + pTc * (hotTemp - 25));
    var vmpHotStr  = vmpHotMod * inp.modsPerString;

    invBank.forEach(function(inv) {
      // DC-01 pre-check -- skipped for OPTIMIZER topology: optimizers regulate
      // string voltage, so summed per-module Voc never appears across the
      // string. CalcDC skips DC-01 the same way (see 04_CalcDC.js).
      if (inv.topology !== 'OPTIMIZER' && vocColdStr > inv.maxDcV) {
        critical('DC-01',
          inv.model + ': Voc_cold = ' + vocColdStr.toFixed(1) + 'V exceeds Vmax = ' + inv.maxDcV + 'V.' +
          ' Max mods/string = ' + Math.floor(inv.maxDcV / vocColdMod) + '.',
          'Reduce modsPerString at ' + inputLocation('modsPerString') + ', or select compatible inverter.');
      }
      // DC-02 pre-check (using conservative hot temp) -- also N/A for OPTIMIZER.
      if (inv.topology !== 'OPTIMIZER' && pVmp > 0 && vmpHotStr < inv.mpptVmin) {
        var minMods = Math.ceil(inv.mpptVmin / vmpHotMod);
        var maxMods = Math.floor(inv.maxDcV / vocColdMod);
        if (minMods > maxMods) {
          critical('DC-02',
            inv.model + ': IMPOSSIBLE string window -- min mods needed for MPPT (' + minMods +
            ') > max mods allowed by Vmax (' + maxMods + ').' +
            ' This panel+inverter combination is incompatible at this site temperature.',
            'Change inverter to one with MPPT_min <= ' + Math.floor(vmpHotStr).toFixed(0) +
            'V, or use a panel with higher Vmp.');
        } else {
          major('DC-02',
            inv.model + ': Vmp_hot (' + vmpHotStr.toFixed(1) + 'V) < MPPT_min (' + inv.mpptVmin + 'V).' +
            ' Valid range: ' + minMods + '-' + maxMods + ' mods/string.',
            'Adjust modsPerString to ' + minMods + '-' + maxMods + ' for this inverter.');
        }
      }
    });
  }

  // =========================================================================
  // GROUP 5: DC/AC RATIO PRE-CHECK
  // =========================================================================

  if (pPwr > 0 && inp.panelQty > 0) {
    var dcKwp = (pPwr * inp.panelQty) / 1000;
    var acKw  = invBank.reduce(function(s, inv) { return s + inv.acKw * inv.qty; }, 0);
    if (acKw > 0) {
      var ratio = dcKwp / acKw;
      if (ratio > nom.dcAcHard) {
        critical('DC-10',
          'DC/AC ratio = ' + ratio.toFixed(3) + ' exceeds hard max ' + nom.dcAcHard + '.' +
          ' (' + dcKwp.toFixed(1) + ' kWp / ' + acKw.toFixed(1) + ' kWac)',
          'Add inverter capacity or reduce panel count.');
      } else if (ratio > nom.dcAcWarn) {
        major('DC-10',
          'DC/AC ratio = ' + ratio.toFixed(3) + ' exceeds warn threshold ' + nom.dcAcWarn + '.',
          'Verify project/manufacturer basis allows ratio > ' + nom.dcAcWarn + '.');
      }
      // Bug B3 fix (3.7.8): previously read `acKw > 0 && ratio < X || ratio < 0.8` which
      // (due to JS && binding tighter than ||) parsed as `(acKw > 0 && ratio < X) || (ratio < 0.8)` —
      // the second branch would have fired regardless of the acKw>0 guard. Today it's masked
      // because the enclosing block already guards acKw>0, but the latent bug stays a footgun.
      // Explicit parens lock the intended meaning: warn iff acKw>0 AND ratio is below either threshold.
      if (acKw > 0 && (ratio < nom.limits['project_dc_ac_ratio_warnMin'] || ratio < 0.8)) {
        warn('DC-10', 'DC/AC ratio = ' + ratio.toFixed(3) + ' is very low (< 0.8). Verify panel count.');
      }
    }
  }

  // =========================================================================
  // GROUP 6: STRING COUNT CONSISTENCY
  // =========================================================================

  var totalStringsAssigned = invBank.reduce(function(s, inv) {
    return s + inv.stringsAssigned;
  }, 0);

  if (inp.stringsTotal > 0 && totalStringsAssigned !== inp.stringsTotal) {
    major('STR-00',
      'Total strings at ' + inputLocation('stringsTotal') + ' (' + inp.stringsTotal +
      ') != sum of strings assigned to inverters (' + totalStringsAssigned + ').',
      'Check stringsTotal vs invertersSecondary col F + inverterPrimaryStrings. They must sum to the same value.');
  }

  var modulesFromStrings = inp.stringsTotal * inp.modsPerString * inp.parallelStrings;
  if (inp.panelQty > 0 && inp.stringsTotal > 0 &&
      Math.abs(modulesFromStrings - inp.panelQty) > 5) {
    major('STR-00',
      'Modules derived from strings (' + modulesFromStrings + ') != panel qty (' + inp.panelQty + ').' +
      ' strings=' + inp.stringsTotal + ' x mods=' + inp.modsPerString +
      ' x parallel=' + inp.parallelStrings,
      'Reconcile panel count with string/MPPT layout in INPUT_DESIGN.');
  }

  // =========================================================================
  // GROUP 7: PRODUCTION DATA
  // =========================================================================

  if (!inp.helio || inp.helio.length < 12) {
    major('HEL-01', 'Helioscope data incomplete -- fewer than 12 months found.',
      'Paste all 12 months of Helioscope data into the §07 HELIOSCOPE block (INPUT_DESIGN rows 43-54).');
  } else {
    var hasGrid = inp.helio.filter(function(m) { return m.grid > 0; }).length;
    if (hasGrid < 6) {
      major('HEL-02',
        'Helioscope GRID kWh column has fewer than 6 non-zero months (' + hasGrid + ').',
        'Verify Helioscope export includes GRID kWh column.');
    }
  }

  // =========================================================================
  // GROUP 8: DESIGN LIMITS
  // =========================================================================

  if (inp.dcVdropLimit > nom.dcVdropHard) {
    critical('LIM-01',
      'DC voltage drop limit at ' + inputLocation('dcVdropLimit') + ' (' + (inp.dcVdropLimit*100).toFixed(1) +
      '%) exceeds NOM hard max (' + (nom.dcVdropHard*100).toFixed(0) + '%).',
      'Set DC VOLTAGE DROP LIMIT to <= ' + nom.dcVdropHard + '.');
  }
  if (inp.acVdropLimit > nom.acVdropHard) {
    critical('LIM-02',
      'AC voltage drop limit at ' + inputLocation('acVdropLimit') + ' (' + (inp.acVdropLimit*100).toFixed(1) +
      '%) exceeds NOM hard max (' + (nom.acVdropHard*100).toFixed(0) + '%).',
      'Set AC VOLTAGE DROP LIMIT to <= ' + nom.acVdropHard + '.');
  }
  if (inp.powerFactor < 0.85 || inp.powerFactor > 1.0) {
    major('LIM-03',
      'Power factor (' + inp.powerFactor + ') outside typical range 0.85-1.0.',
      'Verify POWER FACTOR at ' + inputLocation('powerFactor') + '.');
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================

  result.summary =
    (result.criticals.length === 0 && result.majors.length === 0)
    ? 'PASS -- All validation checks passed (' + result.warnings.length + ' warnings).'
    : (result.criticals.length > 0
      ? 'BLOCKED -- ' + result.criticals.length + ' critical error(s) must be fixed before engine can run.'
      : 'WARNINGS -- ' + result.majors.length + ' major issue(s) found. Engine will run but review results.');

  engineLog(ss, 'Validate', result.passed ? 'OK' : 'FAIL',
    result.summary +
    ' Criticals=' + result.criticals.length +
    ' Majors=' + result.majors.length +
    ' Warnings=' + result.warnings.length);

  return result;
}

// Formats validation result for UI alert
function formatValidationAlert(result) {
  var msg = result.summary + '\n\n';
  if (result.criticals.length > 0) {
    msg += '-- CRITICAL (must fix) --\n';
    result.criticals.forEach(function(e) {
      msg += '[' + e.rule + '] ' + e.msg + '\n  FIX: ' + e.fix + '\n\n';
    });
  }
  if (result.majors.length > 0) {
    msg += '-- MAJOR (review) --\n';
    result.majors.forEach(function(e) {
      msg += '[' + e.rule + '] ' + e.msg + '\n  FIX: ' + e.fix + '\n\n';
    });
  }
  if (result.warnings.length > 0) {
    msg += '-- WARNINGS --\n';
    result.warnings.forEach(function(e) {
      msg += '[' + e.rule + '] ' + e.msg + '\n';
    });
  }
  return msg;
}
