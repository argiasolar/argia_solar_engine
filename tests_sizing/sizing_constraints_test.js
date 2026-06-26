/* =============================================================================
 * ARGIA — Sizing-constraint regression tests
 * -----------------------------------------------------------------------------
 * Turns the pre-launch review notes into executable, fail-closed checks.
 *
 * It loads the REAL engine sizing functions (03_ElecTables, 05_CalcAC,
 * 18_CalcBessCircuit) into a VM and drives them with the actual project cases,
 * then judges each result against a NEC-310.16-correct oracle.
 *
 * Two kinds of test:
 *   CONTROL      — the engine is already correct here; this MUST pass. A control
 *                  failing means a real regression (or a broken oracle).
 *   DEFECT(xfail)— a constraint the engine does NOT yet enforce. Expected to
 *                  reproduce the defect today. When the engine is fixed the
 *                  "correct" assertion starts passing and the runner prints
 *                  "DEFECT FIXED — remove xfail". Defects do NOT fail the build;
 *                  only a broken CONTROL (exit 1) does.
 *
 * Run:  node tests_sizing/sizing_constraints_test.js
 *
 * The oracle pairs the engine's OWN 90 C ampacity column (its derate basis)
 * with the standard NEC 310.16 copper 75 C column (the physical termination
 * limit, which the engine's data model omits entirely).
 * ===========================================================================*/

'use strict';
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// --- load the real engine functions into one shared sandbox -----------------
const sandbox = { console, SH: { ELEC_TABLES: '15M_ELEC_TABLES' } };
vm.createContext(sandbox);
for (const f of ['03_ElecTables.js', '05_CalcAC.js', '18_CalcBessCircuit.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const {
  readElecTables, selectConductor, nextBreaker, getEgcSize, getGroupingFactor,
  requiredAmpacity, calcBessCircuit, BESS_COUPLING, ocpdProtectsConductor,
} = sandbox;

// --- build the real `tbls` via the real parser over a committed fixture -----
const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'elec_tables_fixture.json'), 'utf8'));
const grid = fixture['15M_ELEC_TABLES'];
const ssStub = {
  getSheetByName() {
    return {
      getLastRow() { return grid.length; },
      getRange(row, col, numRows, numCols) {
        return {
          getValues() {
            const out = [];
            for (let r = row - 1; r < row - 1 + numRows; r++) {
              const src = grid[r] || [];
              const line = [];
              for (let c = col - 1; c < col - 1 + numCols; c++) line.push(src[c] === undefined ? '' : src[c]);
              out.push(line);
            }
            return out;
          },
        };
      },
    };
  },
};
const tbls = readElecTables(ssStub);

// --- oracle: standard NEC 310.16 copper 75 C ampacities (the terminal limit) -
// Keyed to the engine's size labels after normalisation. The engine carries
// ONLY the 90 C column, so this is the reference the engine cannot see.
const NEC_75C = {
  '14': 20, '12': 25, '10': 35, '8': 50, '6': 65, '4': 85, '3': 100, '2': 115,
  '1': 130, '1/0': 150, '2/0': 175, '3/0': 200, '4/0': 230,
  '250': 255, '300': 285, '350': 310, '400': 335, '500': 380, '600': 420,
  '700': 460, '750': 475, '800': 490, '900': 520, '1000': 545,
};
const norm = (s) => (String(s).indexOf('/') >= 0 ? String(s).trim() : String(parseFloat(s)));
const amp75 = (size) => NEC_75C[norm(size)];               // may be undefined for tiny gauges
const condBySize = (size) => tbls.conductors.find((c) => String(c.size) === String(size));

/**
 * NEC-correct conductor pick for a continuous load.
 *   terminal branch : amp75(size)            >= contFactor * load     (110.14(C))
 *   derate branch   : amp90(size) * ft * fag >= load                  (310.15(B))
 * Smallest conductor satisfying BOTH governs.
 */
function correctConductor(loadA, ft, fag, contFactor) {
  const termReq = contFactor * loadA;
  const sorted  = [...tbls.conductors].sort((a, b) => a.ampacity - b.ampacity);
  for (const c of sorted) {
    const t75 = amp75(c.size);
    if (t75 === undefined) continue;                       // ignore sub-14 AWG
    const okTerm   = t75 >= termReq;
    const okDerate = c.ampacity * ft * fag >= loadA;
    if (okTerm && okDerate) return c.size;
  }
  return null;                                             // nothing in table suffices
}

/** NEC 240.4: OCPD must not exceed conductor ampacity, except 240.4(B) lets you
 *  round UP to the next standard breaker when ampacity <= 800 A. */
function ocpdProtects(ocpdA, conductorAmpacityA) {
  if (ocpdA <= conductorAmpacityA) return true;
  if (conductorAmpacityA > 800) return false;             // no next-size-up above 800 A
  return nextBreaker(conductorAmpacityA, tbls) === ocpdA;  // exactly the next standard size
}

// ----------------------------------------------------------------------------
// tiny runner
// ----------------------------------------------------------------------------
const results = [];
let controlFailed = false;
function check(kind, name, correctness, detail) {
  // kind: 'CONTROL' | 'DEFECT'. correctness = does the engine meet the correct rule?
  let status;
  if (kind === 'CONTROL') {
    status = correctness ? 'PASS' : 'FAIL (regression!)';
    if (!correctness) controlFailed = true;
  } else {
    status = correctness ? 'DEFECT FIXED — remove xfail' : 'xfail (defect reproduced)';
  }
  results.push({ kind, name, status, detail });
}

// ============================================================================
// T1  CONTROL (was DEFECT, fixed) — 75 C terminal cap (NEC 110.14(C)). On a
// lightly-derated 125 A continuous circuit the terminal branch governs
// (1.25*125 = 156.25 A). 1/0 clears the 90 C column (170 A) but not the 75 C
// lug (150 A), so selection must bump to 2/0. The engine now takes a terminal
// basis and enforces the 75 C floor.
// ============================================================================
{
  const load = 125, ft = 1, fag = 1, cf = 1.25;
  const engReq  = requiredAmpacity(load, ft, fag, cf);
  const termReq = cf * load;                                  // 156.25 A terminal basis
  const engCond = selectConductor(engReq, tbls, termReq).size;  // T1: pass terminal basis
  const correct = correctConductor(load, ft, fag, cf);         // NEC oracle -> 2/0
  const ok = engCond === correct && amp75(engCond) >= termReq;
  check('CONTROL', 'T1 75C terminal cap enforced (lightly derated 125A)', ok,
    `engine=${engCond} (75C=${amp75(engCond)}A) for terminal req ${termReq}A; NEC-correct=${correct}.`);
}

// ============================================================================
// T2  CONTROL — per-inverter AC (180.42 A, Ft=0.91). Next-size jump to 4/0
// happens to also clear 75 C, so engine is correct here.
// ============================================================================
{
  const load = 180.42, ft = 0.91, fag = 1, cf = 1.25;
  const engCond = selectConductor(requiredAmpacity(load, ft, fag, cf), tbls).size;
  const correct = correctConductor(load, ft, fag, cf);
  check('CONTROL', 'T2 per-inverter AC 180.42A (engine should be correct)',
    engCond === correct,
    `engine=${engCond}, correct=${correct} (75C=${amp75(engCond)}A >= ${cf*load}A)`);
}

// ============================================================================
// T3  CONTROL — main feeder per run (280.7 A, Ft=0.91, Fag=0.70). Heavy derate
// forces 600 kcmil, which also clears 75 C. (Corrects the review's headline
// example: this case does NOT violate the terminal cap.)
// ============================================================================
{
  const load = 280.7, ft = 0.91, fag = 0.70, cf = 1.25;
  const engCond = selectConductor(requiredAmpacity(load, ft, fag, cf), tbls).size;
  const correct = correctConductor(load, ft, fag, cf);
  check('CONTROL', 'T3 main feeder 280.7A/run (no terminal violation expected)',
    engCond === correct,
    `engine=${engCond}, correct=${correct}; terminal req=${(cf*load).toFixed(1)}A ` +
    `vs 75C(${engCond})=${amp75(engCond)}A`);
}

// ============================================================================
// T4  CONTROL (was DEFECT, fixed) — the engine ENFORCES NEC 240.4: it exposes a
// per-run verdict on whether the OCPD protects its conductor, and warns when it
// doesn't.
//
// NOTE: this does NOT assert the BESS circuit is *safe* — the 1406 A single-run
// lump genuinely violates 240.4, and making it safe is the per-stack remodel
// (T5). What T4 pins is that the engine now DETECTS the violation instead of
// silently shipping it. Green = engine's verdict matches the NEC oracle AND it
// surfaced a warning.
// ============================================================================
{
  const out = calcBessCircuit({
    coupling: BESS_COUPLING.DC_COUPLED,
    bess: { powerKw: 972, rtePct: 0.90 },
    dcBusVoltageV: 864,
    tbls,
    nom: { bess: { dcCurrentFactor: 1.25, rteFloor: 0.80 } },
  });
  const run = out.runs[0];
  const oracle = ocpdProtects(run.ocpdA, run.conductorAmpacity);   // test's own NEC check
  const engineHasVerdict = typeof run.ocpdProtectsConductor === 'boolean';
  const warned = out.warnings.some((w) => /240\.4/.test(w));
  const detects = engineHasVerdict && run.ocpdProtectsConductor === oracle && (oracle || warned);
  check('CONTROL', 'T4 engine enforces OCPD<=conductor (NEC 240.4)', detects,
    `engine ocpdProtectsConductor=${run.ocpdProtectsConductor} (NEC oracle=${oracle}); ` +
    `OCPD=${run.ocpdA}A on ${run.conductorSize} (${run.conductorAmpacity}A); ` +
    `warned=${warned}.`);
  // cross-check the standalone helper agrees with the test oracle
  if (ocpdProtectsConductor(run.ocpdA, run.conductorAmpacity, tbls) !== oracle) controlFailed = true;
}

// ============================================================================
// T5  CONTROL (was DEFECT, fixed) — a multi-stack BESS is sized PER STACK, not
// as one lumped pack-current run. For CULLIGAN (9 × 108 kW @ 864 V): each stack
// home-run carries ~156 A, maps to a real conductor, the OCPD coordinates with
// it (NEC 240.4), parallels = stackQty (9), and no 240.4 warning fires.
// ============================================================================
{
  const stackQty = 9;
  const out = calcBessCircuit({
    coupling: BESS_COUPLING.DC_COUPLED,
    bess: { powerKw: 972, rtePct: 0.90, stackQty },   // CULLIGAN: 9 × 108 kW stacks
    dcBusVoltageV: 864,
    tbls,
    nom: { bess: { dcCurrentFactor: 1.25, rteFloor: 0.80 } },
  });
  const run = out.runs[0];
  const maxAmp = Math.max(...tbls.conductors.map((c) => c.ampacity));
  const expectedPerStackDesign = (972000 / stackQty) / 864 * 1.25;   // ~156 A
  const sizedPerStack   = Math.abs(run.designCurrentA - expectedPerStackDesign) < 1;
  const realConductor   = run.conductorAmpacity >= run.designCurrentA &&
                          run.designCurrentA <= maxAmp;
  const coordinated     = run.ocpdProtectsConductor === true;
  const countedAsStacks = run.parallels === stackQty;
  const no240Warning    = !out.warnings.some((w) => /240\.4/.test(w));
  const perStackOk = sizedPerStack && realConductor && coordinated &&
                     countedAsStacks && no240Warning;
  check('CONTROL', 'T5 BESS sized per-stack (9 × home-runs, 240.4 OK)', perStackOk,
    `per-run design ${run.designCurrentA.toFixed(1)}A on ${run.conductorSize} ` +
    `(${run.conductorAmpacity}A), OCPD=${run.ocpdA}A, parallels=${run.parallels}, ` +
    `240.4 ok=${run.ocpdProtectsConductor}, warnings=${out.warnings.length}.`);
}

// ============================================================================
// T6  CONTROL — OCPD ok via 240.4(B) next-size-up (per-inverter 250A / 4/0).
// ============================================================================
{
  const iNom = 180.42, cf = 1.25, ft = 0.91, fag = 1;
  const ocpd = nextBreaker(iNom * cf, tbls);                    // 225.5 -> 250
  const cond = selectConductor(requiredAmpacity(iNom, ft, fag, cf), tbls);  // 4/0
  const deratedAmp = cond.ampacity * ft * fag;                  // 260*0.91 = 236.6
  check('CONTROL', 'T6 OCPD next-size-up allowance (per-inverter 250A/4/0)',
    ocpdProtects(ocpd, deratedAmp),
    `OCPD=${ocpd}A vs derated ampacity ${deratedAmp.toFixed(1)}A on ${cond.size} — 240.4(B) ok`);
}

// ============================================================================
// T7  DEFECT(note) — DC grouping count capped at 6 (04_CalcDC.js:161). The
// table DOES define a factor beyond 6, so the cap silently under-derates.
// ============================================================================
{
  const fag6 = getGroupingFactor(6, tbls);
  const fag9 = getGroupingFactor(9, tbls);
  // correct = table has no stricter factor past 6 (i.e., cap is harmless)
  const capHarmless = fag9 >= fag6;
  check('DEFECT', 'T7 DC grouping cap at 6 conductors', capHarmless,
    `Fag(6)=${fag6}, Fag(9)=${fag9}; engine caps the count at 6 so bundles >6 use ` +
    `${fag6} instead of ${fag9} (non-conservative when Fag(9) < Fag(6)).`);
}

// ============================================================================
// T8  CONTROL (was DEFECT, fixed) — readElecTables must read the full table.
// Previously it read a hardcoded 29-row window (getRange(7,1,29,25)), dropping
// the 15 A & 1600 A breakers and the 75 kVA transformer. Now reads row 6..last.
// ============================================================================
{
  const rawBreakers = grid
    .map((r) => parseFloat(r[10]))
    .filter((v) => !isNaN(v) && v > 0);
  const rawMax = Math.max(...rawBreakers);
  const rawMin = Math.min(...rawBreakers);
  const parsedMax = Math.max(...tbls.breakers);
  const parsedMin = Math.min(...tbls.breakers);
  const intact = parsedMax === rawMax && parsedMin === rawMin;
  check('CONTROL', 'T8 elec-table parser reads full table (no row-window clip)', intact,
    `breakers in sheet [${rawMin}..${rawMax}] but parsed [${parsedMin}..${parsedMax}] — ` +
    `${intact ? 'complete' : 'rows outside the 29-row window dropped'}.`);
}

// ----------------------------------------------------------------------------
// report
// ----------------------------------------------------------------------------
const w = Math.max(...results.map((r) => r.name.length));
console.log('\nARGIA sizing-constraint regression tests\n' + '='.repeat(72));
for (const r of results) {
  console.log(`[${r.kind.padEnd(7)}] ${r.name.padEnd(w)}  ${r.status}`);
  console.log(`            ${r.detail}`);
}
const defects = results.filter((r) => r.kind === 'DEFECT');
const reproduced = defects.filter((r) => r.status.startsWith('xfail')).length;
const fixed = defects.length - reproduced;
console.log('='.repeat(72));
console.log(`controls: ${results.filter(r=>r.kind==='CONTROL').length} | ` +
            `defects reproduced (xfail): ${reproduced} | defects now fixed: ${fixed}`);
if (controlFailed) {
  console.log('RESULT: CONTROL FAILED — real regression. Investigate before shipping.');
  process.exit(1);
}
console.log(fixed > 0
  ? `RESULT: ${fixed} defect(s) now pass — update the engine notes and un-xfail them.`
  : 'RESULT: all controls green; known defects still open (expected pre-fix).');
