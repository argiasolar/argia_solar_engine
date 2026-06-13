// =============================================================================
// ARGIA -- tests_unit/inputs/RebuildStepOwnershipTests.gs
// -----------------------------------------------------------------------------
// [4.15.5] Closes the coverage gap that let the section-08 double-write reach
// the live workbook while unit tests stayed green.
//
// THE INCIDENT: 4.15.4 moved section 08 SOLAR back into the generic
// setupInputProject(true) renderer (step 0 of rebuildInputsToDefault) and gave
// it full styling. But setupInputProjectPvSection -- the OLD dedicated owner of
// section 08 -- was STILL a separate rebuild step (step 8). So a full rebuild
// wrote section 08 TWICE: once styled by the generic renderer, once again by
// the dedicated setup. Result after "Repair Input Layout": duplicate / stale
// SOLAR rows (e.g. "PV existente (kWh/año)" appearing at both 69 and 71).
//
// The unit suite missed it because the step list was a LOCAL array, not
// introspectable. 4.15.5 extracts it into rebuildInputSteps_(ss) with stable
// ids; this test asserts the dedicated section-08 setup is NOT in the rebuild
// sequence as long as section 08 is rendered generically.
// =============================================================================

registerTest({
  id      : 'UNIT_REBUILD_NO_DOUBLE_OWNED_SECTION',
  group   : 'unit',
  module  : 'inputs/rebuild_ownership',
  scenarios: [],
  tags    : ['inputs', 'rebuild', 'regression'],
  source  : 'tests_unit/inputs/RebuildStepOwnershipTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT inputs/rebuild_ownership [4.15.5]: no section written twice');

    // rebuildInputSteps_ takes ss only to close over it for the step fns; the
    // ids are static, so a null ss is fine for introspection.
    var steps = rebuildInputSteps_(null);
    var ids = steps.map(function (s) { return s.id; });

    // Section 08 SOLAR is rendered by the generic setupInputProject step.
    var solarGeneric = inputSectionsForTab('INPUT_PROJECT').indexOf('08 SOLAR') >= 0;
    t.assertTrue('precondition: 08 SOLAR rendered by generic setupInputProject',
                 solarGeneric);

    // Therefore the dedicated section-08 setup must NOT also be a rebuild step.
    t.assertTrue('setupInputProjectPvSection is NOT in the rebuild sequence '
                 + '(would double-write section 08)',
                 ids.indexOf('setupInputProjectPvSection') < 0);

    // setupInputProject (which owns section 08 now) IS in the sequence.
    t.assertTrue('setupInputProject is in the rebuild sequence',
                 ids.indexOf('setupInputProject') >= 0);

    // Sanity: ids are unique (no step listed twice).
    var seen = {}, dupes = [];
    ids.forEach(function (id) { if (seen[id]) dupes.push(id); seen[id] = true; });
    t.assertTrue('no duplicate step ids' + (dupes.length ? ' -- ' + dupes.join(',') : ''),
                 dupes.length === 0);
  }
});
