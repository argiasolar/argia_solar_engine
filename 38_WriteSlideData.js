// =============================================================================
// 38_WriteSlideData.js  —  SLIDE_DATA rebuild (chunk 1: API_OUTPUT projection)
// -----------------------------------------------------------------------------
// The legacy SLIDE_DATA tab is the external presentation tool's contract (flat
// key -> value, read by key in col A / value in col B) but it is broken: many
// figure cells are #REF! or stale (e.g. annual_mwh 4475 vs real ~1321), with
// only 5 keys safe-repointed at API_OUTPUT in T2.
//
// This rebuilds SLIDE_DATA as a clean PROJECTION of API_OUTPUT (the canonical
// T2 offer interface): every covered figure key reads API_OUTPUT by key via a
// robust INDEX/MATCH (label-anchored, survives row drift), so the offer numbers
// can never drift from API_OUTPUT again. Config keys (salesperson, dates, ...)
// and not-yet-exposed figures (panel_w, prod_*, ...) are written as CLEAN BLANKS
// with a "pendiente" note -- never #REF! -- and are filled by later chunks
// (99_SETUP config; API_OUTPUT figure extensions).
//
// The four ConsistencyGuard-checked keys (annual_energy_cost, annual_savings,
// capex_total, system_kwp) keep their exact T2 API mappings, so the rebuild
// changes no guarded value.
// =============================================================================

var SLIDE_DATA_SHEET_V2 = 'SLIDE_DATA';
var SLIDE_DATA_API_SHEET = 'API_OUTPUT';

// The contract, in render order. type: 'api' -> INDEX/MATCH on API_OUTPUT[apiKey];
// 'config' -> 99_SETUP (chunk 2); 'derived' -> API_OUTPUT extension (chunk 2).
var SLIDE_DATA_PLAN_V2 = [
  { key: 'client_name',        type: 'api',     apiKey: 'client_name' },
  { key: 'client_location',    type: 'config' },
  { key: 'project_type',       type: 'config' },
  { key: 'tariff_type',        type: 'derived' },
  { key: 'offer_date',         type: 'config' },
  { key: 'offer_valid_until',  type: 'config' },
  { key: 'salesperson_name',   type: 'config' },
  { key: 'salesperson_title',  type: 'config' },
  { key: 'salesperson_email',  type: 'config' },
  { key: 'salesperson_phone',  type: 'config' },
  { key: 'system_kwp',         type: 'api',     apiKey: 'system_kwp_dc',          guard: true },
  { key: 'panel_model',        type: 'api',     apiKey: 'module_model' },
  { key: 'panel_qty',          type: 'api',     apiKey: 'module_qty' },
  { key: 'panel_w',            type: 'derived' },
  { key: 'panel_tech',         type: 'derived' },
  { key: 'inv_model',          type: 'derived' },
  { key: 'inv_qty',            type: 'api',     apiKey: 'inverter_qty' },
  { key: 'inv_kw',             type: 'derived' },
  { key: 'area_m2',            type: 'derived' },
  { key: 'annual_mwh',         type: 'api',     apiKey: 'annual_generation_mwh' },
  { key: 'system_coverage_pct',type: 'derived' },
  { key: 'co2_tons',           type: 'api',     apiKey: 'co2_tons_year1' },
  { key: 'avg_kwh_price',      type: 'derived' },
  { key: 'annual_energy_cost', type: 'api',     apiKey: 'cfe_bill_sin_pv_mxn',    guard: true },
  { key: 'annual_savings',     type: 'api',     apiKey: 'pv_only_savings_year1_mxn', guard: true },
  { key: 'savings_10yr',       type: 'api',     apiKey: 'savings_term_mxn' },
  { key: 'capex_total',        type: 'api',     apiKey: 'offer_price_mxn',        guard: true },
  { key: 'roi_years',          type: 'api',     apiKey: 'payback_years' },
  { key: 'irr_10yr',           type: 'api',     apiKey: 'irr' },
  { key: 'observations',       type: 'config' },
  { key: 'notes',              type: 'config' },
  { key: 'prod_jan', type: 'derived' }, { key: 'prod_feb', type: 'derived' },
  { key: 'prod_mar', type: 'derived' }, { key: 'prod_apr', type: 'derived' },
  { key: 'prod_may', type: 'derived' }, { key: 'prod_jun', type: 'derived' },
  { key: 'prod_jul', type: 'derived' }, { key: 'prod_aug', type: 'derived' },
  { key: 'prod_sep', type: 'derived' }, { key: 'prod_oct', type: 'derived' },
  { key: 'prod_nov', type: 'derived' }, { key: 'prod_dec', type: 'derived' }
];

// PURE. The plan, validated: returns { rows, apiCount, configCount, derivedCount,
// guardKeys }. Used by tests + the writer.
function buildSlideDataPlan() {
  var rows = SLIDE_DATA_PLAN_V2.slice();
  var apiCount = 0, configCount = 0, derivedCount = 0, guardKeys = [];
  rows.forEach(function (r) {
    if (r.type === 'api')          apiCount++;
    else if (r.type === 'config')  configCount++;
    else if (r.type === 'derived') derivedCount++;
    if (r.guard) guardKeys.push(r.key);
  });
  return { rows: rows, apiCount: apiCount, configCount: configCount,
           derivedCount: derivedCount, guardKeys: guardKeys };
}

// PURE. The robust label-anchored read formula for an API_OUTPUT key.
function _slideApiFormula(apiKey) {
  return "=INDEX('" + SLIDE_DATA_API_SHEET + "'!B:B,MATCH(\"" + apiKey
       + "\",'" + SLIDE_DATA_API_SHEET + "'!A:A,0))";
}

// LIVE. Rebuild SLIDE_DATA rows 1..N (header + keys). Rows below N (e.g. the
// "--- IMAGES ---" block) are left untouched. Returns { written, apiCount,
// pending }.
function writeSlideDataV2(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SLIDE_DATA_SHEET_V2);
  if (!sh) sh = ss.insertSheet(SLIDE_DATA_SHEET_V2);

  var plan = buildSlideDataPlan();
  sh.getRange(1, 1).setValue('key');
  sh.getRange(1, 2).setValue('value');

  var apiCount = 0, pending = 0;
  for (var i = 0; i < plan.rows.length; i++) {
    var r = plan.rows[i];
    var row = i + 2;                       // row 1 = header
    sh.getRange(row, 1).setValue(r.key);
    var valCell = sh.getRange(row, 2);
    if (r.type === 'api') {
      valCell.setFormula(_slideApiFormula(r.apiKey));
      if (typeof valCell.setNote === 'function') valCell.setNote('Fuente: API_OUTPUT[' + r.apiKey + ']');
      apiCount++;
    } else {
      valCell.setValue('');                // clean blank, never #REF!
      if (typeof valCell.setNote === 'function') {
        valCell.setNote(r.type === 'config'
          ? 'Pendiente: configuracion (99_SETUP).'
          : 'Pendiente: figura derivada (extension de API_OUTPUT).');
      }
      pending++;
    }
  }
  try { if (typeof Logger !== 'undefined') Logger.log('SLIDE_DATA rebuilt: ' + apiCount + ' api, ' + pending + ' pendiente'); } catch (e) {}
  return { written: plan.rows.length, apiCount: apiCount, pending: pending };
}
