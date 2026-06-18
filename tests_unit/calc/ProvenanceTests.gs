// =============================================================================
// ARGIA TESTS -- tests_unit/calc/ProvenanceTests.gs
// T11 (v4.47.0): reusable provenance note helper. PURE formatting + guarded
// stamp behavior.
// =============================================================================

registerTest({
  id: 'UNIT_PROVENANCE_NOTE',
  group: 'unit', module: 'calc/provenance',
  scenarios: [], tags: ['calc', 'provenance', 'mdc', 't11'],
  source: 'tests_unit/calc/ProvenanceTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/provenance: buildProvenanceNote + stampProvenanceNote');

    // full record -> exact multi-line note
    var full = buildProvenanceNote({
      label: 'VPN', formula: 'VPN(WACC; flujos) - CAPEX',
      sources: ['INPUT_BAAS!D15 (WACC)', 'flujos netos'],
      version: '4.47.0', date: '2026-06-18'
    });
    var expected = 'TRAZABILIDAD: VPN\n'
                 + 'Calculo: VPN(WACC; flujos) - CAPEX\n'
                 + 'Fuente: INPUT_BAAS!D15 (WACC), flujos netos\n'
                 + 'Motor v4.47.0 - 2026-06-18';
    t.assert('full record exact note', expected, full);

    // sources as a plain string (not array)
    var strSrc = buildProvenanceNote({ label: 'LCOE', sources: 'BOM_v2!G94', version: '4.47.0' });
    t.assert('string sources note', 'TRAZABILIDAD: LCOE\nFuente: BOM_v2!G94\nMotor v4.47.0', strSrc);

    // version omitted -> falls back to ENGINE_VERSION (just assert it is present)
    var noVer = buildProvenanceNote({ label: 'TIR' });
    t.assertContains('falls back to engine version', noVer, 'Motor v' + ENGINE_VERSION);
    t.assertContains('label present', noVer, 'TRAZABILIDAD: TIR');

    // no formula / no date -> those lines omitted
    var sparse = buildProvenanceNote({ label: 'X', sources: 'Y', version: '1.0' });
    t.assertFalse('no Calculo line when formula absent', sparse.indexOf('Calculo:') >= 0);
    t.assert('sparse exact', 'TRAZABILIDAD: X\nFuente: Y\nMotor v1.0', sparse);

    // empty record -> empty string
    t.assert('empty record -> empty', '', buildProvenanceNote({}));
    t.assert('null record -> empty', '', buildProvenanceNote(null));

    // stamp guard: a range without setNote returns false and never throws
    t.assertFalse('mock range w/o setNote -> false', stampProvenanceNote({}, { label: 'A', version: '1.0' }));
    t.assertFalse('null range -> false', stampProvenanceNote(null, { label: 'A' }));

    // stamp with a capturing mock -> true + correct note written
    var captured = null;
    var mockRng = { setNote: function (s) { captured = s; } };
    var ok = stampProvenanceNote(mockRng, { label: 'CAPEX', formula: 'BOM + instalacion', version: '1.0' });
    t.assertTrue('stamp returns true', ok);
    t.assert('stamp wrote expected note', 'TRAZABILIDAD: CAPEX\nCalculo: BOM + instalacion\nMotor v1.0', captured);
  }
});
