// =============================================================================
// ARGIA TESTS -- tests_unit/inputs/BessAuthoritativeCtxTests.gs
// -----------------------------------------------------------------------------
// [A2c] Locks applyBessAuthoritativeContext: the single-source injection of
// coupling + RESOLVED voltages into the BESS install context, used by both
// orchestration sites (00_Main step 9.6, 13 standalone install).
//
// The case that motivated it: blank C44/C45 read as 0 in the raw context
// while the circuit calc resolves to the battery DB nominal -- the same
// silent voltage split the 2026-06-10 unification fixed for populated cells.
// After injection, vdrop/BOS/NOM and the circuit calc always agree.
// =============================================================================

registerTest({
  id      : 'UNIT_INPUTS_BESS_AUTHORITATIVE_CTX',
  group   : 'unit',
  module  : 'inputs/bess_voltage',
  scenarios: [],
  tags    : ['inputs', 'bess', 'voltage', 'a2', 'install-context'],
  source  : 'tests_unit/inputs/BessAuthoritativeCtxTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT inputs/bess_voltage [A2c]: applyBessAuthoritativeContext');

    // -- The motivating case: blank C44/C45 (raw ctx 0) + catalog battery ----
    // Circuit calc resolved 864 (DB nominal); ctx must get the same 864.
    var ctxBlank = { coupling: 'STALE', dcBusV: 0, acV: 0, dcRunM: 25 };
    var resBlank = { coupling: 'DC_COUPLED',
                     bess: { dcBusVoltageV: 864, acVoltageV: 480 } };
    var out = applyBessAuthoritativeContext(ctxBlank, resBlank);
    t.assert('blank-cell ctx gets resolved DC 864', 864, out.dcBusV);
    t.assert('blank-cell ctx gets resolved AC 480', 480, out.acV);
    t.assert('coupling overridden from bessResult', 'DC_COUPLED', out.coupling);
    t.assert('other ctx fields untouched',          25,  out.dcRunM);
    t.assertTrue('mutates and returns the same object', out === ctxBlank);

    // -- Populated cells (CULLIGAN): resolved == raw, no behavior change -----
    var ctxPop = { dcBusV: 864, acV: 480 };
    applyBessAuthoritativeContext(ctxPop,
      { coupling: 'DC_COUPLED', bess: { dcBusVoltageV: 864, acVoltageV: 480 } });
    t.assert('populated DC unchanged (864=864)', 864, ctxPop.dcBusV);
    t.assert('populated AC unchanged (480=480)', 480, ctxPop.acV);

    // -- CUSTOM_MANUAL with nothing supplied: 0 stays 0 ("pendiente") --------
    var ctxNone = { dcBusV: 0, acV: 0 };
    applyBessAuthoritativeContext(ctxNone,
      { coupling: 'AC_COUPLED', bess: { dcBusVoltageV: 0, acVoltageV: 0 } });
    t.assert('unsupplied DC stays 0', 0, ctxNone.dcBusV);
    t.assert('unsupplied AC stays 0', 0, ctxNone.acV);

    // -- bess absent (defensive): voltages untouched, coupling still set -----
    var ctxNoBess = { dcBusV: 7, acV: 8 };
    applyBessAuthoritativeContext(ctxNoBess, { coupling: 'DC_COUPLED' });
    t.assert('no bess: dcBusV untouched', 7, ctxNoBess.dcBusV);
    t.assert('no bess: acV untouched',    8, ctxNoBess.acV);
    t.assert('no bess: coupling still injected', 'DC_COUPLED', ctxNoBess.coupling);

    // -- junk voltage coerces to 0, never NaN --------------------------------
    var ctxJunk = {};
    applyBessAuthoritativeContext(ctxJunk,
      { coupling: 'DC_COUPLED', bess: { dcBusVoltageV: 'Loading...', acVoltageV: null } });
    t.assert('junk DC -> 0', 0, ctxJunk.dcBusV);
    t.assert('null AC -> 0', 0, ctxJunk.acV);
  }
});
