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
//                              mode (known, documented disagreement).
//   - FACTURACION_NETA         New CFE rule. Export credited at fixed price.
//   - SIN_EXPORTACION          Zero export. Surplus PV is lost.
//
// VERIFICATION:
//   v2.0.4: no-PV path matches live engine to within ~0.001 MXN.
//   v2.1.0: PV scenarios verified by Python recompute (Phase 1 lock targets).
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
  // is a known, documented disagreement).
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
// PHASE 3 (v2.3.0) — adds PEAK_SHAVING strategy
// =============================================================================
// SELF_CONSUMPTION_MAX (Strategy B): captures PV export, displaces grid energy.
// PEAK_SHAVING (v2.3.0): discharges in punta to cut demand charges (Capacidad
//   + Distribución) plus an estimated energy load-shift tier (Variable).
// HYBRID remains deferred to v2.4.0 — combining both strategies on one battery
// requires interval data to avoid double-counting shared throughput/SoC.
// =============================================================================

/**
 * BESS strategy constants.
 *   SELF_CONSUMPTION_MAX — v2.2.0, PV-export capture (Strategy B)
 *   PEAK_SHAVING         — v2.3.0, demand-charge reduction
 *   LOAD_SHIFTING        — v3.7.9, time-of-use arbitrage (base->punta)
 *   HYBRID               — deferred (needs interval data)
 *
 * NOTE (3.7.9): the live customer-facing CFE savings come from the hourly
 * simulation (20_CalcHourlySimulation._bessDispatchHour), which implements
 * all three as priority policies. The monthly functions below are the
 * unit-tested analytic reference. LOAD_SHIFTING in the monthly layer reuses
 * the SELF_CONSUMPTION capture model as a conservative lower bound (it does
 * not model grid arbitrage; the hourly sim does). Kept consistent so neither
 * layer throws on a valid dropdown value.
 */
var BESS_STRATEGY = {
  SELF_CONSUMPTION_MAX: 'SELF_CONSUMPTION_MAX',
  PEAK_SHAVING:         'PEAK_SHAVING',
  LOAD_SHIFTING:        'LOAD_SHIFTING',
  // HYBRID:            'HYBRID',                // deferred — do not enable
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
  // 3.7.9: LOAD_SHIFTING is accepted by the monthly layer as a conservative
  // self-consumption-capture proxy (no grid arbitrage modeled here; the
  // hourly simulator does the real arbitrage dispatch). PEAK_SHAVING has its
  // own dedicated function (calcPeakShavingImpact) and must not be routed here.
  if (strategy !== BESS_STRATEGY.SELF_CONSUMPTION_MAX
      && strategy !== BESS_STRATEGY.LOAD_SHIFTING) {
    throw new Error('calcBessImpact: supports SELF_CONSUMPTION_MAX or '
                    + 'LOAD_SHIFTING (got ' + strategy + '). '
                    + 'PEAK_SHAVING uses calcPeakShavingImpact.');
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
  // v2.3.0 BUGFIX: rtePct must NOT be applied here. capturedKwh is already
  // MIN(exported, throughput), and monthlyThroughputKwh (step 1) already
  // carries the × rtePct factor. Multiplying again double-counted round-trip
  // losses, understating BESS savings by ~(1-rtePct) ≈ 10%. Verified via
  // Python recompute against SYNTH-001: FN Jan 9933.98 → 11037.76 (+11.1%).
  // See CHANGELOG v2.3.0.
  var valuePerCapturedKwh = blendedAvoidedTariff - exportPrice;
  var pvCaptureValueMxn = capturedKwh * valuePerCapturedKwh;

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

// =============================================================================
// PHASE 3 (v2.3.0) — PEAK_SHAVING strategy
// =============================================================================
// Models a battery that discharges during punta hours to reduce CFE demand
// charges, plus an estimated energy load-shift tier.
//
// THREE SAVINGS TIERS:
//   Tier 1a — Capacidad    : VERIFIABLE. demandaFacturable = MAX(kWPunta,
//                            0.7×kWMaxAnoMovil). Battery lowers kWPunta.
//   Tier 1b — Distribución : VERIFIABLE. charged on MAX(kWBase,kWInter,kWPunta).
//                            Moves ONLY if punta was the monthly max — often 0.
//   Tier 2  — Variable     : ESTIMATED. Energy shifted punta→base. Depends on a
//                            synthesized load shape, so it ALWAYS carries the
//                            "estimado — sujeto a levantamiento en sitio"
//                            disclaimer regardless of demand-data provenance.
//
// DEMAND-DATA PROVENANCE (v2.3.0 — option 1, decided 2026-05-18):
//   1. dmaxPuntaOverride present  → 'measured(override)'
//   2. else inp.kWPunta present   → 'measured(INPUT_CFE)'      ← normal path
//   3. else                       → 'synthesized(no demand data)' via
//                                    Q/(24×d×F.C.). LOUD disclaimer. Last resort
//                                    only — never runs when a metered kWPunta
//                                    exists, so it cannot inflate above real data.
//
// RATCHET (Year-1 vs steady-state):
//   demandaFacturable has a 0.7×kWMaxAnoMovil floor. A battery that shaves THIS
//   month's punta does not immediately erase the 12-month rolling max, so
//   Year-1 savings are smaller than steady-state. Both are reported; Year-1 is
//   the headline (conservative, protects against first-bill surprise).
//
// Verified via Python recompute against TESTPROJ_PEAK_001.
// =============================================================================

/**
 * Usable battery energy after SoC window, degradation, and backup reserve.
 * Shared with Strategy B's identical capacity model.
 */
function _bessUsableKwh(bess) {
  return bess.capacityKwh
       * (bess.maxSocPct - bess.minSocPct)
       * (1 - bess.degradationPct)
       * (1 - bess.backupReservePct);
}

/**
 * Compute one month's PEAK_SHAVING impact.
 *
 * @param {Object} inp   Monthly CFE inputs (kWh*, kW*, kWMaxAnoMovil, tariff).
 * @param {Object} tar   Frozen tariff prices.
 * @param {Object} bess  Battery block:
 *   {
 *     strategy: 'PEAK_SHAVING',
 *     capacityKwh, powerKw, minSocPct, maxSocPct, rtePct,
 *     cyclesPerDay, degradationPct, backupReservePct, daysInMonth,
 *     puntaWindowHours: number,        // hours of punta window (e.g. 4 winter)
 *     loadFactorFC: number,            // F.C. for synthesis path, default 0.57
 *     dmaxPuntaOverride: number|null,  // designer override of punta demand kW
 *   }
 * @param {Object} options  Forwarded to calcCfeBill (e.g. fpThreshold).
 *
 * @return {Object} {
 *   strategyUsed, bessEnabled,
 *   usableKwh, shaveKw, dmaxPuntaUsed, postBessPuntaKw, demandProvenance,
 *   // Year-1 (headline) — ratchet floor still partly loaded
 *   capacidadSavingYear1, distribucionSavingYear1, verifiableSavingYear1,
 *   // Steady-state — rolling max decayed to reduced peak
 *   capacidadSavingSteady, distribucionSavingSteady, verifiableSavingSteady,
 *   // Tier 2 — always estimated, always disclaimed
 *   energyShiftedKwh, variableSavingEstimated,
 *   totalSavingYear1,
 *   baselineBill, billAfterPeakShavingYear1,
 *   estimatedTierDisclaimer: true,
 *   synthesizedDemandDisclaimer: boolean   // true → loud "perfil genérico"
 * }
 */
function calcPeakShavingImpact(inp, tar, bess, options) {
  // Disabled / zero-capacity → no-op, returns baseline
  if (!bess || !bess.capacityKwh || bess.capacityKwh <= 0) {
    var baselineOnly = calcCfeBill(inp, tar, options);
    return {
      strategyUsed: null,
      bessEnabled: false,
      usableKwh: 0, shaveKw: 0, dmaxPuntaUsed: 0, postBessPuntaKw: 0,
      demandProvenance: 'n/a',
      capacidadSavingYear1: 0, distribucionSavingYear1: 0,
      verifiableSavingYear1: 0,
      capacidadSavingSteady: 0, distribucionSavingSteady: 0,
      verifiableSavingSteady: 0,
      energyShiftedKwh: 0, variableSavingEstimated: 0,
      totalSavingYear1: 0,
      baselineBill: baselineOnly.total,
      billAfterPeakShavingYear1: baselineOnly.total,
      estimatedTierDisclaimer: true,
      synthesizedDemandDisclaimer: false,
    };
  }

  // Input bounds validation (mirrors calcBessImpact discipline)
  if (bess.minSocPct < 0 || bess.minSocPct > 1) {
    throw new Error('calcPeakShavingImpact: minSocPct must be 0-1, got ' + bess.minSocPct);
  }
  if (bess.maxSocPct <= bess.minSocPct) {
    throw new Error('calcPeakShavingImpact: maxSocPct must exceed minSocPct, got '
                    + bess.maxSocPct + ' vs ' + bess.minSocPct);
  }
  if (bess.rtePct < 0 || bess.rtePct > 1) {
    throw new Error('calcPeakShavingImpact: rtePct must be 0-1, got ' + bess.rtePct);
  }
  if (!bess.puntaWindowHours || bess.puntaWindowHours <= 0) {
    throw new Error('calcPeakShavingImpact: puntaWindowHours must be > 0, got '
                    + bess.puntaWindowHours);
  }

  var usableKwh = _bessUsableKwh(bess);
  var daysInMonth = (bess.daysInMonth != null) ? bess.daysInMonth : 30.42;
  var fc = (bess.loadFactorFC != null) ? bess.loadFactorFC : 0.57;

  // ---- Shave power: limited by inverter power AND energy-over-window --------
  // The battery can sustain MIN(powerKw, usable/window) kW across the punta
  // window. Energy limit reflects that a small battery can't hold a big kW
  // reduction for the whole window.
  var shaveKw = Math.min(bess.powerKw, usableKwh / bess.puntaWindowHours);

  // ---- Demand provenance (option 1: synthesis is true last resort) ---------
  var dmaxPuntaUsed, demandProvenance, synthesizedDemandDisclaimer;
  if (bess.dmaxPuntaOverride != null && bess.dmaxPuntaOverride > 0) {
    dmaxPuntaUsed = bess.dmaxPuntaOverride;
    demandProvenance = 'measured(override)';
    synthesizedDemandDisclaimer = false;
  } else if (inp.kWPunta != null && inp.kWPunta > 0) {
    dmaxPuntaUsed = inp.kWPunta;
    demandProvenance = 'measured(INPUT_CFE)';
    synthesizedDemandDisclaimer = false;
  } else {
    // No demand data anywhere — synthesize from monthly kWh. LOUD disclaimer.
    var qMensual = inp.kWhBase + inp.kWhIntermedia + inp.kWhPunta;
    dmaxPuntaUsed = qMensual / (24 * daysInMonth * fc);
    demandProvenance = 'synthesized(no demand data)';
    synthesizedDemandDisclaimer = true;
  }

  var postBessPuntaKw = Math.max(dmaxPuntaUsed - shaveKw, 0);

  // ---- Tier 1: re-run the VERIFIED calcCfeBill with reduced punta demand ---
  // Year-1: rolling max (kWMaxAnoMovil) unchanged — ratchet floor still loaded.
  // Steady: rolling max has decayed to the reduced peak.
  function _withPunta(puntaKw, decayRollingMax) {
    var o = {
      kWhBase: inp.kWhBase, kWhIntermedia: inp.kWhIntermedia, kWhPunta: inp.kWhPunta,
      kWBase: inp.kWBase, kWIntermedia: inp.kWIntermedia, kWPunta: puntaKw,
      kWMaxAnoMovil: inp.kWMaxAnoMovil, kVArh: inp.kVArh,
      tarifa: inp.tarifa, dap: inp.dap, bajaTension2pct: inp.bajaTension2pct,
    };
    if (decayRollingMax) {
      o.kWMaxAnoMovil = Math.min(inp.kWMaxAnoMovil, puntaKw);
    }
    return o;
  }

  var billBefore       = calcCfeBill(_withPunta(dmaxPuntaUsed, false), tar, options);
  var billAfterYear1   = calcCfeBill(_withPunta(postBessPuntaKw, false), tar, options);
  var billAfterSteady  = calcCfeBill(_withPunta(postBessPuntaKw, true),  tar, options);

  var capacidadSavingYear1   = billBefore.capacidad   - billAfterYear1.capacidad;
  var distribucionSavingYear1 = billBefore.distribucion - billAfterYear1.distribucion;
  var capacidadSavingSteady  = billBefore.capacidad   - billAfterSteady.capacidad;
  var distribucionSavingSteady = billBefore.distribucion - billAfterSteady.distribucion;

  var verifiableSavingYear1  = capacidadSavingYear1  + distribucionSavingYear1;
  var verifiableSavingSteady = capacidadSavingSteady + distribucionSavingSteady;

  // ---- Tier 2: Variable load-shift — ESTIMATED, always disclaimed ----------
  // Energy shifted out of punta into base, capped by monthly battery throughput.
  // This depends on a synthesized load shape (which punta kWh the battery
  // actually displaced), so it is NEVER measured-grade.
  var monthlyThroughputKwh = usableKwh * bess.cyclesPerDay * daysInMonth * bess.rtePct;
  var energyShiftedKwh = Math.min(inp.kWhPunta, monthlyThroughputKwh);
  var variableSavingEstimated = energyShiftedKwh * (tar.energiaPunta - tar.energiaBase);

  var totalSavingYear1 = verifiableSavingYear1 + variableSavingEstimated;
  var billAfterPeakShavingYear1 = Math.max(0, billBefore.total - totalSavingYear1);

  return {
    strategyUsed: BESS_STRATEGY.PEAK_SHAVING,
    bessEnabled: true,
    usableKwh: usableKwh,
    shaveKw: shaveKw,
    dmaxPuntaUsed: dmaxPuntaUsed,
    postBessPuntaKw: postBessPuntaKw,
    demandProvenance: demandProvenance,
    capacidadSavingYear1: capacidadSavingYear1,
    distribucionSavingYear1: distribucionSavingYear1,
    verifiableSavingYear1: verifiableSavingYear1,
    capacidadSavingSteady: capacidadSavingSteady,
    distribucionSavingSteady: distribucionSavingSteady,
    verifiableSavingSteady: verifiableSavingSteady,
    energyShiftedKwh: energyShiftedKwh,
    variableSavingEstimated: variableSavingEstimated,
    totalSavingYear1: totalSavingYear1,
    baselineBill: billBefore.total,
    billAfterPeakShavingYear1: billAfterPeakShavingYear1,
    estimatedTierDisclaimer: true,
    synthesizedDemandDisclaimer: synthesizedDemandDisclaimer,
  };
}