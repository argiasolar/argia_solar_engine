// =============================================================================
// ARGIA ENGINE -- File: tests_unit/PdfExportConfigTests.gs
// Unit tests for 12_ExportPDF.js: PDF_EXPORTS config table.
//
// Why this file exists:
//   The PDF_EXPORTS table is small but easy to corrupt -- swapping a row
//   index, dropping the _v2 suffix, or pasting the wrong column count would
//   silently produce wrong PDFs that look almost-right. These tests pin the
//   verified Tier 3 values so a future regression is loud, not silent.
//
// What's verified:
//   1. All required config keys exist (no typos, no dropped entries)
//   2. Every sheet name has the _v2 suffix (Tier 3 invariant)
//   3. Range bounds match the verified workbook layout (rows + cols)
//   4. Orientation is set correctly per category
//   5. RFQ entries use dynamicEndRow; non-RFQ entries do not
//   6. PDF_EXPORTS_RFQ_KEYS lists exactly the 6 RFQ keys, in the right order
//   7. _safeFileName() strips illegal characters without breaking on edges
//
// What's NOT verified here:
//   - The actual PDF export round-trip (no UrlFetchApp in unit test land)
//   - Folder resolution (depends on 00_MASTER_LINK content)
//   - The "exportAll" / "exportAllRfqs" orchestration (integration concern)
//   See tests_integration/ for those.
//
// Triggered by: runUnitTests, runCurrentChunkTests (if Tier 3 is active chunk)
// =============================================================================

function _pdfExpTest_ok(name, cond, detail) {
  if (cond) return { name: name, pass: true };
  return { name: name, pass: false, detail: detail || '(no detail)' };
}

function _pdfExpTest_runAll() {
  var results = [];
  var t = _pdfExpTest_ok;

  // ---- 1. Required keys exist --------------------------------------------
  var required = [
    'MDC', 'BOM', 'INSTALLATION', 'PROJECT_CARD',
    'RFQ_PANELES', 'RFQ_INVERSORES', 'RFQ_ESTRUCTURA',
    'RFQ_ELECTRICO', 'RFQ_MONITOREO', 'RFQ_BESS'
  ];
  required.forEach(function(k) {
    results.push(t('PDF_EXPORTS has key ' + k,
                   PDF_EXPORTS[k] != null,
                   'PDF_EXPORTS[' + k + '] is missing'));
  });

  // ---- 2. _v2 sheet suffix on every entry --------------------------------
  Object.keys(PDF_EXPORTS).forEach(function(k) {
    var s = PDF_EXPORTS[k].sheet;
    results.push(t('PDF_EXPORTS[' + k + '].sheet ends with _v2',
                   /_v2$/.test(s),
                   'sheet name was ' + s));
  });

  // ---- 3. Verified ranges (Tier 3.1 buffered values, 2026-05-27) --------
  // Buffer cells past actual content prevent Google's PDF-export trim bug
  // (trailing row/col occasionally dropped near page boundaries). The
  // buffer cells are blank so the visible deliverable is unchanged.
  var expected = {
    MDC          : { r1: 0,  c1: 1, r2: 119, c2: 7,  orient: 'portrait'  },
    BOM          : { r1: 0,  c1: 0, r2: 95,  c2: 8,  orient: 'portrait'  },
    INSTALLATION : { r1: 0,  c1: 0, r2: 36,  c2: 10, orient: 'landscape' },
    PROJECT_CARD : { r1: 0,  c1: 0, r2: 70,  c2: 10, orient: 'portrait'  },
  };
  Object.keys(expected).forEach(function(k) {
    var got = PDF_EXPORTS[k];
    var exp = expected[k];
    var fields = ['r1', 'c1', 'r2', 'c2', 'orient'];
    fields.forEach(function(f) {
      results.push(t(k + '.' + f + ' = ' + exp[f],
                     got[f] === exp[f],
                     'got ' + got[f] + ', expected ' + exp[f]));
    });
  });

  // ---- 4. RFQ entries all use dynamicEndRow + scale=4 -------------------
  PDF_EXPORTS_RFQ_KEYS.forEach(function(k) {
    var cfg = PDF_EXPORTS[k];
    results.push(t(k + ' uses dynamicEndRow',
                   cfg.dynamicEndRow === true,
                   'dynamicEndRow was ' + cfg.dynamicEndRow));
    results.push(t(k + '.c2 = 13 (col N buffer past M)',
                   cfg.c2 === 13,
                   'c2 was ' + cfg.c2));
    results.push(t(k + '.orient = landscape',
                   cfg.orient === 'landscape',
                   'orient was ' + cfg.orient));
    results.push(t(k + '.scale = 4 (fit to page)',
                   cfg.scale === 4,
                   'scale was ' + cfg.scale));
  });

  // ---- 5. Non-RFQ entries: MDC/BOM/INSTALLATION use fitw mode (no scale);
  //                          PROJECT_CARD uses scale=2 (fit to width) -----
  ['MDC', 'BOM', 'INSTALLATION'].forEach(function(k) {
    var cfg = PDF_EXPORTS[k];
    results.push(t(k + ' does not use dynamicEndRow',
                   !cfg.dynamicEndRow,
                   'dynamicEndRow was ' + cfg.dynamicEndRow));
    results.push(t(k + ' does not set scale (uses fitw)',
                   cfg.scale == null,
                   'scale was ' + cfg.scale));
  });
  results.push(t('PROJECT_CARD does not use dynamicEndRow',
                 !PDF_EXPORTS.PROJECT_CARD.dynamicEndRow,
                 'dynamicEndRow was ' + PDF_EXPORTS.PROJECT_CARD.dynamicEndRow));
  results.push(t('PROJECT_CARD.scale = 2 (fit to width)',
                 PDF_EXPORTS.PROJECT_CARD.scale === 2,
                 'scale was ' + PDF_EXPORTS.PROJECT_CARD.scale));

  // ---- 6. PDF_EXPORTS_RFQ_KEYS order -------------------------------------
  var expectedKeys = ['RFQ_PANELES', 'RFQ_INVERSORES', 'RFQ_ESTRUCTURA',
                      'RFQ_ELECTRICO', 'RFQ_MONITOREO', 'RFQ_BESS'];
  results.push(t('PDF_EXPORTS_RFQ_KEYS length = 6',
                 PDF_EXPORTS_RFQ_KEYS.length === 6,
                 'length was ' + PDF_EXPORTS_RFQ_KEYS.length));
  for (var i = 0; i < expectedKeys.length; i++) {
    results.push(t('PDF_EXPORTS_RFQ_KEYS[' + i + '] = ' + expectedKeys[i],
                   PDF_EXPORTS_RFQ_KEYS[i] === expectedKeys[i],
                   'got ' + PDF_EXPORTS_RFQ_KEYS[i]));
  }

  // ---- 7. _safeFileName edge cases ---------------------------------------
  results.push(t('_safeFileName strips slashes',
                 _safeFileName('a/b\\c') === 'abc',
                 'got ' + _safeFileName('a/b\\c')));
  results.push(t('_safeFileName collapses spaces',
                 _safeFileName('hello  world') === 'hello_world',
                 'got ' + _safeFileName('hello  world')));
  results.push(t('_safeFileName caps at 40 chars',
                 _safeFileName('x'.repeat(80)).length === 40,
                 'len was ' + _safeFileName('x'.repeat(80)).length));
  results.push(t('_safeFileName trims trailing underscores',
                 _safeFileName('test ') === 'test',
                 'got ' + _safeFileName('test ')));
  results.push(t('_safeFileName handles empty string',
                 _safeFileName('') === '',
                 'got ' + _safeFileName('')));
  results.push(t('_safeFileName handles non-string',
                 _safeFileName(123) === '123',
                 'got ' + _safeFileName(123)));

  return results;
}

// ---------------------------------------------------------------------------
// Apps Script test registry hook -- follows the project's existing TEST_REGISTRY
// pattern (lazy init, named test function pushes its results to the shared
// accumulator).
//
// If the registry pattern in this repo doesn't quite match, the test runner
// also looks for any global function matching /Tests$/ that returns an array
// of {name, pass, detail}. This file exposes both.
// ---------------------------------------------------------------------------
function PdfExportConfigTests() {
  return _pdfExpTest_runAll();
}

// Optional: register with TEST_REGISTRY if it exists in this project. Safe
// to call multiple times -- registry is keyed by function name.
(function _pdfExpTest_register() {
  try {
    if (typeof TEST_REGISTRY !== 'undefined' && TEST_REGISTRY && TEST_REGISTRY.push) {
      TEST_REGISTRY.push({
        name : 'PdfExportConfigTests',
        fn   : PdfExportConfigTests,
        kind : 'unit',
        chunk: 'tier3'
      });
    }
  } catch (e) { /* registry not loaded yet -- runner will pick up by name */ }
})();
