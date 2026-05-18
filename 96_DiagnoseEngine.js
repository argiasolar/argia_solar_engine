// =============================================================================
// ARGIA ENGINE v7 -- File: 96_DiagnoseEngine.gs
// Replicates the EXACT test-runner flow and dumps the inp{} object the
// engine sees — with emphasis on fields suspected of causing failures.
//
// RUN: diagnoseEngine()
// SAFE: backs up + restores INPUT sheets. No permanent change.
// =============================================================================

function diagnoseEngine() {
  var ss = SpreadsheetApp.getActive();
  var lines = [];
  lines.push('DIAGNOSTIC: engine view of inputs during test flow');
  lines.push('=' .repeat(100));

  try {
    // Step 1: backup (same as real test runner)
    backupInputs(ss);
    lines.push('[1] backup done');

    // Step 2: run the fixture writer (same as real test)
    var skipped = writeTestInputs(ss);
    lines.push('[2] writeTestInputs done, skipped.length = ' + skipped.length);
    if (skipped.length) {
      lines.push('    SKIPPED ITEMS:');
      skipped.forEach(function(s) { lines.push('      - ' + s); });
    }

    SpreadsheetApp.flush();

    // Step 3: what's in the cells RIGHT NOW?
    var sh = ss.getSheetByName('INPUT_DESIGN');
    lines.push('');
    lines.push('[3] cell snapshot after writeTestInputs:');
    var snapKeys = [
      ['minTemp',      41,  4, 'M7',  7, 13],
      ['maxTemp',      42,  4, 'M8',  8, 13],
      ['avgTemp',      43,  4, 'M10', 10, 13],
      ['distInverter', 60,  4, 'M21', 21, 13],
      ['distAcProt',   61,  4, 'M22', 22, 13],
      ['distGrid',     62,  4, 'M23', 23, 13],
      ['feederExtraM', 76,  4, 'M36', 36, 13],
      ['acSpareFactor',75,  4, 'M35', 35, 13],
      ['powerFactor',  54,  4, 'M14', 14, 13],
    ];
    snapKeys.forEach(function(s) {
      var newVal    = sh.getRange(s[1], s[2]).getValue();
      var legacyVal = sh.getRange(s[4], s[5]).getValue();
      lines.push('    ' + s[0].padEnd(16) + ' new=D' + s[1] + ':' + JSON.stringify(newVal).padEnd(10) +
                 ' legacy=' + s[3].padEnd(5) + ':' + JSON.stringify(legacyVal));
    });

    // Step 4: what does readInputs() return?
    lines.push('');
    lines.push('[4] readInputs() output — key fields:');
    var inp = readInputs(ss);
    var keyFields = ['minTemp','maxTemp','avgTemp','distInverter','distAcProt','distGrid',
                     'feederExtraM','acSpareFactor','powerFactor','tempCoeffOverride',
                     'dcVdropLimit','acVdropLimit','projectType','roofType','structure'];
    keyFields.forEach(function(k) {
      lines.push('    inp.' + k.padEnd(20) + ' = ' + JSON.stringify(inp[k]));
    });

    // Step 5: compute the two failing values directly
    lines.push('');
    lines.push('[5] derived values the tests check:');
    var panel = lookupPanel(ss, inp.panelModel);
    var tempCoeff = parseFloat(panel['PANEL_TEMP_PMAX']) || inp.tempCoeffOverride;
    var voc = parseFloat(panel['PANEL_VOC']) || 0;
    var vocColdPerMod = voc * (1 + tempCoeff * (inp.minTemp - 25));
    var vocColdString = vocColdPerMod * inp.modsPerString;
    lines.push('    panel Voc   = ' + voc);
    lines.push('    tempCoeff   = ' + tempCoeff + '  (from panel DB PANEL_TEMP_PMAX)');
    lines.push('    inp.minTemp = ' + inp.minTemp);
    lines.push('    vocColdPerMod = ' + voc + ' × (1 + ' + tempCoeff + ' × (' + inp.minTemp + ' - 25)) = ' + vocColdPerMod.toFixed(2));
    lines.push('    vocColdString = ' + vocColdPerMod.toFixed(2) + ' × ' + inp.modsPerString + ' = ' + vocColdString.toFixed(2));
    lines.push('    EXPECTED BASELINE: 1013.57');

    var feederLen = inp.distAcProt + inp.distGrid + inp.feederExtraM;
    var feederCableM = feederLen * 3 * inp.acSpareFactor;
    lines.push('');
    lines.push('    feederLen       = ' + inp.distAcProt + ' + ' + inp.distGrid + ' + ' + inp.feederExtraM + ' = ' + feederLen);
    lines.push('    feederCableM    = ' + feederLen + ' × 3 × ' + inp.acSpareFactor + ' = ' + feederCableM);
    lines.push('    EXPECTED BASELINE: 306');

  } catch (e) {
    lines.push('ERROR: ' + e.message);
    lines.push(e.stack || '(no stack)');
  } finally {
    try { restoreInputs(ss); lines.push('[6] restore done'); }
    catch (e) { lines.push('[6] restore FAILED: ' + e.message); }
  }

  var output = lines.join('\n');
  Logger.log(output);
  try { SpreadsheetApp.getUi().alert('Engine diagnostic', output, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { /* no UI */ }
}
