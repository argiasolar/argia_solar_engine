// =============================================================================
// ARGIA ENGINE v7 -- File: 16_WriteOverview.gs
// Generates a single-page HTML "project overview" for approval purposes.
//
// PURPOSE
//   Pulls live data from INPUT_PROJECT, INPUT_DESIGN, MDC, BOM, INSTALLATION,
//   FINANCE, and the engine pipeline (calcDC/calcAC/calcLayout/runValidation)
//   and renders a single self-contained HTML file with:
//     - Header band with status pills
//     - 4 KPI tiles
//     - Financials + cost breakdown donut
//     - Design summary + MDC compliance pills
//     - Project schedule timeline
//     - Documentation status + team
//     - Decision checklist
//
// OUTPUT
//   Writes ARGIA_<projectName>_OVERVIEW.html to the offer folder
//   (00_MASTERLINK!H2). Existing file with same name is trashed.
//
// MENU
//   Wired up in 00_Main.gs as "Generate Project Overview".
//
// SCOPE NOTES
//   - IRR is computed from FINANCE row 35 (Y00..Y10 cash flow series) using
//     Newton-Raphson. If row 35 is empty/broken, IRR shows "—".
//   - DSCR Y1 = annualSavings / annualLoanPayment. "—" if either is zero.
//   - Documentation status auto-detects from engine output (PROJECT_CARD
//     sheet exists, BOM exists, helio data present, etc.). Items with no
//     auto-detect path are shown unchecked. Edit the rendered HTML manually
//     to override.
//   - The currency toggle uses one tc multiplier captured at render time
//     (read from BOM row 6 col F).
//
// DESIGN
//   Single-file HTML. CSS and chart.js inline so the file works standalone
//   when shared. Dark mode via @media (prefers-color-scheme: dark).
// =============================================================================

var SH_OVERVIEW_FILE_NAME = function(projectName) {
  var safe = String(projectName || 'PROJECT').replace(/[^\w\-]+/g, '_');
  return 'ARGIA_' + safe + '_OVERVIEW.html';
};

// ---------------------------------------------------------------------------
// MAIN ENTRY -- wired up to ARGIA menu via 00_Main.gs
// ---------------------------------------------------------------------------
function runWriteOverview() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var TOTAL = 6;

  try {
    _setArgiaProgress(0, TOTAL, 'Starting Project Overview\u2026');
    _showArgiaProgress('ARGIA \u2014 Project Overview');

    _setArgiaProgress(1, TOTAL, 'Loading constants & inputs\u2026');
    var nom     = loadNomConstants(ss);
    var inp     = readInputs(ss);

    _setArgiaProgress(2, TOTAL, 'Loading equipment & validation\u2026');
    var panel   = lookupPanel(ss, inp.panelModel);
    var invBank = buildInverterBank(ss, inp.inverterBank);
    var validation = runValidation(ss, inp, panel, invBank, nom);

    _setArgiaProgress(3, TOTAL, 'Running calculations\u2026');
    var tbls    = readElecTables(ss);
    var dc      = calcDC(inp, panel, invBank, nom, tbls);
    var ac      = calcAC(inp, panel, invBank, nom, tbls, dc);
    var lay     = calcLayout(inp, dc, ac, nom);

    _setArgiaProgress(4, TOTAL, 'Gathering project data\u2026');
    var ctx = _gatherOverviewData(ss, inp, panel, invBank, dc, ac, lay, validation);

    _setArgiaProgress(5, TOTAL, 'Rendering HTML\u2026');
    var html = _renderOverviewHtml(ctx);

    _setArgiaProgress(6, TOTAL, 'Saving to Drive\u2026');
    var saved = _saveOverviewHtml(html, ctx.fileName, ss);

    _setArgiaProgress(TOTAL, TOTAL, '\u2705 Done!');
    Utilities.sleep(1200);

    engineLog(ss, 'Overview', 'OK',
      'Overview HTML saved: ' + ctx.fileName + ' | ' + (saved ? saved.getUrl() : '(no url)'));

    var msg = 'Project Overview generated.\n\nFile: ' + ctx.fileName +
              (saved ? '\nFolder: ' + saved.getParents().next().getName() : '') +
              (saved ? '\n\n' + saved.getUrl() : '') +
              '\n\nOpen in browser to view, or share the Drive link.';
    ui.alert('ARGIA \u2014 Project Overview', msg, ui.ButtonSet.OK);

  } catch (e) {
    try { _setArgiaProgress(TOTAL, TOTAL, '\u274C Error'); } catch (_) {}
    try { engineLog(ss, 'Overview', 'ERROR', e.message + '\n' + (e.stack || '')); } catch (_) {}
    ui.alert('Overview Error', e.message + '\n\nStack:\n' + (e.stack || ''), ui.ButtonSet.OK);
  }
}


// ---------------------------------------------------------------------------
// DATA GATHERING
// Builds the full context object consumed by _renderOverviewHtml.
// Every field has a sensible fallback so partial data doesn't break the render.
// ---------------------------------------------------------------------------
function _gatherOverviewData(ss, inp, panel, invBank, dc, ac, lay, validation) {
  // Exchange rate from BOM row 6 col F (set by writeBOM); fallback 18.50
  var tc = 18.5;
  try {
    var bs = ss.getSheetByName(SH.BOM);
    if (bs) tc = parseFloat(bs.getRange(BOM_ROW.EXCHANGE_RATE, BOM_COL.TOTAL_USD).getValue()) || 18.5;
  } catch (e_) {}

  var pcInp     = (typeof readPcInputs_     === 'function') ? readPcInputs_(ss)     : {};
  var bomTotals = (typeof readBomSubtotals_ === 'function') ? readBomSubtotals_(ss) : null;
  var instTot   = (typeof readInstallTotal_ === 'function') ? readInstallTotal_(ss) : { usd: 0, mxn: 0 };
  var finance   = _readFinanceValues(ss);

  // ---- Cost breakdown by category (USD) -----------------------------------
  // Order matches the donut chart legend in the template
  var cats = bomTotals ? [
    { key: 'elecAc',     label: 'Electric AC',          color: '#1D9E75', usd: bomTotals.elecAc.usd },
    { key: 'panels',     label: 'Solar panels',         color: '#5DCAA5', usd: bomTotals.panels.usd },
    { key: 'elecDc',     label: 'Electric DC',          color: '#9FE1CB', usd: bomTotals.elecDc.usd },
    { key: 'install',    label: 'Installation',         color: '#7F77DD', usd: instTot.usd },
    { key: 'inverters',  label: 'Inverters',            color: '#AFA9EC', usd: bomTotals.inverters.usd },
    { key: 'structure',  label: 'Structure',            color: '#CECBF6', usd: bomTotals.structure.usd },
    { key: 'permitsMon', label: 'Permits + Monitoring', color: '#888780',
      usd: (bomTotals.monitoring.usd + bomTotals.permits.usd) },
  ] : [];
  var totalCostUsd = cats.reduce(function(s, c) { return s + c.usd; }, 0);
  cats.forEach(function(c) { c.pct = totalCostUsd > 0 ? (c.usd / totalCostUsd * 100) : 0; });

  // ---- Selling / margin / gross profit ------------------------------------
  // Mirror the project-card's logic so the numbers are consistent.
  var dcKwp        = dc.dcKwp || 0;
  var dcWp         = dcKwp * 1000;
  var sellingWp    = pcInp.sellingPriceWpUsd || 0;
  var marginIn     = pcInp.marginPct || 0;
  var costPerWp    = dcWp > 0 ? totalCostUsd / dcWp : 0;
  var margin       = marginIn;
  if (margin <= 0 && sellingWp > 0 && costPerWp > 0) {
    margin = (sellingWp - costPerWp) / sellingWp;
  }
  if (margin <= 0) margin = 0.20;
  var sellingTotalUsd = (margin < 1) ? totalCostUsd / (1 - margin) : totalCostUsd;
  var grossProfitUsd  = sellingTotalUsd - totalCostUsd;

  // ---- Financials from FINANCE --------------------------------------------
  var annualSavings = finance.annualSavings || 0;
  var loanAnnualPmt = finance.loanAnnualPayment || 0;
  var dscr1         = (loanAnnualPmt > 0) ? annualSavings / loanAnnualPmt : null;

  // IRR — Newton-Raphson over the 11-element cashflow array (Y00..Y10)
  // captured below if row 35 has data
  var cashFlows = _readFinanceCashFlows(ss);
  var irr = _computeIrr(cashFlows);   // null if can't compute

  // ---- Production -------------------------------------------------------
  var annualKwh = 0;
  if (inp.helio && inp.helio.length) {
    annualKwh = inp.helio.reduce(function(s, m) { return s + (m.grid || 0); }, 0);
  }
  if (annualKwh <= 0 && finance.annualProductionKwh) annualKwh = finance.annualProductionKwh;
  var annualMwh = annualKwh / 1000;
  var yieldKwhKwp = dcKwp > 0 ? annualKwh / dcKwp : 0;

  // Annual consumption from FINANCE C42 (kWh/yr) → MWh
  var consMwh = finance.annualConsumptionKwh ? finance.annualConsumptionKwh / 1000 : 0;

  // Coverage from INPUT_PROJECT
  var coverage = pcInp.systemCoveragePct || 0;
  if (coverage <= 0 && consMwh > 0 && annualMwh > 0) {
    coverage = annualMwh / consMwh;
  }

  // ---- Status pills ------------------------------------------------------
  var pills = _computeStatusPills(inp, validation, pcInp, cats, bomTotals, instTot, dcKwp);

  // ---- MDC compliance ----------------------------------------------------
  var compliance = _computeMdcCompliance(dc, ac, lay, validation, invBank);

  // ---- Decision checklist -----------------------------------------------
  var checklist = _computeDecisionChecklist(inp, dc, pcInp, validation, finance, dscr1, coverage, margin, pills);

  // ---- Documentation status ---------------------------------------------
  var documentation = _computeDocumentation(ss, inp);

  // ---- Schedule milestones -----------------------------------------------
  var milestones = [
    { name: 'Sign',         date: pcInp.contractSignDate,       active: !!pcInp.contractSignDate },
    { name: 'Delivery',     date: pcInp.equipmentDeliveryDate,  active: false },
    { name: 'Install start',date: pcInp.installStartDate,       active: false },
    { name: 'Install done', date: pcInp.installFinishDate,      active: false },
    { name: 'Contract end', date: pcInp.contractFinishDate,     active: false },
  ];

  // ---- Team & approvals --------------------------------------------------
  var team = {
    bizManager      : inp.bizManager      || '\u2014',
    designer        : inp.designer        || '\u2014',
    projectManager  : pcInp.projectManager || inp.designer || '\u2014',
    contact         : inp.contact         || '\u2014',
    submittedBy     : inp.designer        || '\u2014',
    receivedBy      : pcInp.receivedBy    || inp.bizManager || '\u2014',
    approvedBy      : pcInp.approvedBy    || '\u2014',
  };

  // ---- Address line ------------------------------------------------------
  var addr = [inp.street, inp.city, inp.state].filter(Boolean).join(', ');
  var location = (inp.clientName ? inp.clientName + (addr ? ' \u00B7 ' + addr : '') : addr);

  // ---- Inverter summary string -------------------------------------------
  var invSummary = invBank.map(function(i) {
    return i.qty + ' \u00D7 ' + (i.model || '?');
  }).join(' \u00B7 ');

  // ---- Voc cold worst case -----------------------------------------------
  // Use smallest maxDcV across the inverter bank as the binding limit
  var minVmax = invBank.length ? Math.min.apply(null, invBank.map(function(i) { return i.maxDcV || 1100; })) : 1100;

  // ---- Crew/days/MH from install result if accessible --------------------
  // We don't re-run runInstallCost here. Read from INSTALLATION sheet header
  // if present (cell pattern set by 13_CalcInstallCost). Best-effort.
  var crewMh = _readCrewMhFromInstall(ss, inp);

  // Build the full context object
  return {
    // identity
    fileName       : SH_OVERVIEW_FILE_NAME(inp.projectName),
    projectName    : inp.projectName    || '\u2014',
    clientName    : inp.clientName    || '\u2014',
    projectNumber : pcInp.projectNumber || '\u2014',
    location       : location,
    businessType   : inp.businessType   || '',
    contact        : inp.contact        || '',
    clientReq      : (function() {
      try { return readInput(ss, 'clientRequirements') || ''; } catch (e_) { return ''; }
    })(),

    // pills
    pills          : pills,

    // KPI tiles
    dcKwp          : dcKwp,
    acKw           : (dc.acKwTotal || ac.acKwTotal || 0),
    dcAcRatio      : dc.dcAcRatio || (dcKwp / (dc.acKwTotal || ac.acKwTotal || 1)),
    moduleCount    : inp.panelQty || 0,
    stringCount    : inp.stringsTotal || 0,
    annualMwh      : annualMwh,
    yieldKwhKwp    : yieldKwhKwp,
    coverage       : coverage,           // fraction (0..1)
    consMwh        : consMwh,
    payback        : finance.payback,    // years (or null)

    // financials
    tc             : tc,
    sellingTotalUsd: sellingTotalUsd,
    totalCostUsd   : totalCostUsd,
    grossProfitUsd : grossProfitUsd,
    margin         : margin,
    npvMxn         : finance.npv,
    irr            : irr,                // fraction (or null)
    dscr1          : dscr1,              // (or null)
    annualSavings  : annualSavings,      // MXN
    cum10yrCfMxn   : finance.cum10yrCf,  // MXN (or null)
    co2PerYearTons : finance.co2PerYear, // tons (or null)
    loan           : {
      provider     : finance.loanProvider || '',
      currency     : finance.loanCurrency || 'MXN',
      periodYears  : finance.loanPeriod   || 0,
      ratePct      : finance.loanRate     || 0,    // fraction
      annualPmt    : loanAnnualPmt,                // MXN
    },

    // cost breakdown
    cats           : cats,
    costPerKwpUsd  : dcKwp > 0 ? (totalCostUsd / dcKwp) : 0,

    // design
    panelLabel     : ((panel && panel['PANEL_BRAND']) || '') + ' ' + ((panel && panel['PANEL_MODEL']) || '') +
                     (panel && panel['PANEL_POWER_W'] ? ' \u00B7 ' + panel['PANEL_POWER_W'] + 'W' : ''),
    invSummary     : invSummary,
    modsPerString  : inp.modsPerString || 0,
    vocCold        : dc.vocColdString || 0,
    vocColdLimit   : minVmax,
    vocColdPass    : !!dc.dc01Pass,
    transformer    : ac.transformer || 0,
    transformerBase: ac.apparentPower || 0,
    arrayArea      : (lay && lay.bom && lay.bom.areaRequired) || lay.grossArea || 0,
    availableSpace : inp.availableSpace || 0,
    minTemp        : inp.minTemp,
    maxTemp        : inp.maxTemp,
    roofAdder      : dc.roofAdder || 0,

    // MDC compliance pills (one per row)
    compliance     : compliance,

    // schedule
    milestones     : milestones,
    crewSize       : crewMh.crew,
    projectDays    : crewMh.days,
    totalMh        : crewMh.mh,
    paymentTerms   : pcInp.paymentTerms || '\u2014',
    paymentDays    : pcInp.paymentDays || 0,
    interconnectionMonths: finance.interconnectionMonths || 0,

    // documentation
    documentation  : documentation,

    // team
    team           : team,

    // checklist
    checklist      : checklist,
  };
}


// ---------------------------------------------------------------------------
// Reads the FINANCE tab (column-by-cell, defensive). Returns null fields when
// the cell is empty / unparseable. The schema documented here matches the
// FINANCE layout I inspected in ARGIA_ENGINE.xlsx as of 2026-04-28.
// ---------------------------------------------------------------------------
function _readFinanceValues(ss) {
  var fin = ss.getSheetByName('FINANCE');
  if (!fin) return {};
  function num(a1) {
    try {
      var v = fin.getRange(a1).getValue();
      var f = parseFloat(v);
      return isNaN(f) ? null : f;
    } catch (e_) { return null; }
  }
  function str(a1) {
    try { return String(fin.getRange(a1).getValue() || '').trim(); }
    catch (e_) { return ''; }
  }

  return {
    capexMxn               : num('C3'),
    npv                    : num('C4'),
    interconnectionMonths  : num('C5'),
    loanAnnualPayment      : num('C9'),

    loanProvider           : str('F5'),
    loanCurrency           : str('F6'),
    loanPeriod             : num('F7'),     // years
    loanRate               : num('F9'),     // fraction (e.g. 0.1266)

    annualSavings          : num('C37'),    // MXN/yr
    payback                : num('C38'),    // years (the FINANCE 'ROI' cell)

    co2PerYear             : num('D22'),    // tons/year (Y01)

    annualConsumptionKwh   : num('C42'),    // kWh/yr
    annualProductionKwh    : num('C43'),    // kWh/yr
    pvDesignKwhKwp         : num('C45'),

    // Cumulative CF after 10 years — try several columns
    // D=Y01, E=Y02, ... so M=Y10. Fall back to M, then N, then largest in row.
    cum10yrCf              : num('M36') || num('N36') || (function() {
      try {
        var rng = fin.getRange('D36:O36').getValues()[0];
        var max = 0;
        rng.forEach(function(v) { var f = parseFloat(v); if (!isNaN(f) && f > max) max = f; });
        return max || null;
      } catch (e_) { return null; }
    })(),
  };
}


// ---------------------------------------------------------------------------
// Reads the FINANCE row-35 cash-flow series. Returns [-CAPEX, Y01, Y02, ...]
// up to 10 years. Used by _computeIrr.
// ---------------------------------------------------------------------------
function _readFinanceCashFlows(ss) {
  var fin = ss.getSheetByName('FINANCE');
  if (!fin) return null;
  try {
    // C35 is -CAPEX, D35..M35 are Y01..Y10
    var raw = fin.getRange('C35:M35').getValues()[0];
    var cf = raw.map(function(v) { var f = parseFloat(v); return isNaN(f) ? 0 : f; });
    if (cf[0] === 0) return null;
    return cf;
  } catch (e_) { return null; }
}


// ---------------------------------------------------------------------------
// Newton-Raphson IRR solver. Returns the rate as a decimal (0.439 = 43.9%),
// or null if it can't converge. Standard implementation.
// ---------------------------------------------------------------------------
function _computeIrr(cashFlows) {
  if (!cashFlows || cashFlows.length < 2) return null;

  function npv(rate) {
    var s = 0;
    for (var t = 0; t < cashFlows.length; t++) {
      s += cashFlows[t] / Math.pow(1 + rate, t);
    }
    return s;
  }
  function dnpv(rate) {
    var s = 0;
    for (var t = 1; t < cashFlows.length; t++) {
      s -= t * cashFlows[t] / Math.pow(1 + rate, t + 1);
    }
    return s;
  }

  var rate = 0.10;
  for (var i = 0; i < 100; i++) {
    var f = npv(rate);
    var df = dnpv(rate);
    if (Math.abs(df) < 1e-12) break;
    var next = rate - f / df;
    if (!isFinite(next) || next < -0.99) break;
    if (Math.abs(next - rate) < 1e-7) return next;
    rate = next;
  }
  // Sanity: cap at -100%/+10000% so we never display nonsense
  if (rate < -1 || rate > 100) return null;
  return rate;
}


// ---------------------------------------------------------------------------
// Try to read crew size, project days, and total MH from INSTALLATION sheet.
// Best-effort. INSTALLATION is written by 13_CalcInstallCost.
// Falls back to (crewSize from INPUT_INSTALL, days/mh from null) if not found.
// ---------------------------------------------------------------------------
function _readCrewMhFromInstall(ss, inp) {
  var crewSize = 0, days = 0, mh = 0;
  try { crewSize = parseInt(readInput(ss, 'crewSize')) || 0; } catch (e_) {}

  // Scan INSTALLATION top rows for numeric fields next to recognisable labels.
  var sh = ss.getSheetByName('INSTALLATION') || ss.getSheetByName('INSTALL_COST');
  if (sh) {
    try {
      var data = sh.getRange(1, 1, Math.min(sh.getLastRow(), 50), Math.min(sh.getLastColumn(), 10)).getValues();
      data.forEach(function(row) {
        row.forEach(function(cell, c) {
          var label = String(cell || '').toLowerCase();
          if (!days && /\bdays?\b/.test(label) && c < row.length - 1) {
            var v = parseFloat(row[c + 1]); if (!isNaN(v) && v > 0 && v < 365) days = Math.round(v);
          }
          if (!mh && /\bmh\b/.test(label) && c < row.length - 1) {
            var v2 = parseFloat(row[c + 1]); if (!isNaN(v2) && v2 > 0) mh = Math.round(v2);
          }
        });
      });
    } catch (e_) {}
  }
  return { crew: crewSize, days: days, mh: mh };
}


// ---------------------------------------------------------------------------
// Compute the three header status pills.
// ---------------------------------------------------------------------------
function _computeStatusPills(inp, validation, pcInp, cats, bomTotals, instTot, dcKwp) {
  // 1. Project type pill (CAPEX or PPA)
  var bt = String(inp.businessType || '').toUpperCase();
  var btLabel = bt
    .replace(/_/g, ' ')
    .replace('CAPEX ROOF', 'CAPEX roof')
    .replace('CAPEX GROUND', 'CAPEX ground')
    .replace('PPA ROOF', 'PPA roof')
    .replace('PPA GROUND', 'PPA ground') || 'CAPEX';
  var typePill = { tone: 'info', label: btLabel };

  // 2. MDC emittable pill -- from validation result
  var mdcPill;
  if (!validation.passed) {
    mdcPill = { tone: 'danger', label: 'BLOCKED \u00B7 ' + validation.criticals.length + ' critical' };
  } else if (validation.majors && validation.majors.length > 0) {
    mdcPill = { tone: 'warning', label: 'Emittable with ' + validation.majors.length + ' observation' + (validation.majors.length === 1 ? '' : 's') };
  } else {
    mdcPill = { tone: 'success', label: 'Emittable' };
  }

  // 3. Cost validation pill — counts of PASS for each category against
  //    the project-card validation envelope (range from INPUT_PROJECT 52-60)
  var passCount = 0, totalChecks = 0;
  if (pcInp && pcInp.validation && bomTotals && dcKwp > 0) {
    cats.forEach(function(c) {
      var label = c.label;
      // Map cost-breakdown labels to PC envelope keys (the keys in
      // readPcInputs_'s validation dict)
      var envelopeKey = ({
        'Solar panels'         : 'Solar panels',
        'Inverters'            : 'Inverters',
        'Structure'            : 'Structure',
        'Electric DC'          : 'Electric DC',
        'Electric AC'          : 'Electric AC',
        'Permits + Monitoring' : 'Monitoring',     // approximate match
        'Installation'         : 'Installation',
      })[label];
      if (!envelopeKey) return;
      var env = pcInp.validation[envelopeKey];
      if (!env) return;
      totalChecks++;
      var perKwp = c.usd / dcKwp;
      if (perKwp >= env.min && perKwp <= env.max) passCount++;
    });
    // Also the TOTAL envelope
    var tEnv = pcInp.validation['TOTAL'];
    if (tEnv) {
      totalChecks++;
      var totalPerKwp = cats.reduce(function(s, c) { return s + c.usd; }, 0) / dcKwp;
      if (totalPerKwp >= tEnv.min && totalPerKwp <= tEnv.max) passCount++;
    }
  }
  var costPill = (totalChecks > 0 && passCount === totalChecks)
    ? { tone: 'success', label: 'Costs within range \u00B7 ' + passCount + '/' + totalChecks }
    : (totalChecks > 0
        ? { tone: 'warning', label: 'Cost ranges \u00B7 ' + passCount + '/' + totalChecks + ' PASS' }
        : { tone: 'info', label: 'Cost validation N/A' });

  return {
    type   : typePill,
    mdc    : mdcPill,
    cost   : costPill,
    costPassCount : passCount,
    costPassTotal : totalChecks,
  };
}


// ---------------------------------------------------------------------------
// Build the MDC compliance row list shown in the right-hand card.
// ---------------------------------------------------------------------------
function _computeMdcCompliance(dc, ac, lay, validation, invBank) {
  // helper: did any rule with this prefix fire as critical?
  function hasCritical(prefix) {
    return validation.criticals.some(function(c) { return String(c.rule).indexOf(prefix) === 0; });
  }
  function hasMajor(prefix) {
    return validation.majors.some(function(m) { return String(m.rule).indexOf(prefix) === 0; });
  }

  // DC section pass = no DC critical AND vdrop within limit
  var dcSectionPass = !hasCritical('DC-') && !!dc.vdropDCPass;

  // String voltage window pass — DC-01 + DC-02 both pass
  var voltageWindowPass = !!dc.dc01Pass && !!dc.dc02Pass;

  // DC input limit per inverter — STR-02 must not have fired critical
  var dcInputPass = !hasCritical('STR-02');

  // MPPT current STR-03/DC-09 — best-effort. Mark PASS if neither rule fired.
  var mpptPass = !hasCritical('STR-03') && !hasMajor('STR-03') && !hasCritical('DC-09') && !hasMajor('DC-09');

  // AC per inverter — check ac.perInverter[].ocpdPassPerInv if available;
  // otherwise infer from validation (no AC-* critical).
  var acPerInvPass = true;
  var acPerInvNote = '';
  try {
    if (ac && ac.perInverter && ac.perInverter.length) {
      ac.perInverter.forEach(function(pi, idx) {
        if (pi && (pi.ocpdPassPerInv === false || pi.vdropACPassPerInv === false)) {
          acPerInvPass = false;
          // best-effort model name lookup
          if (invBank && invBank[idx] && invBank[idx].model) acPerInvNote = invBank[idx].model;
        }
      });
    }
  } catch (e_) {}

  // Main feeder/breaker — ac.resultFeeder string contains "PASS"/"FAIL"
  var feederPass = !!ac.vdropFeederPass && !/FAIL/i.test(String(ac.resultFeeder || ''));

  // Voltage drops — show all three numbers (DC, AC per-inv, feeder)
  var vdropDc      = (dc.vdropDC || 0) * 100;
  var vdropAcPerInv= (ac.perInverter && ac.perInverter[0] && ac.perInverter[0].vdropAC || 0) * 100;
  var vdropFeeder  = (ac.vdropFeeder || 0) * 100;

  // Rapid shutdown — units count from lay.bom (same source as BOM writer)
  var rsdRequired = !!(lay && lay.bom && lay.bom.rsdRequired);
  var rsdUnits    = (lay && lay.bom && lay.bom.rsdUnits) || 0;

  return {
    dcSection           : { pass: dcSectionPass },
    voltageWindow       : { pass: voltageWindowPass, note: voltageWindowPass ? 'PASS (both types)' : 'REVIEW' },
    dcInputLimit        : { pass: dcInputPass },
    mpptCurrent         : { pass: mpptPass },
    acPerInverter       : { pass: acPerInvPass, note: acPerInvNote },
    feeder              : { pass: feederPass },
    vdrop               : { dc: vdropDc, ac: vdropAcPerInv, feeder: vdropFeeder },
    rsd                 : { required: rsdRequired, units: rsdUnits },
  };
}


// ---------------------------------------------------------------------------
// 8 yes/no items for the decision checklist.
// ---------------------------------------------------------------------------
function _computeDecisionChecklist(inp, dc, pcInp, validation, finance, dscr1, coverage, margin, pills) {
  var lowROI = String(inp && inp.businessType || '').toUpperCase().indexOf('PPA') >= 0
    || /low/i.test(String(pcInp && pcInp.clientRequirements || ''));

  return [
    {
      label: 'Coverage in 25\u201360%?',
      pass : (coverage >= 0.25 && coverage <= 0.60),
      value: (coverage > 0 ? (coverage * 100).toFixed(1) + '%' : '\u2014'),
    },
    {
      label: 'DC/AC ratio \u2264 1.5?',
      pass : ((dc.dcAcRatio || 0) <= 1.5 && (dc.dcAcRatio || 0) > 0),
      value: (dc.dcAcRatio ? dc.dcAcRatio.toFixed(2) : '\u2014'),
    },
    {
      label: 'Margin \u2265 15% target?',
      pass : (margin >= 0.15),
      value: (margin > 0 ? (margin * 100).toFixed(1) + '%' : '\u2014'),
    },
    {
      label: 'DSCR year 1 \u2265 1.20?',
      pass : (dscr1 != null && dscr1 >= 1.20),
      value: (dscr1 != null ? dscr1.toFixed(2) : '\u2014'),
    },
    {
      label: 'All cost categories in range?',
      pass : (pills.costPassTotal > 0 && pills.costPassCount === pills.costPassTotal),
      value: pills.costPassTotal > 0
        ? (pills.costPassCount + '/' + pills.costPassTotal)
        : 'N/A',
    },
    {
      label: 'MDC emittable?',
      pass : !!validation.passed && (!validation.majors || validation.majors.length === 0),
      value: validation.passed
        ? (validation.majors && validation.majors.length > 0
            ? '\u25B2 with ' + validation.majors.length + ' obs'
            : '\u2713')
        : 'BLOCKED',
    },
    {
      label: 'Mandatory docs complete?',
      pass : null,   // unknown without manual flags; renderer will show "—"
      value: '\u2014',
    },
    {
      label: 'Payback acceptable?',
      pass : (finance.payback != null && finance.payback > 0 && finance.payback <= 6),
      value: (finance.payback != null ? finance.payback.toFixed(1) + ' yrs' : '\u2014'),
    },
  ];
}


// ---------------------------------------------------------------------------
// Documentation status. Auto-detect what's been produced; everything else
// reports as "TBD" (the user can edit the rendered HTML manually if needed).
// ---------------------------------------------------------------------------
function _computeDocumentation(ss, inp) {
  function has(name) { return ss.getSheetByName(name) !== null; }
  var rfqAny = has('RFQ_PANELES') || has('RFQ_INVERSORES') ||
               has('RFQ_ESTRUCTURA') || has('RFQ_ELECTRICO') || has('RFQ_MONITOREO');
  var helioPresent = !!(inp.helio && inp.helio.length && inp.helio.some(function(m) { return (m.grid || 0) > 0; }));

  return [
    { label: 'ARGIA offer',         done: has('PROJECT_CARD'), category: 'mandatory' },
    { label: 'RFQ set',             done: rfqAny,              category: 'mandatory' },
    { label: 'Helioscope',          done: helioPresent,        category: 'mandatory' },
    { label: 'Tender spec',         done: false,               category: 'mandatory' },
    { label: 'Install manual',      done: false,               category: 'mandatory' },
    { label: 'Install quotation',   done: has('INSTALLATION'), category: 'additional' },
    { label: 'Contract / PO',       done: false,               category: 'additional' },
    { label: 'Harmonogram',         done: false,               category: 'additional' },
    { label: 'Technical audit',     done: false,               category: 'additional' },
  ];
}


// ---------------------------------------------------------------------------
// FORMAT HELPERS
// ---------------------------------------------------------------------------
function _fmtNum(n, decimals) {
  if (n == null || isNaN(n)) return '\u2014';
  decimals = decimals == null ? 0 : decimals;
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
function _fmtMoney(n) { return _fmtNum(n, 0); }
function _fmtPct(n, decimals) {
  if (n == null || isNaN(n)) return '\u2014';
  decimals = decimals == null ? 1 : decimals;
  return (Number(n) * 100).toFixed(decimals) + '%';
}
function _fmtDate(d) {
  if (!d) return '';
  if (d instanceof Date) {
    return Utilities.formatDate(d, 'America/Monterrey', 'MMM d');
  }
  return String(d);
}
function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


// ---------------------------------------------------------------------------
// HTML RENDERING
// One big template literal. CSS+chart.js inline so the file is self-contained
// when shared. Currency toggle works via a single tc multiplier.
// ---------------------------------------------------------------------------
function _renderOverviewHtml(c) {
  // Pre-format frequently-used values
  var dcKwpStr     = _fmtNum(c.dcKwp, 0);
  var acKwStr      = _fmtNum(c.acKw, 0);
  var ratioStr     = c.dcAcRatio ? c.dcAcRatio.toFixed(2) : '\u2014';
  var modulesStr   = _fmtNum(c.moduleCount, 0);
  var stringsStr   = _fmtNum(c.stringCount, 0);
  var prodMwhStr   = _fmtNum(c.annualMwh, 0);
  var yieldStr     = _fmtNum(c.yieldKwhKwp, 0);
  var coveragePct  = _fmtPct(c.coverage, 1);
  var consMwhStr   = _fmtNum(c.consMwh, 0);
  var paybackStr   = c.payback != null ? c.payback.toFixed(1) + ' yrs' : '\u2014';

  // Donut chart data
  var chartLabels  = c.cats.map(function(x) { return "'" + _esc(x.label) + "'"; }).join(',');
  var chartData    = c.cats.map(function(x) { return x.pct.toFixed(1); }).join(',');
  var chartColors  = c.cats.map(function(x) { return "'" + x.color + "'"; }).join(',');

  // Cost breakdown legend rows
  var legendHtml = c.cats.map(function(x) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0">' +
      '<span style="width:10px;height:10px;border-radius:2px;background:' + x.color + ';flex-shrink:0"></span>' +
      '<span style="flex:1">' + _esc(x.label) + '</span>' +
      '<span style="color:var(--text-secondary)">' + x.pct.toFixed(1) + '%</span>' +
    '</div>';
  }).join('');

  // Status pills
  function pillHtml(p) {
    var bgVar = 'var(--bg-' + p.tone + ')';
    var fgVar = 'var(--text-' + p.tone + ')';
    return '<span class="pill" style="background:' + bgVar + ';color:' + fgVar + '">' +
      '<span class="dot" style="background:' + fgVar + '"></span>' + _esc(p.label) + '</span>';
  }

  // Compliance pills
  function passPill(pass, customLabel) {
    var label = customLabel || (pass ? 'PASS' : 'REVIEW');
    var tone = pass ? 'success' : 'warning';
    return '<span class="pill" style="background:var(--bg-' + tone + ');color:var(--text-' + tone + ')">' +
      _esc(label) + '</span>';
  }

  // Schedule milestones
  var milestoneHtml = c.milestones.map(function(m, idx) {
    var dotStyle = m.active
      ? 'width:10px;height:10px;border-radius:50%;background:var(--text-info);margin:24px auto 0'
      : 'width:10px;height:10px;border-radius:50%;background:var(--bg-primary);border:1.5px solid var(--border-secondary);margin:24px auto 0';
    var nameColor = m.active ? 'var(--text-primary)' : 'var(--text-secondary)';
    var dateStr = m.date ? _fmtDate(m.date) : '\u2014';
    return '<div style="text-align:center">' +
      '<div style="' + dotStyle + '"></div>' +
      '<div style="font-size:11px;color:' + nameColor + ';margin-top:8px' + (m.active ? ';font-weight:500' : '') + '">' + _esc(m.name) + '</div>' +
      '<div style="font-size:10px;color:var(--text-tertiary)">' + _esc(dateStr) + '</div>' +
    '</div>';
  }).join('');

  // Documentation grid (split mandatory + additional)
  var docMandatory = c.documentation.filter(function(d) { return d.category === 'mandatory'; });
  var docAdditional = c.documentation.filter(function(d) { return d.category === 'additional'; });
  function docRowHtml(d) {
    var checkStyle = d.done
      ? 'width:14px;height:14px;border-radius:3px;background:var(--bg-success);color:var(--text-success);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:500'
      : 'width:14px;height:14px;border-radius:3px;border:1px solid var(--border-secondary);display:inline-block';
    var rowColor = d.done ? '' : 'color:var(--text-secondary);';
    return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0;' + rowColor + '">' +
      '<span style="' + checkStyle + '">' + (d.done ? '\u2713' : '') + '</span>' + _esc(d.label) +
    '</div>';
  }
  var docHtml = c.documentation.map(docRowHtml).join('');
  var docMandatoryDone   = docMandatory.filter(function(d) { return d.done; }).length;
  var docMandatoryTotal  = docMandatory.length;
  var docAdditionalDone  = docAdditional.filter(function(d) { return d.done; }).length;
  var docAdditionalTotal = docAdditional.length;

  // Decision checklist
  var checklistHtml = c.checklist.map(function(it) {
    var color, icon;
    if (it.pass === true) { color = 'var(--text-success)'; icon = '\u2713'; }
    else if (it.pass === false) { color = 'var(--text-warning)'; icon = '\u25B2'; }
    else { color = 'var(--text-tertiary)'; icon = ''; }
    return '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:0.5px solid var(--border-tertiary)">' +
      '<span>' + _esc(it.label) + '</span>' +
      '<span style="color:' + color + ';font-weight:500">' + icon + ' ' + _esc(it.value) + '</span>' +
    '</div>';
  }).join('');

  // Crew/days/MH summary line
  var scheduleSummary = [];
  if (c.crewSize > 0 || c.projectDays > 0 || c.totalMh > 0) {
    var parts = [];
    if (c.crewSize > 0) parts.push('Crew of ' + c.crewSize);
    if (c.projectDays > 0) parts.push(c.projectDays + ' days');
    if (c.totalMh > 0) parts.push(_fmtNum(c.totalMh, 0) + ' MH');
    scheduleSummary.push(parts.join(' \u00B7 '));
  }
  if (c.paymentTerms && c.paymentTerms !== '\u2014') {
    scheduleSummary.push('Payment: ' + c.paymentTerms +
      (c.paymentDays ? ' \u00B7 ' + c.paymentDays + ' days' : ''));
  }
  if (c.interconnectionMonths > 0) {
    scheduleSummary.push('Interconnection: ' + c.interconnectionMonths + ' months');
  }

  // Currency-toggleable values: mark elements with data-usd="<amount>"
  // The script multiplies by tc to get MXN.
  // We pass the numeric USD values (no commas) so the JS can reformat.
  function $$(usd) {
    if (usd == null || isNaN(usd)) return '<span class="cur-num" data-usd="">\u2014</span>';
    return '<span class="cur-num" data-usd="' + Number(usd).toFixed(2) + '">' + _fmtMoney(usd) + '</span>';
  }

  // Loan footer
  var loanFooter = '';
  if (c.loan.provider || c.loan.periodYears > 0) {
    var loanBits = [];
    if (c.loan.provider) loanBits.push(_esc(c.loan.provider));
    if (c.loan.periodYears > 0) loanBits.push(c.loan.periodYears + ' yr');
    if (c.loan.ratePct > 0) loanBits.push((c.loan.ratePct * 100).toFixed(2) + '%');
    var loanFooterShort = loanBits.join(' \u00B7 ');

    var loanDetailBits = [];
    if (c.loan.annualPmt > 0 && c.loan.periodYears > 0) {
      var totalPmt = c.loan.annualPmt * c.loan.periodYears;
      loanDetailBits.push((c.loan.periodYears * 12) + ' payments \u00D7 ' +
        _fmtMoney(c.loan.annualPmt / 12) + ' MXN');
      loanDetailBits.push('total ' + _fmtMoney(totalPmt) + ' MXN');
    }
    var loanDetailFooter = loanDetailBits.length
      ? '<div style="font-size:11px;color:var(--text-tertiary);margin-top:6px">Loan: ' + loanDetailBits.join(' \u00B7 ') + '</div>'
      : '';

    loanFooter = '<span style="font-size:11px;color:var(--text-tertiary);font-weight:400">' + loanFooterShort + '</span>';
  }

  // ---- The big template -----------------------------------------------------
  // (CSS comes first, then body, then script. Keep styles literal so the
  // file works standalone. CSS variables follow the uploaded template.)
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>ARGIA Overview \u2014 ' + _esc(c.projectName) + '</title>\n' +
'<style>\n' +
':root{\n' +
'  --bg-primary:#ffffff; --bg-secondary:#f5f4ef; --bg-tertiary:#faf9f5;\n' +
'  --bg-info:#E6F1FB; --bg-success:#EAF3DE; --bg-warning:#FAEEDA; --bg-danger:#FCEBEB;\n' +
'  --text-primary:#1f1e1c; --text-secondary:#5F5E5A; --text-tertiary:#888780;\n' +
'  --text-info:#0C447C; --text-success:#27500A; --text-warning:#854F0B; --text-danger:#791F1F;\n' +
'  --border-tertiary:rgba(0,0,0,0.10); --border-secondary:rgba(0,0,0,0.20);\n' +
'  --radius-md:8px; --radius-lg:12px;\n' +
'  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;\n' +
'}\n' +
'@media (prefers-color-scheme: dark){:root{\n' +
'  --bg-primary:#141412; --bg-secondary:#1e1d1b; --bg-tertiary:#262524;\n' +
'  --bg-info:#0C447C; --bg-success:#27500A; --bg-warning:#633806; --bg-danger:#501313;\n' +
'  --text-primary:#f4f3ee; --text-secondary:#B4B2A9; --text-tertiary:#888780;\n' +
'  --text-info:#B5D4F4; --text-success:#C0DD97; --text-warning:#FAC775; --text-danger:#F7C1C1;\n' +
'  --border-tertiary:rgba(255,255,255,0.12); --border-secondary:rgba(255,255,255,0.22);\n' +
'}}\n' +
'*{box-sizing:border-box}\n' +
'body{margin:0;padding:24px;background:var(--bg-tertiary);color:var(--text-primary);font-family:var(--font-sans);font-size:14px;line-height:1.5;max-width:1280px;margin:0 auto}\n' +
'.pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:3px 10px;border-radius:999px;font-weight:500;line-height:1.4}\n' +
'.dot{width:6px;height:6px;border-radius:50%;display:inline-block}\n' +
'.label-t{font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px}\n' +
'.metric{font-size:26px;font-weight:500;line-height:1.2}\n' +
'.sub{font-size:11px;color:var(--text-tertiary);margin-top:4px}\n' +
'.card{background:var(--bg-primary);border:0.5px solid var(--border-tertiary);border-radius:var(--radius-lg);padding:18px 20px}\n' +
'.section-title{font-size:13px;font-weight:500;margin-bottom:14px;color:var(--text-primary);display:flex;align-items:center;justify-content:space-between}\n' +
'.row{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;font-size:13px;gap:12px}\n' +
'.row-label{color:var(--text-secondary)}\n' +
'.row-value{font-variant-numeric:tabular-nums;text-align:right}\n' +
'.divider{height:0.5px;background:var(--border-tertiary);margin:8px 0}\n' +
'.tog{display:inline-flex;background:var(--bg-secondary);border-radius:var(--radius-md);padding:2px;font-size:12px}\n' +
'.tog button{background:transparent;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;color:var(--text-secondary);font-size:12px;font-family:inherit}\n' +
'.tog button.on{background:var(--bg-primary);color:var(--text-primary);font-weight:500}\n' +
'.g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:14px}\n' +
'.g4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px}\n' +
'.metric-card{background:var(--bg-secondary);border-radius:var(--radius-md);padding:14px}\n' +
'@media (max-width: 720px){.g2{grid-template-columns:1fr} .g4{grid-template-columns:repeat(2,1fr)}}\n' +
'.print-btn{position:fixed;top:16px;right:16px;z-index:1000;background:var(--bg-primary);border:0.5px solid var(--border-secondary);border-radius:var(--radius-md);padding:8px 14px;font-size:12px;cursor:pointer;color:var(--text-primary);font-family:inherit;font-weight:500;box-shadow:0 2px 6px rgba(0,0,0,0.08);display:inline-flex;align-items:center;gap:6px}\n' +
'.print-btn:hover{background:var(--bg-secondary)}\n' +
'@media print {\n' +
'  /* Force light theme regardless of OS preference (saves toner, looks pro) */\n' +
'  :root, body {\n' +
'    --bg-primary:#ffffff !important; --bg-secondary:#f5f4ef !important; --bg-tertiary:#ffffff !important;\n' +
'    --bg-info:#E6F1FB !important; --bg-success:#EAF3DE !important; --bg-warning:#FAEEDA !important; --bg-danger:#FCEBEB !important;\n' +
'    --text-primary:#1f1e1c !important; --text-secondary:#5F5E5A !important; --text-tertiary:#888780 !important;\n' +
'    --text-info:#0C447C !important; --text-success:#27500A !important; --text-warning:#854F0B !important; --text-danger:#791F1F !important;\n' +
'    --border-tertiary:rgba(0,0,0,0.10) !important; --border-secondary:rgba(0,0,0,0.20) !important;\n' +
'  }\n' +
'  body { background:#ffffff !important; padding:0 !important; max-width:none !important; }\n' +
'  /* Hide interactive controls -- they have no meaning on paper */\n' +
'  .print-btn, .tog { display:none !important; }\n' +
'  /* Avoid awkward page breaks mid-card */\n' +
'  .card, .metric-card { break-inside:avoid; page-break-inside:avoid; }\n' +
'  .g2, .g4 { page-break-inside:avoid; }\n' +
'  /* Force background colors to print (Chrome respects this; Safari needs OS setting) */\n' +
'  * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }\n' +
'  /* A bit tighter so a typical overview lands on 1-2 pages */\n' +
'  .card { padding:14px 16px; }\n' +
'  .g2, .g4 { margin-bottom:10px; gap:10px; }\n' +
'}\n' +
'@page { size: A4; margin: 12mm 10mm; }\n' +
'</style>\n</head>\n<body>\n' +

// ── Print button (fixed position, top-right) ──
'<button class="print-btn" onclick="window.print()" title="Save as PDF">\n' +
'  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>\n' +
'  Save as PDF\n' +
'</button>\n' +

// ── Header band ──
'<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;padding:4px 4px 18px;border-bottom:0.5px solid var(--border-tertiary);margin-bottom:18px">\n' +
'  <div style="flex:1;min-width:260px">\n' +
'    <div style="font-size:11px;color:var(--text-tertiary);letter-spacing:0.6px;text-transform:uppercase;margin-bottom:4px">' + _esc(c.projectNumber) + '</div>\n' +
'    <div style="font-size:22px;font-weight:500;line-height:1.2">' + _esc(c.projectName) + '</div>\n' +
'    <div style="font-size:13px;color:var(--text-secondary);margin-top:2px">' + _esc(c.location) + '</div>\n' +
'  </div>\n' +
'  <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">\n' +
'    ' + pillHtml(c.pills.type) + '\n' +
'    ' + pillHtml(c.pills.mdc) + '\n' +
'    ' + pillHtml(c.pills.cost) + '\n' +
'  </div>\n' +
'  <div class="tog" id="curtog">\n' +
'    <button class="on" data-cur="USD">USD</button>\n' +
'    <button data-cur="MXN">MXN</button>\n' +
'  </div>\n' +
'</div>\n' +

// ── KPI tiles ──
'<div class="g4">\n' +
'  <div class="metric-card">\n' +
'    <div class="label-t">System size</div>\n' +
'    <div class="metric">' + dcKwpStr + '</div>\n' +
'    <div class="sub">kWp DC \u00B7 ' + acKwStr + ' kW AC \u00B7 ratio ' + ratioStr + '</div>\n' +
'  </div>\n' +
'  <div class="metric-card">\n' +
'    <div class="label-t">Production</div>\n' +
'    <div class="metric">' + prodMwhStr + '</div>\n' +
'    <div class="sub">MWh / year \u00B7 yield ' + yieldStr + ' kWh/kWp</div>\n' +
'  </div>\n' +
'  <div class="metric-card">\n' +
'    <div class="label-t">Coverage</div>\n' +
'    <div class="metric">' + coveragePct + '</div>\n' +
'    <div class="sub">' + (c.consMwh > 0 ? 'of ' + consMwhStr + ' MWh/yr consumption' : '\u2014') + '</div>\n' +
'  </div>\n' +
'  <div class="metric-card">\n' +
'    <div class="label-t">Payback</div>\n' +
'    <div class="metric"' + (c.payback != null && c.payback <= 6 ? ' style="color:var(--text-success)"' : '') + '>' + paybackStr + '</div>\n' +
'    <div class="sub">' + (c.clientReq ? _esc('client target: ' + c.clientReq) : '\u2014') + '</div>\n' +
'  </div>\n' +
'</div>\n' +

// ── Financials + Cost breakdown ──
'<div class="g2">\n' +
'  <div class="card">\n' +
'    <div class="section-title">\n' +
'      <span>Financials \u2014 CAPEX</span>\n' +
'      ' + loanFooter + '\n' +
'    </div>\n' +
'    <div class="row"><span class="row-label">Selling price</span><span class="row-value">' + $$(c.sellingTotalUsd) + ' <span class="cur-label">USD</span></span></div>\n' +
'    <div class="row"><span class="row-label">Cost</span><span class="row-value">' + $$(c.totalCostUsd) + ' <span class="cur-label">USD</span></span></div>\n' +
'    <div class="row"><span class="row-label">Gross profit</span><span class="row-value" style="color:var(--text-success)">' + $$(c.grossProfitUsd) + ' <span class="cur-label">USD</span> \u00B7 ' + (c.margin > 0 ? (c.margin * 100).toFixed(0) + '%' : '\u2014') + '</span></div>\n' +
'    <div class="divider"></div>\n' +
'    <div class="row"><span class="row-label">NPV</span><span class="row-value">' + (c.npvMxn != null ? _fmtMoney(c.npvMxn) + ' MXN' : '\u2014') + '</span></div>\n' +
'    <div class="row"><span class="row-label">IRR</span><span class="row-value"' + (c.irr != null && c.irr > 0 ? ' style="color:var(--text-success)"' : '') + '>' + (c.irr != null ? (c.irr * 100).toFixed(1) + '%' : '\u2014') + '</span></div>\n' +
'    <div class="row"><span class="row-label">DSCR year 1</span><span class="row-value"' + (c.dscr1 != null && c.dscr1 >= 1.20 ? ' style="color:var(--text-success)"' : '') + '>' + (c.dscr1 != null ? c.dscr1.toFixed(2) : '\u2014') + '</span></div>\n' +
'    <div class="row"><span class="row-label">Y01 annual savings</span><span class="row-value">' + (c.annualSavings > 0 ? _fmtMoney(c.annualSavings) + ' MXN' : '\u2014') + '</span></div>\n' +
'    <div class="row"><span class="row-label">10 yr cumulative CF</span><span class="row-value">' + (c.cum10yrCfMxn ? _fmtMoney(c.cum10yrCfMxn) + ' MXN' : '\u2014') + '</span></div>\n' +
'    <div class="row"><span class="row-label">CO\u2082 avoided / yr</span><span class="row-value">' + (c.co2PerYearTons ? _fmtNum(c.co2PerYearTons, 0) + ' tons' : '\u2014') + '</span></div>\n' +
'  </div>\n' +
'  <div class="card">\n' +
'    <div class="section-title">\n' +
'      <span>Cost breakdown</span>\n' +
'      <span style="font-size:11px;color:var(--text-tertiary);font-weight:400">' + (c.pills.costPassTotal > 0 ? c.pills.costPassCount + ' of ' + c.pills.costPassTotal + ' PASS' : '') + '</span>\n' +
'    </div>\n' +
'    <div style="display:grid;grid-template-columns:150px minmax(0,1fr);gap:14px;align-items:center">\n' +
'      <div style="position:relative;width:150px;height:150px"><canvas id="costChart" role="img" aria-label="Donut chart of cost breakdown by category"></canvas></div>\n' +
'      <div style="font-size:12px">' + legendHtml + '</div>\n' +
'    </div>\n' +
'    <div class="divider" style="margin:14px 0 8px"></div>\n' +
'    <div style="font-size:11px;color:var(--text-secondary);display:flex;justify-content:space-between">\n' +
'      <span>Total cost</span>\n' +
'      <span>' + $$(c.totalCostUsd) + ' <span class="cur-label">USD</span> \u00B7 ' + _fmtNum(c.costPerKwpUsd, 0) + ' USD/kWp</span>\n' +
'    </div>\n' +
'  </div>\n' +
'</div>\n' +

// ── Design + MDC compliance ──
'<div class="g2">\n' +
'  <div class="card">\n' +
'    <div class="section-title">Design</div>\n' +
'    <div class="row"><span class="row-label">Panel</span><span class="row-value">' + _esc(c.panelLabel) + ' \u00B7 ' + modulesStr + ' pcs</span></div>\n' +
'    <div class="row"><span class="row-label">Inverters</span><span class="row-value">' + _esc(c.invSummary || '\u2014') + '</span></div>\n' +
'    <div class="row"><span class="row-label">Strings / string size</span><span class="row-value">' + stringsStr + ' \u00D7 ' + c.modsPerString + ' modules</span></div>\n' +
'    <div class="row"><span class="row-label">DC/AC ratio</span><span class="row-value">' + ratioStr + ' ' + (c.dcAcRatio && c.dcAcRatio <= 1.5 ? '<span class="pill" style="background:var(--bg-success);color:var(--text-success);margin-left:6px">OK</span>' : '<span class="pill" style="background:var(--bg-warning);color:var(--text-warning);margin-left:6px">REVIEW</span>') + '</span></div>\n' +
'    <div class="row"><span class="row-label">Voc cold (worst)</span><span class="row-value">' + _fmtNum(c.vocCold, 1) + ' V &lt; ' + _fmtNum(c.vocColdLimit, 0) + ' V ' + (c.vocColdPass ? '<span class="pill" style="background:var(--bg-success);color:var(--text-success);margin-left:6px">OK</span>' : '<span class="pill" style="background:var(--bg-danger);color:var(--text-danger);margin-left:6px">FAIL</span>') + '</span></div>\n' +
'    <div class="row"><span class="row-label">Transformer</span><span class="row-value">' + _fmtNum(c.transformer, 0) + ' kVA' + (c.transformerBase > 0 ? ' (' + _fmtNum(c.transformerBase, 0) + ' kVA base +20%)' : '') + '</span></div>\n' +
'    <div class="row"><span class="row-label">Array / roof area</span><span class="row-value">' + _fmtNum(c.arrayArea, 0) + ' / ' + _fmtNum(c.availableSpace, 0) + ' m\u00B2</span></div>\n' +
'    <div class="row"><span class="row-label">Site temp range</span><span class="row-value">' + (c.minTemp != null ? c.minTemp + ' \u00B0C' : '\u2014') + ' to ' + (c.maxTemp != null ? c.maxTemp + ' \u00B0C' : '\u2014') + (c.roofAdder > 0 ? ' \u00B7 azotea +' + c.roofAdder + ' \u00B0C' : '') + '</span></div>\n' +
'  </div>\n' +
'  <div class="card">\n' +
'    <div class="section-title">\n' +
'      <span>MDC compliance</span>\n' +
'      ' + (c.compliance.acPerInverter.pass ? '' : '<span style="font-size:11px;color:var(--text-warning);font-weight:400">1 observation</span>') + '\n' +
'    </div>\n' +
'    <div class="row"><span class="row-label">DC section</span><span class="row-value">' + passPill(c.compliance.dcSection.pass) + '</span></div>\n' +
'    <div class="row"><span class="row-label">String voltage window</span><span class="row-value">' + passPill(c.compliance.voltageWindow.pass, c.compliance.voltageWindow.note) + '</span></div>\n' +
'    <div class="row"><span class="row-label">DC input limit per inverter</span><span class="row-value">' + passPill(c.compliance.dcInputLimit.pass) + '</span></div>\n' +
'    <div class="row"><span class="row-label">MPPT current (STR-03 / DC-09)</span><span class="row-value">' + passPill(c.compliance.mpptCurrent.pass) + '</span></div>\n' +
'    <div class="row"><span class="row-label">AC per inverter</span><span class="row-value">' + passPill(c.compliance.acPerInverter.pass, c.compliance.acPerInverter.pass ? 'PASS' : ('REVIEW ' + c.compliance.acPerInverter.note)) + '</span></div>\n' +
'    <div class="row"><span class="row-label">Main feeder / breaker</span><span class="row-value">' + passPill(c.compliance.feeder.pass) + '</span></div>\n' +
'    <div class="row"><span class="row-label">Voltage drop DC / AC / feeder</span><span class="row-value">' + c.compliance.vdrop.dc.toFixed(1) + '% / ' + c.compliance.vdrop.ac.toFixed(1) + '% / ' + c.compliance.vdrop.feeder.toFixed(1) + '%</span></div>\n' +
'    <div class="row"><span class="row-label">Rapid shutdown (SAFE-01)</span><span class="row-value">' + (c.compliance.rsd.required ? c.compliance.rsd.units + ' units \u00B7 NOM 690.12' : 'N/A') + '</span></div>\n' +
'  </div>\n' +
'</div>\n' +

// ── Schedule ──
'<div class="card" style="margin-bottom:14px">\n' +
'  <div class="section-title">Schedule</div>\n' +
'  <div style="position:relative;height:62px;margin:8px 4px 0">\n' +
'    <div style="position:absolute;top:28px;left:0;right:0;height:2px;background:var(--border-tertiary)"></div>\n' +
'    <div style="display:flex;justify-content:space-between;position:relative">' + milestoneHtml + '</div>\n' +
'  </div>\n' +
(scheduleSummary.length > 0
  ? '  <div style="display:flex;gap:16px;font-size:11px;color:var(--text-secondary);margin-top:14px;border-top:0.5px solid var(--border-tertiary);padding-top:10px;flex-wrap:wrap">' +
    scheduleSummary.map(function(s, i) {
      return (i > 0 ? '<span style="color:var(--text-tertiary)">\u00B7</span>' : '') + '<span>' + _esc(s) + '</span>';
    }).join('') + '  </div>\n'
  : '') +
'</div>\n' +

// ── Documentation + Team ──
'<div class="g2">\n' +
'  <div class="card">\n' +
'    <div class="section-title">Documentation</div>\n' +
'    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;font-size:13px">' + docHtml + '</div>\n' +
'    <div class="divider" style="margin:10px 0"></div>\n' +
'    <div style="font-size:11px;color:var(--text-tertiary)">Mandatory ' + docMandatoryDone + '/' + docMandatoryTotal + ' \u00B7 Additional ' + docAdditionalDone + '/' + docAdditionalTotal + '</div>\n' +
'  </div>\n' +
'  <div class="card">\n' +
'    <div class="section-title">Team &amp; approvals</div>\n' +
'    <div class="row"><span class="row-label">Business manager</span><span class="row-value">' + _esc(c.team.bizManager) + '</span></div>\n' +
'    <div class="row"><span class="row-label">Designer</span><span class="row-value">' + _esc(c.team.designer) + '</span></div>\n' +
'    <div class="row"><span class="row-label">Project manager</span><span class="row-value">' + _esc(c.team.projectManager) + '</span></div>\n' +
'    <div class="row"><span class="row-label">Contact (client)</span><span class="row-value">' + _esc(c.team.contact) + '</span></div>\n' +
'    <div class="divider"></div>\n' +
'    <div class="row"><span class="row-label">Submitted by</span><span class="row-value">' + _esc(c.team.submittedBy) + '</span></div>\n' +
'    <div class="row"><span class="row-label">Received by</span><span class="row-value">' + _esc(c.team.receivedBy) + '</span></div>\n' +
'    <div class="row"><span class="row-label">Budget approval</span><span class="row-value">' + _esc(c.team.approvedBy) + '</span></div>\n' +
'  </div>\n' +
'</div>\n' +

// ── Decision checklist ──
'<div class="card">\n' +
'  <div class="section-title">Decision checklist</div>\n' +
'  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 20px;font-size:13px">' + checklistHtml + '</div>\n' +
'</div>\n' +

// ── Chart.js + currency-toggle script ──
'<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js"></script>\n' +
'<script>\n' +
'(function(){\n' +
'  // Donut chart\n' +
'  var ctx = document.getElementById("costChart");\n' +
'  if (ctx && window.Chart) {\n' +
'    new Chart(ctx, {\n' +
'      type: "doughnut",\n' +
'      data: {\n' +
'        labels: [' + chartLabels + '],\n' +
'        datasets: [{\n' +
'          data: [' + chartData + '],\n' +
'          backgroundColor: [' + chartColors + '],\n' +
'          borderWidth: 0\n' +
'        }]\n' +
'      },\n' +
'      options: {\n' +
'        responsive: true,\n' +
'        maintainAspectRatio: false,\n' +
'        cutout: "65%",\n' +
'        plugins: {\n' +
'          legend: { display: false },\n' +
'          tooltip: { callbacks: { label: function(c){ return c.label + ": " + c.raw + "%"; } } }\n' +
'        }\n' +
'      }\n' +
'    });\n' +
'  }\n' +

'  // Currency toggle\n' +
'  var TC = ' + Number(c.tc).toFixed(4) + ';\n' +
'  function fmt(n){ if (n==null||isNaN(n)) return "\u2014"; return Math.round(n).toLocaleString("en-US"); }\n' +
'  document.querySelectorAll("#curtog button").forEach(function(b){\n' +
'    b.addEventListener("click", function(){\n' +
'      document.querySelectorAll("#curtog button").forEach(function(x){ x.classList.remove("on"); });\n' +
'      b.classList.add("on");\n' +
'      var cur = b.dataset.cur;\n' +
'      document.querySelectorAll(".cur-num").forEach(function(el){\n' +
'        var usd = parseFloat(el.dataset.usd);\n' +
'        if (isNaN(usd)) { el.textContent = "\u2014"; return; }\n' +
'        el.textContent = fmt(cur === "USD" ? usd : usd * TC);\n' +
'      });\n' +
'      document.querySelectorAll(".cur-label").forEach(function(el){ el.textContent = cur; });\n' +
'    });\n' +
'  });\n' +
'})();\n' +
'</script>\n' +
'</body>\n</html>\n';
}


// ---------------------------------------------------------------------------
// FILE STORAGE
// Saves the rendered HTML as a Drive file in the offer folder defined in
// 00_MASTERLINK!H2. Falls back to the spreadsheet's parent folder.
// Returns the saved file (DriveApp.File) or null on failure.
// ---------------------------------------------------------------------------
function _saveOverviewHtml(html, fileName, ss) {
  // Find the destination folder
  var folder = null;
  try {
    var ml = ss.getSheetByName('00_MASTER_LINK') || ss.getSheetByName('00_MASTERLINK');
    if (ml) {
      var fid = String(ml.getRange(2, 8).getValue()).trim();
      if (fid) folder = DriveApp.getFolderById(fid);
    }
  } catch (e_) { /* fall through */ }

  if (!folder) {
    var ssFile = DriveApp.getFileById(ss.getId());
    var parents = ssFile.getParents();
    folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  }

  // Trash any existing file with the same name
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);

  // Create new file. text/html mime type so it opens in browser when clicked.
  var blob = Utilities.newBlob(html, 'text/html', fileName);
  return folder.createFile(blob);
}
