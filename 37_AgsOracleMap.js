// =============================================================================
// 37_AgsOracleMap.js  —  AGS-802 oracle map (§5.2) + hard-block list (§5.3)
// -----------------------------------------------------------------------------
// AGS conformance track — Task A3a. Pure reference data, no workbook access.
//
// AGS-802 R1/R6: every Engine output must trace to an owning chapter + an oracle
// (a §7 line or a register ID), or it is not validated. AGS-802 §5.3 lists the
// non-negotiable hard-blocks. This file encodes both as data so the status gate,
// the project card, and the conformance report can cite them by reference rather
// than re-stating prose — turning the AGS-802 tables into a single source of
// truth that A3b (engine-evaluable blocks) and A4 (bankability) build on.
//
// Nothing here changes behaviour: it is reference data + pure accessors.
// =============================================================================

// ---- §5.2 Master output → owning-chapter → oracle map -----------------------
var AGS_ORACLE_MAP = [
  { output: 'Data Pack / site readiness',          chapter: 'AGS-101', oracle: '§7 + Data-Pack completeness' },
  { output: 'Regulatory class & pathway',          chapter: 'AGS-102', oracle: '§7; SAE-GE / permit route' },
  { output: 'Design basis (resource, Tmin/Tcell)', chapter: 'AGS-201', oracle: '§7; ENV/STC register' },
  { output: 'Energy & PR (P50, PR_STC)',           chapter: 'AGS-202', oracle: '§7; PB-02/04; sim <= 5%' },
  { output: 'Layout / fire access / shading',      chapter: 'AGS-203', oracle: '§7; PB-07; IFC pathways' },
  { output: 'Module / inverter / string / DC-AC',  chapter: 'AGS-204', oracle: '§7; DC-AC 1.10-1.40' },
  { output: 'Memoria de Calculo',                  chapter: 'AGS-205', oracle: '§7; NOM-001-SEDE clauses' },
  { output: 'Structural / wind / load',            chapter: 'AGS-206', oracle: '§7; DRO stamp gate' },
  { output: 'Bankability (P75/P90, sigma, guar.)', chapter: 'AGS-207', oracle: '§7; PB-01/03/06' },
  { output: 'BESS sizing',                         chapter: 'AGS-301', oracle: '§7; BS-06' },
  { output: 'BESS safety / fire',                  chapter: 'AGS-302', oracle: '§7; BS-02/03' },
  { output: 'BESS interconnection / controls',     chapter: 'AGS-303', oracle: '§7; BS-07' },
  { output: 'BOM / procurement / cost',            chapter: 'AGS-401', oracle: '§7; warranty >= PB-01' },
  { output: 'Quality / ITP',                       chapter: 'AGS-402', oracle: '§7; CT-IDs' },
  { output: 'Install quantities / construction',   chapter: 'AGS-501', oracle: '§7; IFC-gate' },
  { output: 'Commissioning results',               chapter: 'AGS-601', oracle: '§7; CT-01..05' },
  { output: 'Interconnection sign-off',            chapter: 'AGS-602', oracle: '§7; dictamen' },
  { output: 'O&M / performance',                   chapter: 'AGS-701', oracle: '§7; PB-01/03/04' }
];

/** The §5.2 oracle map (copy — callers must not mutate the source). */
function agsOracleMap() { return AGS_ORACLE_MAP.slice(); }

/** Lookup the oracle row whose output contains `needle` (case-insensitive). */
function agsOracleFor(needle) {
  var q = String(needle || '').toLowerCase();
  for (var i = 0; i < AGS_ORACLE_MAP.length; i++) {
    if (AGS_ORACLE_MAP[i].output.toLowerCase().indexOf(q) !== -1) return AGS_ORACLE_MAP[i];
  }
  return null;
}

// ---- §5.3 Non-negotiable hard-block list ------------------------------------
// category   : 'life-safety' | 'legal' | 'bankability' | 'data' | 'quality' | 'edition-lock'
// humanGate  : true  -> a downstream human/field sign-off the Engine cannot
//                       evaluate at proposal time (surfaced NOT_EVALUATED, A3a)
//              false -> the Engine has the data to evaluate it (A3b block)
// timeGated  : carries an effective-date condition (UL 9540A Ed.6)
// dependsOn  : conformance task that must land before this can be wired live
var AGS_HARD_BLOCK_LIST = [
  { ref: 'AGS-101', condition: 'Proposal/design without a verified Data Pack',                       category: 'data',         humanGate: false },
  { ref: 'AGS-203', condition: 'Modules in exclusion zones / missing fire pathways',                 category: 'life-safety',  humanGate: false },
  { ref: 'AGS-206', condition: 'No DRO-stamped capacity check / unverified loads',                   category: 'life-safety',  humanGate: true,  stage: 'pre-construction' },
  { ref: 'AGS-207', condition: 'sigma > 8% labelled bankable; P50 used as the guarantee',            category: 'bankability',  humanGate: false, dependsOn: 'A4' },
  { ref: 'AGS-302', condition: 'Any BESS safety / fire failure',                                     category: 'life-safety',  humanGate: false },
  { ref: 'AGS-303', condition: 'Back-feed / missing anti-islanding / export without grid-forming',   category: 'legal',        humanGate: false },
  { ref: 'AGS-401', condition: 'Module warranty below PB-01; PO raised before the gate',             category: 'bankability',  humanGate: false },
  { ref: 'AGS-402', condition: 'Skipped H-point / uninspected material',                             category: 'quality',      humanGate: true,  stage: 'construction' },
  { ref: 'AGS-501', condition: 'Height work without protection; live work; energize before hold',    category: 'life-safety',  humanGate: true,  stage: 'construction' },
  { ref: 'AGS-601', condition: 'Energize before Cat-1 complete; untested BESS safety',               category: 'life-safety',  humanGate: true,  stage: 'commissioning' },
  { ref: 'AGS-602', condition: 'Energize without UVIE dictamen / non-independent UVIE',              category: 'legal',        humanGate: true,  stage: 'interconnection' },
  { ref: 'AGS-302/503', condition: 'BESS PO\u2019d after 2026-06 without an explicit UL 9540A Ed.6 report', category: 'edition-lock', humanGate: false, timeGated: true }
];

/** Full §5.3 hard-block list (copy). */
function agsHardBlockList() { return AGS_HARD_BLOCK_LIST.slice(); }

/** Human/field gates the Engine cannot self-certify (A3a surfaces these). */
function agsHumanGates() {
  return AGS_HARD_BLOCK_LIST.filter(function (b) { return b.humanGate === true; });
}

/** Hard-blocks the Engine has data to evaluate at proposal time (A3b wires these). */
function agsEngineHardBlocks() {
  return AGS_HARD_BLOCK_LIST.filter(function (b) { return b.humanGate === false; });
}

// Node export (no-op in Apps Script).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AGS_ORACLE_MAP: AGS_ORACLE_MAP, agsOracleMap: agsOracleMap, agsOracleFor: agsOracleFor,
    AGS_HARD_BLOCK_LIST: AGS_HARD_BLOCK_LIST, agsHardBlockList: agsHardBlockList,
    agsHumanGates: agsHumanGates, agsEngineHardBlocks: agsEngineHardBlocks
  };
}
