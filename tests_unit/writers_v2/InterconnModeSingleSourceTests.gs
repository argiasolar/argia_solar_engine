// =============================================================================
// ARGIA TESTS -- tests_unit/writers_v2/InterconnModeSingleSourceTests.gs
// -----------------------------------------------------------------------------
// T5 (v4.38.0): interconnection-mode single source.
//
// The DISPLAYED mode (CFE_OUTPUT) and the API mode must reflect the CANONICAL
// mode the engine resolver produced -- never an independent re-read of
// INPUT_CFE!C41. The resolver's Spanish->English mapping is covered by
// CfeReadersMigrationTests; here we lock the display chain that turns the
// resolver's canonical mode back into the bilingual label:
//
//   resolver mode (canonical) -> _cfeOutV2_canonicalModeToRawEnum -> _cfeOutV2_interconnLabel
//
// PURE -- no workbook.
// =============================================================================

registerTest({
  id: 'UNIT_INTERCONN_MODE_SINGLE_SOURCE',
  group: 'unit',
  module: 'writers_v2/interconn_mode',
  scenarios: [],
  tags: ['writers_v2', 'interconnection', 'mode', 'single-source', 't5'],
  source: 'tests_unit/writers_v2/InterconnModeSingleSourceTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT writers_v2/interconn_mode: canonical -> display chain');

    // 1. canonical mode -> raw enum (round-trips the resolver's vocab).
    t.assert('NET_METERING -> MEDICION_NETA', 'MEDICION_NETA',  _cfeOutV2_canonicalModeToRawEnum('NET_METERING'));
    t.assert('NET_BILLING  -> FACTURACION_NETA', 'FACTURACION_NETA', _cfeOutV2_canonicalModeToRawEnum('NET_BILLING'));
    t.assert('ZERO_EXPORT  -> SIN_EXPORTACION', 'SIN_EXPORTACION', _cfeOutV2_canonicalModeToRawEnum('ZERO_EXPORT'));
    t.assert('UNKNOWN -> "" (shows no-definido)', '', _cfeOutV2_canonicalModeToRawEnum('UNKNOWN'));
    t.assert('blank -> ""', '', _cfeOutV2_canonicalModeToRawEnum(''));
    t.assert('garbage -> "" (never passes a bogus value through)', '', _cfeOutV2_canonicalModeToRawEnum('WHATEVER'));

    // 2. Full chain: resolver canonical mode -> displayed bilingual label.
    function display(mode) { return _cfeOutV2_interconnLabel(_cfeOutV2_canonicalModeToRawEnum(mode)); }
    t.assertContains('NET_METERING displays NET_METERING', display('NET_METERING'), 'NET_METERING');
    t.assertContains('NET_METERING displays MEDICI', display('NET_METERING'), 'MEDICI');
    t.assertContains('NET_BILLING displays NET_BILLING', display('NET_BILLING'), 'NET_BILLING');
    t.assertContains('ZERO_EXPORT displays ZERO_EXPORT', display('ZERO_EXPORT'), 'ZERO_EXPORT');

    // 3. The fork that T5 closes: an unrecognized mode the sim ran as UNKNOWN
    //    must NOT display a bogus passthrough -- it shows "(no definido)".
    t.assert('UNKNOWN sim mode -> (no definido), not passthrough',
             '(no definido)', display('UNKNOWN'));
    t.assert('garbage sim mode -> (no definido), not passthrough',
             '(no definido)', display('SOME_BOGUS_MODE'));
  }
});
