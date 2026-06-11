// ===========================================================================
// Batch 2 guard tests -- PURE, Node-runnable.
//
// G3: bomGrandTotalLabel() -- the BOM grand-total SIN COTIZAR flag wording,
//     including the zero-flag case that MUST equal the legacy label exactly
//     (CULLIGAN-era sheets with fully-priced BOMs stay byte-identical).
// G6: argiaFinancialGuardNotes() -- O&M / replacement-reserve zero-guards
//     for the client financial story (31_CalcClientFinancials).
// ===========================================================================

registerTest({
  id      : 'UNIT_BOM_GRAND_TOTAL_LABEL',
  group   : 'unit',
  module  : 'writers_v2/bom_grand_total_label',
  scenarios: [],
  tags    : ['bom', 'batch2', 'g3', 'regression'],
  source  : 'tests_unit/writers/Batch2GuardTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT writers_v2/bom: grand-total label SIN COTIZAR policy [G3]');

    // Zero missing -> EXACT legacy string. This is the golden-safety
    // contract: fully-priced BOMs render the same label as pre-4.14.0.
    t.assert('0 missing -> exact legacy label',
             'TOTAL MATERIAL + SERVICIOS (USD)',
             bomGrandTotalLabel(0));
    t.assert('undefined -> exact legacy label',
             'TOTAL MATERIAL + SERVICIOS (USD)',
             bomGrandTotalLabel(undefined));
    t.assert('negative -> exact legacy label (defensive)',
             'TOTAL MATERIAL + SERVICIOS (USD)',
             bomGrandTotalLabel(-2));

    // Singular.
    var one = bomGrandTotalLabel(1);
    t.assertTrue('1 missing -> starts with legacy label',
                 one.indexOf('TOTAL MATERIAL + SERVICIOS (USD)') === 0);
    t.assertTrue('1 missing -> singular "1 PARTIDA "',
                 one.indexOf('1 PARTIDA SIN COTIZAR') >= 0);
    t.assertTrue('1 missing -> NOT plural "PARTIDAS"',
                 one.indexOf('PARTIDAS') < 0);
    t.assertTrue('1 missing -> flags TOTAL PRELIMINAR',
                 one.indexOf('TOTAL PRELIMINAR') >= 0);

    // Plural.
    var three = bomGrandTotalLabel(3);
    t.assertTrue('3 missing -> plural "3 PARTIDAS SIN COTIZAR"',
                 three.indexOf('3 PARTIDAS SIN COTIZAR') >= 0);
    t.assertTrue('3 missing -> flags TOTAL PRELIMINAR',
                 three.indexOf('TOTAL PRELIMINAR') >= 0);
    t.assertTrue('3 missing -> warning glyph present',
                 three.indexOf('\u26A0') >= 0);
  }
});


registerTest({
  id      : 'UNIT_FIN_GUARD_OM_ZERO_FIRES',
  group   : 'unit',
  module  : 'calc/financial_guards',
  scenarios: [],
  tags    : ['financials', 'batch2', 'g6', 'regression'],
  source  : 'tests_unit/writers/Batch2GuardTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/financial_guards: OM_ZERO fires on $0 O&M [G6]');

    function codes(o) {
      return argiaFinancialGuardNotes(o).map(function (g) { return g.code; });
    }

    // The audit finding: live BESS proposal with O&M = $0. Must fire even on
    // a PV-only project -- every solar installation has real O&M.
    t.assert('om=0, no BESS -> exactly OM_ZERO',
             'OM_ZERO',
             codes({ omCostMxnPerYear: 0, replacementReserveMxnPerYear: 50000,
                     bessMaterialsMxn: 0 }).join(','));

    // Healthy O&M -> silent.
    t.assert('om=120000 -> no guards',
             '',
             codes({ omCostMxnPerYear: 120000,
                     replacementReserveMxnPerYear: 50000,
                     bessMaterialsMxn: 0 }).join(','));

    // Defensive: NaN / negative / missing all treated as not-positive.
    t.assertTrue('om missing -> OM_ZERO fires',
                 codes({ replacementReserveMxnPerYear: 1,
                         bessMaterialsMxn: 0 }).indexOf('OM_ZERO') >= 0);
    t.assertTrue('om negative -> OM_ZERO fires',
                 codes({ omCostMxnPerYear: -5,
                         replacementReserveMxnPerYear: 1,
                         bessMaterialsMxn: 0 }).indexOf('OM_ZERO') >= 0);

    // Message must point the user at the actual input cell.
    var msg = argiaFinancialGuardNotes({ omCostMxnPerYear: 0,
                                         replacementReserveMxnPerYear: 1,
                                         bessMaterialsMxn: 0 })[0].msg;
    t.assertTrue('OM_ZERO msg names INPUT_BAAS fila 16',
                 msg.indexOf('INPUT_BAAS fila 16') >= 0);
    t.assertTrue('OM_ZERO msg says sobreestimado',
                 msg.toLowerCase().indexOf('sobreestimad') >= 0);
  }
});


registerTest({
  id      : 'UNIT_FIN_GUARD_RESERVE_BESS_ONLY',
  group   : 'unit',
  module  : 'calc/financial_guards',
  scenarios: [],
  tags    : ['financials', 'batch2', 'g6', 'regression'],
  source  : 'tests_unit/writers/Batch2GuardTests.gs',
  fn      : function (t, ctx) {
    t.suite('UNIT calc/financial_guards: RESERVE_ZERO is BESS-gated [G6]');

    function codes(o) {
      return argiaFinancialGuardNotes(o).map(function (g) { return g.code; });
    }

    // reserve=0 on a BESS project -> fires.
    t.assert('reserve=0 + BESS materials -> RESERVE_ZERO',
             'RESERVE_ZERO',
             codes({ omCostMxnPerYear: 120000,
                     replacementReserveMxnPerYear: 0,
                     bessMaterialsMxn: 17000000 }).join(','));

    // reserve=0 on PV-only -> exempt (no battery to provision for).
    t.assert('reserve=0 + NO BESS -> silent',
             '',
             codes({ omCostMxnPerYear: 120000,
                     replacementReserveMxnPerYear: 0,
                     bessMaterialsMxn: 0 }).join(','));

    // reserve funded -> silent even with BESS.
    t.assert('reserve=80000 + BESS -> silent',
             '',
             codes({ omCostMxnPerYear: 120000,
                     replacementReserveMxnPerYear: 80000,
                     bessMaterialsMxn: 17000000 }).join(','));

    // Both guards stack on the audit's exact live-workbook state:
    // BESS project, om=0, reserve=0.
    t.assert('audit state (om=0, reserve=0, BESS) -> both fire',
             'OM_ZERO,RESERVE_ZERO',
             codes({ omCostMxnPerYear: 0,
                     replacementReserveMxnPerYear: 0,
                     bessMaterialsMxn: 17000000 }).join(','));

    var rmsg = argiaFinancialGuardNotes({ omCostMxnPerYear: 1,
                                          replacementReserveMxnPerYear: 0,
                                          bessMaterialsMxn: 1 })[0].msg;
    t.assertTrue('RESERVE_ZERO msg names INPUT_BAAS fila 17',
                 rmsg.indexOf('INPUT_BAAS fila 17') >= 0);
  }
});
