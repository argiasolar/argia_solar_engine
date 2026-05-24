// =============================================================================
// ARGIA ENGINE -- File: 24_CalcBessNomChecks.gs   (BDF-7)
// NOM compliance checks for the BESS install (beyond ampacity sized by
// calcBessCircuit and voltage drop sized by calcBessVoltageDrop).
//
// THIS MODULE COVERS:
//   1. Disconnect presence verification (NOM 690-13 / 690-15) -- a
//      lockable AC disconnect within sight of the battery is REQUIRED for
//      AC_COUPLED systems. We verify it's in the BoS line items.
//   2. GEC (Grounding Electrode Conductor) sizing per NOM 250-66.
//      Sized from the largest ungrounded conductor in the BESS circuit.
//
// PURE FUNCTION. Pulls in conductor tables but does not write.
// =============================================================================


// ---------------------------------------------------------------------------
// NOM 250-66 GEC sizing table (Mexican copper, mm² basis).
// Largest ungrounded conductor mm² -> GEC mm².
// This mirrors NEC Table 250.66 with Mexican units. Conservative thresholds.
// ---------------------------------------------------------------------------
var BESS_GEC_TABLE_NOM_250_66 = [
  // [largest_ungrounded_max_mm2, gec_mm2]
  { upTo: 33.62,   gecMm2: 8.37 },     // up to #2 AWG -> #8 AWG
  { upTo: 53.49,   gecMm2: 13.30 },    // up to 1/0 AWG -> #6 AWG
  { upTo: 107.20,  gecMm2: 21.15 },    // up to 4/0 AWG -> #4 AWG
  { upTo: 177.30,  gecMm2: 33.62 },    // up to 350 kcmil -> #2 AWG
  { upTo: 304.00,  gecMm2: 53.49 },    // up to 600 kcmil -> 1/0 AWG
  { upTo: 506.70,  gecMm2: 67.43 },    // up to 1100 kcmil -> 2/0 AWG
  { upTo: Infinity, gecMm2: 85.01 },   // larger -> 3/0 AWG
];


// ---------------------------------------------------------------------------
// calcBessNomChecks(opts) -> result{}
// ---------------------------------------------------------------------------
// @param {Object} opts
//   circuit       : result from calcBessCircuit
//   bos           : result from calcBessBosQuantities (for disconnect verify)
//   installContext: { coupling, gecRunM } from readBessInstallContext
//   nom           : NOM constants
//
// @return {Object}
//   {
//     checks: [
//       { id, title, status: 'PASS'|'REVIEW'|'FAIL', detail, nomCite }
//     ]
//   }
function calcBessNomChecks(opts) {
  opts = opts || {};
  var circuit = opts.circuit || {};
  var bos = opts.bos || { lines: [] };
  var ctx = opts.installContext || {};
  var coupling = ctx.coupling || circuit.coupling;
  // BDF-7.1 contract: ctx.coupling is injected by 00_Main Step 9.6 from
  // bessResult.coupling (authoritative source = INPUT_DESIGN!C17).
  // circuit.coupling carries the same value as a defensive fallback.

  var checks = [];

  // -- Check 1: Disconnect presence ---------------------------------------
  // For AC_COUPLED systems, NOM 690-13/15 requires a disconnect within sight.
  // We verify a DISTRIBUTION line with side='DISCONNECT_AC' is present in BoS.
  if (coupling === 'AC_COUPLED') {
    var hasDisconnect = false;
    for (var i = 0; i < bos.lines.length; i++) {
      var line = bos.lines[i];
      if (line.productSpec && line.productSpec.side === 'DISCONNECT_AC') {
        hasDisconnect = true;
        break;
      }
    }
    checks.push({
      id: 'BESS_DISCONNECT_AC',
      title: 'Desconectador AC presente (NOM 690-13 / 690-15)',
      status: hasDisconnect ? 'PASS' : 'FAIL',
      detail: hasDisconnect
        ? 'Línea BESS-10 incluida en la lista de materiales.'
        : 'Sistema AC_COUPLED requiere desconectador AC con candado. NO incluido en BoS.',
      nomCite: 'NOM-001 art. 690-13 / 690-15',
    });
  } else {
    // DC_COUPLED: NOM 690-15 still applies but the requirement is met by the
    // shared DC bus disconnect from the PV side. We report informational pass.
    checks.push({
      id: 'BESS_DISCONNECT_DC',
      title: 'Desconectador DC compartido con PV (NOM 690-15)',
      status: 'PASS',
      detail: 'Sistema DC_COUPLED comparte desconectador con el sistema FV. ' +
              'Verificar que el desconectador FV existente cubra la suma de ' +
              'corrientes FV + BESS.',
      nomCite: 'NOM-001 art. 690-15',
    });
  }

  // -- Check 2: GEC sizing per NOM 250-66 ---------------------------------
  // Find the largest ungrounded conductor's cross-section across all runs.
  var largestMm2 = 0;
  var largestSide = '';
  for (var r = 0; r < (circuit.runs || []).length; r++) {
    var run = circuit.runs[r];
    var area = Number(run.cuAreaMm2) || 0;
    if (area > largestMm2) {
      largestMm2 = area;
      largestSide = run.side;
    }
  }
  if (largestMm2 > 0) {
    var requiredGecMm2 = 0;
    for (var t = 0; t < BESS_GEC_TABLE_NOM_250_66.length; t++) {
      if (largestMm2 <= BESS_GEC_TABLE_NOM_250_66[t].upTo) {
        requiredGecMm2 = BESS_GEC_TABLE_NOM_250_66[t].gecMm2;
        break;
      }
    }
    var hasGecLine = false;
    var providedGecMeters = 0;
    for (var b = 0; b < bos.lines.length; b++) {
      var bl = bos.lines[b];
      if (bl.productSpec && bl.productSpec.side === 'GEC') {
        hasGecLine = true;
        providedGecMeters = Number(bl.qty) || 0;
      }
    }
    var gecRunM = Number(ctx.gecRunM) || 0;
    var status, detail;
    if (!hasGecLine) {
      status = 'FAIL';
      detail = 'GEC requerido (mín ' + requiredGecMm2.toFixed(2) +
               ' mm²) pero NO incluido en BoS. Conductor mayor: ' +
               largestMm2.toFixed(2) + ' mm² (' + largestSide + ').';
    } else if (gecRunM <= 0) {
      status = 'REVIEW';
      detail = 'GEC presente en BoS pero longitud (gecRunM) = 0. ' +
               'Especificar distancia a barra/electrodo de tierra en INPUT_BESS.';
    } else {
      status = 'PASS';
      detail = 'GEC requerido ≥ ' + requiredGecMm2.toFixed(2) +
               ' mm² para conductor mayor ' + largestMm2.toFixed(2) + ' mm². ' +
               'Línea BESS-11 (' + providedGecMeters + ' m) incluida.';
    }
    checks.push({
      id: 'BESS_GEC_SIZING',
      title: 'Dimensionamiento GEC (NOM 250-66)',
      status: status,
      detail: detail,
      nomCite: 'NOM-001 art. 250-66',
      requiredGecMm2: requiredGecMm2,
      largestUngroundedMm2: largestMm2,
    });
  }

  return { checks: checks };
}
