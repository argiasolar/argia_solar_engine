// =============================================================================
// ARGIA -- 27a_SetupInputBessResilience.js
// -----------------------------------------------------------------------------
// CHUNK 7 Session 2 -- idempotent setup for the INPUT_BESS "7. RESILIENCIA /
// RESPALDO" section (the RESILIENCE_MAX inputs).
//
// Mirrors setupInputProjectPvSection / setupInputBaasSheet: SAFE to run
// repeatedly, fills BLANK value cells only, never overwrites a designer
// value, applies the value-source dropdown. The cell rows MUST match the
// input-map entries (bessCriticalLoadKw C42 ... bessEventValueSource C46);
// SetupInputBessResilienceTests asserts the alignment.
// =============================================================================

var INPUT_BESS_RESILIENCE_ROWS = {
  SECTION_HEADER:   57,   // "7. RESILIENCIA / RESPALDO" (rows 42-53 are the
                          // pre-existing DISTANCIAS section; 55 is Notas; the
                          // first truly-empty zone starts at 56)
  CRITICAL_LOAD_KW: 58,   // C58
  BACKUP_HOURS:     59,   // C59
  EVENTS_PER_YEAR:  60,   // C60
  EVENT_COST_MXN:   61,   // C61
  EVENT_SOURCE:     62    // C62
};

function setupInputBessResilienceSection(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('INPUT_BESS');
  if (!sh) throw new Error('setupInputBessResilienceSection: INPUT_BESS not found');

  var R = INPUT_BESS_RESILIENCE_ROWS;
  var created = [], skipped = [];

  // Section header (col B).
  if (!String(sh.getRange(R.SECTION_HEADER, 2).getValue() || '').trim()) {
    sh.getRange(R.SECTION_HEADER, 2).setValue('7. RESILIENCIA / RESPALDO')
      .setFontWeight('bold');
    sh.getRange(R.SECTION_HEADER, 3).setValue(
      'Respaldo ante apagones, sags, brownouts. Valor SEPARADO del ahorro CFE.');
    created.push('header');
  } else {
    skipped.push('header');
  }

  // [row, label, default, dropdownOrNull]
  var rows = [
    [R.CRITICAL_LOAD_KW, 'Carga crítica (kW)',         0, null],
    [R.BACKUP_HOURS,     'Duración de respaldo (h)',   0, null],
    [R.EVENTS_PER_YEAR,  'Eventos por año',            0, null],
    [R.EVENT_COST_MXN,   'Costo por evento (MXN)',     0, null],
    [R.EVENT_SOURCE,     'Fuente del valor',          '',
      ['', 'CUSTOMER_ESTIMATE', 'VALIDATED_ESTIMATE', 'AUDITED_ESTIMATE']]
  ];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i][0], label = rows[i][1], dflt = rows[i][2], dd = rows[i][3];
    sh.getRange(row, 2).setValue(label);   // label always (cosmetic)

    var valueCell = sh.getRange(row, 3);   // col C
    var current = valueCell.getValue();
    var isBlank = (current === '' || current === null || current === undefined);
    if (isBlank) {
      valueCell.setValue(dflt);
      created.push(label);
    } else {
      skipped.push(label);
    }
    if (dd && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.newDataValidation) {
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(dd, true).setAllowInvalid(false).build();
      valueCell.setDataValidation(rule);
    }
  }

  // Disclaimer note under the section (cosmetic, always set).
  sh.getRange(R.EVENT_SOURCE + 1, 2, 1, 4).merge().setValue(
    'NOTA: el valor de respaldo NO es ahorro en recibo CFE; se muestra por '
    + 'separado y solo se calcula si se indica una fuente de valor. '
    + 'Reservar capacidad para respaldo reduce el ahorro de peak-shaving.')
    .setFontStyle('italic').setFontSize(9).setWrap(true)
    .setBackground('#FFF3E0').setFontColor('#995700');

  SpreadsheetApp.flush && SpreadsheetApp.flush();
  return { created: created, skipped: skipped };
}

function runSetupInputBessResilienceSection() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  try {
    var ret = setupInputBessResilienceSection(ss);
    ui.alert('Resilience section setup',
      'INPUT_BESS "7. RESILIENCIA / RESPALDO" ready.\n\n'
      + 'Created (were blank): ' + (ret.created.join(', ') || '(none)') + '\n'
      + 'Skipped (already set): ' + (ret.skipped.join(', ') || '(none)') + '\n\n'
      + 'All fields default to 0/blank, so projects that ignore this section '
      + 'are unaffected. The backup value is shown SEPARATELY from CFE '
      + 'savings and requires a value source.',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Resilience section setup error', e.message, ui.ButtonSet.OK);
  }
}
