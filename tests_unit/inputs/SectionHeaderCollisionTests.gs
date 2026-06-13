// =============================================================================
// ARGIA -- tests_unit/inputs/SectionHeaderCollisionTests.gs
// -----------------------------------------------------------------------------
// [4.15.2] Locks the fix for the repeated rebuild failure:
//   "You must select all cells in a merged range to merge or unmerge them."
//
// ROOT CAUSE (found from the live merge geometry, not guessed):
//   _setupOneTab renders each map section with a header merge at
//   (minRow-2) spanning C:E (cols 3-5). Section 08 SOLAR's fields start at
//   row 66, so its generic header computed to row 64 (C64:E64) -- the SAME
//   row as section 07's only field (installBattery, label merge B64:C64,
//   cols 2-3). B64:C64 and C64:E64 share col 3 and neither contains the
//   other, so breakApart() on the label merge partially overlaps the header
//   merge and THROWS, aborting the rebuild.
//
//   '08 SOLAR' is in fact laid out by a DEDICATED idempotent setup
//   (setupInputProjectPvSection, 01d) with a non-merged col-B header at row
//   65 -- so the generic renderer should never have rendered it. The fix
//   marks those keys renderedBy:'dedicated' and inputSectionsForTab skips
//   fully-dedicated sections.
//
// THESE TESTS assert the map-level invariants directly, so any future row
// edit that reintroduces a collision fails offline, before it can abort a
// live rebuild.
// =============================================================================

registerTest({
  id      : 'UNIT_NO_SECTION_HEADER_OVERLAPS_FIELD_ROW',
  group   : 'unit',
  module  : 'inputs/section_layout',
  scenarios: [],
  tags    : ['inputs', 'layout', 'regression'],
  source  : 'tests_unit/inputs/SectionHeaderCollisionTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT inputs/section_layout [4.15.2]: no generic header merge ' +
            'collides with a field-label merge');

    // Recreate what _setupOneTab actually renders, per tab, using the SAME
    // helpers it uses (inputSectionsForTab / inputKeysForSection) so the test
    // tracks the real renderer.
    //   header merge:  C(minRow-2 clamped>=5) : E   == cols 3..5
    //   field label:   B(row) : C(row)               == cols 2..3   (col-4 primary)
    // A header row that equals a field row in the SAME tab is the collision.
    var tabs = ['INPUT_PROJECT', 'INPUT_INSTALL'];
    tabs.forEach(function (tab) {
      var sections = inputSectionsForTab(tab);   // already excludes dedicated
      var headerRows = {};   // row -> section
      var fieldRows  = {};   // row -> key (col-4 primary only -> these merge B:C)

      sections.forEach(function (sec) {
        var keys = inputKeysForSection(tab, sec).filter(function (k) {
          var m = INPUT_MAP[k];
          return !m.mode || m.mode === 'scalar';
        });
        if (!keys.length) return;
        var minRow = Math.min.apply(null, keys.map(function (k) { return INPUT_MAP[k].row; }));
        var hr = Math.max(minRow - 2, 5);
        headerRows[hr] = sec;
        keys.forEach(function (k) {
          var m = INPUT_MAP[k];
          if ((m.col || 4) === 4) fieldRows[m.row] = k;  // B:C label merge
        });
      });

      var collisions = [];
      Object.keys(headerRows).forEach(function (hr) {
        if (fieldRows[hr]) {
          collisions.push(tab + ' row ' + hr + ': header "' + headerRows[hr]
                          + '" (C:E) overlaps field "' + fieldRows[hr] + '" (B:C)');
        }
      });

      t.assertTrue(tab + ': zero header/field row collisions'
                   + (collisions.length ? ' -- ' + collisions.join(' ; ') : ''),
                   collisions.length === 0);
    });
  }
});


registerTest({
  id      : 'UNIT_DEDICATED_SECTION_EXCLUDED_FROM_GENERIC_RENDER',
  group   : 'unit',
  module  : 'inputs/section_layout',
  scenarios: [],
  tags    : ['inputs', 'layout', 'regression'],
  source  : 'tests_unit/inputs/SectionHeaderCollisionTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT inputs/section_layout [4.15.2]: dedicated sections skipped ' +
            'by the generic renderer');

    var projSections = inputSectionsForTab('INPUT_PROJECT');

    // 08 SOLAR is renderedBy:'dedicated' (setupInputProjectPvSection owns it).
    t.assertTrue('08 SOLAR excluded from generic _setupOneTab render',
                 projSections.indexOf('08 SOLAR') < 0);

    // 07 ALMACENAMIENTO has NO dedicated owner -> still rendered generically.
    t.assertTrue('07 ALMACENAMIENTO still rendered generically',
                 projSections.indexOf('07 ALMACENAMIENTO') >= 0);

    // The five SOLAR keys must all carry the dedicated flag (so a future
    // edit that drops the flag from one of them re-enables the collision and
    // this test catches it).
    var solarKeys = ['installPv', 'hasExistingPv', 'existingPvKwp',
                     'existingPvAnnualKwh', 'existingExportKwh'];
    var allDedicated = solarKeys.every(function (k) {
      return INPUT_MAP[k] && INPUT_MAP[k].renderedBy === 'dedicated';
    });
    t.assertTrue('all five 08 SOLAR keys are renderedBy:dedicated', allDedicated);
  }
});
