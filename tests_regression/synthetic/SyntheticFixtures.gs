// =============================================================================
// tests_regression/synthetic/SyntheticFixtures.gs
// -----------------------------------------------------------------------------
// T12 (chunk a) — three synthetic golden fixtures proving the engine end-to-end
// from EXPLICIT INPUTS ONLY. This file is the DECLARATIVE registry + the pure
// validators that the Node rig can check today:
//   - SYNTHETIC_FIXTURES        the 3 fixtures (inputs by INPUT_MAP key + specs)
//   - validateSyntheticFixtureKeys()   every input key routes through INPUT_MAP
//                                       (the plan's "input-map completeness" test)
//   - syntheticPrefillKeys()    engine-consumed numeric keys the tripwire checks
//
// The LIVE runner (snapshot -> Start New Project -> prefill tripwire -> writeInput
// loop -> runArgiaEngine -> assert -> restore) and the captured NUMERIC goldens
// land in chunk b/c -- those numbers come from running the engine, never guessed.
//
// Each fixture carries 'inputs' (mapKey -> value; arrays for 12-month ranges) and
// 'structural' (negative / gate assertions that are knowable WITHOUT a run:
// BESS-off zeros, SIN COTIZAR on a blank structure, etc.).
// =============================================================================

// 12-month array from an annual total and a normalized 12-shape (sums to ~1).
function _synthMonthly(annualTotal, shape) {
  var s = shape || [0.083,0.082,0.085,0.084,0.086,0.085,0.087,0.086,0.083,0.084,0.079,0.076];
  var sum = 0; for (var i = 0; i < 12; i++) sum += s[i];
  var out = [];
  for (var j = 0; j < 12; j++) out.push(Math.round(annualTotal * (s[j] / sum)));
  return out;
}
// Flat 12-month array (kW peaks, FP, días -- roughly constant month to month).
function _synthFlat(v) { var a = []; for (var i = 0; i < 12; i++) a.push(v); return a; }

var SYNTHETIC_FIXTURES = {

  // ~500 kWp, KR18 roof, GDMTH, BESS OFF -> all BESS gating must zero out.
  SYNTH_500: {
    id: 'SYNTH_500',
    label: '~500 kWp · KR18 · GDMTH · BESS OFF',
    inputs: {
      projectName: 'SYNTH_500', clientName: 'Synthetic 500 kWp', businessType: 'CAPEX_ROOF',
      panelModel: 'LR7-72HVHF-640M', panelQty: 780, panelPowerW: 640, modsPerString: 18,
      inverterPrimaryModel: 'SUN2000-100KTL-M1',
      inverterPrimaryQty: 5, inverterPrimaryKw: 100, inverterPrimaryStrings: 8, totalInverters: 5,
      roofType: 'KR18',
      cfeTariff: 'GDMTH', cfeInterconnMode: 'SIN_EXPORTACION',
      cfeKwhBase:       _synthMonthly(720000), cfeKwhIntermedia: _synthMonthly(1680000),
      cfeKwhPunta:      _synthMonthly(360000),
      cfeKwBase:        _synthFlat(520), cfeKwIntermedia: _synthFlat(640), cfeKwPunta: _synthFlat(600),
      cfeKwMaxAnoMovil: _synthFlat(640), cfeKvarh: _synthMonthly(1300000),
      cfeDias:          _synthFlat(30), cfeFpPct: _synthFlat(0.92), cfeDemandaFacturable: _synthFlat(600),
      installBattery: 'NO'
    },
    structural: {
      bessOff: true,                 // BESS gates -> 0 (no battery line, no BESS savings)
      structurePresent: true,        // KR18 priced -> structure rule PASS
      offerEmittableExpected: true
    }
  },

  // ~600 kWp, KR18 roof, GDMTH, BESS ON (PEAK_SHAVING).
  SYNTH_600: {
    id: 'SYNTH_600',
    label: '~600 kWp · KR18 · GDMTH · BESS ON (PEAK_SHAVING)',
    inputs: {
      projectName: 'SYNTH_600', clientName: 'Synthetic 600 kWp', businessType: 'CAPEX_ROOF',
      panelModel: 'LR7-72HVHF-640M', panelQty: 938, panelPowerW: 640, modsPerString: 18,
      inverterPrimaryModel: 'SUN2000-100KTL-M1',
      inverterPrimaryQty: 6, inverterPrimaryKw: 100, inverterPrimaryStrings: 9, totalInverters: 6,
      roofType: 'KR18',
      cfeTariff: 'GDMTH', cfeInterconnMode: 'SIN_EXPORTACION',
      cfeKwhBase:       _synthMonthly(900000), cfeKwhIntermedia: _synthMonthly(2050000),
      cfeKwhPunta:      _synthMonthly(470000),
      cfeKwBase:        _synthFlat(640), cfeKwIntermedia: _synthFlat(780), cfeKwPunta: _synthFlat(740),
      cfeKwMaxAnoMovil: _synthFlat(780), cfeKvarh: _synthMonthly(1600000),
      cfeDias:          _synthFlat(30), cfeFpPct: _synthFlat(0.90), cfeDemandaFacturable: _synthFlat(740),
      installBattery: 'YES', bessBatteryId: 'CUSTOM_MANUAL',
      bessCapacityKwh: 1000, bessPowerKw: 500, bessStrategy: 'PEAK_SHAVING'
    },
    structural: {
      bessOff: false,                // BESS present -> battery line + BESS savings
      structurePresent: true,
      offerEmittableExpected: true
    }
  },

  // ~650 kWp, CONCRETE roof, GDMTH, BESS ON (LOAD_SHIFTING + net-billing).
  // Structure deliberately BLANK -> ESTRUCTURA NO SELECCIONADA + SIN COTIZAR;
  // transformer present -> SIN COTIZAR. This one is INTENTIONALLY not emittable
  // (structure_cost == 0 -> BLOCKED) -- the negative-path proof.
  SYNTH_650: {
    id: 'SYNTH_650',
    label: '~650 kWp · concrete (blank structure) · GDMTH · BESS ON (LOAD_SHIFTING/net-billing)',
    inputs: {
      projectName: 'SYNTH_650', clientName: 'Synthetic 650 kWp', businessType: 'CAPEX_ROOF',
      panelModel: 'LR7-72HVHF-640M', panelQty: 1016, panelPowerW: 640, modsPerString: 18,
      inverterPrimaryModel: 'SUN2000-100KTL-M1',
      inverterPrimaryQty: 7, inverterPrimaryKw: 100, inverterPrimaryStrings: 9, totalInverters: 7,
      roofType: 'RT37',              // concrete; structure key intentionally OMITTED below
      cfeTariff: 'GDMTH', cfeInterconnMode: 'FACTURACION_NETA',
      cfeKwhBase:       _synthMonthly(980000), cfeKwhIntermedia: _synthMonthly(2200000),
      cfeKwhPunta:      _synthMonthly(510000),
      cfeKwBase:        _synthFlat(700), cfeKwIntermedia: _synthFlat(840), cfeKwPunta: _synthFlat(800),
      cfeKwMaxAnoMovil: _synthFlat(840), cfeKvarh: _synthMonthly(1750000),
      cfeDias:          _synthFlat(30), cfeFpPct: _synthFlat(0.88), cfeDemandaFacturable: _synthFlat(800),
      installBattery: 'YES', bessBatteryId: 'CUSTOM_MANUAL',
      bessCapacityKwh: 1200, bessPowerKw: 600, bessStrategy: 'LOAD_SHIFTING'
      // NOTE: `structure` is intentionally NOT set -> ESTRUCTURA NO SELECCIONADA / SIN COTIZAR.
    },
    structural: {
      bessOff: false,
      structurePresent: false,       // blank structure -> SIN COTIZAR
      sinCotizarStructureExpected: true,
      offerEmittableExpected: false  // structure_cost == 0 -> BLOCKED (T10a)
    }
  }
};

// PURE. Every input key in every fixture must exist in INPUT_MAP (route through
// writeInput). Returns { ok, byFixture: { id: [missingKeys] }, totalMissing }.
// This doubles as the plan's input-map completeness check.
function validateSyntheticFixtureKeys() {
  var byFixture = {}, total = 0;
  Object.keys(SYNTHETIC_FIXTURES).forEach(function (fid) {
    var miss = [];
    var inp = SYNTHETIC_FIXTURES[fid].inputs || {};
    Object.keys(inp).forEach(function (k) {
      var present = (typeof inputMapHas === 'function')
        ? inputMapHas(k)
        : (typeof INPUT_MAP !== 'undefined' && INPUT_MAP.hasOwnProperty(k));
      if (!present) miss.push(k);
    });
    byFixture[fid] = miss;
    total += miss.length;
  });
  return { ok: total === 0, byFixture: byFixture, totalMissing: total };
}

// PURE. Engine-consumed numeric input keys the prefill tripwire asserts are
// blank/default after a DEFAULT rebuild (before a fixture is written).
function syntheticPrefillKeys() {
  if (typeof INPUT_MAP === 'undefined') return [];
  return Object.keys(INPUT_MAP).filter(function (k) {
    var m = INPUT_MAP[k];
    var consumed = m && m.consumedBy && m.consumedBy.indexOf('engine') >= 0;
    return consumed && m.type === 'number';
  });
}
