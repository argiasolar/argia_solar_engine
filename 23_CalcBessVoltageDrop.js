// =============================================================================
// ARGIA ENGINE -- File: 23_CalcBessVoltageDrop.gs   (BDF-7)
// Voltage-drop verification for BESS conductors against NOM limits.
//
// NOM-001 doesn't quote a single % limit, but the engineering convention
// followed throughout this codebase (matching the PV side) is:
//   - Branch (DC battery <-> PCS):  3% target / 5% hard cap
//   - Feeder (PCS <-> panelboard):  3% target / 5% hard cap
//
// FORMULAS (same as PV side in 04_CalcDC.js — kept identical so MDC
// citations line up):
//   DC, 2-wire round-trip:  Vdrop% = (2 * L * rho / A * I) / V
//   AC, 3-phase:            Vdrop% = (sqrt(3) * L * rho / A * I) / V
//
// where:
//   L     = one-way conductor length (m)
//   rho   = copper resistivity (Ω·mm²/m)  — typically 0.0172
//   A     = conductor cross-section (mm²) — from NOM ampacity table
//   I     = continuous-duty design current (A)  — already 1.25x factor
//   V     = nominal voltage of the run (V)
//
// PURE FUNCTION. No spreadsheet access. Fully unit-testable.
// =============================================================================


// ---------------------------------------------------------------------------
// calcBessVoltageDrop(opts) -> result{}
// ---------------------------------------------------------------------------
// Walks each run in circuit.runs[], computes %VD, classifies PASS/REVIEW/FAIL.
//
// @param {Object} opts
//   circuit       : result from calcBessCircuit (must have .sizeable=true)
//   installContext: { dcRunM, acRunM, dcBusV, acV } from readBessInstallContext
//   nom           : NOM constants object — needs cuResistivity, dcVdropTarget,
//                   dcVdropHard, acVdropTarget, acVdropHard
//
// @return {Object}
//   {
//     blocked: bool,
//     reason: string | null,
//     checks: [
//       { side: 'DC'|'AC', runName, lengthM, currentA, voltageV,
//         vdropPct, target, hardLimit, status: 'PASS'|'REVIEW'|'FAIL',
//         formula: '...' }
//     ]
//   }
function calcBessVoltageDrop(opts) {
  opts = opts || {};
  var circuit = opts.circuit || {};
  var ctx = opts.installContext || {};
  var nom = opts.nom || {};

  if (!circuit.sizeable) {
    return {
      blocked: true,
      reason: circuit.reason || 'BESS circuit not sizeable; voltage drop cannot be computed.',
      checks: [],
    };
  }

  var rho = Number(nom.cuResistivity) || 0.0172;
  var dcTarget = Number(nom.dcVdropTarget) || 0.03;
  var dcHard   = Number(nom.dcVdropHard)   || 0.05;
  var acTarget = Number(nom.acVdropTarget) || 0.03;
  var acHard   = Number(nom.acVdropHard)   || 0.05;

  var checks = [];

  for (var i = 0; i < circuit.runs.length; i++) {
    var run = circuit.runs[i];
    var lengthM, voltageV, vdropPct, target, hardLimit, formula;

    // Cross-section in mm² is required for the calc. calcBessCircuit emits
    // .cuAreaMm2 on each run (mirrored from the conductor table row picked).
    var areaMm2 = Number(run.cuAreaMm2) || 0;
    if (areaMm2 <= 0) {
      checks.push({
        side: run.side, runName: run.name, status: 'BLOCKED',
        reason: 'Conductor cross-section unknown for this run',
      });
      continue;
    }

    if (run.side === 'DC') {
      lengthM = Number(ctx.dcRunM) || 0;
      voltageV = Number(ctx.dcBusV) || 0;
      if (lengthM <= 0 || voltageV <= 0) {
        checks.push({
          side: 'DC', runName: run.name, status: 'BLOCKED',
          reason: 'DC run length or voltage missing; cannot compute %VD',
          lengthM: lengthM, voltageV: voltageV,
        });
        continue;
      }
      vdropPct = (2 * lengthM * rho / areaMm2 * run.designCurrentA) / voltageV;
      target = dcTarget;
      hardLimit = dcHard;
      formula = 'Vdrop% = (2 \u00d7 L \u00d7 \u03c1/A \u00d7 I) / V = (2 \u00d7 ' +
                lengthM + ' \u00d7 ' + rho + '/' + areaMm2 + ' \u00d7 ' +
                run.designCurrentA.toFixed(2) + ') / ' + voltageV;
    } else if (run.side === 'AC') {
      lengthM = Number(ctx.acRunM) || 0;
      voltageV = Number(ctx.acV) || 0;
      if (lengthM <= 0 || voltageV <= 0) {
        checks.push({
          side: 'AC', runName: run.name, status: 'BLOCKED',
          reason: 'AC run length or voltage missing; cannot compute %VD',
          lengthM: lengthM, voltageV: voltageV,
        });
        continue;
      }
      vdropPct = (Math.sqrt(3) * lengthM * rho / areaMm2 * run.designCurrentA) / voltageV;
      target = acTarget;
      hardLimit = acHard;
      formula = 'Vdrop% = (\u221a3 \u00d7 L \u00d7 \u03c1/A \u00d7 I) / V = (' +
                Math.sqrt(3).toFixed(3) + ' \u00d7 ' + lengthM + ' \u00d7 ' +
                rho + '/' + areaMm2 + ' \u00d7 ' + run.designCurrentA.toFixed(2) +
                ') / ' + voltageV;
    } else {
      continue;  // unknown side
    }

    var status;
    if (vdropPct <= target) status = 'PASS';
    else if (vdropPct <= hardLimit) status = 'REVIEW';
    else status = 'FAIL';

    checks.push({
      side: run.side,
      runName: run.name,
      lengthM: lengthM,
      voltageV: voltageV,
      currentA: run.designCurrentA,
      areaMm2: areaMm2,
      vdropPct: vdropPct,
      target: target,
      hardLimit: hardLimit,
      status: status,
      formula: formula,
    });
  }

  return {
    blocked: false,
    reason: null,
    checks: checks,
  };
}
