// =============================================================================
// ARGIA ENGINE v2 -- File: templates/RfqRegistry.gs
// -----------------------------------------------------------------------------
// CHUNK 6 — Single source of truth for the 6 RFQ categories.
//
// WHAT THIS DEFINES
//   For each RFQ category (PANELES, INVERSORES, ESTRUCTURA, ELECTRICO,
//   MONITOREO, BESS), this file declares:
//     - sheet       : V2_SHEETS key (resolves to e.g. 'RFQ_PANELES_v2')
//     - title       : Display title for the banner
//     - code        : Short code used in RFQ number (PAN/INV/STR/ELEC/MON/BESS)
//     - bomRanges   : Array of { from, to } row spans in BOM_v2 to scrape
//     - certReqs    : Map of item# -> cert text; '*' means "applies to all"
//     - techNotes   : Free-text technical note shown above the item table
//     - defaultCcy  : Default currency token in the supplier-fills CCY column
//
// WHY A REGISTRY
//   - One file lists every category. Easy to audit, easy to test.
//   - Adding a future category (e.g. RFQ_OBRAS) is one entry, not a new writer.
//   - All BOM row ranges live in one place, so if BOM layout changes, the
//     impact is local. The reader (RfqBomReader.gs) doesn't know which rows
//     mean what — only the registry does.
//
// BESS SPLIT BETWEEN ELECTRICO AND BESS RFQs (Chunk 6 decision)
//   BOM §8 (rows 79-92) contains 12 line items + subtotal. They split:
//     - Row 80 (BESS-01, battery stack)         -> RFQ_BESS_v2
//     - Row 91 (BESS-12, commissioning)         -> RFQ_BESS_v2
//     - Rows 81-90 (DC/AC cables, conduit,
//                   OCPD, disconnect, GEC)      -> RFQ_ELECTRICO_v2
//
//   Rationale: battery + commissioning are vendor-specific (the battery OEM
//   typically commissions). Electrical balance-of-system items go to the
//   same supplier as the PV electrical BOS for freight efficiency.
//
// LEGACY DIFFERENCE
//   Legacy 15_WriteRFQ.js had 5 categories and excluded BESS entirely from
//   RFQs. v2 adds a 6th category (BESS) and routes BESS electrical lines
//   into ELECTRICO. This is intentional scope expansion per the v2 plan.
//
// CALLED BY
//   - writers_v2/WriteRfqV2.gs (runWriteAllRfqsV2 iterates RFQ_REGISTRY)
//   - tests_unit/templates/RfqRegistryTests.gs (registry invariants)
//
// =============================================================================


// BOM_v2 row ranges (1-indexed, inclusive). These match BOM_ROW in 00_Main.gs;
// duplicated here so the registry is self-describing without forcing readers
// to import BOM_ROW. The cross-check between these and BOM_ROW is tested in
// RfqRegistryTests.gs.
var _RFQ_BOM_RANGES = {
  // §1 PANELS rows 7-13 — items at 8-12, subtotal at 13. Items are rows 8..12.
  PANELES    : [{ from: 8,  to: 12 }],
  // §2 INVERTERS rows 14-20 — items at 15-19
  INVERSORES : [{ from: 15, to: 19 }],
  // §3 STRUCTURE rows 21-25 — items at 22-24
  ESTRUCTURA : [{ from: 22, to: 24 }],
  // §4 DC (rows 27-34) + §5 AC (37-62) + §8 BESS-electrical (81-90)
  // Note: BESS-04, BESS-05, BESS-07, BESS-09, BESS-10 only populate for
  // AC_COUPLED systems. Reader silently skips blank rows.
  ELECTRICO  : [
    { from: 27, to: 34 },   // DC items (rows 27-32 used, 33-34 reserved)
    { from: 37, to: 62 },   // AC items including per-inverter blocks
    { from: 81, to: 90 }    // BESS electrical BOS (excludes battery + commissioning)
  ],
  // §7 MONITORING rows 70-75
  MONITOREO  : [{ from: 70, to: 75 }],
  // BESS battery line (80) + commissioning (91). Two single-row ranges.
  BESS       : [
    { from: 80, to: 80 },   // BESS-01 — battery stack
    { from: 91, to: 91 }    // BESS-12 — commissioning
  ]
};


// -----------------------------------------------------------------------------
// RFQ_REGISTRY — the canonical list, iterated by runWriteAllRfqsV2.
// Order is the order in which sheets are generated (matters for the menu
// progress messages, not for correctness).
// -----------------------------------------------------------------------------
var RFQ_REGISTRY = (typeof RFQ_REGISTRY !== 'undefined' && RFQ_REGISTRY) ? RFQ_REGISTRY : [
  {
    key        : 'PANELES',
    sheetKey   : 'RFQ_PANELES',
    title      : 'Paneles Solares',
    code       : 'PAN',
    bomRanges  : _RFQ_BOM_RANGES.PANELES,
    defaultCcy : 'USD',
    certReqs   : {
      '*': 'IEC 61215 / IEC 61730 \u00b7 NOM-001-SEDE \u00b7 Datasheet req. ' +
           '\u00b7 Linear power warranty min 25yr \u00b7 Product warranty min 12yr ' +
           '\u00b7 Degradation \u22640.55%/yr'
    },
    techNotes  : 'Bifacial modules preferred. Confirm: temperature coefficient ' +
                 'Pmax, NOCT, dimensions, weight per module, pallet configuration ' +
                 'and qty per pallet.'
  },
  {
    key        : 'INVERSORES',
    sheetKey   : 'RFQ_INVERSORES',
    title      : 'Inversores',
    code       : 'INV',
    bomRanges  : _RFQ_BOM_RANGES.INVERSORES,
    defaultCcy : 'USD',
    certReqs   : {
      '*': 'IEC 62109-1/2 \u00b7 UL 1741 \u00b7 NOM-001-SEDE \u00b7 IP65 outdoor ' +
           '\u00b7 Datasheet + wiring diagram req.'
    },
    techNotes  : 'Confirm: communication protocol (Modbus/SunSpec), monitoring ' +
                 'platform included, spare parts availability in Mexico, local ' +
                 'service center.'
  },
  {
    key        : 'ESTRUCTURA',
    sheetKey   : 'RFQ_ESTRUCTURA',
    title      : 'Estructura de Montaje',
    code       : 'STR',
    bomRanges  : _RFQ_BOM_RANGES.ESTRUCTURA,
    defaultCcy : 'MXN',
    certReqs   : {
      '*': 'ASCE 7-16 wind load design \u00b7 Aluminum 6005-T5 or equiv ' +
           '\u00b7 Installation manual req. \u00b7 Structural calculation ' +
           'report preferred'
    },
    techNotes  : 'Specify: material grade, surface treatment (anodised/powder ' +
                 'coat), wind speed design basis (m/s), required fasteners ' +
                 'included or quoted separately.'
  },
  {
    key        : 'ELECTRICO',
    sheetKey   : 'RFQ_ELECTRICO',
    title      : 'Electrico BOS (DC + AC + BESS BOS)',
    code       : 'ELEC',
    bomRanges  : _RFQ_BOM_RANGES.ELECTRICO,
    defaultCcy : 'MXN',
    certReqs   : {
      '*': 'NOM-001-SEDE-2012 \u00b7 UL listed or equivalent ' +
           '\u00b7 Confirm voltage/temperature rating'
    },
    techNotes  : 'Quote all items together for best freight efficiency. ' +
                 'Cables: confirm Cu conductor, XLPE/THHW insulation, voltage ' +
                 'rating \u22651kV DC for PV wire, \u2265600V AC for THHW. ' +
                 'Breakers: I-LINE frame preferred, confirm interrupting ' +
                 'capacity \u226510kA. BESS electrical balance-of-system items ' +
                 'are included \u2014 see items in the BESS BOS rows.'
  },
  {
    key        : 'MONITOREO',
    sheetKey   : 'RFQ_MONITOREO',
    title      : 'Monitoreo y Servicios',
    code       : 'MON',
    bomRanges  : _RFQ_BOM_RANGES.MONITOREO,
    defaultCcy : 'MXN',
    certReqs   : {
      '*': 'Compatible with Huawei FusionSolar or AlsoEnergy ' +
           '\u00b7 Modbus TCP/SunSpec \u00b7 Remote access cloud platform req.'
    },
    techNotes  : 'Include: data logger, communication module, cloud subscription ' +
                 '(min 5yr), weather station if available. Specify data resolution ' +
                 '(min 15-min interval) and alarm/reporting capabilities.'
  },
  {
    key        : 'BESS',
    sheetKey   : 'RFQ_BESS',
    title      : 'Almacenamiento / Bater\u00edas (BESS)',
    code       : 'BESS',
    bomRanges  : _RFQ_BOM_RANGES.BESS,
    defaultCcy : 'MXN',
    certReqs   : {
      '*': 'NOM-001-SEDE Art. 706 \u00b7 UL 9540 / UL 9540A (system + thermal ' +
           'runaway) \u00b7 IEC 62619 (cell-level safety) \u00b7 IP54 minimum ' +
           '\u00b7 Datasheet + warranty terms + commissioning protocol req.'
    },
    techNotes  : 'Quote the battery hardware (stack count, kWh nominal, kW ' +
                 'nominal) and commissioning service. Confirm: cycle life at ' +
                 'rated DoD, round-trip efficiency, ambient operating range, ' +
                 'cooling type (passive/active), warranty terms (years AND ' +
                 'throughput MWh), spare parts availability in Mexico, local ' +
                 'service center, commissioning protocol document.'
  }
];


// -----------------------------------------------------------------------------
// getRfqByKey
// -----------------------------------------------------------------------------
//   Returns the registry entry for a given key (e.g. 'PANELES'), or null if
//   not found. Used by tests and by single-RFQ export functions.
// -----------------------------------------------------------------------------
function getRfqByKey(key) {
  if (!key) return null;
  for (var i = 0; i < RFQ_REGISTRY.length; i++) {
    if (RFQ_REGISTRY[i].key === key) return RFQ_REGISTRY[i];
  }
  return null;
}


// -----------------------------------------------------------------------------
// listRfqV2Sheets
// -----------------------------------------------------------------------------
//   Returns array of all v2 RFQ sheet names (resolved from V2_SHEETS).
//   Used by Reset Outputs (Chunk 12) and by tests.
// -----------------------------------------------------------------------------
function listRfqV2Sheets() {
  var out = [];
  for (var i = 0; i < RFQ_REGISTRY.length; i++) {
    var name = V2_SHEETS[RFQ_REGISTRY[i].sheetKey];
    if (name) out.push(name);
  }
  return out;
}
