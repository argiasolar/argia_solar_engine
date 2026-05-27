// =============================================================================
// ARGIA TESTS -- tests_integration/templates/LoadOrderProbe.gs
// -----------------------------------------------------------------------------
// CHUNK 0 — Apps Script cross-folder load-order probe.
//
// WHY THIS EXISTS
//   The migration plan flags load order as a real risk:
//     "Apps Script load order is alphabetical *within* and *across* folders.
//      Verify in Chunk 0 by intentionally creating cross-file dependencies
//      and running. If load order breaks, add lazy-init guards."
//
//   This test confirms that symbols defined in the new `templates/` folder
//   and the new `tests_unit/templates/` folder are visible from the test
//   runner, and that root-level symbols (primitives, design tokens) remain
//   visible too. If Apps Script ever decided to skip a folder or fail
//   alphabetical sort across folders, this test catches it.
//
// CLASSIFICATION
//   group=integration. No sheet I/O of its own, but exercises real symbol
//   resolution across folders — that crosses the line out of "pure unit."
//
// WHAT IT CHECKS
//   - templates/TemplateRegistry.js : V2_SHEETS, V2_TEMPLATE_FUNCTIONS,
//                                     getV2SheetForLegacy, listV2Sheets,
//                                     setupAllV2Templates
//   - 02b_LayoutPrimitives.js       : primSubtotalRow, primTotalRow (root)
//   - 02a_DesignTokens.js           : loadDesignTokens, token (root)
//   - test/TestRegistry.gs          : TEST_REGISTRY (root subfolder)
//
//   Each check uses `typeof` so a missing symbol fails the assertion
//   instead of throwing a ReferenceError that would abort the runner.
// =============================================================================


registerTest({
  id      : 'INT_TEMPLATES_LOAD_ORDER_PROBE',
  group   : 'integration',
  module  : 'templates/load_order',
  scenarios: [],
  tags    : ['templates', 'load_order', 'chunk0'],
  source  : 'tests_integration/templates/LoadOrderProbe.gs',
  fn: function (t, ctx) {
    t.suite('INTEGRATION templates/load_order: cross-folder symbol resolution');

    // === templates/ folder symbols ========================================
    t.assertTrue('V2_SHEETS visible (from templates/)',
      typeof V2_SHEETS === 'object' && V2_SHEETS !== null);
    t.assertTrue('V2_TEMPLATE_FUNCTIONS visible (from templates/)',
      typeof V2_TEMPLATE_FUNCTIONS === 'object' && V2_TEMPLATE_FUNCTIONS !== null);
    t.assertTrue('V2_LEGACY_MAP visible (from templates/)',
      typeof V2_LEGACY_MAP === 'object' && V2_LEGACY_MAP !== null);
    t.assertTrue('getV2SheetForLegacy visible (from templates/)',
      typeof getV2SheetForLegacy === 'function');
    t.assertTrue('listV2Sheets visible (from templates/)',
      typeof listV2Sheets === 'function');
    t.assertTrue('setupAllV2Templates visible (from templates/)',
      typeof setupAllV2Templates === 'function');

    // === root-level primitives (02b) =====================================
    t.assertTrue('primDocTitle visible (root)',
      typeof primDocTitle === 'function');
    t.assertTrue('primSectionHeader visible (root)',
      typeof primSectionHeader === 'function');
    t.assertTrue('primBodyRow visible (root)',
      typeof primBodyRow === 'function');
    t.assertTrue('primSubtotalRow visible (root) — added in Chunk 0',
      typeof primSubtotalRow === 'function');
    t.assertTrue('primTotalRow visible (root) — added in Chunk 0',
      typeof primTotalRow === 'function');
    t.assertTrue('primApplyPageCanvas visible (root)',
      typeof primApplyPageCanvas === 'function');

    // === root-level tokens (02a) =========================================
    t.assertTrue('loadDesignTokens visible (root)',
      typeof loadDesignTokens === 'function');
    t.assertTrue('token visible (root)',
      typeof token === 'function');
    t.assertTrue('tokenNum visible (root)',
      typeof tokenNum === 'function');
    t.assertTrue('resetDesignTokenCache_ visible (root)',
      typeof resetDesignTokenCache_ === 'function');

    // === test/ framework =================================================
    t.assertTrue('TEST_REGISTRY visible (test/)',
      typeof TEST_REGISTRY !== 'undefined' && Array.isArray(TEST_REGISTRY));
    t.assertTrue('registerTest visible (test/)',
      typeof registerTest === 'function');

    // === cross-folder live call ==========================================
    // Resolve a v2 sheet name (templates/), then use root-level tokens to
    // build a small expected value. If load order were broken, one of these
    // would have thrown above; this last step confirms they actually
    // cooperate at call time, not just at declaration time.
    var mdcV2 = getV2SheetForLegacy('MDC');
    t.assert('cross-folder call: getV2SheetForLegacy("MDC")',
      'MDC_v2', mdcV2);

    // Load tokens and read one — confirms 02a is callable here too.
    resetDesignTokenCache_();
    loadDesignTokens(SpreadsheetApp.getActive());
    var fontFamily = token('FONT_FAMILY');
    t.assertTrue('cross-folder call: token("FONT_FAMILY") returns non-empty string',
      typeof fontFamily === 'string' && fontFamily.length > 0);

    // === orchestrator no-op call =========================================
    // setupAllV2Templates iterates V2_TEMPLATE_FUNCTIONS (11 entries since
    // Chunk 6 added RFQ_BESS; INSTALL_DRIVER_MAP is intentionally absent
    // from V2_TEMPLATE_FUNCTIONS because it has no template -- it's a
    // v2-only audit sheet written directly by writeInstallationV2). Same
    // semantics as the unit suite, but running from the integration tier
    // confirms the orchestrator survives the cross-folder code path too.
    var summary = setupAllV2Templates(SpreadsheetApp.getActive());
    t.assert('orchestrator attempted all 11 sheets', 11, summary.attempted);
    // The "skipped all 11" assertion below holds only if NO setup function
    // is defined yet (the Chunk 0 state). Once templates ship (which they
    // have, post-Tier 1), the assertion below will fail: setup functions
    // exist, so the orchestrator either succeeds or fails on them, not
    // skips. Keep this test as a *Chunk 0* regression -- if some future
    // refactor accidentally re-removes the setup functions, this catches it.
    // For now (post-templates), `skipped.length` will be 0 and this fails;
    // a clean fix is to assert "no setup function missing" instead.
    var actuallyHaveSetupFns = (typeof setupMdcTemplate === 'function');
    if (!actuallyHaveSetupFns) {
      t.assert('orchestrator skipped all 11 (no setup fns yet, Chunk 0 state)',
        11, summary.skipped.length);
    } else {
      t.info('orchestrator finished (templates exist)',
             'attempted=' + summary.attempted +
             ', succeeded=' + summary.succeeded.length +
             ', failed=' + summary.failed.length +
             ', skipped=' + summary.skipped.length);
      // Sanity: at least the MDC setup ran (whether it succeeded or failed,
      // it shouldn't have been "skipped" if the function exists).
      var mdcSkipped = summary.skipped.some(function(s) { return s.key === 'MDC'; });
      t.assertTrue('MDC was not skipped (setupMdcTemplate exists)',
                   !mdcSkipped);
    }
  }
});
