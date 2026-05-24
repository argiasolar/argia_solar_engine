// =============================================================================
// ARGIA ENGINE -- File: 22_CalcBessBosQuantities.gs   (BDF-7)
// Compute BoS (Balance-of-System) quantities for the BESS BOM section.
//
// Given the install context (distances, voltages, coupling) and the engine's
// circuit-sizing result (conductors + OCPD picked by calcBessCircuit), this
// function returns the line-item quantities for BOM §8:
//   - DC cable meters (battery <-> PCS or shared DC bus)
//   - DC EGC meters
//   - AC cable meters (PCS <-> panelboard) — AC_COUPLED only
//   - DC conduit meters
//   - AC conduit meters — AC_COUPLED only
//   - DC breaker / fuse count
//   - AC breaker count — AC_COUPLED only
//   - AC disconnect count
//   - GEC meters (Grounding Electrode Conductor)
//
// PURE FUNCTION. No spreadsheet access. Fully unit-testable.
//
// CALLER CONVENTION
//   The result feeds writeBOM §8 (BDF-7 Session 2). Each quantity carries
//   the conductor/breaker/conduit IDENTIFIER chosen by calcBessCircuit so
//   the BOM writer can look up pricing via 14M_PRODUCTS_BOS / 15M_ELEC_TABLES
//   the same way the PV side already does.
//
// CONDUCTOR RUN ARITHMETIC
//   - DC run length = installContext.dcRunM
//   - AC run length = installContext.acRunM (0 if DC_COUPLED)
//   - GEC length    = installContext.gecRunM
//   - Each "run" from calcBessCircuit consists of multiple parallel conductors
//     when current exceeds single-conductor ampacity. The cable meters reported
//     here are TOTAL meters across all parallels (qty × length × phase count).
//
// CONDUIT
//   - One conduit per run side (DC and AC). Length = the run length.
//   - Conduit type depends on installContext.cablePath:
//       INTEMPERIE / OUTDOOR    -> intemperie-rated PVC or galvanized RGS
//       CONDUIT_ENTERRADO       -> PVC schedule 80 buried
//       BANDEJA_INTERIOR        -> open cable tray (no conduit, but tray meters)
//     For BDF-7 R1: keep it simple. We always emit "1 line of conduit"
//     and let the BOM writer pick the actual SKU from 14M_PRODUCTS_BOS based
//     on cablePath.
// =============================================================================


// ---------------------------------------------------------------------------
// calcBessBosQuantities(opts) -> result{}
// ---------------------------------------------------------------------------
// @param {Object} opts
//   bess          : the bess{} object from readInputBess (carries powerKw,
//                   capacityKwh, stackQty, batteryId, etc.)
//   circuit       : the result of calcBessCircuit() — { sizeable, runs[],
//                   coupling, reason }
//   installContext: { coupling, dcBusV, acV, dcRunM, acRunM, cablePath,
//                     location, gecRunM, batteriesPerContainer,
//                     groundingSystem }   (from readBessInstallContext)
//   nom           : NOM constants object (for fill ratios, voltage-drop targets)
//
// @return {Object} See bottom of function for shape.
function calcBessBosQuantities(opts) {
  opts = opts || {};
  var bess    = opts.bess || {};
  var circuit = opts.circuit || {};
  var ctx     = opts.installContext || {};
  var nom     = opts.nom || {};

  // -- Guards --------------------------------------------------------------
  // If the circuit isn't sizeable, we can't compute meters of cable. Return
  // a "blocked" shape that the writer renders as "pendiente".
  if (!circuit.sizeable) {
    return {
      blocked: true,
      reason: circuit.reason || 'BESS circuit not sizeable; BoS quantities cannot be computed.',
      lines: [],
    };
  }

  var coupling = ctx.coupling || circuit.coupling;
  // BDF-7.1 contract: ctx.coupling is injected by 00_Main Step 9.6 from
  // bessResult.coupling (authoritative source = INPUT_DESIGN!C17).
  // circuit.coupling carries the same value as a defensive fallback.
  var dcRunM = Number(ctx.dcRunM) || 0;
  var acRunM = Number(ctx.acRunM) || 0;
  var gecRunM = Number(ctx.gecRunM) || 0;

  // Find the DC and AC runs from circuit.runs[]
  var dcRun = null, acRun = null;
  for (var r = 0; r < circuit.runs.length; r++) {
    var run = circuit.runs[r];
    if (run.side === 'DC' && !dcRun) dcRun = run;
    if (run.side === 'AC' && !acRun) acRun = run;
  }

  // Parallels per run. Each run carries `parallels` if calcBessCircuit
  // had to break high current across multiple conductors. Default to 1.
  function parCount(run) {
    return Math.max(1, Number(run && run.parallels) || 1);
  }

  // Build line items array. Order matches BOM §8 design.
  var lines = [];

  // ---- Line 1: Battery itself (price comes from 16M_PRODUCTS_BESS!AI) ---
  // BDF-8: short visible description; full stack breakdown moves to detail.
  var stackQty = Number(bess.stackQty) || 1;
  lines.push({
    code: 'BESS-01',
    description: _bessLineDescription(bess),
    detail: _bessLineDetail(bess),
    qty: stackQty,
    unit: 'u',
    productCategory: 'BESS_BATTERY',
    productSpec: { batteryId: bess.baseBatteryId || bess.batteryId },
    nomCite: '',          // battery itself has no NOM cable cite
  });

  // ---- Line 2: DC cable battery <-> PCS / DC bus ------------------------
  // Round-trip: 2 conductors × parallels × runLength.
  // We REPORT total meters; price-per-meter comes from the conductor DB.
  //
  // BDF-8: split short `description` (visible in BOM cell) vs `detail`
  // (designer-facing breakdown, rendered into a cell note). Keeps the
  // visible BOM column from wrapping awkwardly.
  // BDF-9: productSpec also carries cuAreaMm2 + insAreaMm2 so the BOM
  // writer can derive conduit size (NOM 358 fill) without re-running
  // calcBessCircuit.
  if (dcRun && dcRunM > 0) {
    var dcConductorMeters = 2 * parCount(dcRun) * dcRunM;
    lines.push({
      code: 'BESS-02',
      description: 'Cable DC ' + (dcRun.conductorLabel || 'AWG?') +
                   ' batería \u2194 ' +
                   (coupling === 'AC_COUPLED' ? 'PCS' : 'bus DC común'),
      detail: parCount(dcRun) + ' par' + (parCount(dcRun) > 1 ? 'es' : '')
            + ' \u00d7 ' + dcRunM + ' m \u00d7 2 conductores'
            + ' = ' + dcConductorMeters + ' m totales',
      qty: dcConductorMeters,
      unit: 'm',
      productCategory: 'CONDUCTORS',
      productSpec: {
        awg: dcRun.conductorLabel,
        side: 'DC',
        cuAreaMm2: Number(dcRun.cuAreaMm2) || 0,
        insAreaMm2: Number(dcRun.insAreaMm2) || 0,
        parallels: parCount(dcRun),
      },
      nomCite: 'NOM-001 art. 690-8(b) / 240-91',
    });
  }

  // ---- Line 3: DC EGC (Equipment Ground) --------------------------------
  if (dcRun && dcRunM > 0) {
    var dcEgcMeters = parCount(dcRun) * dcRunM;
    lines.push({
      code: 'BESS-03',
      description: 'EGC DC ' + (dcRun.egcLabel || 'AWG?'),
      detail: parCount(dcRun) + ' \u00d7 ' + dcRunM + ' m = ' + dcEgcMeters + ' m totales',
      qty: dcEgcMeters,
      unit: 'm',
      productCategory: 'CONDUCTORS',
      productSpec: {
        awg: dcRun.egcLabel,
        side: 'DC_EGC',
        cuAreaMm2: Number(dcRun.egcCuAreaMm2) || 0,
      },
      nomCite: 'NOM-001 art. 250-122',
    });
  }

  // ---- Line 4: AC cable PCS <-> panelboard (AC_COUPLED only) ------------
  if (coupling === 'AC_COUPLED' && acRun && acRunM > 0) {
    // 3-phase: 3 phase conductors + 1 neutral (if used) + EGC counted separately
    // BDF-7 R1: assume 3 phase conductors (no neutral) for industrial 3F.
    var acConductorMeters = 3 * parCount(acRun) * acRunM;
    lines.push({
      code: 'BESS-04',
      description: 'Cable AC ' + (acRun.conductorLabel || 'AWG?') +
                   ' PCS \u2194 tablero',
      detail: parCount(acRun) + ' par' + (parCount(acRun) > 1 ? 'es' : '')
            + ' \u00d7 ' + acRunM + ' m \u00d7 3F'
            + ' = ' + acConductorMeters + ' m totales',
      qty: acConductorMeters,
      unit: 'm',
      productCategory: 'CONDUCTORS',
      productSpec: {
        awg: acRun.conductorLabel,
        side: 'AC',
        cuAreaMm2: Number(acRun.cuAreaMm2) || 0,
        insAreaMm2: Number(acRun.insAreaMm2) || 0,
        parallels: parCount(acRun),
        phases: 3,
      },
      nomCite: 'NOM-001 art. 690-8',
    });
    lines.push({
      code: 'BESS-05',
      description: 'EGC AC ' + (acRun.egcLabel || 'AWG?'),
      detail: parCount(acRun) + ' \u00d7 ' + acRunM + ' m',
      qty: parCount(acRun) * acRunM,
      unit: 'm',
      productCategory: 'CONDUCTORS',
      productSpec: {
        awg: acRun.egcLabel,
        side: 'AC_EGC',
        cuAreaMm2: Number(acRun.egcCuAreaMm2) || 0,
      },
      nomCite: 'NOM-001 art. 250-122',
    });
  }

  // ---- Line 6: DC conduit (or cable tray) -------------------------------
  if (dcRunM > 0) {
    var conduitTypeDc = _conduitTypeFromPath(ctx.cablePath);
    lines.push({
      code: 'BESS-06',
      description: 'Conduit DC — ' + conduitTypeDc.label,
      detail: 'Trayectoria DC ' + dcRunM + ' m',
      qty: dcRunM,
      unit: 'm',
      productCategory: 'CONDUIT',
      productSpec: {
        conduitType: conduitTypeDc.dbKey,
        side: 'DC',
        // Conductor fill data needed for NOM 358 conduit-size pick in the writer.
        // dcRun's 2 conductors + EGC = round-trip + ground.
        condCuAreaMm2: Number(dcRun ? dcRun.cuAreaMm2 : 0) || 0,
        condInsAreaMm2: Number(dcRun ? dcRun.insAreaMm2 : 0) || 0,
        condCount: 2 * parCount(dcRun) + 1,   // 2 conductors + EGC, single conduit
      },
      nomCite: 'NOM-001 art. 358-30',
    });
  }

  // ---- Line 7: AC conduit (AC_COUPLED only) -----------------------------
  if (coupling === 'AC_COUPLED' && acRunM > 0) {
    var conduitTypeAc = _conduitTypeFromPath(ctx.cablePath);
    lines.push({
      code: 'BESS-07',
      description: 'Conduit AC — ' + conduitTypeAc.label,
      detail: 'Trayectoria AC ' + acRunM + ' m',
      qty: acRunM,
      unit: 'm',
      productCategory: 'CONDUIT',
      productSpec: {
        conduitType: conduitTypeAc.dbKey,
        side: 'AC',
        condCuAreaMm2: Number(acRun ? acRun.cuAreaMm2 : 0) || 0,
        condInsAreaMm2: Number(acRun ? acRun.insAreaMm2 : 0) || 0,
        condCount: 3 * parCount(acRun) + 1,   // 3F + EGC
      },
      nomCite: 'NOM-001 art. 358-30',
    });
  }

  // ---- Line 8: DC OCPD (breaker or fuse) --------------------------------
  if (dcRun) {
    lines.push({
      code: 'BESS-08',
      description: 'Interruptor / fusible DC ' +
                   (dcRun.ocpdLabel || dcRun.ocpdAmps + 'A'),
      detail: parCount(dcRun) + ' polo' + (parCount(dcRun) > 1 ? 's' : ''),
      qty: parCount(dcRun),
      unit: 'pcs',
      productCategory: 'DISTRIBUTION',
      productSpec: {
        ratingA: dcRun.ocpdAmps,
        side: 'DC',
        poles: 1,
      },
      nomCite: 'NOM-001 art. 690-9',
    });
  }

  // ---- Line 9: AC OCPD (breaker, AC_COUPLED only) -----------------------
  if (coupling === 'AC_COUPLED' && acRun) {
    lines.push({
      code: 'BESS-09',
      description: 'Interruptor AC 3F ' +
                   (acRun.ocpdLabel || acRun.ocpdAmps + 'A'),
      detail: parCount(acRun) + ' \u00d7 3 polos',
      qty: parCount(acRun),
      unit: 'pcs',
      productCategory: 'DISTRIBUTION',
      productSpec: {
        ratingA: acRun.ocpdAmps,
        side: 'AC',
        poles: 3,
      },
      nomCite: 'NOM-001 art. 240-6',
    });
  }

  // ---- Line 10: AC disconnect (lockable, near battery) ------------------
  // Required by NOM 690-13 / 690-15 — within sight of the battery.
  // One per BESS regardless of stack qty.
  if (coupling === 'AC_COUPLED' && acRun) {
    lines.push({
      code: 'BESS-10',
      description: 'Desconectador AC con candado ' + acRun.ocpdAmps + 'A',
      detail: 'NOM 690-13/15: dentro de vista de la batería',
      qty: 1,
      unit: 'pcs',
      productCategory: 'DISTRIBUTION',
      productSpec: {
        ratingA: acRun.ocpdAmps,
        side: 'DISCONNECT_AC',
        poles: 3,
      },
      nomCite: 'NOM-001 art. 690-13 / 690-15',
    });
  }

  // ---- Line 11: GEC (Grounding Electrode Conductor) ---------------------
  // BDF-10: derive the required GEC AWG from the largest ungrounded
  // conductor (NOM 250-66, same logic as calcBessNomChecks). This
  // populates productSpec.awg so the BOM writer can resolve a price
  // from 14M_PRODUCTS_BOS (BARE COPPER, matching AWG).
  if (gecRunM > 0) {
    var gecSpec = _resolveGecAwgSpec(circuit);
    lines.push({
      code: 'BESS-11',
      description: 'GEC (electrodo a tierra)'
                 + (gecSpec.awgLabel ? ' ' + gecSpec.awgLabel : ''),
      detail: gecRunM + ' m al electrodo. '
            + (gecSpec.derivation || 'Calibre derivado de NOM 250-66.'),
      qty: gecRunM,
      unit: 'm',
      productCategory: 'CONDUCTORS',
      productSpec: {
        side: 'GEC',
        awg: gecSpec.awgLabel || '',
        cuAreaMm2: gecSpec.gecMm2 || 0,
      },
      nomCite: 'NOM-001 art. 250-66',
    });
  }

  // ---- Line 12: Commissioning (flat fee from INPUT_BESS) ---------------
  var commMxn = Number(ctx.commissioningMxn) || 0;
  if (commMxn > 0) {
    lines.push({
      code: 'BESS-12',
      description: 'Comisionamiento y puesta en servicio',
      detail: 'Lote único — pruebas funcionales + entrega al cliente',
      qty: 1,
      unit: 'lote',
      productCategory: 'COMMISSIONING',
      productSpec: { flatPriceMxn: commMxn },
      nomCite: '',
    });
  }

  return {
    blocked: false,
    reason: null,
    lines: lines,
    summary: {
      lineCount: lines.length,
      coupling: coupling,
      dcRunM: dcRunM,
      acRunM: acRunM,
      gecRunM: gecRunM,
    },
  };
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _bessLineDescription(bess) {
  var batteryId = String(bess.batteryId || bess.baseBatteryId || 'BESS').trim();
  var stackQty = Number(bess.stackQty) || 1;
  // BDF-8: short visible description. For stacks: "5 × HW_LUNA_2MWH".
  // For singles: "Sistema BESS HW_LUNA_2MWH". Full spec breakdown moves to
  // _bessLineDetail (rendered as cell note in BOM).
  if (stackQty === 1) {
    return 'Sistema BESS ' + batteryId;
  }
  var baseId = String(bess.baseBatteryId || batteryId).trim();
  return stackQty + ' \u00d7 ' + baseId;
}


function _bessLineDetail(bess) {
  var capacityKwh = Number(bess.capacityKwh) || 0;
  var powerKw = Number(bess.powerKw) || 0;
  var stackQty = Number(bess.stackQty) || 1;
  if (stackQty === 1) {
    return 'Capacidad: ' + capacityKwh + ' kWh / Potencia: ' + powerKw + ' kW';
  }
  var unitCapKwh = Math.round(capacityKwh / stackQty);
  var unitPowerKw = Math.round(powerKw / stackQty);
  return 'Por unidad: ' + unitCapKwh + ' kWh / ' + unitPowerKw + ' kW. '
       + 'Total stack (' + stackQty + ' unidades): '
       + capacityKwh + ' kWh / ' + powerKw + ' kW.';
}


function _conduitTypeFromPath(cablePath) {
  var path = String(cablePath || '').trim().toUpperCase();
  if (path === 'INTEMPERIE' || path === 'OUTDOOR') {
    return { label: 'PVC intemperie / RGS galv.', dbKey: 'PVC_OUTDOOR' };
  }
  if (path === 'CONDUIT_ENTERRADO' || path === 'BURIED') {
    return { label: 'PVC schedule 80 enterrado', dbKey: 'PVC_BURIED' };
  }
  if (path === 'BANDEJA_INTERIOR' || path === 'CABLE_TRAY') {
    return { label: 'Bandeja porta-cables', dbKey: 'CABLE_TRAY' };
  }
  // Default: interior EMT
  return { label: 'EMT interior', dbKey: 'EMT_INDOOR' };
}


// =============================================================================
// BDF-10: GEC AWG resolver
// =============================================================================
// Mirrors the table in 24_CalcBessNomChecks.js (NOM 250-66). Given the
// circuit runs, finds the largest ungrounded conductor's cuAreaMm2 and
// returns the required GEC AWG label + mm² for BoS price resolution.
//
// Returns:
//   { awgLabel: 'AWG 4', gecMm2: 21.15, derivation: '...' }
//   OR
//   { awgLabel: '', gecMm2: 0, derivation: 'Sin datos de conductor mayor' }
function _resolveGecAwgSpec(circuit) {
  var BESS_GEC_TABLE_NOM_250_66 = [
    { upTo: 33.62,    gecMm2: 8.37,   awg: 'AWG 8' },    // up to #2 AWG -> #8 AWG
    { upTo: 53.49,    gecMm2: 13.30,  awg: 'AWG 6' },    // up to 1/0 AWG -> #6 AWG
    { upTo: 107.20,   gecMm2: 21.15,  awg: 'AWG 4' },    // up to 4/0 AWG -> #4 AWG
    { upTo: 177.30,   gecMm2: 33.62,  awg: 'AWG 2' },    // up to 350 kcmil -> #2 AWG
    { upTo: 304.00,   gecMm2: 53.49,  awg: 'AWG 1/0' },  // up to 600 kcmil -> 1/0 AWG
    { upTo: 506.70,   gecMm2: 67.43,  awg: 'AWG 2/0' },  // up to 1100 kcmil -> 2/0 AWG
    { upTo: Infinity, gecMm2: 85.01,  awg: 'AWG 3/0' },  // larger -> 3/0 AWG
  ];

  var largest = 0;
  var largestSide = '';
  if (circuit && circuit.runs) {
    for (var i = 0; i < circuit.runs.length; i++) {
      var r = circuit.runs[i];
      var area = Number(r.cuAreaMm2) || 0;
      if (area > largest) {
        largest = area;
        largestSide = r.side || '';
      }
    }
  }
  if (largest <= 0) {
    return { awgLabel: '', gecMm2: 0,
             derivation: 'Sin datos de conductor mayor — calibre GEC pendiente.' };
  }

  for (var t = 0; t < BESS_GEC_TABLE_NOM_250_66.length; t++) {
    var row = BESS_GEC_TABLE_NOM_250_66[t];
    if (largest <= row.upTo) {
      return {
        awgLabel: row.awg,
        gecMm2: row.gecMm2,
        derivation: 'NOM 250-66: conductor mayor ' + largest.toFixed(2)
                  + ' mm² (' + largestSide + ') → GEC mín ' + row.awg
                  + ' (' + row.gecMm2 + ' mm²).',
      };
    }
  }
  // Fallback (shouldn't reach since last row is upTo Infinity)
  return { awgLabel: 'AWG 3/0', gecMm2: 85.01,
           derivation: 'NOM 250-66 fallback.' };
}
