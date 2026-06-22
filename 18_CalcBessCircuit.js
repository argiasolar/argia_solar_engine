// =============================================================================
// ARGIA ENGINE -- File: 18_CalcBessCircuit.gs
// Battery circuit sizing. Sizes the conductor + OCPD for the battery's
// electrical connection, choosing WHICH runs to size based on the coupling
// type declared in INPUT_DESIGN.
//
//   DC_COUPLED -> battery shares the PV inverter's DC bus.
//                 Sizes ONE run: battery <-> shared DC bus.
//   AC_COUPLED -> battery has its own PCS (power conversion system).
//                 Sizes TWO runs: battery <-> PCS (DC side), and
//                 PCS <-> panelboard (AC side, a real new feeder).
//
// DESIGN PHILOSOPHY:
//   - PURE CALCULATOR. Takes plain objects + the tested elec tables, returns
//     a plain object. No spreadsheet I/O. Unit-testable with hand-derived
//     numbers, same as Phases 5-8.
//   - REUSES the tested helpers from 03_ElecTables.gs (selectConductor,
//     nextBreaker, getEgcSize) -- does not reinvent conductor/OCPD logic.
//   - The continuous-duty uplift uses nom.bess.dcCurrentFactor (Increment 4a,
//     1.25) applied to the battery circuit current.
//
// HONESTY NOTE:
//   Circuit current is derived from the battery power rating and the system
//   voltage the caller supplies. If the caller cannot supply a real voltage
//   (battery datasheet incomplete), the run is returned with sizeable:false
//   and a reason -- the calculator never invents a voltage to force a number.
//
// SEE ALSO:
//   03_ElecTables.gs  -- selectConductor / nextBreaker / getEgcSize
//   02_LoadDB.gs      -- nom.bess.dcCurrentFactor
//   01a_ReadInputsBess.gs -- the bess{} spec
// =============================================================================

// Coupling types -- mirror the INPUT_DESIGN dropdown (02c_InputMap bessCoupling).
var BESS_COUPLING = {
  DC_COUPLED: 'DC_COUPLED',
  AC_COUPLED: 'AC_COUPLED',
};

// ---------------------------------------------------------------------------
// calcBessCircuit(opts) -> result{}
//
// @param {Object} opts
//   coupling        : BESS_COUPLING.*          REQUIRED
//   bess            : { powerKw, ... }         REQUIRED (from readInputBess)
//   tbls            : elec tables object       REQUIRED (from loadElecTables)
//   nom             : nom constants object     REQUIRED (from loadNomConstants)
//   dcBusVoltageV   : number  DC bus / battery nominal voltage (DC runs)
//   acVoltageV      : number  AC system voltage (AC_COUPLED PCS->panel run)
//   acPhases        : number  3 (default) or 1 -- AC run only
//
// @return {Object}
//   coupling, sizeable, reason,
//   runs: [ { name, side('DC'|'AC'), circuitCurrentA, designCurrentA,
//             conductorSize, conductorAmpacity, ocpdA, egcSize }, ... ]
//   warnings: []
// ---------------------------------------------------------------------------
function calcBessCircuit(opts) {
  opts = opts || {};
  var coupling = opts.coupling;
  var bess     = opts.bess;
  var tbls     = opts.tbls;
  var nom      = opts.nom;

  // -- validate ------------------------------------------------------------
  if (coupling !== BESS_COUPLING.DC_COUPLED &&
      coupling !== BESS_COUPLING.AC_COUPLED) {
    throw new Error('calcBessCircuit: coupling must be DC_COUPLED or AC_COUPLED');
  }
  if (!bess || !(Number(bess.powerKw) > 0)) {
    throw new Error('calcBessCircuit: bess.powerKw must be > 0');
  }
  if (!tbls || !tbls.conductors) {
    throw new Error('calcBessCircuit: tbls (elec tables) required');
  }
  if (!nom || !nom.bess) {
    throw new Error('calcBessCircuit: nom.bess constants required');
  }

  var powerW       = bess.powerKw * 1000;
  var currentFactor = nom.bess.dcCurrentFactor;   // 1.25 continuous-duty
  var warnings = [];
  var runs = [];

  // -- DC run: battery <-> (DC bus | PCS) ----------------------------------
  // Present in BOTH topologies. DC current = power / DC voltage.
  var dcV = Number(opts.dcBusVoltageV);
  if (!(dcV > 0)) {
    return {
      coupling: coupling, sizeable: false,
      reason: 'DC bus / battery nominal voltage not supplied (dcBusVoltageV). '
            + 'Cannot size the battery DC circuit without it -- fill '
            + 'Nominal_Voltage_V for this battery in 16_PRODUCTS_BESS.',
      runs: [], warnings: warnings,
    };
  }
  var dcRunName = (coupling === BESS_COUPLING.AC_COUPLED)
    ? 'Battery <-> PCS (DC)'
    : 'Battery <-> shared DC bus';
  runs.push(_sizeRun(dcRunName, 'DC', powerW / dcV, currentFactor, tbls));

  // -- AC run: PCS <-> panelboard (AC_COUPLED only) ------------------------
  if (coupling === BESS_COUPLING.AC_COUPLED) {
    var acV = Number(opts.acVoltageV);
    if (!(acV > 0)) {
      return {
        coupling: coupling, sizeable: false,
        reason: 'AC_COUPLED battery needs an AC system voltage (acVoltageV) '
              + 'to size the PCS-to-panelboard feeder. Not supplied.',
        runs: [], warnings: warnings,
      };
    }
    var phases = Number(opts.acPhases) || 3;
    // AC current: 3-phase I = P / (sqrt(3) * V); 1-phase I = P / V.
    var acCurrent = (phases === 3)
      ? powerW / (Math.sqrt(3) * acV)
      : powerW / acV;
    runs.push(_sizeRun('PCS <-> panelboard (AC)', 'AC',
                       acCurrent, currentFactor, tbls));
  }

  // -- low-RTE advisory (carried from the battery spec) --------------------
  if (bess.rtePct !== undefined && bess.rtePct < nom.bess.rteFloor) {
    warnings.push('Battery round-trip efficiency (' + bess.rtePct
      + ') is below the NOM floor (' + nom.bess.rteFloor + ').');
  }

  // -- NEC 240.4: flag any run whose OCPD does not protect its conductor.
  // Today this catches the single-conductor lump on high-current DC runs
  // (no parallel runs yet): the design current exceeds every table conductor,
  // so the OCPD ends up far above the conductor ampacity.
  runs.forEach(function (r) {
    if (r.ocpdProtectsConductor === false) {
      warnings.push('OCPD ' + r.ocpdA + 'A exceeds conductor ampacity '
        + r.conductorAmpacity + 'A on "' + r.name + '" (NEC 240.4 violation). '
        + 'Use parallel runs / per-stack circuits or a larger conductor.');
    }
  });

  return {
    coupling: coupling,
    sizeable: true,
    reason: null,
    runs: runs,
    warnings: warnings,
  };
}

// ---------------------------------------------------------------------------
// _sizeRun -- size one conductor run: apply the continuous-duty factor,
// pick conductor by ampacity, pick OCPD, pick EGC. Reuses tested helpers.
// ---------------------------------------------------------------------------
function _sizeRun(name, side, circuitCurrentA, currentFactor, tbls) {
  var designCurrentA = circuitCurrentA * currentFactor;
  var conductor = selectConductor(designCurrentA, tbls);
  var ocpdA     = nextBreaker(designCurrentA, tbls);
  var egc       = getEgcSize(ocpdA, tbls);
  return {
    name: name,
    side: side,
    circuitCurrentA: circuitCurrentA,
    designCurrentA: designCurrentA,
    conductorSize: conductor.size,
    conductorAmpacity: conductor.ampacity,
    ocpdA: ocpdA,
    egcSize: egc.egcSize,
    // BDF-7: extra fields exposed for voltage drop, BoS quantity calc, and
    // BOM line-item generation. Same shape conventions as the PV side
    // (04_CalcDC.js's dc.areaConDC / dc.egcDCArea) so MDC citations align.
    cuAreaMm2:       conductor.cuAreaMm2 || 0,
    insAreaMm2:      conductor.insAreaMm2 || 0,
    conductorLabel:  conductor.size || '',     // e.g. "AWG 2/0"
    egcLabel:        egc.egcSize || '',
    egcCuAreaMm2:    egc.cuAreaMm2 || 0,
    ocpdAmps:        ocpdA,
    ocpdLabel:       ocpdA ? (ocpdA + 'A') : '',
    parallels:       1,    // single-conductor sizing today; multi-parallel TBD
    // NEC 240.4: does the chosen OCPD actually protect the chosen conductor?
    // Exposed so the caller (and the MDC) can flag a coordination failure
    // instead of silently shipping an under-protected conductor.
    ocpdProtectsConductor: ocpdProtectsConductor(ocpdA, conductor.ampacity, tbls),
  };
}