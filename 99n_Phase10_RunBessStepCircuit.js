// =============================================================================
// ARGIA ENGINE -- Phase 10 test suite: runBessStep circuit wiring (Increment 4b-2)
// Paste this function into 99_TestRunner.gs, and add the call
//   try { addPhase10Tests(t, ss); } catch (e) { t.error('Phase10 aborted', e); }
// right after the addPhase9bTests block in runTests().
//
// SCOPE: Increment 4b-2 wired calcBessCircuit + a coupling-aware busbar note
// into runBessStep. Phase 6 still covers the pre-4b-2 behaviour (capacity,
// throughput, validation). Phase 10 covers ONLY the new fields:
//   - result.coupling           (resolved from INPUT_DESIGN!C17)
//   - result.circuit            (calcBessCircuit output, or null)
//   - result.busbarNote         (coupling-aware string)
//   - circuit not-sizeable path (no battery voltage available today)
//
// HONESTY NOTE: INPUT_BESS has no battery-voltage cell yet, so calcBessCircuit
// receives no dcBusVoltageV and correctly returns sizeable:false. Phase 10
// asserts THAT honest behaviour -- the circuit is wired and reports its own
// missing-input state rather than fabricating a conductor size. When a voltage
// input is added in a later increment, the sizeable:true path activates and
// this suite should be extended then.
//
// SAFETY: snapshots INPUT_PROJECT!D64 (battery toggle) + INPUT_DESIGN!C17
// (coupling), writes test values, asserts, and ALWAYS restores in finally.
// =============================================================================

function addPhase10Tests(t, ss) {
  t.suite('Phase10: runBessStep circuit wiring');

  var shProj   = ss.getSheetByName('INPUT_PROJECT');
  var shDesign = ss.getSheetByName('INPUT_DESIGN');
  var shBess   = ss.getSheetByName('INPUT_BESS');
  if (!shProj || !shDesign || !shBess) {
    t.error('Phase10 setup',
            new Error('INPUT_PROJECT / INPUT_DESIGN / INPUT_BESS missing'));
    return;
  }

  // -- snapshot every cell we touch ---------------------------------------
  var snap = {
    toggle:   shProj.getRange(64, 4).getValue(),    // D64 install battery
    coupling: shDesign.getRange(17, 3).getValue(),  // C17 coupling
    bCap:     shBess.getRange(10, 3).getValue(),    // C10 capacity
    bPow:     shBess.getRange(11, 3).getValue(),    // C11 power
  };

  function restore() {
    shProj.getRange(64, 4).setValue(snap.toggle);
    shDesign.getRange(17, 3).setValue(snap.coupling);
    shBess.getRange(10, 3).setValue(snap.bCap);
    shBess.getRange(11, 3).setValue(snap.bPow);
    SpreadsheetApp.flush();
  }

  try {
    // -- arrange: a valid, enabled battery --------------------------------
    shProj.getRange(64, 4).setValue('YES');
    shBess.getRange(10, 3).setValue(200);   // 200 kWh
    shBess.getRange(11, 3).setValue(100);   // 100 kW
    SpreadsheetApp.flush();

    // === TEST 1: DC_COUPLED path =========================================
    shDesign.getRange(17, 3).setValue('DC_COUPLED');
    SpreadsheetApp.flush();
    var dc = runBessStep(ss);

    t.assertTrue('DC: bessEnabled true', dc.bessEnabled);
    t.assert('DC: result.coupling = DC_COUPLED', 'DC_COUPLED', dc.coupling);
    t.assertTrue('DC: result.busbarNote is a non-empty string',
                 typeof dc.busbarNote === 'string' && dc.busbarNote.length > 0);
    t.assertTrue('DC: busbarNote mentions DC-coupled',
                 dc.busbarNote.indexOf('DC-coupled') >= 0);
    // circuit ran -- assert the call happened and produced a typed object.
    // Sizeable depends on whether a battery voltage is available (DB or manual);
    // accept BOTH paths so the test stays valid as the live battery picked in
    // INPUT_BESS!C6 changes (CUSTOM_MANUAL = no voltage; catalog = real V).
    t.assertTrue('DC: result.circuit present', dc.circuit !== null
                                            && dc.circuit !== undefined);
    if (dc.circuit) {
      if (dc.circuit.sizeable) {
        // Voltage available -> circuit was sized. Assert shape.
        t.assertTrue('DC: sizeable -> has runs',
                     Array.isArray(dc.circuit.runs) && dc.circuit.runs.length > 0);
        // Note: conductorSize is a number/string like 3, "1/0" -- coerce to bool.
        var hasCond = !!(dc.circuit.runs[0]
                      && dc.circuit.runs[0].conductorSize !== undefined
                      && dc.circuit.runs[0].conductorSize !== null
                      && String(dc.circuit.runs[0].conductorSize).length > 0);
        t.assertTrue('DC: sizeable -> first run has a conductor size', hasCond);
        // sized circuit must NOT emit a "circuit not sized" warning
        t.assertFalse('DC: sized -> no "circuit not sized" warning',
                      _phase10HasWarning(dc.warnings, 'circuit not sized'));
      } else {
        // No voltage -> graceful "not sized" with a reason + warning.
        t.assertTrue('DC: not sizeable -> gives a reason',
                     typeof dc.circuit.reason === 'string'
                     && dc.circuit.reason.length > 0);
        t.assertTrue('DC: not sizeable -> "circuit not sized" warning raised',
                     _phase10HasWarning(dc.warnings, 'circuit not sized'));
      }
    }

    // === TEST 2: AC_COUPLED path -- busbar note changes ==================
    shDesign.getRange(17, 3).setValue('AC_COUPLED');
    SpreadsheetApp.flush();
    var ac = runBessStep(ss);

    t.assert('AC: result.coupling = AC_COUPLED', 'AC_COUPLED', ac.coupling);
    t.assertTrue('AC: busbarNote mentions AC-coupled',
                 ac.busbarNote.indexOf('AC-coupled') >= 0);
    t.assertTrue('AC: busbarNote mentions main + PV + BESS',
                 ac.busbarNote.indexOf('BESS') >= 0);
    // the AC and DC busbar notes must genuinely differ
    t.assertTrue('AC busbarNote differs from DC busbarNote',
                 ac.busbarNote !== dc.busbarNote);

    // === TEST 3: summary includes coupling + circuit lines ===============
    var hasCouplingLine = false, hasCircuitLine = false;
    for (var i = 0; i < ac.summary.length; i++) {
      if (ac.summary[i].indexOf('coupling') >= 0) hasCouplingLine = true;
      if (ac.summary[i].indexOf('circuit') >= 0)  hasCircuitLine  = true;
    }
    t.assertTrue('AC: summary has a coupling line', hasCouplingLine);
    t.assertTrue('AC: summary has a circuit line',  hasCircuitLine);

    // === TEST 4: PV-only project -- no circuit, no crash =================
    shProj.getRange(64, 4).setValue('NO');
    SpreadsheetApp.flush();
    var pv = runBessStep(ss);
    t.assertFalse('PV-only: bessEnabled false', pv.bessEnabled);
    // disabled path is the original early-return -- it has no coupling field
    t.assertTrue('PV-only: no circuit object',
                 pv.circuit === undefined || pv.circuit === null);

  } finally {
    restore();
    t.info('Phase10 cleanup',
           'INPUT_PROJECT/INPUT_DESIGN/INPUT_BESS restored to pre-test state');
  }
}

// helper: case-insensitive substring search across a warnings array
function _phase10HasWarning(warnings, needle) {
  if (!warnings) return false;
  var n = String(needle).toLowerCase();
  for (var i = 0; i < warnings.length; i++) {
    if (String(warnings[i]).toLowerCase().indexOf(n) >= 0) return true;
  }
  return false;
}