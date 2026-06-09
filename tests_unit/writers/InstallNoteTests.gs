// =============================================================================
// ARGIA TESTS -- tests_unit/writers/InstallNoteTests.gs
// -----------------------------------------------------------------------------
// Per-section cost-breakdown notes on INSTALLATION_v2 (WriteInstallationV2.js):
// each LABOR / EQUIP / OTHER cell gets a note listing the items that compose it
// with TYPE + driver quantity + cost. Targets the pure helpers
// _instV2_typeTag / _instV2_driverLabel / _instV2_sectionColumnNote.
// =============================================================================

registerTest({
  id      : 'UNIT_INSTALL_BREAKDOWN_NOTES',
  group   : 'unit',
  module  : 'writers/install',
  scenarios: [],
  tags    : ['install', 'notes', 'breakdown'],
  source  : 'tests_unit/writers/InstallNoteTests.gs',
  fn: function (t) {
    t.suite('install -- cost-breakdown note helpers');

    // type tags
    t.assert('indirect -> supervisión', 'supervisión',
      _instV2_typeTag({ bucket: 'INDIRECT_LABOR', item: { costType: 'OTHER_FIXED' } }));
    t.assert('labor -> mano de obra', 'mano de obra',
      _instV2_typeTag({ bucket: 'STANDARD', item: { costType: 'LABOR_PRODUCTIVITY' } }));
    t.assert('equip day -> equipo', 'equipo',
      _instV2_typeTag({ bucket: 'STANDARD', item: { costType: 'EQUIPMENT_DAY' } }));
    t.assert('other -> material/logística', 'material/logística',
      _instV2_typeTag({ bucket: 'STANDARD', item: { costType: 'OTHER_FIXED' } }));
    t.assert('percent -> indirecto %', 'indirecto %',
      _instV2_typeTag({ bucket: 'STANDARD', item: { costType: 'PERCENT_OF_SUBTOTAL' } }));

    // driver labels
    t.assert('MH labor driver', '90 MH',
      _instV2_driverLabel({ mhComputed: 90, item: { costType: 'LABOR_FIXED_MH' } }));
    t.assert('PROJECT_ONE -> fijo', 'fijo',
      _instV2_driverLabel({ driverQtyVal: 1, item: { costType: 'OTHER_FIXED', driverKey: 'PROJECT_ONE' } }));
    t.assert('day-driven count', '79 día',
      _instV2_driverLabel({ driverQtyVal: 79, item: { costType: 'OTHER_FIXED', driverKey: 'EST_PROJECT_DAYS', driverUom: 'día' } }));

    // section column note: supervisory shows under LABOR, NOT under OTHER
    var items = [
      { item: { section: 'GENERAL SITE', description: 'Site supervisor', costType: 'OTHER_FIXED',
                driverKey: 'EST_PROJECT_DAYS', driverUom: 'día' },
        bucket: 'INDIRECT_LABOR', laborMxn: 0, equipMxn: 0, otherMxn: 221200, mhComputed: 0, driverQtyVal: 79 },
      { item: { section: 'GENERAL SITE', description: 'Mobilization', costType: 'OTHER_FIXED',
                driverKey: 'PROJECT_ONE' },
        bucket: 'STANDARD', laborMxn: 0, equipMxn: 0, otherMxn: 12000, mhComputed: 0, driverQtyVal: 1 }
    ];
    var laborNote = _instV2_sectionColumnNote(items, 'GENERAL SITE', 'LABOR');
    var otherNote = _instV2_sectionColumnNote(items, 'GENERAL SITE', 'OTHER');
    t.assertTrue('LABOR note lists the supervisor', laborNote.indexOf('Site supervisor') >= 0);
    t.assertTrue('LABOR note tags supervisión',     laborNote.indexOf('supervisión') >= 0);
    t.assertTrue('LABOR note shows 79 día',         laborNote.indexOf('79 día') >= 0);
    t.assertTrue('OTHER note lists mobilization',   otherNote.indexOf('Mobilization') >= 0);
    t.assertTrue('OTHER note does NOT list supervisor', otherNote.indexOf('Site supervisor') === -1);

    // empty when nothing contributes
    t.assert('empty section -> empty note', '',
      _instV2_sectionColumnNote(items, 'BESS', 'OTHER'));
  }
});
