// =============================================================================
// ARGIA ENGINE v2.1.0 -- File: 04a_CalcCfeBill.gs
// Pure-JS reference implementation of the CFE bill formula.
//
// PURPOSE:
//   Provide a deterministic, DB-independent computation of the CFE bill for
//   regression testing. Mirrors the formula logic in the INPUT_CFE sheet
//   (rows 19-37) but takes plain objects instead of cell references.
//
//   v2.1.0 adds optional PV + interconnection-mode handling.
//
// DESIGN:
//   - Pure function. No global state. No spreadsheet calls. No DB lookups.
//   - Tariff prices passed in as a {} parameter, not looked up from
//     20M_CFE_TARIFFS. This makes the test reproducible regardless of
//     monthly tariff updates from CFE.
//   - Engine math is NOT changed. This file only adds a reference impl
//     used by the test suite. The engine continues to use the live DB.
//
// INTERCONNECTION MODES (v2.1.0):
//   - MEDICION_NETA            Legacy net metering. JS impl uses simple
//                              proportional subtraction (no period-shifting).
//                              Will DISAGREE with the live engine in this
//                              mode — see PHASE_1_DESIGN.md.
//   - FACTURACION_NETA         New CFE rule. Export credited at fixed price.
//   - SIN_EXPORTACION          Zero export. Surplus PV is lost.
//
// VERIFICATION:
//   v2.0.4: no-PV path matches live engine to within ~0.001 MXN.
//   v2.1.0: PV scenarios verified by Python recompute, see Phase 1 lock
//   targets in PHASE_1_DESIGN.md.
// =============================================================================

// Interconnection mode constants. Exported so callers can use named refs
// instead of string literals.
var CFE_MODE = {
  MEDICION_NETA:     'MEDICION_NETA',
  FACTURACION_NETA:  'FACTURACION_NETA',
  SIN_EXPORTACION:   'SIN_EXPORTACION',
};

/**
 * Compute one month's CFE bill from inputs and frozen tariffs.
 *
 * v2.0.4: signature was (inp, tar)
 * v2.1.0: signature unchanged. For PV+interconnection-mode handling use
 *         calcCfeBillWithPv() below — it wraps this function.
 *
 * @param {Object} inp Inputs (analogous to INPUT_CFE rows 10-17):
 *   - kWhBase, kWhIntermedia, kWhPunta {number}  Monthly kWh
 *   - kWBase, kWIntermedia, kWPunta {number}     Monthly kW demands
 *   - kWMaxAnoMovil {number}                     12-month rolling max kW
 *   - kVArh {number}                             Reactive energy
 *   - tarifa {string}                            Tariff code 'GDMTH','GDMTO','GDBT'
 *   - dap {number}                               DAP charge (0 if none)
 *   - bajaTension2pct {boolean}                  Whether 2% BT charge applies
 *
 * @param {Object} tar Frozen tariff prices (analogous to 20M_CFE_TARIFFS rows):
 *   - capacidad {number}      MXN/kW-month
 *   - distribucion {number}   MXN/kW-month
 *   - transmision {number}    MXN/kWh
 *   - cenace {number}         MXN/kWh
 *   - energiaBase {number}    MXN/kWh
 *   - energiaInter {number}   MXN/kWh
 *   - energiaPunta {number}   MXN/kWh
 *   - scnmem {number}         MXN/kWh (Servicios Conexos no MEM)
 *   - suministro {number}     MXN/month (fixed)
 *
 * @return {Object} Detailed breakdown with all intermediate values:
 *   { demandaFacturable, pf, capacidad, distribucion, transmision, cenace,
 *     energiaB, energiaI, energiaP, scnmem, suministro,
 *     energiaTotal, bajaTension2pct, cargoFp, subtotal, iva,
 *     facturacion, dap, total }
 *
 *   All values are MXN unless noted. Cargo FP is negative for PF≥0.9 (bonus).
 */
function calcCfeBill(inp, tar, options) {
  // v2.1.2: optional `options.fpThreshold` (default 0.90).
  // Set to 0.95 for users with demanda_contratada ≥ 1000 kW (Acuerdo A/073/2023).
  // Set to 0.97 for users with demanda_contratada ≥ 1000 kW AFTER April 8, 2026
  // (Código de Red RES/550/2021).
  // Default 0.90 preserves all v2.0.4/v2.1.0 behavior byte-identically.
  var fpThreshold = (options && options.fpThreshold != null) ? options.fpThreshold : 0.90;
  // ---- Row 19: Demanda Facturable ----
  // Engine: =MAX(C15, 0.7*C16) = MAX(kW_punta, 0.7 * kWMaxAnoMovil)
  var demandaFacturable = Math.max(inp.kWPunta, 0.7 * inp.kWMaxAnoMovil);

  // ---- Row 20: FP % ----
  // Engine: =IF(PF<0.5, 0.9, PF)  where PF = ΣkWh / SQRT(ΣkWh² + kVArh²)
  var kWhTotal = inp.kWhBase + inp.kWhIntermedia + inp.kWhPunta;
  var pfRaw = kWhTotal / Math.sqrt(kWhTotal * kWhTotal + inp.kVArh * inp.kVArh);
  var pf = (pfRaw < 0.5) ? 0.9 : pfRaw;

  // ---- Row 21: Capacidad ----
  // Engine: =C19 * tarifa(CAPACIDAD)
  var capacidad = demandaFacturable * tar.capacidad;

  // ---- Row 22: Distribución ----
  // Engine for GDMTH/GDMTO/GDBT: =MAX(C13,C14,C15) * tarifa(DISTRIBUCION)
  // Engine otherwise:             =MAX(C10,C11,C12) * tarifa(DISTRIBUCION)
  // For GDMTH it's MAX of demand columns (base/inter/punta kW);
  // for others it's MAX of energy columns (which is unusual — preserve as-is).
  var t = (inp.tarifa || 'GDMTH').toUpperCase();
  var maxForDistrib;
  if (t === 'GDMTH' || t === 'GDMTO' || t === 'GDBT') {
    maxForDistrib = Math.max(inp.kWBase, inp.kWIntermedia, inp.kWPunta);
  } else {
    maxForDistrib = Math.max(inp.kWhBase, inp.kWhIntermedia, inp.kWhPunta);
  }
  var distribucion = maxForDistrib * tar.distribucion;

  // ---- Row 23: Transmisión = ΣkWh * tarifa(TRANSMISION) ----
  var transmision = kWhTotal * tar.transmision;

  // ---- Row 24: CENACE = ΣkWh * tarifa(CENACE) ----
  var cenace = kWhTotal * tar.cenace;

  // ---- Rows 25-27: Energía B / I / P ----
  var energiaB = inp.kWhBase       * tar.energiaBase;
  var energiaI = inp.kWhIntermedia * tar.energiaInter;
  var energiaP = inp.kWhPunta      * tar.energiaPunta;

  // ---- Row 28: SCnMEM = ΣkWh * tarifa(SERVICIOS CONEXOS NO MEM) ----
  var scnmem = kWhTotal * tar.scnmem;

  // ---- Row 29: Suministro (flat) ----
  var suministro = tar.suministro;

  // ---- Row 30: Energía Total = SUM(rows 21-28) ----
  // Note: Suministro (row 29) is NOT included in this sum. Engine formula
  // is =SUM(C21:C28), which excludes row 29.
  var energiaTotal = capacidad + distribucion + transmision + cenace +
                     energiaB + energiaI + energiaP + scnmem;

  // ---- Row 31: 2% Baja Tension ----
  // Engine: =IF($C$7="YES", C30*0.02, 0)
  var bajaTension2pctCharge = inp.bajaTension2pct ? (energiaTotal * 0.02) : 0;

  // ---- Row 32: Cargo FP ----
  // Engine (verbatim from sheet) — v2.1.2: 0.9 replaced with configurable threshold:
  //   IF PF < threshold:  MAX(3/5*(threshold/PF - 1), 0) * (C30+C31)      ← penalty (charge)
  //   IF PF >= threshold: MAX(1/4*(1 - threshold/PF), 0) * -(C30+C31)     ← bonus (credit)
  // Default threshold = 0.90 (legacy). Override via options.fpThreshold to 0.95 (≥1MW)
  // or 0.97 (≥1MW post-April-8-2026). See Acuerdo A/073/2023 numeral 5.5.
  var fpBase = energiaTotal + bajaTension2pctCharge;
  var cargoFp;
  if (pf < fpThreshold) {
    cargoFp = Math.max(0.6 * (fpThreshold / pf - 1), 0) * fpBase;
  } else {
    cargoFp = Math.max(0.25 * (1 - fpThreshold / pf), 0) * -fpBase;
  }

  // ---- Row 33: Subtotal = SUM(rows 29-32) ----
  //   = Suministro + EnergiaTotal + 2%BT + CargoFP
  var subtotal = suministro + energiaTotal + bajaTension2pctCharge + cargoFp;

  // ---- Row 34: IVA = 16% of Subtotal ----
  var iva = subtotal * 0.16;

  // ---- Row 35: Facturación = Subtotal + IVA ----
  var facturacion = subtotal + iva;

  // ---- Row 36: DAP ----
  // Engine: =IF($C$6 < 1, C33 * $C$6, $C$6)
  // If DAP input is < 1, treat as a percentage of Subtotal; else flat.
  var dapInput = inp.dap || 0;
  var dap = (dapInput < 1) ? (subtotal * dapInput) : dapInput;

  // ---- Row 37: TOTAL = Facturación + DAP ----
  var total = facturacion + dap;

  return {
    demandaFacturable: demandaFacturable,
    pf:                pf,
    capacidad:         capacidad,
    distribucion:      distribucion,
    transmision:       transmision,
    cenace:            cenace,
    energiaB:          energiaB,
    energiaI:          energiaI,
    energiaP:          energiaP,
    scnmem:            scnmem,
    suministro:        suministro,
    energiaTotal:      energiaTotal,
    bajaTension2pct:   bajaTension2pctCharge,
    cargoFp:           cargoFp,
    subtotal:          subtotal,
    iva:               iva,
    facturacion:       facturacion,
    dap:               dap,
    total:             total,
  };
}

/**
 * Convenience: compute annual bill = sum of 12 monthly bills.
 * Useful when all 12 months use the same tariff snapshot (synthetic fixture).
 */
function calcCfeBillAnnual(monthlyInputs, tar, options) {
  if (!monthlyInputs || monthlyInputs.length !== 12) {
    throw new Error('calcCfeBillAnnual: need exactly 12 monthly input objects');
  }
  var annual = 0;
  for (var i = 0; i < 12; i++) {
    annual += calcCfeBill(monthlyInputs[i], tar, options).total;
  }
  return annual;
}


// =============================================================================
// v2.1.0 — PV + INTERCONNECTION MODE SUPPORT
// =============================================================================

/**
 * Compute one month's CFE bill WITH PV self-consumption and the
 * configured interconnection mode applied.
 *
 * Math:
 *   1. self_consumed = min(pv_kwh * self_pct, total_load)
 *      For MEDICION_NETA, self_pct is forced to 1.0 (NM is net-of-export
 *      by accounting construction; the simple JS impl approximates this
 *      by maximizing on-site use).
 *   2. exported = pv_kwh - self_consumed
 *   3. Reduce kWh in each tariff period by the same proportional factor:
 *      reduction_factor = self_consumed / total_load
 *      kWh_X_adj = kWh_X * (1 - reduction_factor)
 *   4. Compute bill on adjusted kWh via calcCfeBill().
 *   5. Apply export credit based on mode:
 *        MEDICION_NETA     : 0 (handled by accounting in step 1; in legacy
 *                              engine, surplus carries over months — JS
 *                              does NOT replicate this carry-over)
 *        FACTURACION_NETA  : exported * export_price
 *        SIN_EXPORTACION   : 0 (surplus is lost)
 *   6. final = bill_post_pv - export_credit
 *
 * @param {Object} inp   Same as calcCfeBill: monthly kWh/kW/kVArh/tariff.
 * @param {Object} tar   Same as calcCfeBill: frozen tariff prices.
 * @param {Object} pv    PV + interconnection block:
 *   - monthlyKwh {number}             PV production this month (kWh).
 *                                     If 0 or undefined, behaves like calcCfeBill().
 *   - interconnectionMode {string}    CFE_MODE.* (default MEDICION_NETA).
 *   - exportPriceMxnPerKwh {number}   MXN/kWh export credit (default 0.80,
 *                                     matches new CFE rule effective 2026).
 *                                     Used only in FACTURACION_NETA.
 *   - selfConsumptionPct {number}     0-1, default 0.70.
 *                                     IGNORED in MEDICION_NETA (forced to 1.0).
 *
 * @return {Object} Extended breakdown — same fields as calcCfeBill() plus:
 *   - pvKwh                 Input PV monthly kWh
 *   - selfConsumedKwh       Self-consumed portion (used on site)
 *   - exportedKwh           Surplus PV
 *   - reductionFactor       Fraction of load offset by PV self-consumption
 *   - billPreExport         Bill computed on PV-adjusted kWh (before credit)
 *   - exportCredit          MXN credited per the interconnection rule (positive)
 *   - total                 billPreExport - exportCredit (final bill)
 *   - interconnectionMode   Mode applied
 *   - selfConsumptionPctUsed Effective self-consumption % applied (after NM override)
 */
function calcCfeBillWithPv(inp, tar, pv, options) {
  // v2.1.2: optional `options` param forwarded to calcCfeBill (e.g., fpThreshold).
  // Defensive defaults — if pv is missing or no production, fall through
  // to the no-PV path exactly.
  if (!pv || !pv.monthlyKwh || pv.monthlyKwh <= 0) {
    var noPv = calcCfeBill(inp, tar, options);
    noPv.pvKwh = 0;
    noPv.selfConsumedKwh = 0;
    noPv.exportedKwh = 0;
    noPv.reductionFactor = 0;
    noPv.billPreExport = noPv.total;
    noPv.exportCredit = 0;
    noPv.interconnectionMode = (pv && pv.interconnectionMode) || CFE_MODE.MEDICION_NETA;
    noPv.selfConsumptionPctUsed = 0;
    return noPv;
  }

  var mode = pv.interconnectionMode || CFE_MODE.MEDICION_NETA;
  // Default export price reflects the new CFE rule (2026): 0.80 MXN/kWh.
  // Configurable per project. Used only in FACTURACION_NETA mode.
  var exportPrice = (pv.exportPriceMxnPerKwh != null) ? pv.exportPriceMxnPerKwh : 0.80;

  // Validate the caller's selfConsumptionPct BEFORE applying any mode override.
  // Even when MEDICION_NETA will force selfPct to 1.0, an out-of-range caller
  // value is a bug we want to surface.
  if (pv.selfConsumptionPct != null &&
      (pv.selfConsumptionPct < 0 || pv.selfConsumptionPct > 1)) {
    throw new Error('calcCfeBillWithPv: selfConsumptionPct must be 0-1, got '
                    + pv.selfConsumptionPct);
  }

  // v2.1.4: self_pct defaults are mode-aware.
  //   - MEDICION_NETA: forced 100% (legacy CRE behavior).
  //   - SIN_EXPORTACION: default 100% if blank (no waste model — all PV
  //     up to load gets consumed). Designer can override down to model curtailment.
  //   - FACTURACION_NETA: default 70% if blank (industry standard for
  //     daytime-load misalignment when system exports).
  // See PHASE_1_4_DESIGN_v2.md Q2/Q3 for rationale.
  var selfPct;
  if (mode === CFE_MODE.MEDICION_NETA) {
    selfPct = 1.0;
  } else if (mode === CFE_MODE.SIN_EXPORTACION) {
    selfPct = (pv.selfConsumptionPct != null) ? pv.selfConsumptionPct : 1.0;
  } else { // FACTURACION_NETA
    selfPct = (pv.selfConsumptionPct != null) ? pv.selfConsumptionPct : 0.70;
  }

  var totalLoad = inp.kWhBase + inp.kWhIntermedia + inp.kWhPunta;

  // v2.1.4: mode-aware cascade.
  //   - MEDICION_NETA: PV displaces all three periods proportionally (existing
  //     JS behavior, matches v2.1.0 lock and Quimica FOTOVOLTAICO bill).
  //   - SIN_EXPORTACION / FACTURACION_NETA: PV strictly hits intermedia first;
  //     any leftover is wasted (SE) or exported as cash credit (FN). Base and
  //     punta unchanged. Rationale: PV produces during intermedia hours
  //     (~6am-6pm), so intermedia-only displacement reflects physical reality.
  //     See PHASE_1_4_DESIGN_v2.md Q1.
  var selfConsumed, exported, inpAdj;
  if (mode === CFE_MODE.MEDICION_NETA) {
    selfConsumed = Math.min(pv.monthlyKwh * selfPct, totalLoad);
    exported = pv.monthlyKwh - selfConsumed;
    var rfNm = (totalLoad > 0) ? (selfConsumed / totalLoad) : 0;
    inpAdj = {
      kWhBase:       inp.kWhBase       * (1 - rfNm),
      kWhIntermedia: inp.kWhIntermedia * (1 - rfNm),
      kWhPunta:      inp.kWhPunta      * (1 - rfNm),
      kWBase:        inp.kWBase,
      kWIntermedia:  inp.kWIntermedia,
      kWPunta:       inp.kWPunta,
      kWMaxAnoMovil: inp.kWMaxAnoMovil,
      kVArh:         inp.kVArh,
      tarifa:        inp.tarifa,
      dap:           inp.dap,
      bajaTension2pct: inp.bajaTension2pct,
    };
  } else {
    // SE or FN: intermedia-only displacement, capped at self_pct × PV
    var pvUsable = pv.monthlyKwh * selfPct;
    var pvToIntermedia = Math.min(inp.kWhIntermedia, pvUsable);
    selfConsumed = pvToIntermedia;
    exported = pv.monthlyKwh - selfConsumed;
    inpAdj = {
      kWhBase:       inp.kWhBase,
      kWhIntermedia: inp.kWhIntermedia - pvToIntermedia,
      kWhPunta:      inp.kWhPunta,
      kWBase:        inp.kWBase,
      kWIntermedia:  inp.kWIntermedia,
      kWPunta:       inp.kWPunta,
      kWMaxAnoMovil: inp.kWMaxAnoMovil,
      kVArh:         inp.kVArh,
      tarifa:        inp.tarifa,
      dap:           inp.dap,
      bajaTension2pct: inp.bajaTension2pct,
    };
  }

  // Bill on adjusted consumption (same formula path as no-PV).
  // v2.1.2: forward options to honor fpThreshold and any future options.
  var billDetail = calcCfeBill(inpAdj, tar, options);

  // Apply export credit per mode.
  var exportCredit;
  switch (mode) {
    case CFE_MODE.MEDICION_NETA:
      // NM credits are baked into the accounting (step 1 forced selfPct=1.0).
      // No separate export line.
      exportCredit = 0;
      break;
    case CFE_MODE.FACTURACION_NETA:
      exportCredit = exported * exportPrice;
      break;
    case CFE_MODE.SIN_EXPORTACION:
      exportCredit = 0;
      break;
    default:
      throw new Error('calcCfeBillWithPv: unknown interconnectionMode "' + mode + '"');
  }

  // Final = pre-export bill minus export credit. Credit reduces what
  // the customer pays. Negative result is theoretically possible if
  // export credit > bill; we don't clip (the legacy engine may; this
  // is documented in PHASE_1_DESIGN.md as a known disagreement).
  var billPreExport = billDetail.total;
  var total = billPreExport - exportCredit;

  // Return extended breakdown.
  // reductionFactor semantics:
  //   NM: fraction of total load displaced by PV (legacy meaning)
  //   SE/FN: same — selfConsumed / totalLoad — but selfConsumed is bounded
  //          by kWhIntermedia (only intermedia gets displaced)
  var reductionFactor = (totalLoad > 0) ? (selfConsumed / totalLoad) : 0;
  billDetail.pvKwh = pv.monthlyKwh;
  billDetail.selfConsumedKwh = selfConsumed;
  billDetail.exportedKwh = exported;
  billDetail.reductionFactor = reductionFactor;
  billDetail.billPreExport = billPreExport;
  billDetail.exportCredit = exportCredit;
  billDetail.total = total;
  billDetail.interconnectionMode = mode;
  billDetail.selfConsumptionPctUsed = selfPct;
  return billDetail;
}

/**
 * Convenience: compute annual bill with PV across 12 months.
 *
 * @param {Array<Object>} monthlyInputs  12 monthly input objects
 * @param {Object} tar                   Frozen tariff prices
 * @param {Object|Array<Object>} pv      PV+mode block. Can be:
 *   - A single object → same PV settings every month (e.g., flat 25,000 kWh)
 *   - An array of 12 objects → per-month PV (for seasonality)
 */
function calcCfeBillWithPvAnnual(monthlyInputs, tar, pv, options) {
  if (!monthlyInputs || monthlyInputs.length !== 12) {
    throw new Error('calcCfeBillWithPvAnnual: need exactly 12 monthly input objects');
  }
  var pvIsArray = Array.isArray(pv);
  if (pvIsArray && pv.length !== 12) {
    throw new Error('calcCfeBillWithPvAnnual: pv array must have 12 entries');
  }
  var annual = 0;
  for (var i = 0; i < 12; i++) {
    var pvMonth = pvIsArray ? pv[i] : pv;
    annual += calcCfeBillWithPv(monthlyInputs[i], tar, pvMonth, options).total;
  }
  return annual;
}

// =============================================================================
// PHASE 2 (v2.2.0) — BESS impact calculator
// =============================================================================
// Strategy B (SELF_CONSUMPTION_MAX) only. PEAK_SHAVING and HYBRID strategies
// are deferred to v2.3.0 pending 15-min interval data.
// See PHASE_2_DESIGN_v2.md for design rationale and scope decisions.
// =============================================================================

/**
 * BESS strategy constants. Only SELF_CONSUMPTION_MAX is implemented in v2.2.0.
 */
var BESS_STRATEGY = {
  SELF_CONSUMPTION_MAX: 'SELF_CONSUMPTION_MAX',
  // PEAK_SHAVING:        'PEAK_SHAVING',         // v2.3.0
  // HYBRID:              'HYBRID',               // v2.3.0
};

/**
 * Compute monthly BESS impact (Strategy B: SELF_CONSUMPTION_MAX).
 *
 * Models a battery that captures PV energy that would otherwise be exported
 * (FN mode) or curtailed (SE mode), and discharges it later to displace
 * grid consumption.
 *
 * Math (per month):
 *   usable_kWh = capacityKwh × (maxSoc - minSoc) × (1 - degradation) × (1 - backup)
 *   throughput_kWh = usable_kWh × cyclesPerDay × daysInMonth × rtePct
 *   captured_kWh = MIN(pv.exportedKwh, throughput_kWh)
 *   value_per_kWh = blended_avoided_tariff - export_price
 *     where blended_avoided_tariff = baseline_bill / total_kWh
 *     and export_price = pv.exportPriceMxnPerKwh if mode=FN else 0
 *   savings_MXN = captured_kWh × value_per_kWh × rtePct
 *   bill_after_bess = bill_after_pv - savings_MXN
 *
 * @param {Object} inp   Monthly CFE inputs (kWhBase, kWhIntermedia, etc.)
 * @param {Object} tar   Frozen tariff prices
 * @param {Object} pv    PV block (monthlyKwh, interconnectionMode, etc.)
 * @param {Object} bess  Battery + strategy block:
 *   {
 *     strategy: 'SELF_CONSUMPTION_MAX',  // required (only one for now)
 *     capacityKwh: number,
 *     powerKw: number,                   // not used in v2.2.0 Strategy B
 *     minSocPct: 0-1,
 *     maxSocPct: 0-1,
 *     rtePct: 0-1,
 *     cyclesPerDay: number,
 *     degradationPct: 0-1,
 *     backupReservePct: 0-1,
 *     daysInMonth: number (default 30.42 for annual-average)
 *   }
 * @param {Object} options  Forwarded to calcCfeBill (e.g., fpThreshold)
 *
 * @return {Object} {
 *   bessUsableCapacityKwh,
 *   bessMonthlyThroughputKwh,
 *   pvExportedKwh,
 *   pvCapturedByBessKwh,
 *   blendedAvoidedTariffMxnPerKwh,
 *   exportPriceMxnPerKwh,
 *   valuePerCapturedKwh,
 *   pvCaptureValueMxn,
 *   baselineBill,
 *   billAfterPv,
 *   billAfterPvAndBess,
 *   strategyUsed,
 *   bessEnabled: true
 * }
 */
function calcBessImpact(inp, tar, pv, bess, options) {
  // Defensive: missing/disabled BESS returns the no-BESS path
  if (!bess || !bess.capacityKwh || bess.capacityKwh <= 0) {
    var pvOnly = calcCfeBillWithPv(inp, tar, pv, options);
    var baselineOnly = calcCfeBill(inp, tar, options);
    return {
      bessUsableCapacityKwh: 0,
      bessMonthlyThroughputKwh: 0,
      pvExportedKwh: pvOnly.exportedKwh || 0,
      pvCapturedByBessKwh: 0,
      blendedAvoidedTariffMxnPerKwh: 0,
      exportPriceMxnPerKwh: 0,
      valuePerCapturedKwh: 0,
      pvCaptureValueMxn: 0,
      baselineBill: baselineOnly.total,
      billAfterPv: pvOnly.total,
      billAfterPvAndBess: pvOnly.total,
      strategyUsed: null,
      bessEnabled: false,
    };
  }

  // Strategy validation
  var strategy = bess.strategy || BESS_STRATEGY.SELF_CONSUMPTION_MAX;
  if (strategy !== BESS_STRATEGY.SELF_CONSUMPTION_MAX) {
    throw new Error('calcBessImpact: only SELF_CONSUMPTION_MAX supported in v2.2.0, got '
                    + strategy);
  }

  // Input bounds validation
  if (bess.minSocPct < 0 || bess.minSocPct > 1) {
    throw new Error('calcBessImpact: minSocPct must be 0-1, got ' + bess.minSocPct);
  }
  if (bess.maxSocPct < 0 || bess.maxSocPct > 1) {
    throw new Error('calcBessImpact: maxSocPct must be 0-1, got ' + bess.maxSocPct);
  }
  if (bess.maxSocPct <= bess.minSocPct) {
    throw new Error('calcBessImpact: maxSocPct must exceed minSocPct, got '
                    + bess.maxSocPct + ' vs ' + bess.minSocPct);
  }
  if (bess.rtePct < 0 || bess.rtePct > 1) {
    throw new Error('calcBessImpact: rtePct must be 0-1, got ' + bess.rtePct);
  }
  if (bess.degradationPct < 0 || bess.degradationPct > 1) {
    throw new Error('calcBessImpact: degradationPct must be 0-1, got ' + bess.degradationPct);
  }
  if (bess.backupReservePct < 0 || bess.backupReservePct > 1) {
    throw new Error('calcBessImpact: backupReservePct must be 0-1, got ' + bess.backupReservePct);
  }

  var daysInMonth = (bess.daysInMonth != null) ? bess.daysInMonth : 30.42;

  // 1. Compute battery capacity and throughput
  var usableKwh = bess.capacityKwh
                  * (bess.maxSocPct - bess.minSocPct)
                  * (1 - bess.degradationPct)
                  * (1 - bess.backupReservePct);
  var monthlyThroughputKwh = usableKwh * bess.cyclesPerDay * daysInMonth * bess.rtePct;

  // 2. Compute PV result (need exportedKwh)
  var pvResult = calcCfeBillWithPv(inp, tar, pv, options);
  var pvExportedKwh = pvResult.exportedKwh;
  var billAfterPv = pvResult.total;

  // 3. Captured kWh = MIN(exported, throughput)
  var capturedKwh = Math.min(pvExportedKwh, monthlyThroughputKwh);

  // 4. Compute blended avoided tariff (baseline bill / total kWh consumed)
  var baselineResult = calcCfeBill(inp, tar, options);
  var totalKwhConsumed = inp.kWhBase + inp.kWhIntermedia + inp.kWhPunta;
  var blendedAvoidedTariff = (totalKwhConsumed > 0)
    ? (baselineResult.total / totalKwhConsumed)
    : 0;

  // 5. Export price (only nonzero in FN mode)
  var mode = (pv && pv.interconnectionMode) || CFE_MODE.MEDICION_NETA;
  var exportPrice = (mode === CFE_MODE.FACTURACION_NETA)
    ? ((pv.exportPriceMxnPerKwh != null) ? pv.exportPriceMxnPerKwh : 0.80)
    : 0;

  // 6. Value per captured kWh and total savings
  var valuePerCapturedKwh = blendedAvoidedTariff - exportPrice;
  var pvCaptureValueMxn = capturedKwh * valuePerCapturedKwh * bess.rtePct;

  // 7. Final bill: bill after PV minus BESS savings, floored at 0
  var billAfterPvAndBess = Math.max(0, billAfterPv - pvCaptureValueMxn);

  return {
    bessUsableCapacityKwh: usableKwh,
    bessMonthlyThroughputKwh: monthlyThroughputKwh,
    pvExportedKwh: pvExportedKwh,
    pvCapturedByBessKwh: capturedKwh,
    blendedAvoidedTariffMxnPerKwh: blendedAvoidedTariff,
    exportPriceMxnPerKwh: exportPrice,
    valuePerCapturedKwh: valuePerCapturedKwh,
    pvCaptureValueMxn: pvCaptureValueMxn,
    baselineBill: baselineResult.total,
    billAfterPv: billAfterPv,
    billAfterPvAndBess: billAfterPvAndBess,
    strategyUsed: strategy,
    bessEnabled: true,
  };
}

/**
 * Compute annual BESS impact across 12 months.
 *
 * @param {Array<Object>} monthlyInputs  12 monthly input objects (with daysInMonth)
 * @param {Object} tar                   Frozen tariff prices
 * @param {Object|Array<Object>} pv      PV block (single or per-month array)
 * @param {Object} bess                  Battery + strategy block
 * @param {Object} options               Forwarded
 * @return {number}                      Sum of 12 monthly billAfterPvAndBess
 */
function calcBessImpactAnnual(monthlyInputs, tar, pv, bess, options) {
  if (!monthlyInputs || monthlyInputs.length !== 12) {
    throw new Error('calcBessImpactAnnual: need exactly 12 monthly input objects');
  }
  var pvIsArray = Array.isArray(pv);
  var annual = 0;
  for (var i = 0; i < 12; i++) {
    var pvMonth = pvIsArray ? pv[i] : pv;
    var bessMonth = Object.assign({}, bess, {
      daysInMonth: monthlyInputs[i].daysInMonth || _daysInMonthByIndex(i),
    });
    annual += calcBessImpact(monthlyInputs[i], tar, pvMonth, bessMonth, options).billAfterPvAndBess;
  }
  return annual;
}

/**
 * Days in each month (1=Jan ... 12=Dec). 0-indexed input.
 * Used when monthlyInputs don't carry their own daysInMonth.
 */
function _daysInMonthByIndex(i) {
  var DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return DAYS[i];
}