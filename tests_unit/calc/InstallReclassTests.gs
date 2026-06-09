// =============================================================================
// ARGIA TESTS -- tests_unit/calc/InstallReclassTests.gs
// -----------------------------------------------------------------------------
// Locks the installation OTHER -> indirect-LABOUR reclassification
// (13_CalcInstallCost.js). Per-day supervisory roles (site supervisor, QAQC,
// HSE officer) used to land in the OTHER bucket, hiding ~50% of real labour.
// They now route into a labelled indirect-labour sub-bucket that rolls up into
// TOTAL LABOR — without changing the grand total.
//
// Targets the pure module-scope helpers _icIsIndirectLabor + _icBucketDeltas
// (no spreadsheet access).
// =============================================================================

registerTest({
  id      : 'UNIT_INSTALL_RECLASS_INDIRECT_LABOR',
  group   : 'unit',
  module  : 'calc/install',
  scenarios: [],
  tags    : ['install', 'reclassify', 'labor', 'other'],
  source  : 'tests_unit/calc/InstallReclassTests.gs',
  fn: function (t) {
    t.suite('install cost -- indirect-labour reclassification');

    // 1) classifier: the three supervisory subsections, case-insensitive.
    t.assertTrue('SUPERVISION is indirect labour',  _icIsIndirectLabor({ subsection: 'SUPERVISION' }));
    t.assertTrue('QAQC is indirect labour',         _icIsIndirectLabor({ subsection: 'QAQC' }));
    t.assertTrue('HSE OFFICER is indirect labour',  _icIsIndirectLabor({ subsection: 'HSE OFFICER' }));
    t.assertTrue('lower-case still classifies',     _icIsIndirectLabor({ subsection: 'supervision' }));
    t.assertTrue('blank is NOT indirect labour',   !_icIsIndirectLabor({ subsection: '' }));
    t.assertTrue('DC consumable is NOT indirect',  !_icIsIndirectLabor({ subsection: 'DC HOMERUN' }));
    t.assertTrue('missing subsection is safe',     !_icIsIndirectLabor({}));

    // 2) routing: an indirect-labour result moves its cost OTHER -> LABOR.
    var sup = { item: { section: 'GENERAL SITE' }, bucket: 'INDIRECT_LABOR',
                laborMxn: 0, equipMxn: 0, otherMxn: 221200, totalMxn: 221200, mhComputed: 0 };
    var dS = _icBucketDeltas(sup);
    t.assert('supervisor counts as labour',      221200, dS.labor, 0);
    t.assert('supervisor tracked as indirect',   221200, dS.laborIndirect, 0);
    t.assert('supervisor adds 0 to OTHER',             0, dS.other, 0);
    t.assert('supervisor adds 0 direct labour',        0, dS.laborDirect, 0);
    t.assert('supervisor section LABOR',          221200, dS.secLabor, 0);
    t.assert('supervisor section OTHER',               0, dS.secOther, 0);

    // 3) routing: a standard OTHER item stays OTHER.
    var oth = { item: { section: 'GENERAL SITE' }, bucket: 'STANDARD',
                laborMxn: 0, equipMxn: 0, otherMxn: 12000, totalMxn: 12000, mhComputed: 0 };
    var dO = _icBucketDeltas(oth);
    t.assert('mobilization stays OTHER',           12000, dO.other, 0);
    t.assert('mobilization adds 0 labour',             0, dO.labor, 0);

    // 4) INDIRECT-section (percentage) item contributes nothing here.
    var pct = { item: { section: 'INDIRECT' }, bucket: 'STANDARD',
                laborMxn: 0, equipMxn: 0, otherMxn: 156255, totalMxn: 156255, mhComputed: 0 };
    var dP = _icBucketDeltas(pct);
    t.assert('INDIRECT section adds 0 to grand other', 0, dP.other, 0);
    t.assert('INDIRECT section adds 0 to grand total', 0, dP.secTotal, 0);

    // 5) INVARIANT: for every result, labour+equip+other == section total.
    //    This is what guarantees the reclassification preserves the grand total.
    [sup, oth, { item: { section: 'DC' }, bucket: 'STANDARD',
                 laborMxn: 9000, equipMxn: 0, otherMxn: 600, totalMxn: 9600, mhComputed: 90 }]
      .forEach(function (r, i) {
        var d = _icBucketDeltas(r);
        t.assert('total preserved for result ' + i,
          Math.round(d.labor + d.equip + d.other), Math.round(d.secTotal), 0);
      });
  }
});
