// =============================================================================
// ARGIA ENGINE -- File: 02m_FinanceFinalize.gs
// Make FINANCE correct AND self-documenting in one idempotent pass, so new
// projects ship right by default and the team can explain/defend every number.
//
//   repairFinanceAll(ss):
//     1. repairFinanceSlideCfeSource  (4.29) -- CFE source repoint off the dead stub
//     2. repairFinanceModel           (4.30) -- CAPEX/prod/CO2 correctness
//     3. repairFinanceMarketMetrics   (4.31) -- discounted NPV / IRR / DSCR block
//     4. _finWriteProvenanceNotes            -- plain-language derivation notes on
//        every key FINANCE figure: hover the cell to read HOW it was calculated
//        and WHICH cells feed it. Internal transparency -- not shown to the
//        customer; meant so we are ready to explain and sell the numbers.
//
//   Notes are ASCII-safe Spanish, matching the engine's existing setNote style.
//   Idempotent throughout (each sub-repair is idempotent; setNote overwrites).
//
//   WIRED INTO startNewProjectCore so every new/reset project applies it.
//   Also exposed as a single menu item. (Tip: run once on the master template
//   so all future clones inherit corrected + documented FINANCE.)
// =============================================================================

// --- provenance notes for the FIXED FINANCE cells (stable template anchors) --
var _FIN_FIXED_NOTES = [
  ['C3',
   'CAPEX (precio de venta del sistema). = (materiales BOM_v2!G94 + instalacion ' +
   'INSTALLATION_v2!G9) / (1 - margen INPUT_PROJECT!D35). Incluye el margen ARGIA. ' +
   'Es la base de VPN, ROI y del capital del prestamo (I5).'],
  ['D16',
   'Tarifa CFE base [MXN/kWh] = recibo CFE sin PV (BESS_SIMULATION!D12) / consumo ' +
   'anual (SUM INPUT_CFE!C10:N12). El recibo base lo calcula el motor (calcCfeBill) ' +
   'sobre la tarifa GDMTH y el consumo mensual. Anios siguientes: x (1 + indexacion ' +
   'INPUT_PROJECT!D37).'],
  ['D17',
   'Pago anual a CFE sin sistema = recibo CFE base (BESS_SIMULATION!D12). Es lo que ' +
   'el cliente paga hoy a CFE; la referencia contra la que se mide el ahorro PPA.'],
  ['D19',
   'Tarifa ARGIA [MXN/kWh] = tarifa CFE (D16) x (1 - descuento PPA INPUT_PROJECT!D36). ' +
   'El descuento es el ahorro que ofrece ARGIA frente a CFE.'],
  ['D20',
   'Pago anual a ARGIA = produccion (D15) x tarifa ARGIA (D19). Es el ingreso del PPA ' +
   'para ARGIA y la base del flujo de caja (fila 30).'],
  ['C4',
   'VPN nominal (SIN descontar) = suma de pagos PPA (D30:X30) - CAPEX (C3). Metrica ' +
   'simple; para el VPN descontado, la TIR y el DSCR ver el bloque MARKET-STANDARD ' +
   'METRICS mas abajo.'],
  ['I5',
   'Capital del prestamo = CAPEX (C3) x % financiado (F8). Banco: F5. Moneda: F6.'],
  ['I7',
   'Pago mensual del prestamo = PMT(tasa F9/12, plazos I6, capital I5). La tasa de ' +
   'interes del credito esta en F9 (BanBajio).']
];

// --- provenance notes for the metrics block (located by its header) ----------
var _FIN_BLOCK_HEADER = 'MARKET-STANDARD METRICS (PPA -- unlevered project)';
// [rowOffsetFromHeader, col, note]  (col 3 = C)
var _FIN_BLOCK_NOTES = [
  [1, 3,
   'Tasa de descuento (WACC ARGIA) = INPUT_BAAS!D15. Fuente unica del costo de capital ' +
   'de ARGIA; independiente de la tasa del credito (F9). Tambien la usa el modelo BaaS.'],
  [4, 3,
   'VPN descontado = -CAPEX (C3) + valor presente de los pagos PPA (D30:X30) descontados ' +
   'a la WACC (INPUT_BAAS!D15). Base no apalancada (ingreso vs inversion). Debe ser menor ' +
   'que el VPN nominal (C4) por el valor del dinero en el tiempo.'],
  [5, 3,
   'TIR del proyecto = tasa que hace VPN = 0 sobre el flujo [-CAPEX, pagos Y0..Y20]. ' +
   'Comparar contra la TIR objetivo de ARGIA (INPUT_BAAS!D14).'],
  [6, 3,
   'Margen de TIR = TIR del proyecto - TIR objetivo (INPUT_BAAS!D14). Positivo = el ' +
   'proyecto supera el objetivo de ARGIA.'],
  [7, 3,
   'Servicio de deuda anual = pago mensual del prestamo (I7) x 12.'],
  [9, 3,
   'DSCR = ingreso PPA del anio / servicio de deuda anual, durante el plazo del prestamo ' +
   '(F7 anios). DSCR > 1 significa que el ingreso cubre la deuda. Min = el anio mas ' +
   'exigente (la restriccion que importa); Prom = el promedio del plazo.']
];

function repairFinanceAll(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName('FINANCE')) {
    return { ok: false, steps: [], lines: ['ABORT: FINANCE sheet not found.'] };
  }

  var steps = [];
  function step(name, fn) {
    try {
      var r = fn();
      steps.push({ name: name, ok: (r && r.ok !== false), detail: r });
    } catch (e) {
      steps.push({ name: name, ok: false, detail: { error: String(e && e.message || e) } });
    }
  }

  step('CFE source repoint', function () { return repairFinanceSlideCfeSource(ss); });
  step('model correctness',  function () { return repairFinanceModel(ss); });
  step('market metrics',     function () { return repairFinanceMarketMetrics(ss); });
  step('provenance notes',   function () {
    var n = _finWriteProvenanceNotes(ss);
    return { ok: true, count: n.count, blockFound: n.blockFound };
  });

  var lines = steps.map(function (s) { return '  ' + s.name + ': ' + (s.ok ? 'OK' : 'FAILED'); });
  var allOk = steps.every(function (s) { return s.ok; });
  return { ok: allOk, steps: steps, lines: lines };
}

// Write plain-language derivation notes on every key FINANCE figure. Idempotent
// (setNote overwrites). Returns { count, blockFound }.
function _finWriteProvenanceNotes(ss) {
  var sh = ss.getSheetByName('FINANCE');
  if (!sh) return { count: 0, blockFound: false };

  var count = 0;

  // fixed cells
  for (var i = 0; i < _FIN_FIXED_NOTES.length; i++) {
    var rc = _finA1ToRc(_FIN_FIXED_NOTES[i][0]);
    sh.getRange(rc.row, rc.col).setNote(_FIN_FIXED_NOTES[i][1]);
    count++;
  }

  // metrics block -- locate the header in column B
  var lastRow = sh.getLastRow();
  var H = -1;
  if (lastRow >= 1) {
    var colB = sh.getRange(1, 2, lastRow, 1).getValues();
    for (var r = 0; r < colB.length; r++) {
      if (String(colB[r][0]).trim() === _FIN_BLOCK_HEADER) { H = r + 1; break; }
    }
  }
  if (H !== -1) {
    for (var j = 0; j < _FIN_BLOCK_NOTES.length; j++) {
      sh.getRange(H + _FIN_BLOCK_NOTES[j][0], _FIN_BLOCK_NOTES[j][1]).setNote(_FIN_BLOCK_NOTES[j][2]);
      count++;
    }
  }

  return { count: count, blockFound: (H !== -1) };
}

// 'C3' -> {row:3,col:3}, 'I7' -> {row:7,col:9}. Single-letter columns only.
function _finA1ToRc(a1) {
  return { col: a1.charCodeAt(0) - 64, row: parseInt(a1.slice(1), 10) };
}

// Menu-callable entry point.
function runRepairFinanceAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rep = repairFinanceAll(ss);
  SpreadsheetApp.flush();
  var notes = null;
  for (var i = 0; i < (rep.steps || []).length; i++)
    if (rep.steps[i].name === 'provenance notes') notes = rep.steps[i].detail;
  var summary = 'Repair + document FINANCE:\n\n' + rep.lines.join('\n') +
    (notes ? ('\n\n' + notes.count + ' provenance notes written' +
              (notes.blockFound ? '' : ' (metrics block not found)') + '.') : '') +
    (rep.ok ? '' : '\n\n(some steps FAILED -- see above)');
  try {
    SpreadsheetApp.getUi().alert('Repair FINANCE (all + notes)', summary,
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (_) { /* headless */ }
  return summary;
}
