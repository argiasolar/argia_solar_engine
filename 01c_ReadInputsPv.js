// =============================================================================
// ARGIA -- 01c_ReadInputsPv.js
// -----------------------------------------------------------------------------
// CHUNK 7 Session 1 -- install-PV toggle + scenario model.
//
// READER ONLY. Returns a typed pvConfig{} object describing whether NEW PV is
// part of this project, mirroring the battery toggle pattern in
// 01a_ReadInputsBess.js. The engine consumes pvConfig.installed to decide
// whether to model new solar generation.
//
// THE NULL-PV OBJECT (per the Chunk 7 decision -- no scattered `if installPv`):
//   When installPv = NO, this returns an object with installed:false and
//   monthlyPvKwh:null. Downstream, runHourlySimulation passes
//   monthlyPv:null to the simulator, which ALREADY treats null as "no solar"
//   (the baseline run does exactly this today). So a battery-only project
//   flows through the existing, battle-tested no-PV path with no new
//   branches in the core sim.
//
// SCENARIO MODEL (battery-only configurations):
//   The combination of (installPv, installBattery, hasExistingPv) classifies
//   the project. classifyScenario() returns the label + the PV-capture policy.
//
//   1   PV only                  installPv=YES, battery=NO
//   2   PV + Battery             installPv=YES, battery=YES
//   3   Battery only greenfield  installPv=NO,  battery=YES, existingPv=NO
//   4A  Battery only, exist. PV  installPv=NO,  battery=YES, existingPv=YES,
//                                (existing PV profile UNKNOWN)
//   4B  Battery only, exist. PV  installPv=NO,  battery=YES, existingPv=YES,
//                                (existing PV profile KNOWN)  -- ROADMAP
//
//   PV-capture policy:
//     - Scenarios 3 and 4A: capture OFF (charge from grid only). 4A
//       under-states honestly and carries a disclaimer that capturing the
//       customer's EXISTING-solar export is not modeled (value may be
//       higher).
//     - Scenario 4B: capture ON using the supplied existing-PV profile,
//       with the anti-double-count rule (existing PV is a CHARGING source
//       only, never re-subtracted from the already-net bill). NOT YET LIVE.
// =============================================================================

// ---------------------------------------------------------------------------
// readInputPv(ss) -> pvConfig{}
//   Always returns an object (never null) so callers can read
//   pvConfig.installed without a null check. installPv defaults to YES to
//   preserve all existing behavior (every current project installs new PV).
// ---------------------------------------------------------------------------
function readInputPv(ss) {
  ss = ss || SpreadsheetApp.getActive();

  // installPv toggle (INPUT_PROJECT). Default YES: pre-Chunk-7 projects have
  // no toggle cell, and they all install new PV, so the safe default keeps
  // them byte-identical.
  var toggleRaw = readInput(ss, 'installPv');
  // When the cell/map entry is absent entirely, readInput returns '' or
  // undefined -> treat as YES (legacy default).
  var toggle = String(toggleRaw == null || toggleRaw === '' ? 'YES' : toggleRaw)
                 .trim().toUpperCase();
  var installPv = (toggle !== 'NO');   // anything but explicit NO => install

  // Existing-PV declaration (only meaningful when installPv = NO). Default NO.
  // Drives scenario 3 vs 4A/4B.
  var hasExistingRaw = readInput(ss, 'hasExistingPv');
  var hasExistingPv = String(hasExistingRaw || 'NO').trim().toUpperCase() === 'YES';

  var existingPvKwp = Number(readInput(ss, 'existingPvKwp')) || 0;
  var existingAnnualKwh = Number(readInput(ss, 'existingPvAnnualKwh')) || 0;
  var existingProfileKnown = hasExistingPv
    && (existingPvKwp > 0 || existingAnnualKwh > 0);

  // Chunk 7 4B: EXPORT data is the gate for the export-CAPTURE value stream.
  // The CFE bill is NET import and CANNOT reveal hourly export, so we never
  // estimate capture from net load. Capture value is computed ONLY when the
  // customer supplies real exported kWh (from the bill's export line or an
  // inverter portal). Absent -> capture shown as "DATOS INSUFICIENTES" and
  // the proposal runs peak-shaving-only.
  var existingExportKwh = Number(readInput(ss, 'existingExportKwh')) || 0;
  var exportDataAvailable = hasExistingPv && existingExportKwh > 0;

  return {
    installed:            installPv,
    // Null-PV object: when not installing new PV, monthlyPvKwh is null so the
    // caller passes monthlyPv:null to the sim (existing no-solar path).
    monthlyPvKwh:         installPv ? 'FROM_CFE_SIMULATION' : null,
    hasExistingPv:        hasExistingPv,
    existingPvKwp:        existingPvKwp,
    existingAnnualKwh:    existingAnnualKwh,
    existingProfileKnown: existingProfileKnown,
    existingExportKwh:    existingExportKwh,
    exportDataAvailable:  exportDataAvailable,
    provenance:           'INPUT_PROJECT'
  };
}


// ---------------------------------------------------------------------------
// classifyScenario(pvConfig, bessEnabled) -> { id, label, pvCapture, disclaimer }
//   Pure function. Classifies the project configuration and returns the
//   PV-capture policy + any disclaimer the writer must surface.
// ---------------------------------------------------------------------------
function classifyScenario(pvConfig, bessEnabled) {
  pvConfig = pvConfig || {};
  var installPv  = !!pvConfig.installed;
  var battery    = !!bessEnabled;
  var existingPv = !!pvConfig.hasExistingPv;
  var profileKnown = !!pvConfig.existingProfileKnown;

  // PV present (new install)
  if (installPv) {
    if (battery) {
      return { id: '2', label: 'PV + Battery',
               pvCapture: true, disclaimer: null };
    }
    return { id: '1', label: 'PV only',
             pvCapture: true, disclaimer: null };
  }

  // No new PV. Must have a battery to be a meaningful project.
  if (!battery) {
    return { id: '0', label: 'No PV, no battery (degenerate)',
             pvCapture: false,
             disclaimer: 'Proyecto sin PV nuevo ni batería: nada que modelar.' };
  }

  if (!existingPv) {
    // Scenario 3: greenfield battery-only.
    return { id: '3', label: 'Battery only (greenfield)',
             pvCapture: false, disclaimer: null };
  }

  // Existing PV present.
  if (profileKnown) {
    // Scenario 4B -- existing-PV capture. The export-CAPTURE value stream is
    // DATA-GATED: we never estimate export from the net bill (it can't reveal
    // hourly export). Capture value is computed only when real export data is
    // supplied; otherwise the proposal runs peak-shaving-only and capture
    // shows "DATOS INSUFICIENTES".
    var exportData = !!pvConfig.exportDataAvailable;
    if (exportData) {
      return {
        id: '4B',
        label: 'Battery only, existing PV — export capture (data present)',
        pvCapture: true,
        exportDataAvailable: true,
        disclaimer: 'Cliente con PV existente y datos de exportación. Se '
                  + 'valúa la captura del excedente solar exportado, neta del '
                  + 'valor que ya tenía bajo el esquema de interconexión '
                  + 'actual. Verifique los datos de exportación.'
      };
    }
    return {
      id: '4B-screening',
      label: 'Battery only, existing PV — peak-shaving only (no export data)',
      pvCapture: false,
      exportDataAvailable: false,
      disclaimer: 'Cliente con PV existente. La economía de peak-shaving y '
                + 'desplazamiento se calcula del recibo CFE. La CAPTURA de '
                + 'excedente solar NO se valúa: el recibo (importación neta) '
                + 'no revela la exportación horaria. Para valuarla se '
                + 'requieren datos de exportación o producción del PV '
                + 'existente (Nivel Propuesta).'
    };
  }

  // Scenario 4A: existing PV, profile unknown.
  return {
    id: '4A',
    label: 'Battery only, existing PV (profile unknown)',
    pvCapture: false,
    exportDataAvailable: false,
    disclaimer: 'Cliente con PV existente. El valor de la batería es '
              + 'incremental a su solar actual; NO se modela la captura del '
              + 'excedente de su solar existente (requeriría sus datos de '
              + 'producción). El valor real puede ser mayor.'
  };
}
