// =============================================================================
// ARGIA TESTS -- tests_unit/writers/ResolveStructureTests.gs
// -----------------------------------------------------------------------------
// PASS 10 MIGRATION: resolveStructure string parser.
//
// SOURCE: testResolveStructure in 99_TestRunner.gs (lines ~1754-1820).
//         Migrated 2026-05-21 as part of Pass 10.
//
// === RESURRECTION NOTE: testResolveStructure WAS DEAD ===
// The legacy testResolveStructure function is DEFINED in 99_TestRunner.gs but
// NEVER CALLED from runTests() or any addPhaseN dispatcher. A full grep of
// the repo at migration time confirmed only the function definition exists;
// there is no call site anywhere.
//
// This is the SECOND silently-dead test suite the migration has surfaced
// (the first was Phase 1.2 FP threshold, resurrected in Pass 4). Like that
// one, the test logic looks valid -- it just stopped being invoked at some
// point and nobody noticed.
//
// Migrating it here brings it back to life. If the assertions FAIL, that's
// real regression in resolveStructure that went undetected. If they pass,
// we've recovered ~16 asserts of dormant coverage for free.
//
// COVERAGE
//   resolveStructure() string parser against a synthetic structure DB:
//     - Path 1: canonical "BRAND — MODEL — STR_ID" (4 asserts)
//     - Path 1b: tail-wins when brand/model in prefix is wrong (2 asserts)
//     - Path 2: 2-part brand+model split (1 assert)
//     - Path 2b: brand disambiguates collisions (2 asserts)
//     - Path 3: legacy free-text model-only matching (3 asserts)
//     - Failure cases: null/empty/whitespace/no-match/empty-DB (5 asserts)
//
// CLASSIFICATION
//   group=unit. Pure function called with synthetic DB. No sheet I/O.
//
// DEPENDENCIES
//   - resolveStructure (08_WriteBOM.gs)
//
// MODULE PLACEMENT
//   Lives in tests_unit/writers/ because resolveStructure is owned by
//   08_WriteBOM.gs. Honest tradeoff: semantically the function is more
//   of an input-string parser than a writer concern, but file-ownership
//   is the cleaner rule for module placement until/unless the engine
//   architecture moves it to a dedicated utility file.
//
// CO-EXISTENCE
//   The legacy testResolveStructure stays as dead code in 99_TestRunner.gs
//   (it was never called) -- no behavior change from the migration.
// =============================================================================


registerTest({
  id      : 'UNIT_WRITERS_RESOLVE_STRUCTURE',
  group   : 'unit',
  module  : 'writers/bom',
  scenarios: [],
  tags    : ['writers', 'bom', 'resolver', 'parser', 'resurrected'],
  source  : 'tests_unit/writers/ResolveStructureTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers/bom: resolveStructure (RESURRECTED)');

    // ---- Synthetic DB ----------------------------------------------------
    // Shaped like loadStructureDb() output. STR_COL_ID/BRAND/MODEL/PRICE
    // indices (0/1/2/12) match the live DB.
    function row(id, brand, model, priceUsd) {
      var r = new Array(20);
      for (var i = 0; i < 20; i++) r[i] = '';
      r[0]  = id;
      r[1]  = brand;
      r[2]  = model;
      r[12] = priceUsd;
      return { _raw: r };
    }
    var db = [
      row('STR_001', 'ALUMINEX', 'CARPORT ALU',    45),
      row('STR_008', 'S-5',      'STRUCTURE KR18', 18),
      row('STR_018', 'UNIRAC',   'COPLANAR',       12),
      row('STR_007', 'RALUX',    'RIEL COPLANAR',  16),
      // Synthetic collision: same model name across two brands
      row('STR_099', 'BRAND_A',  'GENERIC RAIL',   20),
      row('STR_100', 'BRAND_B',  'GENERIC RAIL',   25)
    ];

    // ---- Path 1: canonical "BRAND — MODEL — STR_ID" --------------------
    var r1 = resolveStructure(db, 'S-5 — STRUCTURE KR18 — STR_008');
    t.assert('canonical: strId',
             'STR_008', r1 ? r1.strId : null);
    t.assert('canonical: brand',
             'S-5', r1 ? r1.brand : null);
    t.assert('canonical: model',
             'STRUCTURE KR18', r1 ? r1.model : null);
    t.assert('canonical: price',
             18, r1 ? r1.priceUsd : null);

    // ---- Path 1b: STR_ID-tail wins even when brand/model in prefix wrong
    // Defensive case for user-edited C15 cells where the trailing ID is
    // still correct but the rest has drifted.
    var r2 = resolveStructure(db, 'WRONG BRAND — WRONG MODEL — STR_001');
    t.assert('tail-wins: strId',
             'STR_001', r2 ? r2.strId : null);
    t.assert('tail-wins: brand',
             'ALUMINEX', r2 ? r2.brand : null);

    // ---- Path 2: brand+model 2-part split ------------------------------
    var r3 = resolveStructure(db, 'UNIRAC — COPLANAR');
    t.assert('2-part: strId',
             'STR_018', r3 ? r3.strId : null);

    // Brand disambiguates collisions
    var r4a = resolveStructure(db, 'BRAND_A — GENERIC RAIL');
    var r4b = resolveStructure(db, 'BRAND_B — GENERIC RAIL');
    t.assert('collision A: strId',
             'STR_099', r4a ? r4a.strId : null);
    t.assert('collision B: strId',
             'STR_100', r4b ? r4b.strId : null);

    // ---- Path 3: legacy free-text (model only) -------------------------
    // Preserves projects whose C15 cell has not been re-picked from the
    // new dropdown -- old-format strings keep working.
    var r5 = resolveStructure(db, 'STRUCTURE KR18');
    t.assert('legacy: strId',
             'STR_008', r5 ? r5.strId : null);

    // Case-insensitive
    var r6 = resolveStructure(db, 'structure kr18');
    t.assert('legacy lowercase',
             'STR_008', r6 ? r6.strId : null);

    // Legacy free-text with collision: returns first DB match. Inherent
    // limitation of model-only matching; the new dropdown exists to avoid
    // it. Test pins the behavior so future refactors don't change it.
    var r7 = resolveStructure(db, 'GENERIC RAIL');
    t.assert('legacy collision (first match)',
             'STR_099', r7 ? r7.strId : null);

    // ---- Failure cases -------------------------------------------------
    t.assert('null input',
             null, resolveStructure(db, null));
    t.assert('empty string',
             null, resolveStructure(db, ''));
    t.assert('whitespace only',
             null, resolveStructure(db, '   '));
    t.assert('no match',
             null, resolveStructure(db,
                     'NONEXISTENT BRAND — FOO — STR_999'));
    t.assert('empty DB',
             null, resolveStructure([],
                     'S-5 — STRUCTURE KR18 — STR_008'));
  }
});
