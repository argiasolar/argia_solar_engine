// =============================================================================
// ARGIA TESTS -- tests_unit/calc/BomOptimizerSelectionTests.gs
// -----------------------------------------------------------------------------
// _bomV2_selectOptimizer (writers_v2/WriteBomV2.gs): optimizer XOR rapid-shutdown.
// For an OPTIMIZER-topology system the BOM picks the CHEAPEST COMPATIBLE optimizer
// (brand must match the inverter -- a SolarEdge inverter only takes SolarEdge
// optimizers, so a cheaper Tigo unit is NOT eligible), one per module (worst case),
// and the separate RSD line is suppressed. Pure-logic tests: no spreadsheet I/O.
// =============================================================================

registerTest({
  id: 'UNIT_BOM_OPTIMIZER_SELECTION',
  group: 'unit',
  module: 'bom/optimizer',
  scenarios: [],
  tags: ['bom', 'optimizer', 'rsd', 'pricing'],
  source: 'tests_unit/calc/BomOptimizerSelectionTests.gs',
  fn: function (t) {
    t.suite('_bomV2_selectOptimizer -- cheapest COMPATIBLE');
    var db = [
      { id: 'OPT_001', brand: 'SolarEdge',   model: 'S1000',   maxInputW: 1000, priceMxn: 1600, status: 'ACTIVE' },
      { id: 'OPT_002', brand: 'SolarEdge',   model: 'S1200',   maxInputW: 1200, priceMxn: 2000, status: 'ACTIVE' },
      { id: 'OPT_003', brand: 'SolarEdge',   model: 'S1400',   maxInputW: 1400, priceMxn: 2600, status: 'ACTIVE' },
      { id: 'OPT_004', brand: 'Tigo Energy', model: 'TS4-A-O', maxInputW: 725,  priceMxn: 950,  status: 'ACTIVE' },
      { id: 'OPT_006', brand: 'Tigo Energy', model: 'TS4-A-F', maxInputW: 725,  priceMxn: 650,  status: 'ACTIVE' }
    ];

    // PROLOGIS: SE100KUS brand is "SOLAREDGE", 645 W module.
    var s = _bomV2_selectOptimizer(db, 'SOLAREDGE', 645);
    t.assert('picks cheapest compatible (S1000)', 'S1000', s && s.model);
    t.assert('compatible by brand only', 'SOLAREDGE', s && s.brand.toUpperCase());
    t.assertTrue('did NOT pick cheaper incompatible Tigo', s && s.priceMxn === 1600);

    // Higher module power escalates within the compatible brand.
    var big = _bomV2_selectOptimizer(db, 'SolarEdge', 1300);
    t.assert('1300 W needs S1400', 'S1400', big && big.model);

    // Unknown module wattage -> no power constraint -> cheapest of the brand.
    var u = _bomV2_selectOptimizer(db, 'SolarEdge', 0);
    t.assert('unknown Wp -> cheapest SolarEdge', 'S1000', u && u.model);

    // No / unknown brand -> nothing (never silently pick an incompatible unit).
    t.assertTrue('empty brand -> null', _bomV2_selectOptimizer(db, '', 645) === null);
    t.assertTrue('unknown brand -> null', _bomV2_selectOptimizer(db, 'HUAWEI', 645) === null);
  }
});
