// =============================================================================
// ARGIA ENGINE -- File: 99a_MoreTests.gs
// Phase B test suites (added 2026-04-28).
//
// What's in here:
//   testValidationRules(t, ss)          -- Tier 1.5: 22+ rule firings
//   testProjectCardSmoke(t, ss, ...)    -- Tier 3.7: readPcInputs_ + writer
//   testRfqSmoke(t, ss, ...)            -- Tier 3.8: 5 RFQ sheets
//   testInstallCostLineItems(t, ss, items)  -- Tier 3.5b: per-item lock
//   testBomLineItems(t, ss)             -- Tier 3.6b: per-row qty lock
//
// All five are wired into runTests() / testEndToEnd() in 99_TestRunner.gs
// behind `typeof X === 'function'` guards. Pasting this file is the only
// step needed to activate them.
//
// Phase B does NOT touch existing Tier 1, 2, 3, 3.5, or 3.6 assertions.
// Adds ~75 assertions on top of the existing 142.
// =============================================================================


// ─────────────────────────────────────────────────────────────────────────────
// TIER 1.5 -- VALIDATION RULES
//
// Builds synthetic inp/panel/invBank objects, runs runValidation, asserts
// that the right rule code shows up in result.criticals / .majors / .warnings.
//
// Pattern: each test mutates one or two fields of a baseline object and
// confirms the targeted rule fires. We don't assert that *only* that rule
// fires (some mutations cascade -- e.g. high panelQty triggers DC-10 AND
// STR-00). The point is to catch regressions where a rule stops firing
// when it should.
//
// Note: runValidation calls engineLog() for every rule fire, so this suite
// adds ~150 lines to the LOGS sheet. Live with it -- Apps Script trims old
// log rows automatically when LOGS gets long.
// ─────────────────────────────────────────────────────────────────────────────
function testValidationRules(t, ss) {
  t.suite('Tier 1.5 -- validation rules');

  // ---- Baseline fixtures ---------------------------------------------------
  // Mirror TESTPROJ-001 enough that runValidation runs cleanly. NOT meant
  // to be the same as buildTestInputs() in 99_TestRunner.gs -- this fixture
  // is shaped for the validator's needs (helio array, inverterBank, etc.)
  // rather than the calc functions'.

  function _baseInp() {
    var helio = [];
    for (var i = 0; i < 12; i++) helio.push({ grid: 1000 + i * 50 });
    return {
      projectName: 'TESTPROJ-001',
      clientName:  'TEST CUSTOMER',
      panelModel:  'LR5-72HTH 585M',
      panelQty:    720,
      modsPerString: 18,
      stringsTotal:  40,
      parallelStrings: 1,
      minTemp: -1, maxTemp: 38, avgTemp: 25,
      dcVdropLimit: 0.015, acVdropLimit: 0.020,
      powerFactor: 0.90,
      helio: helio,
      inverterBank: [],   // filled in by run-time mutator from invBank
    };
  }

  function _basePanel() {
    return {
      'PANEL_VOC_V': 52.36, 'PANEL_VMP_V': 44.21,
      'PANEL_ISC_A': 14.27, 'PANEL_TEMP_PMAX': -0.0029,
      'PANEL_POWER_W': 585
    };
  }

  function _baseInvBank() {
    return [{
      model: 'SUN2000-100KTL-M2',
      qty: 4, stringsAssigned: 40,
      acKw: 100, voltage: 480,
      maxDcV: 1100, mpptVmin: 200, mpptVmax: 1000,
      totalDcInputs: 20,
      topology: 'STRING', mdcReady: 'VALID'
    }];
  }

  // Real NOM constants from the active workbook. Hard limits like dcAcHard
  // come from here -- using the live values means our tests stay aligned
  // with whatever NOM_DB says, instead of hardcoding numbers that drift.
  var nom;
  try { nom = loadNomConstants(ss); }
  catch (e) { t.error('Tier 1.5 setup', e); return; }

  // ---- Helper: run validation and assert rule firings ---------------------
  function check(label, mutator, expect) {
    var inp = _baseInp();
    var panel = _basePanel();
    var invBank = _baseInvBank();
    inp.inverterBank = invBank;   // validator iterates this
    if (mutator) mutator({ inp: inp, panel: panel, invBank: invBank, nom: nom });

    var r;
    try { r = runValidation(ss, inp, panel, invBank, nom); }
    catch (e) { t.error('VAL [' + label + '] threw', e); return; }

    function has(arr, code) {
      return arr.some(function(x) { return x.rule === code; });
    }

    (expect.criticals || []).forEach(function(code) {
      t.assertTrue('VAL [' + label + '] CRIT ' + code, has(r.criticals, code));
    });
    (expect.majors || []).forEach(function(code) {
      t.assertTrue('VAL [' + label + '] MAJOR ' + code, has(r.majors, code));
    });
    (expect.warnings || []).forEach(function(code) {
      t.assertTrue('VAL [' + label + '] WARN ' + code, has(r.warnings, code));
    });
  }

  // ---- GROUP 1: input completeness ---------------------------------------
  check('empty projectName',
    function(o) { o.inp.projectName = ''; },
    { majors: ['INP-01'] });

  check('empty clientName',
    function(o) { o.inp.clientName = ''; },
    { majors: ['INP-02'] });

  check('empty panelModel',
    function(o) { o.inp.panelModel = ''; },
    { criticals: ['INP-03'] });

  check('panelQty zero',
    function(o) { o.inp.panelQty = 0; },
    { criticals: ['INP-04'] });

  check('modsPerString zero',
    function(o) { o.inp.modsPerString = 0; },
    { criticals: ['INP-05'] });

  check('no inverters',
    function(o) { o.inp.inverterBank = []; o.invBank.length = 0; },
    { criticals: ['INP-06'] });

  check('both temps zero (likely unentered)',
    function(o) { o.inp.minTemp = 0; o.inp.maxTemp = 0; },
    { majors: ['INP-07'] });

  check('min temp >= max temp',
    function(o) { o.inp.minTemp = 50; o.inp.maxTemp = 38; },
    { criticals: ['INP-08'] });

  // ---- GROUP 2: panel data completeness ----------------------------------
  check('panel Voc zero',
    function(o) { o.panel['PANEL_VOC_V'] = 0; },
    { criticals: ['PNL-01'] });

  check('panel Vmp zero',
    function(o) { o.panel['PANEL_VMP_V'] = 0; },
    { criticals: ['PNL-02'] });

  check('panel Isc zero',
    function(o) { o.panel['PANEL_ISC_A'] = 0; },
    { criticals: ['PNL-03'] });

  check('panel temp coeff positive (sign error)',
    function(o) { o.panel['PANEL_TEMP_PMAX'] = 0.001; },
    { majors: ['PNL-04'] });

  check('panel power zero',
    function(o) { o.panel['PANEL_POWER_W'] = 0; },
    { criticals: ['PNL-05'] });

  // ---- GROUP 3: inverter data completeness -------------------------------
  check('inverter maxDcV zero',
    function(o) { o.invBank[0].maxDcV = 0; },
    { criticals: ['INV-01'] });

  check('inverter mpptVmin zero',
    function(o) { o.invBank[0].mpptVmin = 0; },
    { criticals: ['INV-02'] });

  check('inverter mpptVmin >= mpptVmax',
    function(o) { o.invBank[0].mpptVmin = 1100; o.invBank[0].mpptVmax = 1000; },
    { criticals: ['INV-03'] });

  check('inverter qty zero',
    function(o) { o.invBank[0].qty = 0; },
    { criticals: ['INV-06'] });

  check('strings assigned > available DC inputs',
    function(o) { o.invBank[0].stringsAssigned = 200; },  // 200 > 20 inputs * 4 inv = 80
    { criticals: ['STR-02'] });

  check('inverter optimizer topology fires warning',
    function(o) { o.invBank[0].topology = 'OPTIMIZER'; },
    { warnings: ['INV-08'] });

  // ---- GROUP 4: voltage range pre-check ----------------------------------
  // At minTemp=-1, vocPerMod = 56.31. maxDcV=1100. 56.31 * 22 = 1238.8 > 1100
  // so DC-01 fires when modsPerString=22.
  check('DC-01: too many mods/string (Voc cold > Vmax)',
    function(o) { o.inp.modsPerString = 22; },
    { criticals: ['DC-01'] });

  // ---- GROUP 5: DC/AC ratio ----------------------------------------------
  // panelQty 2500 * 585W = 1462.5 kWp / 400 kWac = 3.66 -- way above any
  // sane dcAcHard. Will also cascade to STR-00 (mods derived from strings
  // doesn't match) -- we only assert DC-10.
  check('DC-10: ratio exceeds hard max',
    function(o) { o.inp.panelQty = 2500; },
    { criticals: ['DC-10'] });

  // ---- GROUP 6: string count consistency ---------------------------------
  // stringsTotal=50 but only 40 assigned to the inverter -> STR-00 major.
  check('STR-00: stringsTotal != sum of assigned',
    function(o) { o.inp.stringsTotal = 50; },
    { majors: ['STR-00'] });

  // ---- GROUP 7: helioscope production ------------------------------------
  check('HEL-01: helio incomplete (< 12 months)',
    function(o) { o.inp.helio = [{ grid: 100 }]; },
    { majors: ['HEL-01'] });

  // ---- GROUP 8: design limits --------------------------------------------
  // 0.10 = 10% DC vdrop is well above any sane NOM hard cap (typically 0.02-0.03).
  check('LIM-01: dcVdropLimit > NOM hard',
    function(o) { o.inp.dcVdropLimit = 0.10; },
    { criticals: ['LIM-01'] });

  // 0.20 = 20% AC vdrop similarly.
  check('LIM-02: acVdropLimit > NOM hard',
    function(o) { o.inp.acVdropLimit = 0.20; },
    { criticals: ['LIM-02'] });

  check('LIM-03: powerFactor out of range',
    function(o) { o.inp.powerFactor = 0.5; },
    { majors: ['LIM-03'] });
}


// ─────────────────────────────────────────────────────────────────────────────
// TIER 3.7 -- PROJECT CARD writer
//
// Verifies the Phase A rewrite of readPcInputs_() reads INPUT_PROJECT cells
// correctly via INPUT_MAP, and that writeProjectCard renders the expected
// header / business case rows.
//
// Runs after writeMDC + writeBOM + runInstallCost have populated their
// sheets, so PC's downstream readBomSubtotals_/readInstallTotal_ have data.
// ─────────────────────────────────────────────────────────────────────────────
function testProjectCardSmoke(t, ss, inp, panel, invBank, dc) {
  t.suite('Tier 3.7 -- project card');

  // ---- 1. readPcInputs_ shape and fixture-derived values ------------------
  var pcInp;
  try { pcInp = readPcInputs_(ss); }
  catch (e) { t.error('readPcInputs_ threw', e); return; }

  // Fields the fixture explicitly writes (deterministic):
  t.assert('PC.projectNumber',  'ARG-TEST-001', pcInp.projectNumber);
  t.assert('PC.marginPct',      0.15,           pcInp.marginPct,    0.001);
  t.assert('PC.paymentDays',    14,             pcInp.paymentDays);

  // Field the fixture does NOT write (sellingPriceUsdPerWp). readPcInputs_'s
  // n() helper coerces blank to 0. This locks the new default-handling logic.
  t.assert('PC.sellingPriceWpUsd defaults to 0',
    0, pcInp.sellingPriceWpUsd);

  // Validation envelope: 9 categories, each a {min, max} pair.
  t.assertTrue('PC.validation has TOTAL',
    pcInp.validation && !!pcInp.validation['TOTAL']);
  t.assertTrue('PC.validation Solar panels min > 0',
    pcInp.validation['Solar panels'] && pcInp.validation['Solar panels'].min > 0);
  t.assertTrue('PC.validation Solar panels max > min',
    pcInp.validation['Solar panels'].max > pcInp.validation['Solar panels'].min);

  // ---- 2. writeProjectCard runs -------------------------------------------
  try {
    writeProjectCard(ss, inp, panel, invBank, dc);
    SpreadsheetApp.flush();
  } catch (e) {
    t.error('writeProjectCard threw', e);
    return;
  }

  // ---- 3. PROJECT_CARD sheet content --------------------------------------
  var pc = ss.getSheetByName('PROJECT_CARD');
  if (!pc) {
    t.fail('PROJECT_CARD sheet not found', 'after writeProjectCard');
    return;
  }

  // B1 = title bar. D1 = projectNumber. Rows 4/5 = customer/project name.
  // (BUSINESS CASE header at row 3, then Customer/Project name/Location at 4/5/6.)
  t.assert('PC sheet B1 title',
    'PROJECT CARD', String(pc.getRange(1, 2).getValue()));
  t.assert('PC sheet D1 projectNumber',
    'ARG-TEST-001', String(pc.getRange(1, 4).getValue()));
  t.assert('PC sheet C4 clientName',
    'TEST CUSTOMER S.A. de C.V.', String(pc.getRange(4, 3).getValue()));
  t.assert('PC sheet C5 projectName',
    'TESTPROJ-001', String(pc.getRange(5, 3).getValue()));
}


// ─────────────────────────────────────────────────────────────────────────────
// TIER 3.8 -- RFQ writer
//
// Calls writeRfqSheet_() directly for each of the 5 categories, mirroring
// what runWriteAllRFQs() does internally. Bypasses the UI dialog wrapper
// so the test stays headless. Verifies each sheet exists, has reasonable
// row count, and has at least the expected number of items pulled from BOM.
//
// Depends on testBomDiagnostic having populated the BOM sheet earlier in
// the same testEndToEnd run.
// ─────────────────────────────────────────────────────────────────────────────
function testRfqSmoke(t, ss, inp, panel, invBank) {
  t.suite('Tier 3.8 -- RFQs');

  if (!ss.getSheetByName(SH.BOM)) {
    t.fail('Tier 3.8 skipped', 'BOM sheet not present');
    return;
  }

  // RFQ writer expects inp.projectManager populated. Mirror runWriteAllRFQs's
  // chain. If readPcInputs_ fails here for any reason, fall through to the
  // designer/bizManager fields, then a hardcoded last-resort.
  try {
    var pcIn = readPcInputs_(ss);
    inp.projectManager = pcIn.projectManager || inp.designer || inp.bizManager || 'TEST PM';
  } catch (e) {
    inp.projectManager = inp.designer || inp.bizManager || 'TEST PM';
  }

  // 5 categories. Match the row ranges and codes from runWriteAllRFQs.
  // expectMin = lower bound on number of items pulled for this category from
  // TESTPROJ-001 BOM. Loose -- anything <= the actual count works.
  var cases = [
    {
      sheet: RFQ_SHEETS.PANELES,    title: 'Paneles Solares',     code: 'PAN',
      start: BOM_ROW.PANEL_PRIMARY, end: BOM_ROW.SUBTOTAL_PANELS - 1,
      ccy: 'USD', expectMinItems: 1
    },
    {
      sheet: RFQ_SHEETS.INVERSORES, title: 'Inversores',          code: 'INV',
      start: BOM_ROW.INVERTER_PRIMARY, end: BOM_ROW.SUBTOTAL_INVERTERS - 1,
      ccy: 'USD', expectMinItems: 1
    },
    {
      sheet: RFQ_SHEETS.ESTRUCTURA, title: 'Estructura',          code: 'STR',
      start: BOM_ROW.STRUCTURE_PRIMARY, end: BOM_ROW.STRUCTURE_INVERTER,
      ccy: 'MXN', expectMinItems: 1
    },
    {
      // ELECTRICO is special -- it's DC + AC concatenated.
      sheet: RFQ_SHEETS.ELECTRICO,  title: 'Electrico BOS',       code: 'ELEC',
      ccy: 'MXN', expectMinItems: 5,
      special: 'elec'
    },
    {
      sheet: RFQ_SHEETS.MONITOREO,  title: 'Monitoreo',           code: 'MON',
      start: BOM_ROW.MON_DATALOGGER, end: BOM_ROW.MON_THERMOGRAPHY,
      ccy: 'MXN', expectMinItems: 1
    },
  ];

  cases.forEach(function(c) {
    var items;
    if (c.special === 'elec') {
      var dcItems = readBomItems_(ss, BOM_ROW.DC_CABLE,  BOM_ROW.SUBTOTAL_DC - 1);
      var acItems = readBomItems_(ss, BOM_ROW.AC_FEEDER, BOM_ROW.SUBTOTAL_TRANSFORMER - 1);
      items = dcItems.concat(acItems);
    } else {
      items = readBomItems_(ss, c.start, c.end);
    }

    t.assertTrue('RFQ ' + c.sheet + ' BOM items >= ' + c.expectMinItems,
      items.length >= c.expectMinItems);

    try {
      // Empty cert/notes objects -- cosmetic in the RFQ output, irrelevant
      // to whether the sheet got written. We're testing the writer mechanics,
      // not the cert text.
      writeRfqSheet_(ss, c.sheet, inp, c.title, c.code, items, {}, '', c.ccy);
    } catch (e) {
      t.error('writeRfqSheet_ ' + c.sheet, e);
      return;
    }

    var rfq = ss.getSheetByName(c.sheet);
    t.assertTrue('RFQ ' + c.sheet + ' sheet exists', rfq !== null);
    if (!rfq) return;

    // Each RFQ has metadata block (~5 rows) + headers + items + supplier
    // response section (~10 rows) + footer. Sane minimum is around 15.
    t.assertTrue('RFQ ' + c.sheet + ' has > 15 rows of content',
      rfq.getLastRow() > 15);

    // Title bar at row 1 should mention the category.
    var titleCell = String(rfq.getRange(1, 1).getValue() || '');
    t.assertTrue('RFQ ' + c.sheet + ' title contains "REQUEST FOR QUOTATION"',
      titleCell.indexOf('REQUEST FOR QUOTATION') !== -1);
  });

  SpreadsheetApp.flush();
}


// ─────────────────────────────────────────────────────────────────────────────
// TIER 3.5b -- INSTALL COST line items
//
// Locks the totals of 6 representative line items as a regression check.
// These items each represent a different cost type (productivity-driven
// labor, day-derived labor, indirect %, equipment) and a different section.
// If any of them drifts, the failing assertion tells you EXACTLY which
// dimension of the install cost calc moved.
//
// Baseline values captured 2026-04-28 from the green test run.
// ─────────────────────────────────────────────────────────────────────────────
function testInstallCostLineItems(t, ss, items) {
  t.suite('Tier 3.5b -- install cost line items');

  function findItem(id) {
    return items.filter(function(r) {
      return r && r.item && r.item.id === id;
    })[0];
  }

  // Each lock pins a TOTAL_MXN for one line item. Tolerance 0.50 MXN
  // matches the section assertions.
  var locks = [
    { id: 'AC-01', total:  2346.69, label: 'AC cable productivity' },
    { id: 'DC-01', total:  8424.00, label: 'DC modules productivity' },
    { id: 'DC-03', total:  4545.21, label: 'DC cable productivity' },
    { id: 'RK-01', total: 10516.72, label: 'Racking modules' },
    { id: 'SF-02', total: 23760.00, label: 'Safety days (Patch 3 derived)' },
    { id: 'IN-02', total: 15380.74, label: 'Indirect % of subtotal' },
  ];

  locks.forEach(function(L) {
    var item = findItem(L.id);
    if (!item) {
      t.fail('LineItem ' + L.id, 'not found in result.items (item filtered out or lib changed)');
      return;
    }
    t.assert('LineItem ' + L.id + ' (' + L.label + ') TOTAL',
      L.total, item.totalMxn || 0, 0.50);
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// TIER 3.6b -- BOM cell qtys
//
// Locks specific BOM-sheet QTY cells (column C) for the main line items.
// Complements the existing Tier 3.6 lay.bom.* assertions: if calcLayout
// math is right but the writer puts numbers in the wrong row, those tier 3.6
// tests pass and the BOM is still wrong. These tests catch that.
//
// Baseline values captured 2026-04-28 from the green test run.
// ─────────────────────────────────────────────────────────────────────────────
function testBomLineItems(t, ss) {
  t.suite('Tier 3.6b -- BOM cell qtys');

  var sh = ss.getSheetByName(SH.BOM);
  if (!sh) {
    t.fail('Tier 3.6b skipped', 'BOM sheet not found');
    return;
  }

  // Row -> expected qty in column C (BOM_COL.QTY).
  var locks = [
    { row: BOM_ROW.PANEL_PRIMARY,    qty: 720,  label: 'panels qty' },
    { row: BOM_ROW.INVERTER_PRIMARY, qty: 4,    label: 'inverter qty' },
    { row: BOM_ROW.STRUCTURE_PRIMARY, qty: 720, label: 'panel structure qty' },
    { row: BOM_ROW.DC_CABLE,         qty: 6720, label: 'DC cable m' },
    { row: BOM_ROW.DC_GROUNDING,     qty: 2500, label: 'DC grounding m' },
    { row: BOM_ROW.DC_MC4,           qty: 40,   label: 'DC MC4 pairs' },
    { row: BOM_ROW.DC_OCPD,          qty: 40,   label: 'DC OCPD' },
    { row: BOM_ROW.AC_FEEDER,        qty: 234,  label: 'AC feeder cable m' },
    { row: BOM_ROW.AC_EGC,           qty: 78,   label: 'AC main EGC m' },
    { row: BOM_ROW.AC_BREAKER,       qty: 1,    label: 'AC main breaker' },
  ];

  locks.forEach(function(L) {
    var got = sh.getRange(L.row, BOM_COL.QTY).getValue();
    var gotNum = parseFloat(got);
    if (isNaN(gotNum)) {
      t.fail('BOM row ' + L.row + ' qty (' + L.label + ')',
        'cell is non-numeric: ' + JSON.stringify(got));
      return;
    }
    t.assert('BOM row ' + L.row + ' qty (' + L.label + ')', L.qty, gotNum);
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Tier 1.6 — resolveStructure() unit tests (synthetic DB)
// ─────────────────────────────────────────────────────────────────────────────
// Pure-function tests of the structure resolver. No live workbook needed —
// builds a synthetic DB inline so we can exercise edge cases (collisions,
// legacy free-text, malformed dropdown text) deterministically.
//
// Why this lives in 99a, not 99: it depends on 08_WriteBOM.gs being loaded
// (resolveStructure() is defined there). 99a runs after 99 so this is fine.
// ─────────────────────────────────────────────────────────────────────────────
function testResolveStructure(t) {
  t.suite('Tier 1.6 -- resolveStructure unit');

  // Synthetic DB shaped like loadStructureDb output. STR_COL_ID/BRAND/MODEL/
  // PRICE indices match the live DB (0/1/2/12).
  function row(id, brand, model, priceUsd) {
    var r = new Array(20);
    for (var i = 0; i < 20; i++) r[i] = '';
    r[0]  = id;
    r[1]  = brand;
    r[2]  = model;
    r[12] = priceUsd;
    return { _raw: r };
  }
  var db = [
    row('STR_001', 'ALUMINEX',  'CARPORT ALU',     45),
    row('STR_008', 'S-5',       'STRUCTURE KR18',  18),
    row('STR_018', 'UNIRAC',    'COPLANAR',        12),
    row('STR_007', 'RALUX',     'RIEL COPLANAR',   16),
    // Synthetic collision: same model name across two brands.
    row('STR_099', 'BRAND_A',   'GENERIC RAIL',    20),
    row('STR_100', 'BRAND_B',   'GENERIC RAIL',    25),
  ];

  // ---- Path 1: canonical "BRAND — MODEL — STR_ID" ------------------------
  var r1 = resolveStructure(db, 'S-5 — STRUCTURE KR18 — STR_008');
  t.assert('canonical: strId',   'STR_008',         r1 ? r1.strId    : null);
  t.assert('canonical: brand',   'S-5',             r1 ? r1.brand    : null);
  t.assert('canonical: model',   'STRUCTURE KR18',  r1 ? r1.model    : null);
  t.assert('canonical: price',   18,                r1 ? r1.priceUsd : null);

  // STR_ID-tail wins even if the brand/model in the prefix is wrong.
  // Defensive: handles the case where a user manually edited C15 and the
  // model/brand text drifted but the trailing ID is still good.
  var r2 = resolveStructure(db, 'WRONG BRAND — WRONG MODEL — STR_001');
  t.assert('tail-wins: strId',    'STR_001',     r2 ? r2.strId : null);
  t.assert('tail-wins: brand',    'ALUMINEX',    r2 ? r2.brand : null);

  // ---- Path 2: brand+model 2-part split ----------------------------------
  var r3 = resolveStructure(db, 'UNIRAC — COPLANAR');
  t.assert('2-part: strId',       'STR_018',     r3 ? r3.strId : null);

  // Disambiguates collisions correctly via brand
  var r4a = resolveStructure(db, 'BRAND_A — GENERIC RAIL');
  var r4b = resolveStructure(db, 'BRAND_B — GENERIC RAIL');
  t.assert('collision A: strId',  'STR_099',     r4a ? r4a.strId : null);
  t.assert('collision B: strId',  'STR_100',     r4b ? r4b.strId : null);

  // ---- Path 3: legacy free-text (model only) -----------------------------
  // Preserves projects whose C15 has not been re-picked from the new dropdown.
  var r5 = resolveStructure(db, 'STRUCTURE KR18');
  t.assert('legacy: strId',       'STR_008',     r5 ? r5.strId : null);

  // Case insensitive
  var r6 = resolveStructure(db, 'structure kr18');
  t.assert('legacy lowercase',    'STR_008',     r6 ? r6.strId : null);

  // Legacy free-text with collision: returns first match in DB order. This is
  // the inherent limitation of model-only matching and the reason for the new
  // dropdown — the test pins behaviour so future refactors don't change it.
  var r7 = resolveStructure(db, 'GENERIC RAIL');
  t.assert('legacy collision (first match)', 'STR_099', r7 ? r7.strId : null);

  // ---- Failure cases ------------------------------------------------------
  t.assert('null input',          null,  resolveStructure(db, null));
  t.assert('empty string',        null,  resolveStructure(db, ''));
  t.assert('whitespace only',     null,  resolveStructure(db, '   '));
  t.assert('no match',            null,  resolveStructure(db, 'NONEXISTENT BRAND — FOO — STR_999'));
  t.assert('empty DB',            null,  resolveStructure([], 'S-5 — STRUCTURE KR18 — STR_008'));
}
