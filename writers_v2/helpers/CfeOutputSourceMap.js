// =============================================================================
// ARGIA ENGINE v2 -- File: writers_v2/helpers/CfeOutputSourceMap.gs
// -----------------------------------------------------------------------------
// CHUNK 7 — Source cell map for CFE_OUTPUT_v2 + read helpers.
//
// WHAT THIS DOES
//   Declares CFE_OUT_SRC_V2: every (sheet, row, col) the v2 writer reads from
//   INPUT_CFE, CFE_SIMULATION, BESS_SIMULATION. Provides two pure readers:
//     - readCfeScalar(ss, srcKey)   -> single value (or '' if sheet missing)
//     - readCfeMonthly(ss, srcKey)  -> array of 12 (cols C..N), zero-filled
//                                       if sheet missing
//
// WHY ISOLATED FROM LEGACY
//   Legacy 06_WriteCfeOutput.js defines CFE_OUT_SRC + _cfeOutReadScalar +
//   _cfeOutReadMonthly inline. v2 must not depend on those symbols — when
//   legacy is deleted at cutover (Chunk 11), v2 keeps working unchanged.
//
//   The CFE_OUT_SRC_V2 map is a verbatim copy of legacy CFE_OUT_SRC. We're
//   not changing source coordinates in this chunk — that would conflate
//   "migrate the writer" with "fix source addresses" and is risky.
//
// ROW-DRIFT SAFETY
//   Same risk legacy has: if INPUT_CFE / CFE_SIMULATION / BESS_SIMULATION
//   shift rows, this map silently reads the wrong cells. Legacy guards via
//   Phase 19 (99t_Phase19_WriteCfeOutput.gs) which asserts col-B labels.
//   v2 inherits the same risk — fix at cutover by either keeping Phase 19
//   pointing at v2 or porting the label-assertion checks here.
//
// CONTRACT
//   - readCfeScalar returns '' (empty string) for missing source sheets,
//     not null. Callers test `=== ''` to distinguish "not populated" from
//     "0". Matches legacy behavior — Y1SS section relies on this to decide
//     whether to render.
//   - readCfeMonthly returns 12 zeros if the source sheet is missing.
//     Callers may treat 0 as "no consumption" — fine because the source
//     sheet existence is checked upstream in writeCfeOutputV2.
//
// DEPENDENCIES
//   None. Pure data + 2 readers. Standalone.
// =============================================================================


// -----------------------------------------------------------------------------
// CFE_OUT_SRC_V2 — copy of legacy CFE_OUT_SRC at the time of chunk 7.
// -----------------------------------------------------------------------------
// Each entry: { sheet: 'INPUT_CFE'|'CFE_SIMULATION'|'BESS_SIMULATION',
//               row:  <1-based>,
//               col:  <1-based, only for scalars; monthly bands read cols C..N>
//             }
// -----------------------------------------------------------------------------
var CFE_OUT_SRC_V2 = (typeof CFE_OUT_SRC_V2 !== 'undefined' && CFE_OUT_SRC_V2) ? CFE_OUT_SRC_V2 : {
  // INPUT_CFE header strip (rows 4-7, scalars)
  input_tariffCode      : { sheet: 'INPUT_CFE', row:  4, col:  3 },  // C4
  input_serviceName     : { sheet: 'INPUT_CFE', row:  4, col:  6 },  // F4
  input_serviceNumber   : { sheet: 'INPUT_CFE', row:  5, col:  6 },  // F5
  input_contractedKw    : { sheet: 'INPUT_CFE', row:  6, col:  6 },  // F6
  input_2pctBT          : { sheet: 'INPUT_CFE', row:  7, col:  3 },  // C7

  // INPUT_CFE monthly bands (cols C..N)
  input_kwhBase         : { sheet: 'INPUT_CFE', row: 10 },
  input_kwhInter        : { sheet: 'INPUT_CFE', row: 11 },
  input_kwhPunta        : { sheet: 'INPUT_CFE', row: 12 },
  input_kWbase          : { sheet: 'INPUT_CFE', row: 13 },
  input_kWinter         : { sheet: 'INPUT_CFE', row: 14 },
  input_kWpunta         : { sheet: 'INPUT_CFE', row: 15 },
  input_demandaFact     : { sheet: 'INPUT_CFE', row: 20 },
  // input_facturacion (row 35) / input_total (row 37): RETIRED in 4.51.0 along
  // with the INPUT_CFE bill reconstruction (rows 30-37). No consumer ever
  // requested them; the v2 writer does not read this legacy map for the bill.

  // INPUT_CFE interconnection mode (scalar)
  // 4.0.0 fix: was row 40 — display read the wrong cell and showed blank.
  // Confirmed canonical cell is C41 (matches the simulation reader in
  // 02_LoadDB.readBessInterconnectionFromInputCfe and 19_RunBessSuggestion).
  input_interconnMode   : { sheet: 'INPUT_CFE', row: 41, col:  3 },
  input_autoconsumoPct  : { sheet: 'INPUT_CFE', row: 42, col:  3 },

  // CFE_SIMULATION monthly bands (rows 5-7 = kWh after PV; row 8 = solar)
  csim_kwhBaseAfterPv   : { sheet: 'CFE_SIMULATION', row:  5 },
  csim_kwhInterAfterPv  : { sheet: 'CFE_SIMULATION', row:  6 },
  csim_kwhPuntaAfterPv  : { sheet: 'CFE_SIMULATION', row:  7 },
  csim_solarKwh         : { sheet: 'CFE_SIMULATION', row:  8 },
  csim_facturacion      : { sheet: 'CFE_SIMULATION', row: 35 },
  csim_total            : { sheet: 'CFE_SIMULATION', row: 39 },  // legacy noted row 39 is TOTAL
  csim_ahorroEnergia    : { sheet: 'CFE_SIMULATION', row: 41 },
  csim_pvExportado      : { sheet: 'CFE_SIMULATION', row: 42 },

  // BESS_SIMULATION mode + strategy (scalars, col D)
  bsim_mode             : { sheet: 'BESS_SIMULATION', row:  6, col:  4 },
  bsim_strategy         : { sheet: 'BESS_SIMULATION', row:  7, col:  4 },
  bsim_demandSource     : { sheet: 'BESS_SIMULATION', row:  8, col:  4 },

  // BESS_SIMULATION annual scalars (col D)
  bsim_reciboBase       : { sheet: 'BESS_SIMULATION', row: 12, col:  4 },
  bsim_ahorroPv         : { sheet: 'BESS_SIMULATION', row: 13, col:  4 },
  bsim_reciboTrasPv     : { sheet: 'BESS_SIMULATION', row: 14, col:  4 },
  bsim_ahorroBessCap    : { sheet: 'BESS_SIMULATION', row: 15, col:  4 },
  bsim_ahorroBessDist   : { sheet: 'BESS_SIMULATION', row: 16, col:  4 },
  bsim_ahorroBessVar    : { sheet: 'BESS_SIMULATION', row: 17, col:  4 },
  bsim_reciboFinal      : { sheet: 'BESS_SIMULATION', row: 18, col:  4 },

  // BESS_SIMULATION monthly bands (rows 25-27 = Dmax variants; 30-32 = ahorros)
  bsim_dmaxSinBess      : { sheet: 'BESS_SIMULATION', row: 25 },
  bsim_potShaving       : { sheet: 'BESS_SIMULATION', row: 26 },
  bsim_dmaxConBess      : { sheet: 'BESS_SIMULATION', row: 27 },
  bsim_ahorroMesCap     : { sheet: 'BESS_SIMULATION', row: 30 },
  bsim_ahorroMesDist    : { sheet: 'BESS_SIMULATION', row: 31 },
  bsim_ahorroMesVar     : { sheet: 'BESS_SIMULATION', row: 32 },

  // BESS_SIMULATION battery spec panel (col D)
  bsim_energiaUsable    : { sheet: 'BESS_SIMULATION', row: 37, col:  4 },
  bsim_potenciaKw       : { sheet: 'BESS_SIMULATION', row: 38, col:  4 },
  bsim_capacidadKwh     : { sheet: 'BESS_SIMULATION', row: 39, col:  4 },

  // BDF-11.1 steady-state cells written by 02i_SetupBessSimulationSteady
  bsim_reciboFinalSteady     : { sheet: 'BESS_SIMULATION', row: 48, col:  4 },  // D48
  bsim_ahorroCapSteadyAnnual : { sheet: 'BESS_SIMULATION', row: 45, col: 15 }   // O45
};


// -----------------------------------------------------------------------------
// readCfeScalar(ss, srcKey, _testOpts)
// -----------------------------------------------------------------------------
// Reads a single cell. Returns '' when the source sheet doesn't exist —
// matches legacy contract; callers test `=== ''` to skip rendering.
//
// _testOpts:
//   { srcMap }   — override CFE_OUT_SRC_V2 for tests
// -----------------------------------------------------------------------------
function readCfeScalar(ss, srcKey, _testOpts) {
  var srcMap = (_testOpts && _testOpts.srcMap) || CFE_OUT_SRC_V2;
  var src = srcMap[srcKey];
  if (!src) {
    throw new Error('readCfeScalar: missing source-map key "' + srcKey + '"');
  }
  var sh = ss.getSheetByName(src.sheet);
  if (!sh) return '';
  return sh.getRange(src.row, src.col || 1).getValue();
}


// -----------------------------------------------------------------------------
// readCfeMonthly(ss, srcKey, _testOpts)
// -----------------------------------------------------------------------------
// Reads a 12-cell monthly band (cols C..N = cols 3..14). Returns array of
// length 12. Returns 12 zeros when the source sheet doesn't exist.
// -----------------------------------------------------------------------------
function readCfeMonthly(ss, srcKey, _testOpts) {
  var srcMap = (_testOpts && _testOpts.srcMap) || CFE_OUT_SRC_V2;
  var src = srcMap[srcKey];
  if (!src) {
    throw new Error('readCfeMonthly: missing source-map key "' + srcKey + '"');
  }
  var sh = ss.getSheetByName(src.sheet);
  if (!sh) return [0,0,0,0,0,0,0,0,0,0,0,0];
  return sh.getRange(src.row, 3, 1, 12).getValues()[0];
}


// -----------------------------------------------------------------------------
// Month label constants used by both template and writer
// -----------------------------------------------------------------------------
var CFE_OUT_MONTHS_V2 = (typeof CFE_OUT_MONTHS_V2 !== 'undefined' && CFE_OUT_MONTHS_V2)
  ? CFE_OUT_MONTHS_V2
  : ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
