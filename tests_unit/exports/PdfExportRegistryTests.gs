// =============================================================================
// ARGIA TESTS -- tests_unit/exports/PdfExportRegistryTests.gs
// -----------------------------------------------------------------------------
// [Track B] Locks the PDF_EXPORTS registry contract:
//   1. the two financial deliverables (CLIENT_FINANCIALS, BAAS_PROJECTION)
//      are registered with the right sheet names + dynamicEndRow (their
//      content length varies with term/BaaS configuration)
//   2. GENERIC contract over EVERY entry: sheet/label present, orient valid,
//      coordinates sane (r1<=r2 unless dynamic, c1<c2), scale (when set) in
//      the endpoint's 1-4 range -- a malformed entry fails loud here instead
//      of producing a silently-truncated client PDF.
// Pure registry inspection -- runs headless.
// =============================================================================

registerTest({
  id      : 'UNIT_EXPORTS_PDF_REGISTRY_CONTRACT',
  group   : 'unit',
  module  : 'exports/registry',
  scenarios: [],
  tags    : ['exports', 'pdf', 'trackb', 'contract'],
  source  : 'tests_unit/exports/PdfExportRegistryTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT exports/registry: PDF_EXPORTS contract');

    // -- 1. financial deliverables registered -------------------------------
    var cf = PDF_EXPORTS.CLIENT_FINANCIALS;
    t.assertTrue('CLIENT_FINANCIALS registered', !!cf);
    t.assert('CLIENT_FINANCIALS sheet', 'CLIENT_FINANCIALS_v2', cf.sheet);
    t.assert('CLIENT_FINANCIALS dynamic end row', true, !!cf.dynamicEndRow);
    t.assert('CLIENT_FINANCIALS portrait', 'portrait', cf.orient);

    var bp = PDF_EXPORTS.BAAS_PROJECTION;
    t.assertTrue('BAAS_PROJECTION registered', !!bp);
    t.assert('BAAS_PROJECTION sheet', 'BAAS_PROJECTION_v2', bp.sheet);
    t.assert('BAAS_PROJECTION dynamic end row', true, !!bp.dynamicEndRow);
    t.assert('BAAS_PROJECTION landscape (11-col table)', 'landscape', bp.orient);

    // both buffer past the col-A..L disclaimer merges (index 11) -> c2 >= 12
    t.assertTrue('CLIENT_FINANCIALS c2 covers disclaimer merge', cf.c2 >= 12);
    t.assertTrue('BAAS_PROJECTION c2 covers disclaimer merge',   bp.c2 >= 12);

    // -- 2. generic contract over every entry --------------------------------
    var bad = [];
    Object.keys(PDF_EXPORTS).forEach(function (k) {
      var e = PDF_EXPORTS[k];
      if (!e.sheet)  bad.push(k + ': no sheet');
      if (!e.label)  bad.push(k + ': no label');
      if (e.orient !== 'portrait' && e.orient !== 'landscape') {
        bad.push(k + ': orient "' + e.orient + '"');
      }
      if (!(e.c1 < e.c2)) bad.push(k + ': c1 >= c2');
      if (!e.dynamicEndRow && !(e.r1 < e.r2)) bad.push(k + ': r1 >= r2 (static)');
      if (e.scale != null && !(e.scale >= 1 && e.scale <= 4)) {
        bad.push(k + ': scale ' + e.scale);
      }
    });
    t.assert('all registry entries well-formed. Defects: [' + bad.join('; ') + ']',
             0, bad.length);

    // -- 3. menu entry points exist for the new exports -----------------------
    t.assert('exportClientFinancials entrypoint', 'function', typeof exportClientFinancials);
    t.assert('exportBaasProjection entrypoint',   'function', typeof exportBaasProjection);
  }
});
