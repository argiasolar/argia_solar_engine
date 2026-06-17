// =============================================================================
// ARGIA ENGINE -- writers_v2/WriteApiOutputV2.js
// -----------------------------------------------------------------------------
// T2 (v4.35.0): API_OUTPUT -- the single, flat read-interface for the offer /
// presentation. ONE tab holding every canonical engine figure the offer needs,
// written as VALUES from the owning module (no recomputation, nothing that can
// #REF!). Downstream consumers (SLIDE_DATA, PDF/offer feed) read API_OUTPUT;
// API_OUTPUT reads the owners.
//
// OWNERS (read, never recompute):
//   identity/size  MDC_v2          C7/C8 name/client, C9 module, C11 qty,
//                                  C12 inverters, C13 mods/string, C15 kWp DC,
//                                  C16 kWac AC
//   generation     CFE_OUTPUT_v2   row 15 (kWh solares) -> MWh  (_cfinReadEnergyKwh)
//   mode           INPUT_CFE!C41   interconnection mode (MEDICION_NETA / ...)
//   CFE (T1)       BESS_SIMULATION D12 sin-PV, D14 con-PV, D18 con-BESS;
//                                  pv-only savings = D12 - D14
//   CAPEX          CLIENT_FIN capex.totalMxn (COST) + PROJECT_CARD_v2!I40 (SELL)
//   financials     CLIENT_FIN fin.* (cost basis)
//   status         placeholder until T4 builds the PROJECT_STATUS engine
//
// TWO CAPEX BASES, ON PURPOSE: capex_cost_mxn (model/cost) and offer_price_mxn
// (what the customer pays / sell price) are SEPARATE keys. They differ by the
// commercial margin; conflating them is exactly the silent fork this tab kills.
// The cost-basis financials (payback/NPV/IRR) are tagged "[cost basis]" in the
// source column -- the customer-pays-basis restatement is a deferred decision.
//
// ARCHITECTURE (Node-self-test friendly):
//   API_OUTPUT_FIELDS                    field spec (key, units, src, from)
//   buildApiOutputRows(sources)          PURE -> [{key,value,units,source}]
//   writeApiOutputV2(ss, opts)           LIVE: resolve owners -> build -> render
//   repairSlideDataFromApiOutput(ss)     LIVE: safe SLIDE_DATA repoints (T2)
// =============================================================================


// -----------------------------------------------------------------------------
// FIELD SPEC -- the canonical offer field list. Order = render order.
//   key    : API_OUTPUT row key (col A)
//   units  : units label (col C)
//   src    : human-readable owner reference (col D) -- provenance, not a formula
//   from   : property name on the resolved `sources` object the builder reads
// -----------------------------------------------------------------------------
var API_OUTPUT_FIELDS = [
  { key: 'project_name',                 units: '',        src: 'MDC_v2!C7 (INPUT_PROJECT!D8)',          from: 'projectName' },
  { key: 'client_name',                  units: '',        src: 'MDC_v2!C8 (INPUT_PROJECT!D9)',          from: 'clientName' },

  { key: 'system_kwp_dc',                units: 'kWp',     src: 'MDC_v2!C15',                            from: 'systemKwpDc' },
  { key: 'system_kwac',                  units: 'kWac',    src: 'MDC_v2!C16',                            from: 'systemKwac' },
  { key: 'module_model',                 units: '',        src: 'MDC_v2!C9',                             from: 'moduleModel' },
  { key: 'module_qty',                   units: 'pcs',     src: 'MDC_v2!C11',                            from: 'moduleQty' },
  { key: 'modules_per_string',           units: 'pcs',     src: 'MDC_v2!C13',                            from: 'modulesPerString' },
  { key: 'inverter_qty',                 units: 'pcs',     src: 'MDC_v2!C12',                            from: 'inverterQty' },

  { key: 'annual_generation_mwh',        units: 'MWh',     src: 'CFE_OUTPUT_v2 row15 (solar kWh) / 1000', from: 'annualGenerationMwh' },
  { key: 'interconnection_mode',         units: '',        src: 'INPUT_CFE!C41',                          from: 'interconnectionMode' },

  { key: 'cfe_bill_sin_pv_mxn',          units: 'MXN',     src: 'BESS_SIMULATION!D12 (T1 canonical)',     from: 'cfeBillSinPvMxn' },
  { key: 'cfe_bill_con_pv_mxn',          units: 'MXN',     src: 'BESS_SIMULATION!D14',                    from: 'cfeBillConPvMxn' },
  { key: 'cfe_bill_con_bess_mxn',        units: 'MXN',     src: 'BESS_SIMULATION!D18',                    from: 'cfeBillConBessMxn' },

  { key: 'pv_only_savings_year1_mxn',    units: 'MXN',     src: 'BESS_SIMULATION D12-D14 (PV only)',      from: 'pvOnlySavingsYear1Mxn' },
  { key: 'full_system_savings_year1_mxn',units: 'MXN',     src: 'CLIENT_FIN fin.headline.year1SavingsMxn (PV+BESS)', from: 'fullSystemSavingsYear1Mxn' },
  { key: 'savings_term_mxn',             units: 'MXN',     src: 'CLIENT_FIN fin.headline.termTotalNetMxn', from: 'savingsTermMxn' },

  { key: 'capex_cost_mxn',               units: 'MXN',     src: 'CLIENT_FIN capex.totalMxn (COST basis)', from: 'capexCostMxn' },
  { key: 'offer_price_mxn',              units: 'MXN',     src: 'PROJECT_CARD_v2!I40 (SELL price)',       from: 'offerPriceMxn' },

  { key: 'payback_years',                units: 'years',   src: 'CLIENT_FIN fin.cash.simplePaybackYears [cost basis]', from: 'paybackYears' },
  { key: 'npv_mxn',                      units: 'MXN',     src: 'CLIENT_FIN fin.cash.npvMxn [cost basis]', from: 'npvMxn' },
  { key: 'irr',                          units: 'ratio',   src: 'CLIENT_FIN fin.cash.irr [cost basis]',    from: 'irr' },
  { key: 'roi_pct_term',                 units: 'ratio',   src: 'CLIENT_FIN fin.cash.roiPctOverTerm [cost basis]', from: 'roiPctTerm' },
  { key: 'lcoe_mxn_per_kwh',             units: 'MXN/kWh', src: 'CLIENT_FIN fin.lcoe.mxnPerKwh',          from: 'lcoeMxnPerKwh' },

  { key: 'co2_tons_year1',               units: 'tCO2e',   src: 'CLIENT_FIN fin.co2.year1Tons',           from: 'co2TonsYear1' },
  { key: 'co2_tons_term',                units: 'tCO2e',   src: 'CLIENT_FIN fin.co2.termTons',            from: 'co2TonsTerm' },

  { key: 'project_status',               units: '',        src: 'placeholder until T4 (PROJECT_STATUS engine)', from: 'projectStatus' }
];

var API_OUTPUT_SHEET = 'API_OUTPUT';


// -----------------------------------------------------------------------------
// PURE CORE
// -----------------------------------------------------------------------------

/**
 * Build the API_OUTPUT rows from a resolved sources object. PURE.
 * A missing source value becomes null (rendered blank) rather than throwing,
 * so a partial run (e.g. financials not yet computed) still produces a complete
 * key set -- the unit test relies on the key set being invariant.
 *
 * @param {Object} sources  keyed by API_OUTPUT_FIELDS[].from
 * @return {Array<Object>} [{ key, value, units, source }]
 */
function buildApiOutputRows(sources) {
  sources = sources || {};
  return API_OUTPUT_FIELDS.map(function (f) {
    var v = sources[f.from];
    return {
      key:    f.key,
      value:  (v === undefined ? null : v),
      units:  f.units,
      source: f.src
    };
  });
}


// -----------------------------------------------------------------------------
// LIVE RESOLVERS (Apps Script) -- read each owner, guard misses with warnings.
// -----------------------------------------------------------------------------

/** Numeric cell read, NaN-safe. */
function _apiNum(ss, sheetName, a1, warnings, label) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) { if (warnings) warnings.push('API_OUTPUT: ' + sheetName + ' missing -- ' + label + ' blank'); return null; }
  var v = Number(sh.getRange(a1).getValue());
  return isFinite(v) ? v : null;
}

/** String cell read. */
function _apiStr(ss, sheetName, a1, warnings, label) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) { if (warnings) warnings.push('API_OUTPUT: ' + sheetName + ' missing -- ' + label + ' blank'); return null; }
  var v = sh.getRange(a1).getValue();
  return (v === '' || v === null) ? null : String(v).trim();
}

/**
 * Resolve every field's value from its owner. Financials come from the passed
 * runClientFinancials result (opts.fin / opts.capex) so this never re-runs the
 * financials engine. CFE/size/generation/mode/offer-price are read from the
 * rendered owner sheets (present after an engine + CFE + ProjectCard run).
 */
function _apiResolveSources(ss, opts, warnings) {
  opts = opts || {};
  var fin   = opts.fin   || null;
  var capex = opts.capex || null;

  var sinPv  = _apiNum(ss, 'BESS_SIMULATION', 'D12', warnings, 'cfe_bill_sin_pv_mxn');
  var conPv  = _apiNum(ss, 'BESS_SIMULATION', 'D14', warnings, 'cfe_bill_con_pv_mxn');
  var conBes = _apiNum(ss, 'BESS_SIMULATION', 'D18', warnings, 'cfe_bill_con_bess_mxn');
  var pvOnly = (sinPv != null && conPv != null) ? (sinPv - conPv) : null;

  // Annual solar generation (MWh) -- same owner CLIENT_FIN uses for LCOE/CO2.
  var genKwh = (typeof _cfinReadEnergyKwh === 'function') ? _cfinReadEnergyKwh(ss) : null;
  var genMwh = (genKwh != null && isFinite(genKwh) && genKwh > 0) ? genKwh / 1000 : null;
  if (genMwh == null) warnings.push('API_OUTPUT: annual generation unavailable (CFE_OUTPUT row15) -- blank');

  // Offer price (sell): PROJECT_CARD_v2 TOTAL row, MXN_SALES col. Falls back to
  // the engine-known PC_ROW/PC_COL constants when present, else fixed I40.
  var pcRow = (typeof PC_ROW !== 'undefined' && PC_ROW.COST_TOTAL) ? PC_ROW.COST_TOTAL : 40;
  var pcCol = (typeof PC_COL !== 'undefined' && PC_COL.MXN_SALES)  ? PC_COL.MXN_SALES  : 9;
  var offerPrice = null;
  var pc = ss.getSheetByName('PROJECT_CARD_v2');
  if (pc) {
    var ov = Number(pc.getRange(pcRow, pcCol).getValue());
    offerPrice = isFinite(ov) && ov > 0 ? ov : null;
  }
  if (offerPrice == null) warnings.push('API_OUTPUT: offer_price (PROJECT_CARD_v2 sell TOTAL) unavailable -- blank');

  return {
    projectName:        _apiStr(ss, 'MDC_v2', 'C7', warnings, 'project_name'),
    clientName:         _apiStr(ss, 'MDC_v2', 'C8', warnings, 'client_name'),

    systemKwpDc:        _apiNum(ss, 'MDC_v2', 'C15', warnings, 'system_kwp_dc'),
    systemKwac:         _apiNum(ss, 'MDC_v2', 'C16', warnings, 'system_kwac'),
    moduleModel:        _apiStr(ss, 'MDC_v2', 'C9', warnings, 'module_model'),
    moduleQty:          _apiNum(ss, 'MDC_v2', 'C11', warnings, 'module_qty'),
    modulesPerString:   _apiNum(ss, 'MDC_v2', 'C13', warnings, 'modules_per_string'),
    inverterQty:        _apiNum(ss, 'MDC_v2', 'C12', warnings, 'inverter_qty'),

    annualGenerationMwh: genMwh,
    interconnectionMode: _apiStr(ss, 'INPUT_CFE', 'C41', warnings, 'interconnection_mode'),

    cfeBillSinPvMxn:    sinPv,
    cfeBillConPvMxn:    conPv,
    cfeBillConBessMxn:  conBes,

    pvOnlySavingsYear1Mxn:     pvOnly,
    fullSystemSavingsYear1Mxn: fin ? num_(fin.headline && fin.headline.year1SavingsMxn) : null,
    savingsTermMxn:            fin ? num_(fin.headline && fin.headline.termTotalNetMxn) : null,

    capexCostMxn:       capex ? num_(capex.totalMxn) : null,
    offerPriceMxn:      offerPrice,

    paybackYears:       fin ? num_(fin.cash && fin.cash.simplePaybackYears) : null,
    npvMxn:             fin ? num_(fin.cash && fin.cash.npvMxn) : null,
    irr:                fin ? num_(fin.cash && fin.cash.irr) : null,
    roiPctTerm:         fin ? num_(fin.cash && fin.cash.roiPctOverTerm) : null,
    lcoeMxnPerKwh:      fin ? num_(fin.lcoe && fin.lcoe.mxnPerKwh) : null,

    co2TonsYear1:       fin ? num_(fin.co2 && fin.co2.year1Tons) : null,
    co2TonsTerm:        fin ? num_(fin.co2 && fin.co2.termTons) : null,

    projectStatus:      'PENDING_T4'
  };
}

/** Coerce to number or null (keeps null distinct from 0). */
function num_(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}


// -----------------------------------------------------------------------------
// LIVE WRITER
// -----------------------------------------------------------------------------

/**
 * Render the API_OUTPUT tab from canonical owners. Idempotent: clears and
 * rewrites the value block each run, preserving the tab.
 *
 * @param {Spreadsheet} ss
 * @param {Object} opts  { fin, capex } from runClientFinancials (pass-through to
 *                       avoid recomputation). When absent, financial fields are
 *                       left blank (the tab still renders the full key set).
 * @return {Object} { ok, rows, warnings }
 */
function writeApiOutputV2(ss, opts) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var warnings = [];

  var sources = _apiResolveSources(ss, opts, warnings);
  var rows = buildApiOutputRows(sources);

  var sh = ss.getSheetByName(API_OUTPUT_SHEET);
  if (!sh) sh = ss.insertSheet(API_OUTPUT_SHEET);

  // Clear prior content (value block only) then rewrite. Header at row 1.
  sh.clear();
  var out = [['key', 'value', 'units', 'source']];
  rows.forEach(function (r) { out.push([r.key, (r.value === null ? '' : r.value), r.units, r.source]); });
  sh.getRange(1, 1, out.length, 4).setValues(out);

  // Light formatting: bold header, key column, sensible widths.
  sh.getRange(1, 1, 1, 4).setFontWeight('bold');
  sh.getRange(2, 1, rows.length, 1).setFontWeight('bold');
  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 180);
  sh.setColumnWidth(3, 90);
  sh.setColumnWidth(4, 360);
  sh.getRange('A1').setNote(
    'ARGIA API_OUTPUT (T2): the single offer/presentation read-interface. Every '
    + 'value is written by writeApiOutputV2 from its canonical owner (see source '
    + 'column) -- read THIS tab, not the underlying sheets. capex_cost_mxn (cost) '
    + 'and offer_price_mxn (sell) are intentionally distinct.');

  SpreadsheetApp.flush();

  if (warnings.length && typeof Logger !== 'undefined' && Logger.log) {
    Logger.log('writeApiOutputV2 warnings: ' + warnings.join(' | '));
  }
  return { ok: true, rows: rows, warnings: warnings };
}


// -----------------------------------------------------------------------------
// SLIDE_DATA SAFE REPOINTS (T2, option B -- safe subset only)
// -----------------------------------------------------------------------------
// Repoint SLIDE_DATA figure keys to read API_OUTPUT by key (INDEX/MATCH, robust
// to row reordering). ONLY the no-change-of-meaning keys are repointed here:
//   - annual_energy_cost -> cfe_bill_sin_pv_mxn  (already = D12; same value)
//   - system_kwp         -> system_kwp_dc        (currently #REF!; strict fix)
// The 5 basis-conflicted figures (savings / capex / payback / irr / co2) are
// DEFERRED to the basis-decision task -- repointing them would silently restate
// the customer offer (sell-vs-cost, PV-only-vs-full-system). See CHANGELOG.
// -----------------------------------------------------------------------------

var _API_SLIDE_TARGETS = [
  {
    id: 'SLIDE_DATA[annual_energy_cost]', labelText: 'annual_energy_cost', apiKey: 'cfe_bill_sin_pv_mxn',
    // current source is the T1 repoint (=BESS_SIMULATION!D12) or a #REF! stub
    allowedCurrentContains: ['BESS_SIMULATION!D12', '#REF!', 'INPUT_CFE!C37']
  },
  {
    id: 'SLIDE_DATA[system_kwp]', labelText: 'system_kwp', apiKey: 'system_kwp_dc',
    allowedCurrentContains: ['#REF!']
  }
];

function _apiSlideFormula(apiKey) {
  return "=INDEX('" + API_OUTPUT_SHEET + "'!B:B,MATCH(\"" + apiKey
       + "\",'" + API_OUTPUT_SHEET + "'!A:A,0))";
}

/**
 * Repoint the safe SLIDE_DATA figure keys at API_OUTPUT. Label-anchored (col A
 * key -> col B value), idempotent, and guarded: only overwrites a formula that
 * matches the known prior source (or a #REF! stub). Anything unexpected is left
 * untouched and reported -- never clobbers a hand-edited cell.
 *
 * @return {Object} { ok, results:[{id,status,msg}] }
 */
function repairSlideDataFromApiOutput(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('SLIDE_DATA');
  if (!sh) return { ok: false, results: [{ id: 'SLIDE_DATA', status: 'skipped', msg: 'sheet not found' }] };

  var lastRow = sh.getLastRow();
  var labels = lastRow ? sh.getRange(1, 1, lastRow, 1).getValues() : [];
  var results = [];

  _API_SLIDE_TARGETS.forEach(function (spec) {
    var out = { id: spec.id, status: 'skipped', msg: '' };
    var row = -1;
    for (var r = 0; r < labels.length; r++) {
      if (String(labels[r][0]).trim() === spec.labelText) { row = r + 1; break; }
    }
    if (row === -1) { out.msg = 'key "' + spec.labelText + '" not found'; results.push(out); return; }

    var cell = sh.getRange(row, 2);                 // col B = value
    var newFormula = _apiSlideFormula(spec.apiKey);
    var cur = String(cell.getFormula() || '');

    if (cur === newFormula) { out.status = 'already-ok'; out.msg = '-> ' + spec.apiKey; results.push(out); return; }

    var ok = false;
    for (var i = 0; i < spec.allowedCurrentContains.length; i++) {
      if (cur === '' || cur.indexOf(spec.allowedCurrentContains[i]) !== -1) { ok = true; break; }
    }
    if (!ok) {
      out.msg = 'unexpected formula "' + cur + '" -- left untouched';
      results.push(out); return;
    }

    cell.setFormula(newFormula);
    out.status = (String(cell.getFormula() || '') === newFormula) ? 'changed' : 'verify';
    out.msg = 'row ' + row + ' col B -> ' + spec.apiKey;
    results.push(out);
  });

  SpreadsheetApp.flush();
  return { ok: true, results: results };
}
