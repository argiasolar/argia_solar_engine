// =============================================================================
// ARGIA ENGINE v7 -- File: 02c_InputMap.gs
// Single source of truth for every input field the engine consumes,
// every input field preserved for downstream use (Project Card, RFQ,
// future CFE sim / financing / SLIDE_DATA), and every coordinate in
// the new 4-tab workbook.
//
// HOW TO READ A MAP ENTRY
//   {
//     sheet, row, col   -- where the field lives in the NEW workbook
//     label             -- shown in the setup function next to the input
//     type              -- drives coercion + validation: 'text' | 'number' |
//                          'percent' | 'date' | 'dropdown' | 'flag'
//     default           -- code-level fallback when the cell is blank
//     unit              -- display unit (e.g. '°C', 'm', 'MXN/MH')
//     required          -- true if validator should block on empty
//     section           -- grouping label shown on the setup function
//     consumedBy        -- who reads it today. May be empty (e.g. awaiting
//                          CFE sim or offer generator).
//     dropdown          -- array of allowed values for type='dropdown'
//     legacyAddr        -- 'INPUT_GENERAL!C5' or 'INPUT_DESIGN!M7' -- USED
//                          BY THE ONE-OFF MIGRATION SCRIPT. Delete after
//                          migration is confirmed stable.
//     legacyCol         -- 'M' (override, engine reads) | 'N' (default,
//                          display-only) | 'C' | null. USED BY MIGRATION.
//     notes             -- free text, never user-facing
//   }
//
// MIGRATION SEMANTICS (agreed 2026-04-23)
//   Legacy col M = user override (engine consumes)
//   Legacy col N = suggested default (display-only)
//   Migration copies M if populated, otherwise N, otherwise leaves blank.
//
// TAB NAMING CONVENTION
//   INPUT_PROJECT, INPUT_DESIGN, INPUT_INSTALL, INPUT_CFE
//   INPUT_DESIGN and INPUT_INSTALL split out from the legacy single
//   INPUT_DESIGN. INPUT_PROJECT supersedes INPUT_GENERAL. INPUT_CFE is
//   a fresh shell.
//
// WHAT'S NOT HERE
//   INPUT_CFE fields (out of Track A scope per agreement).
//   Helioscope monthly grid (C6:H17) and imported equipment rows
//   (D22:F26, D27:G31) -- not user inputs, written by import script;
//   their physical positions are frozen and will be styled, not moved.
// =============================================================================


// ---------------------------------------------------------------------------
// Tab names: see the SH constant in 00_Main.gs. INPUT_PROJECT / INPUT_INSTALL
// / INPUT_CFE now live in that single declaration. They used to be assigned
// here as `SH.x = ...` at file-load time, which threw `ReferenceError: SH is
// not defined` whenever Apps Script loaded 02c before 00_Main (file creation
// can reshuffle load order). Folding them into 00_Main's `var SH = {...}`
// removes the cross-file load-order dependency entirely.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// INPUT_PROJECT -- client, team, dates, commercial terms
// Mostly a col-C migration from the legacy INPUT_GENERAL.
// 5 sections. Col D is the canonical value column in the new layout.
// ---------------------------------------------------------------------------
var _MAP_PROJECT = {

  // 01 IDENTIFICACIÓN -------------------------------------------------------
  projectName: {
    sheet: SH.INPUT_PROJECT, row: 8, col: 4,
    label: 'Nombre del proyecto', type: 'text',
    default: '', required: true,
    section: '01 IDENTIFICACIÓN',
    consumedBy: ['engine', 'mdc', 'bom', 'projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C5', legacyCol: 'C',
    notes: 'Appears on every deliverable header.'
  },
  clientName: {
    sheet: SH.INPUT_PROJECT, row: 9, col: 4,
    label: 'Cliente — razón social', type: 'text',
    default: '', required: true,
    section: '01 IDENTIFICACIÓN',
    consumedBy: ['engine', 'mdc', 'projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C6', legacyCol: 'C'
  },
  contact: {
    sheet: SH.INPUT_PROJECT, row: 10, col: 4,
    label: 'Contacto principal', type: 'text',
    default: '', required: false,
    section: '01 IDENTIFICACIÓN',
    consumedBy: ['rfq', 'projectCard'],
    legacyAddr: 'INPUT_GENERAL!C7', legacyCol: 'C'
  },
  street: {
    sheet: SH.INPUT_PROJECT, row: 11, col: 4,
    label: 'Dirección — calle y número', type: 'text',
    default: '', required: false,
    section: '01 IDENTIFICACIÓN',
    consumedBy: ['rfq', 'projectCard'],
    legacyAddr: 'INPUT_GENERAL!C8', legacyCol: 'C'
  },
  city: {
    sheet: SH.INPUT_PROJECT, row: 12, col: 4,
    label: 'Ciudad', type: 'text',
    default: '', required: true,
    section: '01 IDENTIFICACIÓN',
    consumedBy: ['engine', 'mdc', 'projectCard'],
    legacyAddr: 'INPUT_GENERAL!C9', legacyCol: 'C'
  },
  state: {
    sheet: SH.INPUT_PROJECT, row: 13, col: 4,
    label: 'Estado', type: 'dropdown',
    default: '', required: false,
    dropdownRange: '22M_METEO!B2:B33',
    section: '01 IDENTIFICACIÓN',
    consumedBy: ['projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C10', legacyCol: 'C',
    notes: 'Mexican state name, sourced from 22M_METEO!B2:B33 (MASTER_DB-backed).'
  },
  clientRequirements: {
    sheet: SH.INPUT_PROJECT, row: 14, col: 4,
    label: 'Requerimientos del cliente', type: 'text',
    default: '', required: false,
    section: '01 IDENTIFICACIÓN',
    consumedBy: ['rfq', 'slides'],
    legacyAddr: 'INPUT_GENERAL!C15', legacyCol: 'C',
    notes: 'Free-text. e.g. "LOW ROI", "SHORT PAYBACK".'
  },
  projectNumber: {
    sheet: SH.INPUT_PROJECT, row: 15, col: 4,
    label: 'Número de proyecto', type: 'text',
    default: '', required: false,
    section: '01 IDENTIFICACIÓN',
    consumedBy: ['projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C21', legacyCol: 'C',
    notes: 'e.g. ARG-2026-001'
  },

  // 02 EQUIPO ARGIA ---------------------------------------------------------
  bizManager: {
    sheet: SH.INPUT_PROJECT, row: 19, col: 4,
    label: 'Business manager', type: 'dropdown',
    default: '', required: false,
    dropdownRange: '00_MASTER_LINK!C2:C10',
    section: '02 EQUIPO ARGIA',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C12', legacyCol: 'C',
    notes: 'Pool sourced from 00_MASTER_LINK!C2:C10.'
  },
  designer: {
    sheet: SH.INPUT_PROJECT, row: 20, col: 4,
    label: 'Designer', type: 'dropdown',
    default: '', required: false,
    dropdownRange: '00_MASTER_LINK!D2:D10',
    section: '02 EQUIPO ARGIA',
    consumedBy: ['mdc', 'projectCard'],
    legacyAddr: 'INPUT_GENERAL!C13', legacyCol: 'C',
    notes: 'Pool sourced from 00_MASTER_LINK!D2:D10.'
  },
  projectManager: {
    sheet: SH.INPUT_PROJECT, row: 21, col: 4,
    label: 'Project manager', type: 'dropdown',
    default: '', required: false,
    dropdownRange: '00_MASTER_LINK!D2:D10',
    section: '02 EQUIPO ARGIA',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C22', legacyCol: 'C',
    notes: 'Reuses designer pool (00_MASTER_LINK!D2:D10). Split later if needed.'
  },

  // 03 FECHAS Y CONTRATO ----------------------------------------------------
  dateOffer: {
    sheet: SH.INPUT_PROJECT, row: 25, col: 4,
    label: 'Fecha de oferta', type: 'date',
    default: '', required: false,
    section: '03 FECHAS Y CONTRATO',
    consumedBy: ['mdc', 'projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C11', legacyCol: 'C'
  },
  dateSign: {
    sheet: SH.INPUT_PROJECT, row: 26, col: 4,
    label: 'Firma de contrato', type: 'date',
    default: '', required: false,
    section: '03 FECHAS Y CONTRATO',
    consumedBy: ['projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C29', legacyCol: 'C'
  },
  dateFinishContract: {
    sheet: SH.INPUT_PROJECT, row: 27, col: 4,
    label: 'Fin de contrato', type: 'date',
    default: '', required: false,
    section: '03 FECHAS Y CONTRATO',
    consumedBy: ['projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C30', legacyCol: 'C'
  },
  dateDelivery: {
    sheet: SH.INPUT_PROJECT, row: 28, col: 4,
    label: 'Entrega de equipo', type: 'date',
    default: '', required: false,
    section: '03 FECHAS Y CONTRATO',
    consumedBy: ['projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C31', legacyCol: 'C'
  },
  dateInstallStart: {
    sheet: SH.INPUT_PROJECT, row: 29, col: 4,
    label: 'Inicio de instalación', type: 'date',
    default: '', required: false,
    section: '03 FECHAS Y CONTRATO',
    consumedBy: ['projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C32', legacyCol: 'C'
  },
  dateInstallFinish: {
    sheet: SH.INPUT_PROJECT, row: 30, col: 4,
    label: 'Fin de instalación', type: 'date',
    default: '', required: false,
    section: '03 FECHAS Y CONTRATO',
    consumedBy: ['projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C33', legacyCol: 'C'
  },

  // 04 COMERCIAL ------------------------------------------------------------
  businessType: {
    sheet: SH.INPUT_PROJECT, row: 34, col: 4,
    label: 'Tipo de negocio', type: 'dropdown',
    default: 'PPA_ROOF', required: true,
    dropdown: ['PPA_ROOF', 'PPA_GROUND', 'CAPEX_ROOF', 'CAPEX_GROUND', 'CARPORT'],
    section: '04 COMERCIAL',
    consumedBy: ['engine', 'projectCard', 'rfq', 'slides'],
    legacyAddr: 'INPUT_GENERAL!C14', legacyCol: 'C'
  },
  marginPct: {
    sheet: SH.INPUT_PROJECT, row: 35, col: 4,
    label: 'Margen', type: 'percent',
    default: 0.15, required: true,
    unit: '%',
    section: '04 COMERCIAL',
    consumedBy: ['projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C26', legacyCol: 'C'
  },
  ppaDiscountPct: {
    sheet: SH.INPUT_PROJECT, row: 36, col: 4,
    label: 'Descuento PPA', type: 'percent',
    default: 0.15, required: false,
    unit: '%',
    section: '04 COMERCIAL',
    consumedBy: ['rfq'],
    legacyAddr: 'INPUT_GENERAL!C17', legacyCol: 'C'
  },
  ppaIndexationPct: {
    sheet: SH.INPUT_PROJECT, row: 37, col: 4,
    label: 'Indexación PPA', type: 'percent',
    default: 0.05, required: false,
    unit: '%/año',
    section: '04 COMERCIAL',
    consumedBy: ['rfq'],
    legacyAddr: 'INPUT_GENERAL!C18', legacyCol: 'C'
  },
  paymentTerms: {
    sheet: SH.INPUT_PROJECT, row: 38, col: 4,
    label: 'Términos de pago', type: 'text',
    default: 'DP', required: false,
    section: '04 COMERCIAL',
    consumedBy: ['projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C27', legacyCol: 'C',
    notes: 'Free-text: "DP", "N/A", "50/30/20", etc.'
  },
  paymentDays: {
    sheet: SH.INPUT_PROJECT, row: 39, col: 4,
    label: 'Días de pago', type: 'number',
    default: 14, required: false,
    unit: 'días',
    section: '04 COMERCIAL',
    consumedBy: ['projectCard', 'rfq'],
    legacyAddr: 'INPUT_GENERAL!C28', legacyCol: 'C'
  },
  sellingPriceUsdPerWp: {
    sheet: SH.INPUT_PROJECT, row: 40, col: 4,
    label: 'Precio venta USD/Wp', type: 'number',
    default: '', required: false,
    unit: 'USD/Wp',
    section: '04 COMERCIAL',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C24', legacyCol: 'C',
    notes: 'Market-standard validation, not engine input.'
  },
  sellingPriceUsdPerKwp: {
    sheet: SH.INPUT_PROJECT, row: 41, col: 4,
    label: 'Precio venta USD/kWp', type: 'number',
    default: '', required: false,
    unit: 'USD/kWp',
    section: '04 COMERCIAL',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C25', legacyCol: 'C',
    notes: 'Market-standard validation. Derived from USD/Wp if blank.'
  },
  systemCoveragePct: {
    sheet: SH.INPUT_PROJECT, row: 42, col: 4,
    label: 'Cobertura del consumo', type: 'percent',
    default: '', required: false,
    unit: '%',
    section: '04 COMERCIAL',
    consumedBy: ['projectCard', 'slides'],
    legacyAddr: 'INPUT_GENERAL!C23', legacyCol: 'C'
  },

  // 05 APROBACIONES ---------------------------------------------------------
  // TECH-DEBT: receivedBy and approvedBy are hardcoded lists for now.
  // When the 00_MASTER_LINK people structure stabilizes with role columns,
  // migrate both to dropdownRange pointing at the appropriate MASTER_LINK
  // range. Until then, update these arrays when the authorized people change.
  receivedBy: {
    sheet: SH.INPUT_PROJECT, row: 46, col: 4,
    label: 'Recibido por', type: 'dropdown',
    default: '', required: false,
    dropdown: ['Eduardo Fraga', 'Arturo Gonzalez'],
    section: '05 APROBACIONES',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C34', legacyCol: 'C'
  },
  approvedBy: {
    sheet: SH.INPUT_PROJECT, row: 47, col: 4,
    label: 'Aprobado por', type: 'dropdown',
    default: '', required: false,
    dropdown: ['Vit Kovarik'],
    section: '05 APROBACIONES',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C35', legacyCol: 'C'
  },

  // 06 RANGOS DE VALIDACIÓN (USD/kWp) ---------------------------------------
  // Preserved as pairs. No engine consumer, but Project Card cost validation
  // reads these. 9 rows * 2 cols (min, max) = 18 entries, but we flatten
  // them as named fields so setup and IO treat them uniformly.
  costRangePanelsMin: {
    sheet: SH.INPUT_PROJECT, row: 52, col: 4,
    label: 'Paneles — min', type: 'number', default: 20, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C39', legacyCol: 'C'
  },
  costRangePanelsMax: {
    sheet: SH.INPUT_PROJECT, row: 52, col: 5,
    label: 'Paneles — max', type: 'number', default: 200, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!D39', legacyCol: 'C'
  },
  costRangeInvertersMin: {
    sheet: SH.INPUT_PROJECT, row: 53, col: 4,
    label: 'Inversores — min', type: 'number', default: 5, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C40', legacyCol: 'C'
  },
  costRangeInvertersMax: {
    sheet: SH.INPUT_PROJECT, row: 53, col: 5,
    label: 'Inversores — max', type: 'number', default: 80, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!D40', legacyCol: 'C'
  },
  costRangeStructureMin: {
    sheet: SH.INPUT_PROJECT, row: 54, col: 4,
    label: 'Estructura — min', type: 'number', default: 5, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C41', legacyCol: 'C'
  },
  costRangeStructureMax: {
    sheet: SH.INPUT_PROJECT, row: 54, col: 5,
    label: 'Estructura — max', type: 'number', default: 80, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!D41', legacyCol: 'C'
  },
  costRangeElecDcMin: {
    sheet: SH.INPUT_PROJECT, row: 55, col: 4,
    label: 'Eléctrico DC — min', type: 'number', default: 0, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C42', legacyCol: 'C'
  },
  costRangeElecDcMax: {
    sheet: SH.INPUT_PROJECT, row: 55, col: 5,
    label: 'Eléctrico DC — max', type: 'number', default: 200, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!D42', legacyCol: 'C'
  },
  costRangeElecAcMin: {
    sheet: SH.INPUT_PROJECT, row: 56, col: 4,
    label: 'Eléctrico AC — min', type: 'number', default: 0, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C43', legacyCol: 'C'
  },
  costRangeElecAcMax: {
    sheet: SH.INPUT_PROJECT, row: 56, col: 5,
    label: 'Eléctrico AC — max', type: 'number', default: 200, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!D43', legacyCol: 'C'
  },
  costRangeMonitoringMin: {
    sheet: SH.INPUT_PROJECT, row: 57, col: 4,
    label: 'Monitoreo — min', type: 'number', default: 0, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C44', legacyCol: 'C'
  },
  costRangeMonitoringMax: {
    sheet: SH.INPUT_PROJECT, row: 57, col: 5,
    label: 'Monitoreo — max', type: 'number', default: 30, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!D44', legacyCol: 'C'
  },
  costRangePermitsMin: {
    sheet: SH.INPUT_PROJECT, row: 58, col: 4,
    label: 'Permisos y otros — min', type: 'number', default: 1, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C45', legacyCol: 'C'
  },
  costRangePermitsMax: {
    sheet: SH.INPUT_PROJECT, row: 58, col: 5,
    label: 'Permisos y otros — max', type: 'number', default: 20, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!D45', legacyCol: 'C'
  },
  costRangeInstallMin: {
    sheet: SH.INPUT_PROJECT, row: 59, col: 4,
    label: 'Instalación — min', type: 'number', default: 30, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C46', legacyCol: 'C'
  },
  costRangeInstallMax: {
    sheet: SH.INPUT_PROJECT, row: 59, col: 5,
    label: 'Instalación — max', type: 'number', default: 120, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!D46', legacyCol: 'C'
  },
  costRangeTotalMin: {
    sheet: SH.INPUT_PROJECT, row: 60, col: 4,
    label: 'Total — min', type: 'number', default: 200, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!C47', legacyCol: 'C'
  },
  costRangeTotalMax: {
    sheet: SH.INPUT_PROJECT, row: 60, col: 5,
    label: 'Total — max', type: 'number', default: 700, required: false,
    unit: 'USD/kWp', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: 'INPUT_GENERAL!D47', legacyCol: 'C'
  },

  // Chunk 3 (PROJECT_CARD_v2): BESS cost envelope. Unit is USD/kWh nominal
  // (not USD/kWp like the PV ranges), since BESS is denominated in kWh of
  // capacity. Range $350-$650 calibrated from the four BAAS project files
  // in /mnt/project (Autoplastek BJX/PUE, Draxlmaier, Taigene, Culligan):
  // observed $381-$579/kWh; we widen by ~10% on each side. Only PC_v2
  // reads this; legacy PC ignores it. See OUTPUT_V2_MIGRATION_PLAN.md.
  costRangeBessMin: {
    sheet: SH.INPUT_PROJECT, row: 61, col: 4,
    label: 'Almacenamiento BESS — min', type: 'number', default: 350, required: false,
    unit: 'USD/kWh', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: '', legacyCol: ''
  },
  costRangeBessMax: {
    sheet: SH.INPUT_PROJECT, row: 61, col: 5,
    label: 'Almacenamiento BESS — max', type: 'number', default: 650, required: false,
    unit: 'USD/kWh', section: '06 RANGOS DE VALIDACIÓN',
    consumedBy: ['projectCard'],
    legacyAddr: '', legacyCol: ''
  }
};


// ---------------------------------------------------------------------------
// INPUT_DESIGN -- unified tab (Phase 2a, 2026-04-24)
//
// LAYOUT
//   Top section (rows 5-28): two-column compact grid for manual engine inputs
//     Left column  (cols B-E):  labels + values + units + defaults
//       col B=label, C=value, D=unit, E=default hint
//     Right column (cols H-K):  labels + values + units + defaults
//       col H=label, I=value, J=unit, K=default hint
//     col F = visual separator between the two halves
//
//   Bottom section (rows 41+): full-width helioscope + equipment + string blocks
//     Not driven by INPUT_MAP scalar rendering — setupInputDesign() renders
//     these as custom tables and map entries for them use mode:'range' or
//     mode:'skip' (skip = documented but not rendered through _setupOneTab).
//
//   Dashboard row (row 6): 5 computed metric tiles (formulas). Not inputs.
//
// KEY SCHEMA EXTENSIONS (new in Phase 2a)
//   mode: 'range'  — tabular block. col/row point at top-left. rows, cols
//                    describe span. readInput/writeInput dispatch on this.
//   mode: 'skip'   — map entry present for docs but setup doesn't render.
//   advanced: true — tag operator label with "⚙" prefix.
// ---------------------------------------------------------------------------
var _MAP_DESIGN = {

  // ==========================================================================
  // TOP SECTION — LEFT COLUMN (cols B-E, values in col C = 3)
  // ==========================================================================

  // 01 AMBIENTE Y TECHO ------------------------------------------------------
  minTemp: {
    sheet: SH.INPUT_DESIGN, row: 9, col: 3,
    label: 'Temperatura mínima sitio', type: 'number',
    default: -14, required: false, unit: '°C',
    section: '01 AMBIENTE Y TECHO',
    consumedBy: ['engine', 'mdc'],
    notes: 'For Voc-cold per NOM 690.8(a). Bug #1 fix: 0 is now a valid value.'
  },
  maxTemp: {
    sheet: SH.INPUT_DESIGN, row: 10, col: 3,
    label: 'Temperatura máxima', type: 'number',
    default: 38, required: false, unit: '°C',
    section: '01 AMBIENTE Y TECHO',
    consumedBy: ['engine', 'mdc']
  },
  avgTemp: {
    sheet: SH.INPUT_DESIGN, row: 11, col: 3,
    label: 'Temperatura promedio', type: 'number',
    default: 25, required: false, unit: '°C',
    section: '01 AMBIENTE Y TECHO',
    consumedBy: ['engine', 'mdc']
  },
  roofClearanceMm: {
    sheet: SH.INPUT_DESIGN, row: 12, col: 3,
    label: 'Separación azotea', type: 'number',
    default: 90, required: false, unit: 'mm',
    section: '01 AMBIENTE Y TECHO',
    consumedBy: ['engine']
  },
  projectType: {
    sheet: SH.INPUT_DESIGN, row: 13, col: 3,
    label: 'Tipo de proyecto', type: 'dropdown',
    default: 'ROOF', required: true,
    dropdown: ['ROOF', 'GROUND', 'CARPORT'],
    section: '01 AMBIENTE Y TECHO',
    consumedBy: ['engine'],
    notes: 'HELIOSCOPE IMPORT TARGET — helioscope rewriter will target C13.'
  },
  roofType: {
    sheet: SH.INPUT_DESIGN, row: 14, col: 3,
    label: 'Tipo de techo', type: 'dropdown',
    default: 'KR18', required: false,
    dropdown: ['KR18', 'TR36', 'RT37', 'FLAT', 'OTHER'],
    section: '01 AMBIENTE Y TECHO',
    consumedBy: ['engine', 'bom']
  },
  structure: {
    sheet: SH.INPUT_DESIGN, row: 15, col: 3,
    label: 'Estructura primaria', type: 'dropdown',
    default: '', required: false,
    dropdownRange: '_DROPDOWNS!A2:A100',
    section: '01 AMBIENTE Y TECHO',
    consumedBy: ['engine', 'bom', 'install'],
    notes: 'Picks live from 13M_PRODUCTS_STRUCTURES via _DROPDOWNS helper. ' +
           'Format: "BRAND — MODEL — STR_ID". Engine resolves to STR_ID for ' +
           'BOM lookup and install drivers. Legacy free-text values (e.g. ' +
           '"STRUCTURE KR18") still resolve via model-only fallback.'
  },

  // 02 PARÁMETROS ELÉCTRICOS -------------------------------------------------
  bessCoupling: {
    sheet: SH.INPUT_DESIGN, row: 17, col: 3,    // C17
    label: 'Acoplamiento batería', type: 'dropdown',
    default: 'DC_COUPLED', required: false,
    dropdown: ['DC_COUPLED', 'AC_COUPLED'],
    section: '02 PARÁMETROS ELÉCTRICOS',
    consumedBy: ['engine', 'mdc'],
    notes: 'DC_COUPLED: battery shares the PV DC bus. AC_COUPLED: battery '
         + 'has its own PCS with a separate AC circuit. Decides which '
         + 'conductor runs the battery circuit sizing produces.'
  },
  dcVdropLimit: {
    sheet: SH.INPUT_DESIGN, row: 18, col: 3,
    label: 'Límite caída DC', type: 'percent',
    default: 0.015, required: false, unit: '%',
    section: '02 PARÁMETROS ELÉCTRICOS',
    consumedBy: ['engine', 'mdc']
  },
  acVdropLimit: {
    sheet: SH.INPUT_DESIGN, row: 19, col: 3,
    label: 'Límite caída AC', type: 'percent',
    default: 0.020, required: false, unit: '%',
    section: '02 PARÁMETROS ELÉCTRICOS',
    consumedBy: ['engine', 'mdc']
  },
  powerFactor: {
    sheet: SH.INPUT_DESIGN, row: 20, col: 3,
    label: 'Factor de potencia', type: 'number',
    default: 0.95, required: false,
    section: '02 PARÁMETROS ELÉCTRICOS',
    consumedBy: ['engine', 'mdc']
  },
  tempCoeffVocOverride: {
    sheet: SH.INPUT_DESIGN, row: 21, col: 3,
    label: 'Temp coeff Voc override', type: 'number',
    default: -0.0026, required: false, unit: '/°C',
    section: '02 PARÁMETROS ELÉCTRICOS',
    consumedBy: ['engine'],
    advanced: true,
    notes: 'Overrides panel DB value if populated.'
  },

  // 03 DISTANCIAS ------------------------------------------------------------
  distCabinet: {
    sheet: SH.INPUT_DESIGN, row: 24, col: 3,
    label: 'Cabinet box', type: 'number',
    default: 0, required: false, unit: 'm',
    section: '03 DISTANCIAS',
    consumedBy: ['engine']
  },
  distInverter: {
    sheet: SH.INPUT_DESIGN, row: 25, col: 3,
    label: 'Inversor', type: 'number',
    default: 50, required: false, unit: 'm',
    section: '03 DISTANCIAS',
    consumedBy: ['engine']
  },
  distAcProt: {
    sheet: SH.INPUT_DESIGN, row: 26, col: 3,
    label: 'Protección AC', type: 'number',
    default: 15, required: false, unit: 'm',
    section: '03 DISTANCIAS',
    consumedBy: ['engine']
  },
  distGrid: {
    sheet: SH.INPUT_DESIGN, row: 27, col: 3,
    label: 'Red', type: 'number',
    default: 50, required: false, unit: 'm',
    section: '03 DISTANCIAS',
    consumedBy: ['engine']
  },
  groundingLen: {
    sheet: SH.INPUT_DESIGN, row: 28, col: 3,
    label: 'Puesta a tierra', type: 'number',
    default: 2500, required: false, unit: 'm',
    section: '03 DISTANCIAS',
    consumedBy: ['engine', 'bom']
  },

  // ==========================================================================
  // TOP SECTION — RIGHT COLUMN (cols H-K, values in col I = 9)
  // ==========================================================================

  // 04 GEOMETRÍA -------------------------------------------------------------
  areaRequired: {
    sheet: SH.INPUT_DESIGN, row: 9, col: 9,
    label: 'Área requerida', type: 'number',
    default: 0, required: false, unit: 'm²',
    section: '04 GEOMETRÍA',
    consumedBy: ['engine']
  },
  availableSpace: {
    sheet: SH.INPUT_DESIGN, row: 10, col: 9,
    label: 'Espacio disponible', type: 'number',
    default: 5000, required: false, unit: 'm²',
    section: '04 GEOMETRÍA',
    consumedBy: ['engine']
  },
  aspectRatio: {
    sheet: SH.INPUT_DESIGN, row: 11, col: 9,
    label: 'Aspect ratio', type: 'number',
    default: 1.5, required: false,
    section: '04 GEOMETRÍA',
    consumedBy: ['engine'],
    advanced: true
  },
  invStations: {
    sheet: SH.INPUT_DESIGN, row: 12, col: 9,
    label: 'Estaciones de inversor', type: 'number',
    default: 1, required: false,
    section: '04 GEOMETRÍA',
    consumedBy: ['engine'],
    advanced: true
  },
  arrayBlocks: {
    sheet: SH.INPUT_DESIGN, row: 13, col: 9,
    label: 'Bloques del arreglo', type: 'number',
    default: 1, required: false,
    section: '04 GEOMETRÍA',
    consumedBy: ['engine'],
    advanced: true
  },
  rowPitch: {
    sheet: SH.INPUT_DESIGN, row: 14, col: 9,
    label: 'Pitch de filas', type: 'number',
    default: 2.0, required: false, unit: 'm',
    section: '04 GEOMETRÍA',
    consumedBy: ['engine'],
    notes: 'HELIOSCOPE IMPORT TARGET — helioscope rewriter will target I14.'
  },
  walkwayFactor: {
    sheet: SH.INPUT_DESIGN, row: 15, col: 9,
    label: 'Factor walkway', type: 'number',
    default: 1.20, required: false,
    section: '04 GEOMETRÍA',
    consumedBy: ['engine'],
    advanced: true
  },
  dcSpareFactor: {
    sheet: SH.INPUT_DESIGN, row: 16, col: 9,
    label: 'Factor reserva DC', type: 'number',
    default: 1.20, required: false,
    section: '04 GEOMETRÍA',
    consumedBy: ['engine'],
    advanced: true
  },
  acSpareFactor: {
    sheet: SH.INPUT_DESIGN, row: 17, col: 9,
    label: 'Factor reserva AC', type: 'number',
    default: 1.20, required: false,
    section: '04 GEOMETRÍA',
    consumedBy: ['engine'],
    advanced: true
  },
  feederExtraM: {
    sheet: SH.INPUT_DESIGN, row: 18, col: 9,
    label: 'Extra feeder', type: 'number',
    default: 0, required: false, unit: 'm',
    section: '04 GEOMETRÍA',
    consumedBy: ['engine'],
    advanced: true
  },
  stationCorridorM: {
    sheet: SH.INPUT_DESIGN, row: 19, col: 9,
    label: 'Corredor estación', type: 'number',
    default: 20, required: false, unit: 'm',
    section: '04 GEOMETRÍA',
    consumedBy: ['engine'],
    advanced: true
  },

  // 05 LAYOUT OVERRIDE -------------------------------------------------------
  layoutRows: {
    sheet: SH.INPUT_DESIGN, row: 22, col: 9,
    label: 'Filas (override)', type: 'number',
    default: '', required: false,
    section: '05 LAYOUT OVERRIDE',
    consumedBy: ['engine'],
    advanced: true,
    notes: 'Leave blank to auto-calc from array geometry.'
  },
  layoutCols: {
    sheet: SH.INPUT_DESIGN, row: 23, col: 9,
    label: 'Columnas (override)', type: 'number',
    default: '', required: false,
    section: '05 LAYOUT OVERRIDE',
    consumedBy: ['engine'],
    advanced: true,
    notes: 'Leave blank to auto-calc.'
  },
  layoutBlocks: {
    sheet: SH.INPUT_DESIGN, row: 24, col: 9,
    label: 'Bloques (override)', type: 'number',
    default: '', required: false,
    section: '05 LAYOUT OVERRIDE',
    consumedBy: ['engine'],
    advanced: true,
    notes: 'Leave blank to auto-calc.'
  },

  // 06 BOM CONFIG ------------------------------------------------------------
  supplyTransformer: {
    sheet: SH.INPUT_DESIGN, row: 27, col: 9,
    label: 'Suministro transformador', type: 'flag',
    default: 0, required: false,
    section: '06 BOM CONFIG',
    consumedBy: ['engine', 'bom'],
    notes: '0 = Cliente suministra · 1 = Argia suministra (incluir en BOM).'
  },

  // ==========================================================================
  // BOTTOM SECTION — HELIOSCOPE / EQUIPMENT (full width)
  // These entries use mode:'range' (bulk tabular read/write) or document
  // scalar anchors within a table.
  // ==========================================================================

  // 07 HELIOSCOPE — DATOS MENSUALES ------------------------------------------
  helioscopeMonthly: {
    sheet: SH.INPUT_DESIGN, row: 34, col: 2, // anchor at B34
    mode: 'range',
    rangeA1: 'B34:G45',
    rangeRows: 12, rangeCols: 6,
    label: 'Datos mensuales (12 meses × 6 cols)', type: 'table',
    required: false,
    section: '07 HELIOSCOPE',
    consumedBy: ['engine'],
    notes: 'Cols: abbr, ghi, poa, shaded, nameplateKwh, gridKwh. ' +
           'Written by 11_HelioscopeImport. Read as 12×6 array.'
  },
  annualKwh: {
    sheet: SH.INPUT_DESIGN, row: 46, col: 7, // G46
    label: 'Producción anual', type: 'number',
    default: 0, required: false, unit: 'kWh',
    section: '07 HELIOSCOPE',
    consumedBy: ['engine', 'projectCard'],
    notes: 'HELIOSCOPE IMPORT TARGET.'
  },

  // 08 EQUIPO — PANELES ------------------------------------------------------
  panelModel: {
    sheet: SH.INPUT_DESIGN, row: 50, col: 3, // C50
    label: 'Modelo de panel primario', type: 'text',
    default: '', required: true,
    section: '08 EQUIPO — PANELES',
    consumedBy: ['engine', 'mdc', 'bom'],
    notes: 'HELIOSCOPE IMPORT TARGET.'
  },
  panelQty: {
    sheet: SH.INPUT_DESIGN, row: 50, col: 4, // D50
    label: 'Cantidad (primario)', type: 'number',
    default: 0, required: true, unit: 'pcs',
    section: '08 EQUIPO — PANELES',
    consumedBy: ['engine', 'mdc', 'bom'],
    notes: 'HELIOSCOPE IMPORT TARGET.'
  },
  panelPowerW: {
    sheet: SH.INPUT_DESIGN, row: 50, col: 5, // E50
    label: 'Potencia unitaria', type: 'number',
    default: 0, required: true, unit: 'Wp',
    section: '08 EQUIPO — PANELES',
    consumedBy: ['engine', 'mdc'],
    notes: 'HELIOSCOPE IMPORT TARGET.'
  },
  panelsSecondary: {
    sheet: SH.INPUT_DESIGN, row: 51, col: 3, // C51
    mode: 'range',
    rangeA1: 'C51:E54',
    rangeRows: 4, rangeCols: 3,
    label: 'Paneles secundarios (hasta 4 modelos)', type: 'table',
    required: false,
    section: '08 EQUIPO — PANELES',
    consumedBy: ['engine'],
    notes: 'Cols: model, qty, Wp. Written by helioscope for multi-panel projects.'
  },

  // 09 EQUIPO — INVERSORES ---------------------------------------------------
  inverterPrimaryModel: {
    sheet: SH.INPUT_DESIGN, row: 58, col: 3, // C58
    label: 'Modelo inversor primario', type: 'text',
    default: '', required: true,
    section: '09 EQUIPO — INVERSORES',
    consumedBy: ['engine', 'mdc', 'bom'],
    notes: 'HELIOSCOPE IMPORT TARGET.'
  },
  inverterPrimaryQty: {
    sheet: SH.INPUT_DESIGN, row: 58, col: 4, // D58
    label: 'Cantidad (primario)', type: 'number',
    default: 0, required: true, unit: 'pcs',
    section: '09 EQUIPO — INVERSORES',
    consumedBy: ['engine', 'mdc', 'bom'],
    notes: 'HELIOSCOPE IMPORT TARGET.'
  },
  inverterPrimaryKw: {
    sheet: SH.INPUT_DESIGN, row: 58, col: 5, // E58
    label: 'Potencia unitaria (primario)', type: 'number',
    default: 0, required: true, unit: 'kW',
    section: '09 EQUIPO — INVERSORES',
    consumedBy: ['engine', 'mdc'],
    notes: 'HELIOSCOPE IMPORT TARGET.'
  },
  inverterPrimaryStrings: {
    sheet: SH.INPUT_DESIGN, row: 58, col: 6, // F58
    label: 'Strings asignados (primario)', type: 'number',
    default: 0, required: false, unit: 'strings',
    section: '09 EQUIPO — INVERSORES',
    consumedBy: ['engine']
  },
  invertersSecondary: {
    sheet: SH.INPUT_DESIGN, row: 59, col: 3, // C59
    mode: 'range',
    rangeA1: 'C59:F62',
    rangeRows: 4, rangeCols: 4,
    label: 'Inversores secundarios (hasta 4 modelos)', type: 'table',
    required: false,
    section: '09 EQUIPO — INVERSORES',
    consumedBy: ['engine'],
    notes: 'Cols: model, qty, kW, strings. Written by helioscope.'
  },
  totalInverters: {
    sheet: SH.INPUT_DESIGN, row: 63, col: 4, // D63
    label: 'Total inversores', type: 'number',
    default: 0, required: false, unit: 'pcs',
    section: '09 EQUIPO — INVERSORES',
    consumedBy: ['engine']
  },
  totalStrings: {
    sheet: SH.INPUT_DESIGN, row: 63, col: 5, // E63
    label: 'Total strings', type: 'number',
    default: 0, required: false, unit: 'strings',
    section: '09 EQUIPO — INVERSORES',
    consumedBy: ['engine'],
    notes: 'HELIOSCOPE IMPORT TARGET.'
  },

  // 10 STRING CONFIG ---------------------------------------------------------
  stringsTotal: {
    sheet: SH.INPUT_DESIGN, row: 66, col: 3, // C66
    label: 'Strings totales (sistema)', type: 'number',
    default: 0, required: true, unit: 'strings',
    section: '10 STRING CONFIG',
    consumedBy: ['engine'],
    notes: 'Display value — usually mirrors totalStrings at E63.'
  },
  parallelStrings: {
    sheet: SH.INPUT_DESIGN, row: 67, col: 3, // C67
    label: 'Strings en paralelo', type: 'number',
    default: 1, required: true,
    section: '10 STRING CONFIG',
    consumedBy: ['engine']
  },
  modsPerString: {
    sheet: SH.INPUT_DESIGN, row: 68, col: 3, // C68
    label: 'Módulos por string', type: 'number',
    default: 18, required: true,
    section: '10 STRING CONFIG',
    consumedBy: ['engine', 'mdc'],
    notes: 'HELIOSCOPE IMPORT TARGET.'
  },
  optimizers: {
    sheet: SH.INPUT_DESIGN, row: 69, col: 3, // C69
    label: 'Optimizadores', type: 'flag',
    default: 0, required: false,
    section: '10 STRING CONFIG',
    consumedBy: ['engine'],
    notes: '0 = sin optimizadores · 1 = con optimizadores.'
  },

  // DEPRECATED — kept in map for back-compat but pointing nowhere useful.
  // Legacy structureSecondary was at N41 in old layout. In new layout, all
  // panels are modeled via panelsSecondary range (col model/qty/Wp).
  // This scalar key is retained so old references in calcLayout don't throw.
  structureSecondary: {
    sheet: SH.INPUT_DESIGN, row: 15, col: 5, // cohabits row 15 col E (unit slot)
    label: 'Estructura secundaria (DEPRECATED)', type: 'text',
    default: '', required: false,
    section: '01 AMBIENTE Y TECHO',
    consumedBy: ['engine', 'bom'],
    mode: 'skip',  // do not render in setup — exists as a reader-only fallback
    notes: 'DEPRECATED. Returns empty string for back-compat. Engine uses ' +
           'panelsSecondary range for real secondary panel data.'
  }
};


// ---------------------------------------------------------------------------
// INPUT_INSTALL -- crew, conditions, factors, rate overrides, benchmarks
// Migrates from legacy INPUT_DESIGN rows 46-83 (the install driver block).
// ---------------------------------------------------------------------------
var _MAP_INSTALL = {

  // 01 CUADRILLA ------------------------------------------------------------
  crewSize: {
    sheet: SH.INPUT_INSTALL, row: 8, col: 4,
    label: 'Tamaño de cuadrilla', type: 'number',
    default: 6, required: true, unit: 'personas',
    section: '01 CUADRILLA',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M46', legacyCol: 'M'
  },
  // estProjectDays: REMOVED 2026-04-28. Days are now derived inside
  // calcInstallCost as ceil(productiveMH / crew / 8) and re-derived after
  // labor benchmarks (see Patches 2 & 3 in 13_CalcInstallCost.gs). User-
  // entered days were ignored anyway -- removing the map entry stops
  // setupInputInstall from rendering a dead row that confused users.

  // 02 CONDICIONES DE SITIO -------------------------------------------------
  workHeightM: {
    sheet: SH.INPUT_INSTALL, row: 13, col: 4,
    label: 'Altura de trabajo', type: 'number',
    default: 6, required: true, unit: 'm',
    section: '02 CONDICIONES DE SITIO',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M48', legacyCol: 'M',
    notes: 'Maps to LE_3M / LE_6M / LE_10M / GT_10M in install factors.'
  },
  anchorCount: {
    sheet: SH.INPUT_INSTALL, row: 14, col: 4,
    label: 'Anclajes en techo', type: 'number',
    default: 0, required: false, unit: 'penetraciones',
    section: '02 CONDICIONES DE SITIO',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M49', legacyCol: 'M'
  },
  interconnectionPts: {
    sheet: SH.INPUT_INSTALL, row: 15, col: 4,
    label: 'Puntos de interconexión', type: 'number',
    default: 1, required: false,
    section: '02 CONDICIONES DE SITIO',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M50', legacyCol: 'M'
  },
  trayM: {
    sheet: SH.INPUT_INSTALL, row: 16, col: 4,
    label: 'Metros de charola', type: 'number',
    default: 0, required: false, unit: 'm',
    section: '02 CONDICIONES DE SITIO',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M51', legacyCol: 'M'
  },
  conduitM: {
    sheet: SH.INPUT_INSTALL, row: 17, col: 4,
    label: 'Metros de conduit', type: 'number',
    default: 0, required: false, unit: 'm',
    section: '02 CONDICIONES DE SITIO',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M52', legacyCol: 'M'
  },

  // 03 FACTORES -------------------------------------------------------------
  accessDifficulty: {
    sheet: SH.INPUT_INSTALL, row: 21, col: 4,
    label: 'Dificultad de acceso', type: 'dropdown',
    default: 'EASY', required: true,
    dropdown: ['EASY', 'MEDIUM', 'HARD', 'VERY_HARD'],
    section: '03 FACTORES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M53', legacyCol: 'M'
  },
  siteHseClass: {
    sheet: SH.INPUT_INSTALL, row: 22, col: 4,
    label: 'Clase HSE', type: 'dropdown',
    default: 'STANDARD', required: true,
    dropdown: ['STANDARD', 'STRICT', 'HIGH_CONTROL'],
    section: '03 FACTORES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M54', legacyCol: 'M'
  },
  energizedTieIn: {
    sheet: SH.INPUT_INSTALL, row: 23, col: 4,
    label: 'Energized tie-in', type: 'dropdown',
    default: 'NO', required: true,
    dropdown: ['YES', 'NO'],
    section: '03 FACTORES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M55', legacyCol: 'M'
  },
  siteDistanceClass: {
    sheet: SH.INPUT_INSTALL, row: 24, col: 4,
    label: 'Distancia sitio', type: 'dropdown',
    default: 'LOCAL', required: true,
    dropdown: ['LOCAL', 'REGIONAL', 'REMOTE'],
    section: '03 FACTORES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M56', legacyCol: 'M'
  },
  nightWorkRequired: {
    sheet: SH.INPUT_INSTALL, row: 25, col: 4,
    label: 'Trabajo nocturno', type: 'dropdown',
    default: 'NO', required: false,
    dropdown: ['YES', 'NO'],
    section: '03 FACTORES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M57', legacyCol: 'M'
  },
  projectComplexity: {
    sheet: SH.INPUT_INSTALL, row: 26, col: 4,
    label: 'Complejidad proyecto', type: 'dropdown',
    default: 'LOW', required: true,
    dropdown: ['LOW', 'MEDIUM', 'HIGH'],
    section: '03 FACTORES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M58', legacyCol: 'M'
  },
  weatherProfile: {
    sheet: SH.INPUT_INSTALL, row: 27, col: 4,
    label: 'Clima', type: 'dropdown',
    default: 'DRY', required: true,
    dropdown: ['DRY', 'RAIN_SEASON'],
    section: '03 FACTORES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M59', legacyCol: 'M'
  },

  // 04 PORCENTAJES ----------------------------------------------------------
  contingencyPct: {
    sheet: SH.INPUT_INSTALL, row: 31, col: 4,
    label: 'Contingencia', type: 'percent',
    default: 0.05, required: false, unit: '%',
    section: '04 PORCENTAJES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M60', legacyCol: 'M'
  },
  insurancePct: {
    sheet: SH.INPUT_INSTALL, row: 32, col: 4,
    label: 'Seguros', type: 'percent',
    default: 0.03, required: false, unit: '%',
    section: '04 PORCENTAJES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M61', legacyCol: 'M'
  },

  // 05 RATE OVERRIDES -------------------------------------------------------
  // All blank by default — engine falls back to DB rates when blank.
  rateInstaller: {
    sheet: SH.INPUT_INSTALL, row: 36, col: 4,
    label: 'Installer', type: 'number',
    default: '', required: false, unit: 'MXN/MH',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M64', legacyCol: 'M',
    notes: 'DB default 95. Subcontract range 250-350.'
  },
  rateHelper: {
    sheet: SH.INPUT_INSTALL, row: 37, col: 4,
    label: 'Helper', type: 'number',
    default: '', required: false, unit: 'MXN/MH',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M65', legacyCol: 'M',
    notes: 'DB default 70.'
  },
  rateElectrician: {
    sheet: SH.INPUT_INSTALL, row: 38, col: 4,
    label: 'Electrician', type: 'number',
    default: '', required: false, unit: 'MXN/MH',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M66', legacyCol: 'M',
    notes: 'DB default 130. Subcontract range 300-450.'
  },
  rateElectricalEngineer: {
    sheet: SH.INPUT_INSTALL, row: 39, col: 4,
    label: 'Electrical engineer', type: 'number',
    default: '', required: false, unit: 'MXN/MH',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M67', legacyCol: 'M',
    notes: 'DB default 220.'
  },
  rateProjectEngineer: {
    sheet: SH.INPUT_INSTALL, row: 40, col: 4,
    label: 'Project engineer', type: 'number',
    default: '', required: false, unit: 'MXN/MH',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M68', legacyCol: 'M',
    notes: 'DB default 210.'
  },
  rateCommissioningTech: {
    sheet: SH.INPUT_INSTALL, row: 41, col: 4,
    label: 'Commissioning tech', type: 'number',
    default: '', required: false, unit: 'MXN/MH',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M69', legacyCol: 'M',
    notes: 'DB default 180.'
  },
  rateHseCoordinator: {
    sheet: SH.INPUT_INSTALL, row: 42, col: 4,
    label: 'HSE coordinator', type: 'number',
    default: '', required: false, unit: 'MXN/MH',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M70', legacyCol: 'M',
    notes: 'DB default 150.'
  },
  rateQaqcTech: {
    sheet: SH.INPUT_INSTALL, row: 43, col: 4,
    label: 'QA/QC tech', type: 'number',
    default: '', required: false, unit: 'MXN/MH',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M71', legacyCol: 'M',
    notes: 'DB default 145.'
  },
  rateScissorLift: {
    sheet: SH.INPUT_INSTALL, row: 44, col: 4,
    label: 'Scissor lift', type: 'number',
    default: '', required: false, unit: 'MXN/día',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M72', legacyCol: 'M',
    notes: 'DB default 1800.'
  },
  rateBoomLift: {
    sheet: SH.INPUT_INSTALL, row: 45, col: 4,
    label: 'Boom lift', type: 'number',
    default: '', required: false, unit: 'MXN/día',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M73', legacyCol: 'M',
    notes: 'DB default 4200.'
  },
  rateForklift: {
    sheet: SH.INPUT_INSTALL, row: 46, col: 4,
    label: 'Forklift', type: 'number',
    default: '', required: false, unit: 'MXN/día',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M74', legacyCol: 'M',
    notes: 'DB default 2200.'
  },
  rateCrane: {
    sheet: SH.INPUT_INSTALL, row: 47, col: 4,
    label: 'Crane', type: 'number',
    default: '', required: false, unit: 'MXN/día',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M75', legacyCol: 'M',
    notes: 'DB default 9500.'
  },
  rateGenericLift: {
    sheet: SH.INPUT_INSTALL, row: 48, col: 4,
    label: 'Generic lift', type: 'number',
    default: '', required: false, unit: 'MXN/día',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M76', legacyCol: 'M',
    notes: 'DB default 3500.'
  },
  rateScaffolding: {
    sheet: SH.INPUT_INSTALL, row: 49, col: 4,
    label: 'Scaffolding', type: 'number',
    default: '', required: false, unit: 'MXN/día',
    section: '05 RATE OVERRIDES',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M77', legacyCol: 'M',
    notes: 'DB default 2500.'
  },

  // 06 BENCHMARKS (MH/kWp) --------------------------------------------------
  benchStructMhKwp: {
    sheet: SH.INPUT_INSTALL, row: 53, col: 4,
    label: 'Structure', type: 'number',
    default: 0.30, required: false, unit: 'MH/kWp',
    section: '06 PRODUCTIVITY',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M80', legacyCol: 'M',
    notes: 'Range 0.25-0.40. Blank = DB item calc, filled = scales RACKING.'
  },
  benchModuleMhKwp: {
    sheet: SH.INPUT_INSTALL, row: 54, col: 4,
    label: 'Module install', type: 'number',
    default: 0.20, required: false, unit: 'MH/kWp',
    section: '06 PRODUCTIVITY',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M81', legacyCol: 'M',
    notes: 'Range 0.15-0.25. Scales DC-01 only.'
  },
  benchDcElecMhKwp: {
    sheet: SH.INPUT_INSTALL, row: 55, col: 4,
    label: 'Electrical DC', type: 'number',
    default: 0.15, required: false, unit: 'MH/kWp',
    section: '06 PRODUCTIVITY',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M82', legacyCol: 'M',
    notes: 'Range 0.10-0.20. Scales DC electrical (excl. DC-01).'
  },
  benchAcElecMhKwp: {
    sheet: SH.INPUT_INSTALL, row: 56, col: 4,
    label: 'Electrical AC', type: 'number',
    default: 0.12, required: false, unit: 'MH/kWp',
    section: '06 PRODUCTIVITY',
    consumedBy: ['engine'],
    legacyAddr: 'INPUT_DESIGN!M83', legacyCol: 'M',
    notes: 'Range 0.08-0.15. Scales AC section labour.'
  }
};


// ---------------------------------------------------------------------------
// _MAP_INSTALL_BESS -- BESS-specific install knobs on INPUT_INSTALL.
// Added 2026-05-25 (chunk bess_install). Consumed by readInstallDrivers()
// in 13_CalcInstallCost.gs.
//
// SCOPE
//   These four fields are user-facing knobs that the engine needs in
//   addition to the data it already derives from bessResult (capacityKwh,
//   stackQty, bos.lines, etc.). Everything else is auto-derived; do not
//   add new fields here unless the value genuinely cannot be inferred.
//
// LAYOUT
//   Section "07 BESS / ALMACENAMIENTO" rendered as the 7th section in
//   INPUT_INSTALL. Header lands on row 58, first field on row 60.
//   Rows 64-80 left intentionally blank for future BESS knobs (e.g.
//   container model selector, custom commissioning rate, vendor
//   override). Bump rows only at the bottom -- existing rows are stable.
//
// GATING
//   When the project has no BESS (INPUT_PROJECT.installBattery=NO),
//   bessResult.bessEnabled is false, and the engine ignores these inputs
//   regardless of what the user typed.
// ---------------------------------------------------------------------------
var _MAP_INSTALL_BESS = {

  // 07 BESS / ALMACENAMIENTO ------------------------------------------------
  bessBatteriesPerContainer: {
    sheet: SH.INPUT_INSTALL, row: 60, col: 4,
    label: 'Baterias por contenedor', type: 'number',
    default: 16, required: false, unit: 'stacks/contenedor',
    section: '07 BESS / ALMACENAMIENTO',
    consumedBy: ['engine'],
    notes: 'Drives BESS_CONTAINER_QTY = ceil(stackQty / batteriesPerContainer). '
         + 'Huawei LUNA default 16. Adjust per vendor if container is smaller.'
  },
  bessRequiresFireSystem: {
    sheet: SH.INPUT_INSTALL, row: 61, col: 4,
    label: 'Sistema contra incendios BESS', type: 'dropdown',
    default: 'NO', required: false,
    dropdown: ['YES', 'NO'],
    section: '07 BESS / ALMACENAMIENTO',
    consumedBy: ['engine'],
    notes: 'UPSELL toggle. YES => BESS-I-18 fire suppression line fires '
         + '(180k MXN/contenedor placeholder).'
  },
  bessRequiresSpillContainment: {
    sheet: SH.INPUT_INSTALL, row: 62, col: 4,
    label: 'Contencion de derrames BESS', type: 'dropdown',
    default: 'YES', required: false,
    dropdown: ['YES', 'NO'],
    section: '07 BESS / ALMACENAMIENTO',
    consumedBy: ['engine'],
    notes: 'YES => BESS-I-19 spill containment line fires. Default YES '
         + 'because most sites do not already have it.'
  },
  bessCommissioningDays: {
    sheet: SH.INPUT_INSTALL, row: 63, col: 4,
    label: 'Dias de commissioning fabricante', type: 'number',
    default: 2, required: false, unit: 'dias',
    section: '07 BESS / ALMACENAMIENTO',
    consumedBy: ['engine'],
    notes: 'Reserved for future use. No DB row consumes this yet. Kept '
         + 'as a declared knob so the input layout has a place for it.'
  }

  // Rows 64-80 reserved for future BESS install knobs. Add new keys
  // here (bottom-append only) and bump the section if you exceed row 80.
};


// ---------------------------------------------------------------------------
// _MAP_BESS — battery toggle (INPUT_PROJECT) + INPUT_BESS sheet cells.
// Added 2026-05-19. Consumed by readInputBess() in 01a_ReadInputsBess.gs.
// Cell coordinates verified against the live INPUT_BESS / INPUT_PROJECT tabs.
// ---------------------------------------------------------------------------
var _MAP_BESS = {

  // -- Battery toggle: INPUT_PROJECT section 7.0 ALMACENAMIENTO -------------
  installBattery: {
    sheet: SH.INPUT_PROJECT, row: 64, col: 4,   // D64
    label: 'Instalar batería', type: 'dropdown',
    default: 'NO', required: false,
    dropdown: ['YES', 'NO'],
    section: '07 ALMACENAMIENTO',
    consumedBy: ['engine'],
    notes: 'YES => engine reads INPUT_BESS and runs the BESS step.'
  },

  // -- Chunk 7: install-PV toggle + existing-PV declaration ----------------
  // INPUT_PROJECT section 08 SOLAR (rows 66-70, previously empty). installPv
  // defaults to YES so pre-Chunk-7 projects (no cell) keep installing PV and
  // stay byte-identical. NO => battery-only (scenarios 3 / 4A).
  installPv: {
    sheet: SH.INPUT_PROJECT, row: 66, col: 4,   // D66
    label: 'Instalar PV nuevo', type: 'dropdown',
    default: 'YES', required: false,
    dropdown: ['YES', 'NO'],
    section: '08 SOLAR',
    consumedBy: ['engine'],
    notes: 'YES (default) => model new PV. NO => battery-only project '
         + '(scenarios 3 / 4A); the hourly sim runs with monthlyPv=null.'
  },
  hasExistingPv: {
    sheet: SH.INPUT_PROJECT, row: 67, col: 4,   // D67
    label: 'Cliente ya tiene PV', type: 'dropdown',
    default: 'NO', required: false,
    dropdown: ['YES', 'NO'],
    section: '08 SOLAR',
    consumedBy: ['engine'],
    notes: 'Only meaningful when installPv=NO. YES => scenario 4A/4B '
         + '(existing-solar disclaimer). NO => scenario 3 (greenfield).'
  },
  existingPvKwp: {
    sheet: SH.INPUT_PROJECT, row: 68, col: 4,   // D68
    label: 'PV existente (kWp)', type: 'number',
    default: 0, required: false,
    section: '08 SOLAR',
    consumedBy: ['engine'],
    notes: 'Scenario 4B input (roadmap). Existing PV size; not yet used for '
         + 'capture modeling.'
  },
  existingPvAnnualKwh: {
    sheet: SH.INPUT_PROJECT, row: 69, col: 4,   // D69
    label: 'PV existente (kWh/año)', type: 'number',
    default: 0, required: false,
    section: '08 SOLAR',
    consumedBy: ['engine'],
    notes: 'Scenario 4B input (roadmap). Existing PV annual production; not '
         + 'yet used for capture modeling.'
  },

  // -- INPUT_BESS §1 SELECCIÓN DE BATERÍA ----------------------------------
  bessBatteryId: {
    sheet: 'INPUT_BESS', row: 6, col: 3,        // C6
    label: 'BATTERY_ID', type: 'text',
    default: 'CUSTOM_MANUAL', required: false,
    section: 'BESS 1 SELECCION',
    consumedBy: ['engine']
  },
  bessStrategy: {
    sheet: 'INPUT_BESS', row: 7, col: 3,        // C7
    label: 'BESS_STRATEGY', type: 'dropdown',
    default: 'SELF_CONSUMPTION_MAX', required: false,
    // 3.7.9: LOAD_SHIFTING now steers the hourly dispatcher (grid arbitrage
    // base->punta under NET_BILLING). All three are priority policies, not
    // on/off switches — see _bessDispatchHour() in 20_CalcHourlySimulation.
    dropdown: ['SELF_CONSUMPTION_MAX', 'PEAK_SHAVING', 'LOAD_SHIFTING'],
    section: 'BESS 1 SELECCION',
    consumedBy: ['engine']
  },

  // -- INPUT_BESS §2 ESPECIFICACIONES TÉCNICAS -----------------------------
  bessCapacityKwh: {
    sheet: 'INPUT_BESS', row: 10, col: 3,       // C10
    label: 'Capacidad nominal kWh', type: 'number',
    default: 0, required: false, unit: 'kWh',
    section: 'BESS 2 ESPECIFICACIONES',
    consumedBy: ['engine']
  },
  bessPowerKw: {
    sheet: 'INPUT_BESS', row: 11, col: 3,       // C11
    label: 'Potencia kW', type: 'number',
    default: 0, required: false, unit: 'kW',
    section: 'BESS 2 ESPECIFICACIONES',
    consumedBy: ['engine']
  },
  bessMinSocPct: {
    sheet: 'INPUT_BESS', row: 12, col: 3,       // C12
    label: 'Min SOC %', type: 'percent',
    default: 0.10, required: false,
    section: 'BESS 2 ESPECIFICACIONES',
    consumedBy: ['engine']
  },
  bessMaxSocPct: {
    sheet: 'INPUT_BESS', row: 13, col: 3,       // C13
    label: 'Max SOC %', type: 'percent',
    default: 0.90, required: false,
    section: 'BESS 2 ESPECIFICACIONES',
    consumedBy: ['engine']
  },
  bessRtePct: {
    sheet: 'INPUT_BESS', row: 14, col: 3,       // C14
    label: 'RTE %', type: 'percent',
    default: 0.90, required: false,
    section: 'BESS 2 ESPECIFICACIONES',
    consumedBy: ['engine']
  },
  bessCyclesPerDay: {
    sheet: 'INPUT_BESS', row: 15, col: 3,       // C15
    label: 'Ciclos por día', type: 'number',
    default: 1.0, required: false,
    section: 'BESS 2 ESPECIFICACIONES',
    consumedBy: ['engine']
  },
  bessDegradationPct: {
    sheet: 'INPUT_BESS', row: 16, col: 3,       // C16
    label: 'Degradación %/año', type: 'percent',
    default: 0.025, required: false,
    section: 'BESS 2 ESPECIFICACIONES',
    consumedBy: ['engine']
  },
  bessBackupReservePct: {
    sheet: 'INPUT_BESS', row: 17, col: 3,       // C17
    label: 'Reserva backup %', type: 'percent',
    default: 0.0, required: false,
    section: 'BESS 2 ESPECIFICACIONES',
    consumedBy: ['engine']
  },

  // -- INPUT_BESS §2b BATTERY VOLTAGE  (Increment 4b-2.5b) -----------------
  // Manual voltage override / CUSTOM_MANUAL fallback. The reader prefers the
  // selected catalog product's Nominal_Voltage_V (16M_PRODUCTS_BESS via
  // lookupBatteryVoltage); these cells are used only when the product has no
  // DB voltage (CUSTOM_MANUAL) or the designer wants to force a value.
  // Blank is a valid state -> calcBessCircuit reports "pendiente".
  // Physically rows 18/19 of INPUT_BESS, inserted between §2 (C10-C17) and
  // §3 (now C22). default 0 = "not supplied".
  bessDcBusVoltageV: {
    sheet: 'INPUT_BESS', row: 18, col: 3,       // C18
    label: 'Voltaje bus DC / batería (V)', type: 'number',
    default: 0, required: false, unit: 'V',
    section: 'BESS 2 ESPECIFICACIONES',
    consumedBy: ['engine']
  },
  bessAcVoltageV: {
    sheet: 'INPUT_BESS', row: 19, col: 3,       // C19
    label: 'Voltaje sistema AC (V)', type: 'number',
    default: 0, required: false, unit: 'V',
    section: 'BESS 2 ESPECIFICACIONES',
    consumedBy: ['engine']
  },

  // -- INPUT_BESS §3 INFORMACIÓN COMERCIAL ---------------------------------
  bessCapexMxn: {
    sheet: 'INPUT_BESS', row: 22, col: 3,       // C22 (was C20; +2 after the
                                                 // voltage rows were inserted)
    label: 'CAPEX MXN', type: 'number',
    default: 0, required: false, unit: 'MXN',
    section: 'BESS 3 COMERCIAL',
    consumedBy: ['engine', 'finance']
  },

  // -- INPUT_BESS §4 PEAK SHAVING ------------------------------------------
  bessLoadFactorFC: {
    sheet: 'INPUT_BESS', row: 25, col: 3,       // C25 (was C23; +2)
    label: 'Factor de carga (F.C.)', type: 'number',
    default: 0.57, required: false,
    section: 'BESS 4 PEAK SHAVING',
    consumedBy: ['engine']
  },
  bessPuntaWindowSummerH: {
    sheet: 'INPUT_BESS', row: 26, col: 3,       // C26 (was C24; +2)
    label: 'Horas punta — verano', type: 'number',
    default: 2.0, required: false, unit: 'h',
    section: 'BESS 4 PEAK SHAVING',
    consumedBy: ['engine']
  },
  bessPuntaWindowWinterH: {
    sheet: 'INPUT_BESS', row: 27, col: 3,       // C27 (was C25; +2)
    label: 'Horas punta — invierno', type: 'number',
    default: 4.0, required: false, unit: 'h',
    section: 'BESS 4 PEAK SHAVING',
    consumedBy: ['engine']
  },

  // -- INPUT_BESS §5 ECONOMICS GUARDRAILS  (BDF-3) ------------------------
  // Threshold and tariff overrides. setupInputBessEconomicsRows() in
  // 02e_InputSetup.js writes the labels and the threshold default. The
  // engine reads them via readBessMinSavingsThreshold / readInputBessTariffOverride.
  bessMinAnnualSavingMxn: {
    sheet: 'INPUT_BESS', row: 37, col: 3,        // C37
    label: 'Mín. ahorro anual MXN', type: 'number',
    default: 2000000, required: false, unit: 'MXN',
    section: 'BESS 5 ECONOMICS',
    consumedBy: ['engine'],
    notes: 'Sizing engine flags candidates whose annual saving is below this. ' +
           '0 = disabled (no filtering).'
  },
  bessPuntaRateOverride: {
    sheet: 'INPUT_BESS', row: 38, col: 3,        // C38
    label: 'Override tarifa punta MXN/kWh', type: 'number',
    default: 0, required: false, unit: 'MXN/kWh',
    section: 'BESS 5 ECONOMICS',
    consumedBy: ['engine'],
    notes: 'Blank/0 = auto-derive from INPUT_CFE 12-month weighted average.'
  },
  bessBaseRateOverride: {
    sheet: 'INPUT_BESS', row: 39, col: 3,        // C39
    label: 'Override tarifa base MXN/kWh', type: 'number',
    default: 0, required: false, unit: 'MXN/kWh',
    section: 'BESS 5 ECONOMICS',
    consumedBy: ['engine'],
    notes: 'Blank/0 = auto-derive from INPUT_CFE 12-month weighted average.'
  },
};

// ---------------------------------------------------------------------------
// COMBINE — the single map. Writers and readers only touch INPUT_MAP.
// ---------------------------------------------------------------------------
var INPUT_MAP = {};
(function _mergeMaps() {
  var parts = [_MAP_PROJECT, _MAP_DESIGN, _MAP_INSTALL, _MAP_INSTALL_BESS, _MAP_BESS];
  for (var p = 0; p < parts.length; p++) {
    var src = parts[p];
    for (var k in src) {
      if (src.hasOwnProperty(k)) {
        if (INPUT_MAP.hasOwnProperty(k)) {
          throw new Error('INPUT_MAP duplicate key during merge: "' + k + '"');
        }
        INPUT_MAP[k] = src[k];
      }
    }
  }
})();