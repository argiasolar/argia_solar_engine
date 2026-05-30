// =============================================================================
// ARGIA -- 29_CalcCaptureNetValue.js
// -----------------------------------------------------------------------------
// CHUNK 7 Scenario 4B (regime netting) -- the HONEST capture value.
//
// The battery captures an existing-PV customer's EXPORTED surplus and
// discharges it later (earning punta/intermedia offset + demand reduction).
// But that exported energy was NOT worthless before the battery -- under the
// interconnection regime it already had some value. The honest incremental
// value of capture is:
//
//   captureNetValue = max(0, dischargeValue - priorExportWorth)
//
// where priorExportWorth depends on the regime (reviewer-confirmed table):
//   MEDICION_NETA    (net metering)  : export credited ~1:1 at the retail
//                                      energy rate it offset -> HIGH prior
//                                      worth -> capture adds LITTLE.
//   FACTURACION_NETA (net billing)   : export credited at exportPrice
//                                      (~0.80 MXN/kWh) -> MODERATE prior
//                                      worth -> capture adds HIGH value.
//   SIN_EXPORTACION  (zero export)   : export was lost (worth 0) -> capture
//                                      adds the MAXIMUM value.
//
// Floored at 0: if a generous net-metering regime valued the export MORE
// than the battery earns shifting it, capture is value-negative -- we never
// show negative capture; instead addsValue=false and the note says the
// battery's case rests on peak-shaving, not capture.
//
// NEVER blended into CFE bill savings (same rule as resilience). Its own
// line, net of prior worth, with the regime stated.
//
// Pure function. No SpreadsheetApp, no I/O.
// =============================================================================

var CAPTURE_REGIMES = {
  MEDICION_NETA:    'MEDICION_NETA',
  FACTURACION_NETA: 'FACTURACION_NETA',
  SIN_EXPORTACION:  'SIN_EXPORTACION'
};

// ---------------------------------------------------------------------------
// calcCaptureNetValue(o) -> capture result
//
// @param {Object} o
//   capturedKwh               {number}  annual kWh the battery captures from
//                                       existing-PV export (dispatcher output)
//   dischargeValueMxnPerKwh   {number}  value the battery earns per kWh
//                                       discharged (punta/intermedia offset +
//                                       amortized demand reduction)
//   interconnMode             {string}  CAPTURE_REGIMES.*
//   exportPriceMxnPerKwh      {number}  FACTURACION_NETA export credit (~0.80)
//   offsetEnergyRateMxnPerKwh {number}  the retail energy rate the export
//                                       offset under MEDICION_NETA (~1:1 worth)
// @return {Object}
//   capturedKwh, grossValueMxn, priorExportWorthMxn, netValueMxn,
//   regime, regimeLabel, addsValue:boolean, note
// ---------------------------------------------------------------------------
function calcCaptureNetValue(o) {
  o = o || {};
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  var capturedKwh   = Math.max(0, num(o.capturedKwh, 0));
  var dischargeVal  = Math.max(0, num(o.dischargeValueMxnPerKwh, 0));
  var exportPrice   = Math.max(0, num(o.exportPriceMxnPerKwh, 0.80));
  var offsetRate    = Math.max(0, num(o.offsetEnergyRateMxnPerKwh, 0));

  // Normalize the regime. The engine passes the ENGLISH enum from
  // readBessInterconnectionFromInputCfe (NET_METERING / NET_BILLING /
  // ZERO_EXPORT), while CFE_MODE / some callers use the SPANISH enum
  // (MEDICION_NETA / FACTURACION_NETA / SIN_EXPORTACION). Accept BOTH so a
  // spelling mismatch can never silently fall through to a wrong default.
  var rawRegime = String(o.interconnMode || '').trim().toUpperCase();
  var regime;
  if (rawRegime === 'ZERO_EXPORT' || rawRegime === 'SIN_EXPORTACION') {
    regime = 'ZERO_EXPORT';
  } else if (rawRegime === 'NET_BILLING' || rawRegime === 'FACTURACION_NETA') {
    regime = 'NET_BILLING';
  } else if (rawRegime === 'NET_METERING' || rawRegime === 'MEDICION_NETA') {
    regime = 'NET_METERING';
  } else {
    regime = 'UNKNOWN';
  }

  // Per-kWh prior export worth by regime.
  var priorPerKwh;
  var regimeLabel;
  if (regime === 'ZERO_EXPORT') {
    priorPerKwh = 0;                       // export was lost
    regimeLabel = 'sin exportación (excedente se perdía)';
  } else if (regime === 'NET_BILLING') {
    priorPerKwh = exportPrice;             // credited at export price
    regimeLabel = 'facturación neta (excedente a ' + exportPrice + ' MXN/kWh)';
  } else if (regime === 'NET_METERING') {
    // Export credited ~1:1 at the retail rate it offset. If offsetRate wasn't
    // supplied, fall back to dischargeVal as a conservative proxy (treats NM
    // export as ~equal to discharge value -> capture nets near 0, the honest
    // "adds little" result).
    priorPerKwh = (offsetRate > 0) ? offsetRate : dischargeVal;
    regimeLabel = 'medición neta (excedente ya acreditado ~1:1)';
  } else {
    // UNKNOWN regime: be CONSERVATIVE -- assume the export was already fully
    // valued (prior worth = discharge value) so capture nets to 0. Never
    // overstate when we don't know the regime.
    priorPerKwh = dischargeVal;
    regimeLabel = 'esquema desconocido (captura no valuada por seguridad)';
  }

  var grossValueMxn       = capturedKwh * dischargeVal;
  var priorExportWorthMxn = capturedKwh * priorPerKwh;
  var rawNet              = grossValueMxn - priorExportWorthMxn;
  var netValueMxn         = Math.max(0, rawNet);
  var addsValue           = rawNet > 0;

  var note;
  if (!addsValue) {
    note = 'Bajo este esquema de interconexión, el excedente exportado ya '
         + 'tenía un valor similar o mayor al que la batería obtiene al '
         + 'desplazarlo. La captura NO agrega valor económico; el caso de la '
         + 'batería se sostiene en peak-shaving, no en la captura.';
  } else {
    note = 'Valor incremental de capturar el excedente exportado, neto de lo '
         + 'que ya valía como exportación bajo el esquema actual.';
  }

  return {
    capturedKwh:          capturedKwh,
    grossValueMxn:        grossValueMxn,
    priorExportWorthMxn:  priorExportWorthMxn,
    netValueMxn:          netValueMxn,
    regime:               regime,
    regimeLabel:          regimeLabel,
    addsValue:            addsValue,
    note:                 note
  };
}
