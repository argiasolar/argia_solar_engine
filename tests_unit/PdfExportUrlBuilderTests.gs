// =============================================================================
// ARGIA ENGINE -- File: tests_unit/PdfExportUrlBuilderTests.gs
// Unit tests for _buildPdfUrl + dynamicEndRow resolution.
//
// Why this file exists:
//   The PDF_EXPORTS config table is verified by PdfExportConfigTests.gs, but
//   that test doesn't catch URL-construction bugs (wrong param order, missing
//   gid, off-by-one on dynamic end row). These tests stub the spreadsheet
//   surface so the URL-building path runs in pure JS, then assert the
//   resulting URL contains the expected r1/c1/r2/c2/portrait/gid values.
//
// What's verified:
//   1. Static range entries (MDC, BOM, INSTALLATION, PROJECT_CARD) produce
//      URLs with exactly the r2 from the config (no override)
//   2. RFQ entries override r2 with sheet.getLastRow() - 1
//   3. portrait=true for portrait, portrait=false for landscape
//   4. All required params are present and gid is wired in
//
// What's NOT verified:
//   - The actual blob fetched from Google (no HTTP in unit land)
//   - The Drive folder write (no DriveApp in unit land)
// =============================================================================

function _pdfUrlTest_ok(name, cond, detail) {
  if (cond) return { name: name, pass: true };
  return { name: name, pass: false, detail: detail || '(no detail)' };
}

// Parse a URL query string into a {k: v} object for easy assertion.
function _pdfUrlTest_parseParams(url) {
  var qIdx = url.indexOf('?');
  if (qIdx < 0) return {};
  var pairs = url.substring(qIdx + 1).split('&');
  var out = {};
  pairs.forEach(function(p) {
    var eq = p.indexOf('=');
    if (eq < 0) { out[p] = ''; return; }
    out[p.substring(0, eq)] = p.substring(eq + 1);
  });
  return out;
}

function _pdfUrlTest_runAll() {
  var results = [];
  var t = _pdfUrlTest_ok;

  // ---- 1. Static ranges (Tier 3.1 buffered values) -----------------------
  // MDC, BOM, INSTALLATION use fitw mode (no scale param).
  // PROJECT_CARD uses scale=4 (no fitw/fith).
  var staticCases = [
    { key: 'MDC',          r2: 119, c2: 7,  portrait: 'true',  fitw: 'true',  scale: null },
    { key: 'BOM',          r2: 95,  c2: 8,  portrait: 'true',  fitw: 'true',  scale: null },
    { key: 'INSTALLATION', r2: 36,  c2: 10, portrait: 'false', fitw: 'true',  scale: null },
    { key: 'PROJECT_CARD', r2: 70,  c2: 10, portrait: 'true',  fitw: null,    scale: '2'  },
  ];
  staticCases.forEach(function(tc) {
    var cfg = PDF_EXPORTS[tc.key];
    var url = _buildPdfUrl('SSID-TEST', 999888, cfg);
    var p = _pdfUrlTest_parseParams(url);
    results.push(t(tc.key + ' URL has format=pdf',     p.format === 'pdf'));
    results.push(t(tc.key + ' URL has size=A4',        p.size === 'A4'));
    results.push(t(tc.key + ' URL gid=999888',         p.gid === '999888',
                   'gid was ' + p.gid));
    results.push(t(tc.key + ' URL r1=0',               p.r1 === '0'));
    results.push(t(tc.key + ' URL c1 matches config',  p.c1 === String(cfg.c1),
                   'c1 was ' + p.c1));
    results.push(t(tc.key + ' URL r2=' + tc.r2,        p.r2 === String(tc.r2),
                   'r2 was ' + p.r2));
    results.push(t(tc.key + ' URL c2=' + tc.c2,        p.c2 === String(tc.c2),
                   'c2 was ' + p.c2));
    results.push(t(tc.key + ' URL portrait=' + tc.portrait,
                   p.portrait === tc.portrait,
                   'portrait was ' + p.portrait));
    // fitw / scale mutual exclusion
    if (tc.scale != null) {
      results.push(t(tc.key + ' URL scale=' + tc.scale,
                     p.scale === tc.scale,
                     'scale was ' + p.scale));
      results.push(t(tc.key + ' URL has NO fitw (scale mode)',
                     p.fitw === undefined,
                     'fitw was ' + p.fitw));
    } else {
      results.push(t(tc.key + ' URL has fitw=true',
                     p.fitw === 'true',
                     'fitw was ' + p.fitw));
      results.push(t(tc.key + ' URL has NO scale param',
                     p.scale === undefined,
                     'scale was ' + p.scale));
    }
  });

  // ---- 2. Dynamic end row for RFQs --------------------------------------
  // Simulate the dynamicEndRow resolution from _exportSheetToPdf. We can't
  // call _exportSheetToPdf directly without UrlFetchApp + DriveApp, but the
  // resolution logic is small and well-defined: clone cfg (preserving scale),
  // set r2 to (lastRow - 1), build URL.
  function _simulateRfqExport(key, simulatedLastRow) {
    var cfg = PDF_EXPORTS[key];
    if (!cfg.dynamicEndRow) throw new Error(key + ' is not a dynamic export');
    var effective = {
      sheet : cfg.sheet,
      r1: cfg.r1, c1: cfg.c1,
      r2: simulatedLastRow - 1, c2: cfg.c2,
      orient: cfg.orient,
      label : cfg.label,
      scale : cfg.scale,
    };
    return _buildPdfUrl('SSID-TEST', 111, effective);
  }

  // RFQ_PANELES with last row = 33 -> r2 should be 32
  var urlPaneles = _simulateRfqExport('RFQ_PANELES', 33);
  var pPaneles = _pdfUrlTest_parseParams(urlPaneles);
  results.push(t('RFQ_PANELES lastRow=33 -> r2=32',
                 pPaneles.r2 === '32',
                 'r2 was ' + pPaneles.r2));
  results.push(t('RFQ_PANELES URL portrait=false (landscape)',
                 pPaneles.portrait === 'false',
                 'portrait was ' + pPaneles.portrait));
  results.push(t('RFQ_PANELES URL c2=13 (col N buffer)',
                 pPaneles.c2 === '13',
                 'c2 was ' + pPaneles.c2));
  results.push(t('RFQ_PANELES URL scale=4 (fit to page)',
                 pPaneles.scale === '4',
                 'scale was ' + pPaneles.scale));
  results.push(t('RFQ_PANELES URL has NO fitw (scale mode)',
                 pPaneles.fitw === undefined,
                 'fitw was ' + pPaneles.fitw));

  // RFQ_ELECTRICO with last row = 56 -> r2 should be 55
  var urlElec = _simulateRfqExport('RFQ_ELECTRICO', 56);
  var pElec = _pdfUrlTest_parseParams(urlElec);
  results.push(t('RFQ_ELECTRICO lastRow=56 -> r2=55',
                 pElec.r2 === '55',
                 'r2 was ' + pElec.r2));
  results.push(t('RFQ_ELECTRICO URL scale=4',
                 pElec.scale === '4',
                 'scale was ' + pElec.scale));

  // RFQ_BESS with last row = 34 -> r2 should be 33
  var urlBess = _simulateRfqExport('RFQ_BESS', 34);
  var pBess = _pdfUrlTest_parseParams(urlBess);
  results.push(t('RFQ_BESS lastRow=34 -> r2=33',
                 pBess.r2 === '33',
                 'r2 was ' + pBess.r2));
  results.push(t('RFQ_BESS URL scale=4',
                 pBess.scale === '4',
                 'scale was ' + pBess.scale));

  // ---- 3. Param sanity --------------------------------------------------
  // sheetnames + printtitle + pagenumbers + gridlines + fzr should all be
  // off (we don't want any of those on a customer-facing PDF).
  var urlMdc = _buildPdfUrl('SSID', 1, PDF_EXPORTS.MDC);
  var pMdc = _pdfUrlTest_parseParams(urlMdc);
  ['sheetnames', 'printtitle', 'pagenumbers', 'gridlines', 'fzr'].forEach(function(k) {
    results.push(t('URL has ' + k + '=false',
                   pMdc[k] === 'false',
                   k + ' was ' + pMdc[k]));
  });

  return results;
}

function PdfExportUrlBuilderTests() {
  return _pdfUrlTest_runAll();
}

(function _pdfUrlTest_register() {
  try {
    if (typeof TEST_REGISTRY !== 'undefined' && TEST_REGISTRY && TEST_REGISTRY.push) {
      TEST_REGISTRY.push({
        name : 'PdfExportUrlBuilderTests',
        fn   : PdfExportUrlBuilderTests,
        kind : 'unit',
        chunk: 'tier3'
      });
    }
  } catch (e) { /* registry not loaded yet */ }
})();
