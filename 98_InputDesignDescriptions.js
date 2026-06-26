// =============================================================================
// ARGIA ENGINE -- File: 98_InputDesignDescriptions.gs
// Adds a hover NOTE to every INPUT_DESIGN input cell describing how the value
// impacts the project (directional: what goes up/down and what it changes).
//
// Source of truth for the cell location is INPUT_MAP (02c_InputMap.gs), so a
// note always lands on the correct field even if rows move. Re-runnable
// (setNote overwrites). Run from the ARGIA menu or from the Apps Script editor:
//   applyInputDesignDescriptions(SpreadsheetApp.getActiveSpreadsheet())
//
// To switch the descriptions to English (or edit any wording), change the text
// in INPUT_DESIGN_IMPACT below and re-run -- nothing else depends on the prose.
// =============================================================================

// key -> impact description (matches the sheet's Spanish UI).
var INPUT_DESIGN_IMPACT = {
  // 01 AMBIENTE Y TECHO ------------------------------------------------------
  minTemp:
    'Temperatura mínima del sitio. \u2193 minTemp \u2192 \u2191 Voc_cold del string ' +
    '(el frío sube el voltaje). Fija el MÁXIMO de módulos por string ' +
    '(DC-01: Voc_cold \u2264 Vmax del inversor). Muy baja puede romper la ventana de string.',
  maxTemp:
    'Temperatura máxima. \u2191 maxTemp \u2192 \u2193 Vmp_hot (límite mínimo MPPT, DC-02) y ' +
    '\u2193 ampacidad del conductor (factor Ft) \u2192 puede exigir conductor AC/DC más grueso ' +
    'o mayor protección.',
  avgTemp:
    'Temperatura promedio. Se usa con el adder de azotea para la temperatura de celda en ' +
    'Vmp_hot \u2192 afecta el mínimo de módulos por string (ventana MPPT).',
  roofClearanceMm:
    'Separación módulo\u2013azotea (mm). Mapea a un adder de temperatura sobre el ambiente para ' +
    'dimensionar el conductor. Menor separación \u2192 más calor \u2192 conductor más grueso.',
  projectType:
    'Tipo de proyecto (ROOF / GROUND / CARPORT). Filtra qué partidas de instalación aplican y ' +
    'el multiplicador de tipo \u2192 cambia mano de obra y BOM.',
  roofType:
    'Tipo de techo. Debe ser compatible con la estructura (lastre en techo plano/TPO; clamps en ' +
    'metal). Hoy es informativo; la compatibilidad techo\u2013estructura aún no se valida.',
  structure:
    'Estructura de montaje primaria. Selecciona la fila de 13M_PRODUCTS_STRUCTURES \u2192 costo por ' +
    'módulo y mano de obra de racking. Debe coincidir con el tipo de techo.',
  structureSecondary:
    'Estructura secundaria (DEPRECATED). No usar; campo heredado pendiente de eliminar.',

  // 02 PARÁMETROS ELÉCTRICOS -------------------------------------------------
  bessCoupling:
    'Acoplamiento de la batería (AC/DC). Define el circuito BESS y las notas del MDC. En blanco = ' +
    'DC_COUPLED (batería en el bus DC compartido).',
  dcVdropLimit:
    'Límite de caída de tensión DC (%). El conductor DC se engrosa hasta cumplir este límite. ' +
    '\u2193 límite \u2192 conductor más grueso y más cobre.',
  acVdropLimit:
    'Límite de caída de tensión AC (%). El conductor AC se engrosa hasta cumplir este límite. ' +
    '\u2193 límite \u2192 conductor más grueso.',
  powerFactor:
    'Factor de potencia. S = P/FP dimensiona el kVA del transformador y la corriente AC. ' +
    '\u2193 FP \u2192 transformador y feeder más grandes.',
  tempCoeffVocOverride:
    'Override del coeficiente de temperatura de Voc (/°C). Si se ingresa, reemplaza el del panel ' +
    'para Voc_cold (ventana de string). En blanco usa PANEL_TEMP_VOC o, en su defecto, el de Pmax.',

  // 03 DISTANCIAS ------------------------------------------------------------
  roofToInverterDropM:
    'Caída vertical techo\u2192inversor (m). Se suma a cada corrida DC/AC para estimar el cable real. ' +
    '\u2191 \u2192 más cobre y más caída de tensión. En blanco = 5 m.',
  dcStringWireM:
    'Longitud total de cable DC de strings medida por Helioscope (m). Alimenta directamente la ' +
    'cantidad de cable DC del BOM (\u00d7 merma). En blanco = se estima por geometría del arreglo.',
  longestStringRunM:
    'Corrida del string más largo (m), tomada de Helioscope. Gobierna el dimensionamiento del ' +
    'conductor DC por caída de tensión. \u2191 \u2192 conductor más grande. En blanco = usa el promedio.',
  distInverter:
    'Distancia al inversor (m). Base de las corridas DC (home-run) y AC. \u2191 \u2192 más metros de ' +
    'cable, más caída de tensión y más mano de obra de tendido.',
  distAcProt:
    'Distancia a la protección AC (m). Componente del ramal AC y del feeder. \u2191 \u2192 más cable AC.',
  distGrid:
    'Distancia a la red/transformador (m). Longitud del feeder principal (el cable más caro). ' +
    '\u2191 \u2192 impacto grande en el cobre del feeder.',
  groundingLen:
    'Longitud de puesta a tierra (m). Metros de conductor de tierra y su mano de obra.',

  // 04 GEOMETRÍA -------------------------------------------------------------
  areaRequired:
    'Área que requiere el arreglo (m²). Se compara con el espacio disponible para el chequeo de ' +
    'factibilidad de área.',
  availableSpace:
    'Espacio disponible en el techo (m²). Límite de factibilidad: el área requerida debe caber aquí.',
  aspectRatio:
    'Relación largo/ancho del arreglo cuando no hay override de filas/columnas. Afecta la geometría ' +
    '\u2192 longitudes de cable estimadas.',
  invStations:
    'Número de estaciones de inversor. Multiplica la longitud de conduit DC \u2192 más conduit y ' +
    'mano de obra.',
  rowPitch:
    'Pitch entre filas (m). Con override de filas/columnas, largo del arreglo = filas × pitch. ' +
    'Afecta geometría y longitudes de cable.',
  walkwayFactor:
    'Factor de pasillos. Infla el área bruta del arreglo (aisles) \u2192 afecta partidas por área.',
  dcSpareFactor:
    'Factor de reserva DC. Multiplica el cable DC total + tierra (holgura/desperdicio). ' +
    '\u2191 \u2192 más metros facturados.',
  acSpareFactor:
    'Factor de reserva AC. Multiplica las longitudes de cable AC (holgura). \u2191 \u2192 más metros AC.',
  feederExtraM:
    'Metros extra de feeder (manual). Se suman a la longitud del feeder principal para ajustes.',
  stationCorridorM:
    'Corredor de la estación (m). Adder a cada home-run DC. Parte del modelo de distancias \u2192 cable DC.',

  // 05 LAYOUT OVERRIDE -------------------------------------------------------
  layoutRows:
    'Override de filas. Si filas, columnas y pitch > 0, las dimensiones del arreglo se toman directo ' +
    '(en vez del aspect ratio). Geometría \u2192 longitudes de cable.',
  layoutCols:
    'Override de columnas. Junto con Filas (override) fija las dimensiones del arreglo.',

  // 06 BOM CONFIG ------------------------------------------------------------
  supplyTransformer:
    'Suministro del transformador. 0 = lo provee el cliente (no se costea); 1 = lo provee Argia ' +
    '(se incluye en el BOM). Enciende/apaga una línea de costo grande.',

  // 07 HELIOSCOPE ------------------------------------------------------------
  helioscopeMonthly:
    'Tabla mensual (12 meses × 6 cols) de producción/POA. Forma la producción usada para los ahorros CFE.',
  annualKwh:
    'Producción anual (kWh). Base de los ahorros y del headline de producción.',

  // 08 EQUIPO — PANELES ------------------------------------------------------
  panelModel:
    'Modelo del panel primario. Busca su fila eléctrica (Voc/Isc/Vmp/dimensiones); de aquí depende todo ' +
    'el cálculo DC. Debe existir exactamente en 11M_PRODUCTS_PANELS.',
  panelQty:
    'Cantidad de paneles primarios. Driver de tamaño: kWp DC, área, BOM de módulos, mano de obra y ' +
    'producción/ahorros.',
  panelPowerW:
    'Potencia unitaria del panel (Wp). kWp DC = qty × Wp / 1000. Driver de tamaño del sistema.',
  panelsSecondary:
    'Paneles secundarios (hasta 4 modelos). Se suman al banco y a los totales en sistemas multi-modelo.',

  // 09 EQUIPO — INVERSORES ---------------------------------------------------
  inverterPrimaryModel:
    'Modelo del inversor primario. Busca su fila (ventana MPPT, entradas DC, topología); de aquí ' +
    'dependen los chequeos AC/MPPT. Debe existir en 12M_PRODUCTS_INVERTERS.',
  inverterPrimaryQty:
    'Cantidad de inversores primarios. kW AC total \u2192 relación DC/AC y corriente del feeder.',
  inverterPrimaryKw:
    'Potencia unitaria del inversor (kW). kW AC total \u2192 relación DC/AC y dimensionamiento AC.',
  inverterPrimaryStrings:
    'Strings asignados al inversor primario. Alimenta el chequeo de entradas DC (STR-02). Debe ser ' +
    'consistente con Total strings y Strings totales (chequeo STR-RC).',
  invertersSecondary:
    'Inversores secundarios (hasta 4 modelos). Se suman al banco y a los totales.',
  totalInverters:
    'Total de inversores (totalizado). Resumen del banco de inversores.',
  totalStrings:
    'Total de strings (totalizado, fila 63). Debe coincidir con la suma de strings por inversor ' +
    '(chequeo de consistencia STR-RC).',

  // 10 STRING CONFIG ---------------------------------------------------------
  stringsTotal:
    'Strings totales del sistema. Driver de cantidades DC del BOM (metros de cable DC, pares MC4, OCPD). ' +
    'Debe reconciliar con la suma del banco de inversores (STR-RC).',
  parallelStrings:
    'Strings en paralelo. Dimensiona la corriente del home-run DC (I_diseño × paralelos) y el número de ' +
    'conductores. Si difiere de Strings totales hay riesgo de dimensionar mal el conductor.',
  modsPerString:
    'Módulos por string. Define el voltaje del string: \u2191 módulos \u2192 \u2191 Voc_cold y Vmp. Debe ' +
    'caer dentro de la ventana del inversor (STR-01/DC-01/DC-02). En topología OPTIMIZER no aplica el ' +
    'límite estándar.',
  optimizers:
    'Bandera heredada. La topología de optimizador ahora se toma del inversor (INV_TOPOLOGY), no de este ' +
    'campo \u2014 actualmente NO afecta el cálculo.',
  optimizerModsPerUnit:
    'Módulos por optimizador (decisión por proyecto, no la capacidad del catálogo). Default 1 = un ' +
    'optimizador por módulo. Controla la cantidad en el BOM: optimizadores = ceil(módulos / este valor). ' +
    'Ej.: Huawei MERC sirve 2 módulos \u2192 poner 2 (504 en vez de 1008). No cambia diseños existentes ' +
    'mientras quede en 1.'
};

/**
 * Apply the impact notes to INPUT_DESIGN. Pure-ish: only side effect is setNote.
 * Returns { applied, skipped:[{key,reason}] } for logging / the menu summary.
 */
function applyInputDesignDescriptions(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH.INPUT_DESIGN);
  if (!sh) throw new Error('Sheet not found: ' + SH.INPUT_DESIGN);

  var applied = 0;
  var skipped = [];
  Object.keys(INPUT_DESIGN_IMPACT).forEach(function(key) {
    var def = INPUT_MAP[key];
    if (!def) { skipped.push({ key: key, reason: 'not in INPUT_MAP' }); return; }
    if (def.sheet !== SH.INPUT_DESIGN) { skipped.push({ key: key, reason: 'not on INPUT_DESIGN' }); return; }
    if (!(def.row > 0) || !(def.col > 0)) { skipped.push({ key: key, reason: 'no row/col' }); return; }
    sh.getRange(def.row, def.col).setNote(INPUT_DESIGN_IMPACT[key]);
    applied++;
  });

  if (typeof engineLog === 'function') {
    engineLog(ss, 'InputDescriptions', 'INFO',
      'Applied ' + applied + ' INPUT_DESIGN impact notes; skipped ' + skipped.length + '.');
  }
  return { applied: applied, skipped: skipped };
}

/**
 * Menu wrapper. Add to the ARGIA Setup submenu (00_Main):
 *   .addItem('Describe INPUT_DESIGN fields', 'runApplyInputDesignDescriptions')
 */
function runApplyInputDesignDescriptions() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  try {
    var r = applyInputDesignDescriptions(ss);
    var msg = 'Se agregaron ' + r.applied + ' notas de impacto a INPUT_DESIGN.';
    if (r.skipped.length) {
      msg += '\n\nOmitidos (' + r.skipped.length + '): ' +
        r.skipped.map(function(s) { return s.key + ' (' + s.reason + ')'; }).join(', ');
    }
    ui.alert('Descripciones INPUT_DESIGN', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}
