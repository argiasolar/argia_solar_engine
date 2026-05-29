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
  // Drives scenario 3 vs 4A/4B. The "known profile" inputs (4B) are read but
  // NOT yet used for capture -- 4B is roadmap. We read them so the input
  // surface is stable when 4B lands.
  var hasExistingRaw = readInput(ss, 'hasExistingPv');
  var hasExistingPv = String(hasExistingRaw || 'NO').trim().toUpperCase() === 'YES';

  var existingPvKwp = Number(readInput(ss, 'existingPvKwp')) || 0;
  var existingAnnualKwh = Number(readInput(ss, 'existingPvAnnualKwh')) || 0;
  var existingProfileKnown = hasExistingPv
    && (existingPvKwp > 0 || existingAnnualKwh > 0);

  return {
    installed:            installPv,
    // Null-PV object: when not installing new PV, monthlyPvKwh is null so the
    // caller passes monthlyPv:null to the sim (existing no-solar path).
    monthlyPvKwh:         installPv ? 'FROM_CFE_SIMULATION' : null,
    hasExistingPv:        hasExistingPv,
    existingPvKwp:        existingPvKwp,
    existingAnnualKwh:    existingAnnualKwh,
    existingProfileKnown: existingProfileKnown,
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
    // Scenario 4B -- ROADMAP. Capture would be ON, but it is not yet live.
    // For now we behave as 4A (capture OFF) and flag that the higher-value
    // 4B path is pending, so we NEVER silently double-count.
    return {
      id: '4B-pending',
      label: 'Battery only, existing PV (profile known) — 4B pending',
      pvCapture: false,
      disclaimer: 'Cliente con PV existente y perfil conocido. La captura del '
                + 'excedente solar existente (escenario 4B) aún no está activa; '
                + 'esta proyección NO la modela y subestima el valor real de la '
                + 'batería. (Roadmap.)'
    };
  }

  // Scenario 4A: existing PV, profile unknown.
  return {
    id: '4A',
    label: 'Battery only, existing PV (profile unknown)',
    pvCapture: false,
    disclaimer: 'Cliente con PV existente. El valor de la batería es '
              + 'incremental a su solar actual; NO se modela la captura del '
              + 'excedente de su solar existente (requeriría sus datos de '
              + 'producción). El valor real puede ser mayor.'
  };
}
