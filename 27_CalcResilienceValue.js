// =============================================================================
// ARGIA -- 27_CalcResilienceValue.js
// -----------------------------------------------------------------------------
// CHUNK 7 Session 2 -- RESILIENCE_MAX support.
//
// Pure functions (no SpreadsheetApp, no I/O) for the resilience/backup case:
//   - size the reserve from physical critical-load inputs
//   - compute the coverage fraction
//   - compute the avoided-loss resilience value, GUARDED by a required
//     value-source qualifier (the anti-fantasy-ROI rule)
//
// Per the Chunk 7 decisions (reviewer, 2026-05-29):
//   - critical LOAD, not total load: reserve = criticalLoadKw x hours
//   - value-source REQUIRED when eventCostMxn > 0, else value forced to 0
//   - resilience value is NEVER blended with CFE bill savings (the writer
//     enforces separate lines; this module just returns it as its own field)
// =============================================================================

var RESILIENCE_VALUE_SOURCES = {
  CUSTOMER_ESTIMATE:  { id: 'CUSTOMER_ESTIMATE',  rank: 1,
    label: 'estimación del cliente (no validada)' },
  VALIDATED_ESTIMATE: { id: 'VALIDATED_ESTIMATE', rank: 2,
    label: 'estimación validada' },
  AUDITED_ESTIMATE:   { id: 'AUDITED_ESTIMATE',   rank: 3,
    label: 'estimación auditada' }
};

// ---------------------------------------------------------------------------
// calcResilience(o) -> resilience result
//
// @param {Object} o
//   criticalLoadKw       {number}  load that must stay alive (kW)
//   backupDurationHours  {number}  required survival time (h)
//   usableKwh            {number}  battery usable capacity (kWh) -- the pool
//                                  the reserve is carved from
//   eventsPerYear        {number}  disruptive events/year
//   eventCostMxn         {number}  cost per event (MXN)
//   eventValueSource     {string}  CUSTOMER_ESTIMATE|VALIDATED_ESTIMATE|
//                                  AUDITED_ESTIMATE  (required if cost > 0)
// @return {Object}
//   reservedKwh          {number}  criticalLoadKw x backupDurationHours
//   reservedFracOfUsable {number}  min(1, reservedKwh / usableKwh)  [0..1]
//   coverageFraction     {number}  fraction of the backup spec the battery
//                                  can actually hold  [0..1]
//   undersized           {boolean} reservedKwh > usableKwh
//   resilienceValueMxn   {number}  events x cost x coverage  (0 if no source)
//   valueSource          {string|null}  resolved source id (null if none)
//   valueSourceLabel     {string}  human label, or "sin fuente de valor"
//   valueBlockedNoSource {boolean} true if cost>0 but source blank -> value 0
//   warnings             {string[]}
// ---------------------------------------------------------------------------
function calcResilience(o) {
  o = o || {};
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  var criticalLoadKw = Math.max(0, num(o.criticalLoadKw, 0));
  var durationH      = Math.max(0, num(o.backupDurationHours, 0));
  var usableKwh      = Math.max(0, num(o.usableKwh, 0));
  var eventsPerYear  = Math.max(0, num(o.eventsPerYear, 0));
  var eventCostMxn   = Math.max(0, num(o.eventCostMxn, 0));
  var rawSource      = String(o.eventValueSource || '').trim().toUpperCase();

  var warnings = [];

  // -- Reserve sizing (physical) ------------------------------------------
  var reservedKwh = criticalLoadKw * durationH;

  // The energy the backup spec NEEDS is, by definition, reservedKwh. The
  // battery can hold at most usableKwh. Coverage = how much of the spec the
  // battery can actually back up.
  var energyNeeded = reservedKwh;
  var coverageFraction;
  var undersized = false;
  if (energyNeeded <= 0) {
    coverageFraction = 0;                 // no backup requested
  } else if (usableKwh >= energyNeeded) {
    coverageFraction = 1;                 // battery fully covers the spec
  } else {
    coverageFraction = usableKwh / energyNeeded;   // partial
    undersized = true;
    warnings.push('Batería subdimensionada para el respaldo solicitado: '
      + 'se requieren ' + Math.round(energyNeeded) + ' kWh ('
      + criticalLoadKw + ' kW x ' + durationH + ' h) pero el usable es '
      + Math.round(usableKwh) + ' kWh. Cobertura ' + Math.round(coverageFraction * 100) + '%.');
  }

  // Fraction of usable capacity that must be HELD as reserve (cannot exceed 1).
  var reservedFracOfUsable = (usableKwh > 0)
    ? Math.min(1, reservedKwh / usableKwh)
    : (reservedKwh > 0 ? 1 : 0);

  // -- Value-source guard (anti-fantasy-ROI) ------------------------------
  var resolvedSource = RESILIENCE_VALUE_SOURCES[rawSource] || null;
  var valueBlockedNoSource = false;
  var resilienceValueMxn = 0;

  if (eventCostMxn > 0) {
    if (!resolvedSource) {
      // Cost entered but no source -> REFUSE to compute value.
      valueBlockedNoSource = true;
      resilienceValueMxn = 0;
      warnings.push('Valor de respaldo NO calculado: se ingresó un costo por '
        + 'evento pero no una fuente de valor (eventValueSource). Indique '
        + 'CUSTOMER_ESTIMATE / VALIDATED_ESTIMATE / AUDITED_ESTIMATE.');
    } else {
      resilienceValueMxn = eventsPerYear * eventCostMxn * coverageFraction;
    }
  }
  // eventCostMxn == 0 -> value 0, no source needed, no warning.

  return {
    reservedKwh:          reservedKwh,
    reservedFracOfUsable: reservedFracOfUsable,
    coverageFraction:     coverageFraction,
    undersized:           undersized,
    resilienceValueMxn:   resilienceValueMxn,
    valueSource:          resolvedSource ? resolvedSource.id : null,
    valueSourceLabel:     resolvedSource ? resolvedSource.label : 'sin fuente de valor',
    valueBlockedNoSource: valueBlockedNoSource,
    warnings:             warnings
  };
}
