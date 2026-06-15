// =============================================================================
// ARGIA TESTS -- tests_unit/writers/ClientFinancialsWriterTests.gs
// -----------------------------------------------------------------------------
// [Track B P0] Locks writeClientFinancialsV2. Reuses the BaaS writer harness
// (_baasMockSheet / _baasMockSs / _baasWriterText from BaasProjectionTests.gs):
//   1. PROPOSAL disclaimer is ALWAYS rendered (structural invariant)
//   2. headline KPIs render the calc values (savings, payback, ROI, LCOE)
//   3. CO2 figure never appears without the factor caveat (invariant)
//   4. projection table renders one row per year
//   5. scenario block: BaaS column + note toggle on baasNetSavingsByYear
// =============================================================================

function _cfinWriterFin(withBaas) {
  return calcClientFinancials({
    analysisTermYears: 15, billEscalationPct: 0, savingsEscalationPct: 0,
    discountRate: 0,
    capexMxn: 10000000,
    year1BillWithoutMxn: 12000000, year1BillWithMxn: 10000000,
    demandChargeSavingMxnYear1: 500000,
    annualEnergyKwhYear1: 1000000, panelDegradationPct: 0,
    co2FactorTonPerMwh: 0.435,
    baasNetSavingsByYear: withBaas
      ? [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(function () { return 1000000; })
      : null
  });
}

registerTest({
  id      : 'UNIT_WRITERS_CLIENT_FIN_V2',
  group   : 'unit',
  module  : 'writers/client_financials',
  scenarios: [],
  tags    : ['writers', 'financials', 'trackb', 'disclaimer', 'invariant'],
  source  : 'tests_unit/writers/ClientFinancialsWriterTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers/client_financials: writeClientFinancialsV2');

    // -- Render without BaaS ---------------------------------------------------
    var sheet = _baasMockSheet();
    var ret = writeClientFinancialsV2(_baasMockSs(sheet), _cfinWriterFin(false), {
      capexBreakdown: { materialsMxn: 8000000, installMxn: 2000000, totalMxn: 10000000 }
    });
    var text = _baasWriterText(sheet);

    // 1. PROPOSAL disclaimer (structural invariant)
    t.assertTrue('disclaimer: ahorros no garantizados',
                 text.indexOf('no garantizados') >= 0);
    t.assertTrue('disclaimer: intervalos de 15 minutos',
                 text.indexOf('intervalos de 15 minutos') >= 0);

    // 2. headline KPIs carry the hand-computed calc values
    t.assertTrue('title rendered', text.indexOf('ANÁLISIS FINANCIERO') >= 0);
    t.assertTrue('Yr-1 savings $2,000,000', text.indexOf('$2,000,000') >= 0);
    t.assertTrue('payback 5.0 años', text.indexOf('5.0 años') >= 0);
    t.assertTrue('ROI 200.0%', text.indexOf('200.0%') >= 0);
    t.assertTrue('LCOE 0.67 MXN/kWh', text.indexOf('0.67 MXN/kWh') >= 0);
    t.assertTrue('CAPEX breakdown note', text.indexOf('$8,000,000') >= 0
                                       && text.indexOf('$2,000,000') >= 0);

    // 3. CO2 figure + caveat together (invariant)
    t.assertTrue('CO2 yr-1 435 t', text.indexOf('435 toneladas') >= 0);
    t.assertTrue('CO2 factor caveat present', text.indexOf('Factor de emisión') >= 0
                 && text.indexOf('CRE') >= 0);

    // 4. projection table has all 15 year rows (writer returns the count)
    t.assert('writer reports 15 rows', 15, ret.rows);
    t.assertTrue('table renders final-year position $20,000,000',
                 text.indexOf('$20,000,000') >= 0);

    // 5a. no BaaS: note rendered, no lease column
    t.assert('hasBaas false', false, ret.hasBaas);
    t.assertTrue('BaaS hint note rendered',
                 text.indexOf('Genere la Proyección BaaS') >= 0);
    t.assertTrue('no ARRENDAMIENTO column header',
                 text.indexOf('Ahorro acumulado\nARRENDAMIENTO') < 0);

    // -- Render WITH BaaS --------------------------------------------------------
    var sheet2 = _baasMockSheet();
    var ret2 = writeClientFinancialsV2(_baasMockSs(sheet2), _cfinWriterFin(true), {});
    var text2 = _baasWriterText(sheet2);
    t.assert('hasBaas true', true, ret2.hasBaas);
    t.assertTrue('ARRENDAMIENTO column present',
                 text2.indexOf('ARRENDAMIENTO') >= 0);
    t.assertTrue('BaaS cum y15 = $15,000,000', text2.indexOf('$15,000,000') >= 0);
    t.assertTrue('hint note absent with BaaS',
                 text2.indexOf('Genere la Proyección BaaS') < 0);
  }
});


// =============================================================================
// [4.21.0] Valor de Compra (buyout schedule) renders in CLIENT_FINANCIALS_v2
// when opts.valorDeCompra is supplied, and is ABSENT when it is not (the
// section is opt-in, driven by capex > 0 in the orchestrator).
// =============================================================================
registerTest({
  id      : 'UNIT_WRITERS_CLIENT_FIN_VALOR_DE_COMPRA',
  group   : 'unit',
  module  : 'writers/client_financials',
  scenarios: [],
  tags    : ['writers', 'financials', 'valor_de_compra', 'baas'],
  source  : 'tests_unit/writers/ClientFinancialsWriterTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers/client_financials: Valor de Compra section');

    // Build a real schedule from the calc so the test exercises the true shape.
    var vdc = calcValorDeCompra({ systemCapexMxn: 10000000 });  // -> capexConIva 11,600,000

    var sheet = _baasMockSheet();
    writeClientFinancialsV2(_baasMockSs(sheet), _cfinWriterFin(false), {
      capexBreakdown: { materialsMxn: 8000000, installMxn: 2000000, totalMxn: 10000000 },
      valorDeCompra: vdc
    });
    var text = _baasWriterText(sheet);

    // Section header + explanatory line.
    t.assertTrue('VALOR DE COMPRA header rendered',
                 text.indexOf('VALOR DE COMPRA') >= 0);
    t.assertTrue('explanatory line names the term',
                 text.indexOf('16 años') >= 0);

    // Year 0 = capexConIva = 11,600,000 ; year 16 = $0.
    t.assertTrue('Año 0 buyout = $11,600,000', text.indexOf('$11,600,000') >= 0);
    t.assertTrue('schedule has Año 16 row', text.indexOf('Año 16') >= 0);
    t.assertTrue('Año 16 buyout = $0', text.indexOf('$0') >= 0);

    // Absent when not supplied.
    var sheet2 = _baasMockSheet();
    writeClientFinancialsV2(_baasMockSs(sheet2), _cfinWriterFin(false), {
      capexBreakdown: { materialsMxn: 8000000, installMxn: 2000000, totalMxn: 10000000 }
    });
    var text2 = _baasWriterText(sheet2);
    t.assertTrue('no Valor de Compra section when opts.valorDeCompra absent',
                 text2.indexOf('VALOR DE COMPRA') < 0);
  }
});
