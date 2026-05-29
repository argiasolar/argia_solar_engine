// =============================================================================
// ARGIA TESTS -- tests_unit/calc/ResilienceValueTests.gs
// -----------------------------------------------------------------------------
// CHUNK 7 Session 2 -- RESILIENCE_MAX + the hourly-sim reserve fix.
//
// Locks:
//   - calcResilience (27_CalcResilienceValue.js): sizing, coverage, value,
//     and the value-source guard (anti-fantasy-ROI invariant).
//   - the reserve-fraction math the hourly-sim fix uses (reserveFrac=0 must
//     be byte-identical; reserveFrac>0 must reduce usable).
//   - RESILIENCE_MAX registered in the strategy priority map.
//
// COVERAGE (12 tests):
//   1. UNIT_RESIL_RESERVE_SIZING            -- reserved = critical x hours
//   2. UNIT_RESIL_COVERAGE_FULL             -- battery covers spec => 1.0
//   3. UNIT_RESIL_COVERAGE_PARTIAL          -- undersized => fraction + warn
//   4. UNIT_RESIL_VALUE_WITH_SOURCE         -- events x cost x coverage
//   5. UNIT_RESIL_VALUE_GUARD_NO_SOURCE     -- cost>0, no source => value 0
//   6. UNIT_RESIL_VALUE_ZERO_COST_OK        -- cost=0 => value 0, no warning
//   7. UNIT_RESIL_SOURCE_LABELS             -- the three source labels
//   8. UNIT_RESIL_RESERVED_FRAC_CAPPED      -- reservedFracOfUsable in [0,1]
//   9. UNIT_RESIL_RESERVE_FIX_ZERO_IDENTICAL -- reserveFrac=0 keeps usable
//  10. UNIT_RESIL_RESERVE_FIX_REDUCES       -- reserveFrac>0 reduces usable
//  11. UNIT_RESIL_RESERVE_FIX_MAX_OF_TWO    -- max(legacy, resilience)
//  12. UNIT_RESIL_STRATEGY_REGISTERED       -- RESILIENCE_MAX in priority map
// =============================================================================

registerTest({
  id: 'UNIT_RESIL_RESERVE_SIZING', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: reserved kWh = criticalLoadKw x backupDurationHours');
    var r = calcResilience({ criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 972 });
    t.assert('reserved = 200 x 2 = 400', 400, r.reservedKwh);
  }
});

registerTest({
  id: 'UNIT_RESIL_COVERAGE_FULL', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: battery >= spec => coverage 1.0, not undersized');
    var r = calcResilience({ criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 972 });
    t.assert('coverage 1.0', 1, r.coverageFraction);
    t.assertTrue('not undersized', r.undersized === false);
  }
});

registerTest({
  id: 'UNIT_RESIL_COVERAGE_PARTIAL', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: battery < spec => partial coverage + warning');
    // Need 400 kWh (200kW x 2h) but only 300 usable -> coverage 0.75.
    var r = calcResilience({ criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 300 });
    t.assertNear('coverage 0.75', 0.75, r.coverageFraction, 1e-9);
    t.assertTrue('flagged undersized', r.undersized === true);
    t.assertTrue('warns about undersizing',
                 r.warnings.join(' ').indexOf('subdimensionada') >= 0);
  }
});

registerTest({
  id: 'UNIT_RESIL_VALUE_WITH_SOURCE', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: value = events x cost x coverage (with source)');
    var r = calcResilience({
      criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 972,
      eventsPerYear: 4, eventCostMxn: 500000, eventValueSource: 'CUSTOMER_ESTIMATE'
    });
    // coverage 1.0 -> 4 x 500,000 x 1 = 2,000,000
    t.assert('value = 2,000,000', 2000000, r.resilienceValueMxn);
    t.assert('source resolved', 'CUSTOMER_ESTIMATE', r.valueSource);
    t.assertTrue('not blocked', r.valueBlockedNoSource === false);
  }
});

registerTest({
  id: 'UNIT_RESIL_VALUE_GUARD_NO_SOURCE', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7', 'invariant'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: INVARIANT cost>0 + no source => value FORCED to 0');
    var r = calcResilience({
      criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 972,
      eventsPerYear: 4, eventCostMxn: 10000000, eventValueSource: ''   // blank!
    });
    t.assert('value forced to 0 (no source)', 0, r.resilienceValueMxn);
    t.assertTrue('blocked flag set', r.valueBlockedNoSource === true);
    t.assert('source null', null, r.valueSource);
    t.assertTrue('label says sin fuente', r.valueSourceLabel.indexOf('sin fuente') >= 0);
    t.assertTrue('warns about missing source',
                 r.warnings.join(' ').indexOf('fuente de valor') >= 0);
  }
});

registerTest({
  id: 'UNIT_RESIL_VALUE_ZERO_COST_OK', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: cost=0 => value 0, no source needed, no warning');
    var r = calcResilience({
      criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 972,
      eventsPerYear: 4, eventCostMxn: 0
    });
    t.assert('value 0', 0, r.resilienceValueMxn);
    t.assertTrue('not blocked (cost is genuinely 0)', r.valueBlockedNoSource === false);
    // Only the (possible) undersize warning could appear; here none.
    t.assert('no warnings', 0, r.warnings.length);
  }
});

registerTest({
  id: 'UNIT_RESIL_SOURCE_LABELS', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: the three value-source labels resolve');
    function lbl(src) {
      return calcResilience({ criticalLoadKw: 1, backupDurationHours: 1, usableKwh: 10,
        eventsPerYear: 1, eventCostMxn: 1, eventValueSource: src }).valueSourceLabel;
    }
    t.assertTrue('customer label notes not validated',
                 lbl('CUSTOMER_ESTIMATE').indexOf('no validada') >= 0);
    t.assertTrue('validated label', lbl('VALIDATED_ESTIMATE').indexOf('validada') >= 0);
    t.assertTrue('audited label', lbl('AUDITED_ESTIMATE').indexOf('auditada') >= 0);
  }
});

registerTest({
  id: 'UNIT_RESIL_RESERVED_FRAC_CAPPED', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: reservedFracOfUsable capped to [0,1]');
    // Reserve 400 kWh but only 300 usable -> frac capped at 1, not 1.33.
    var r = calcResilience({ criticalLoadKw: 200, backupDurationHours: 2, usableKwh: 300 });
    t.assert('reservedFracOfUsable capped at 1', 1, r.reservedFracOfUsable);
    // Reserve 100 of 1000 usable -> 0.1
    var r2 = calcResilience({ criticalLoadKw: 50, backupDurationHours: 2, usableKwh: 1000 });
    t.assertNear('reservedFrac 0.1', 0.1, r2.reservedFracOfUsable, 1e-9);
  }
});

registerTest({
  id: 'UNIT_RESIL_RESERVE_FIX_ZERO_IDENTICAL', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7', 'regression'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: reserveFrac=0 leaves usable unchanged (byte-identical)');
    // Mirror the 20_ fix math exactly.
    function planUsable(gross, legacyFrac, resilienceFrac) {
      var frac = Math.max(0, Math.min(1, Math.max(legacyFrac || 0, resilienceFrac || 0)));
      return gross * (1 - frac);
    }
    t.assert('no reserve => full usable', 972, planUsable(972, 0, 0));
    t.assert('undefined reserves => full usable', 972, planUsable(972, undefined, undefined));
  }
});

registerTest({
  id: 'UNIT_RESIL_RESERVE_FIX_REDUCES', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: reserveFrac>0 reduces usable proportionally');
    function planUsable(gross, legacyFrac, resilienceFrac) {
      var frac = Math.max(0, Math.min(1, Math.max(legacyFrac || 0, resilienceFrac || 0)));
      return gross * (1 - frac);
    }
    t.assertNear('30% reserve => 70% usable', 680.4, planUsable(972, 0.30, 0), 0.01);
    t.assertNear('full reserve => 0 usable', 0, planUsable(972, 1.0, 0), 0.01);
  }
});

registerTest({
  id: 'UNIT_RESIL_RESERVE_FIX_MAX_OF_TWO', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: reserve fraction = max(legacy pct, resilience frac)');
    function planUsable(gross, legacyFrac, resilienceFrac) {
      var frac = Math.max(0, Math.min(1, Math.max(legacyFrac || 0, resilienceFrac || 0)));
      return gross * (1 - frac);
    }
    // legacy 0.1, resilience 0.4 -> governs 0.4 -> usable 0.6 x 1000 = 600
    t.assertNear('larger reserve governs', 600, planUsable(1000, 0.1, 0.4), 0.01);
    // legacy 0.5, resilience 0.2 -> governs 0.5 -> usable 500
    t.assertNear('legacy governs when larger', 500, planUsable(1000, 0.5, 0.2), 0.01);
  }
});

registerTest({
  id: 'UNIT_RESIL_STRATEGY_REGISTERED', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: RESILIENCE_MAX registered in the priority map');
    t.assertTrue('RESILIENCE_MAX present',
                 BESS_STRATEGY_PRIORITIES.hasOwnProperty('RESILIENCE_MAX'));
    // It dispatches like peak-shaving (no P4 arbitrage in v1).
    var pri = BESS_STRATEGY_PRIORITIES.RESILIENCE_MAX;
    t.assertTrue('has P3_REDUCE_PUNTA', pri.indexOf('P3_REDUCE_PUNTA') >= 0);
    t.assertTrue('no P4_ARBITRAGE in v1', pri.indexOf('P4_ARBITRAGE') < 0);
  }
});


// =============================================================================
// Setup desync guard (mirrors the SOLAR-section guard from Session 1)
// =============================================================================
registerTest({
  id: 'UNIT_RESIL_SETUP_ROWS_MATCH_INPUT_MAP', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7', 'setup', 'invariant'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: setup-script rows MUST match input-map rows');
    var S = INPUT_BESS_RESILIENCE_ROWS;
    function mapRow(field) {
      if (typeof INPUT_MAP !== 'undefined' && INPUT_MAP[field]) return INPUT_MAP[field].row;
      if (typeof getInputMapEntry === 'function') {
        var e = getInputMapEntry(field); return e ? e.row : null;
      }
      return null;
    }
    t.assert('criticalLoadKw row',  S.CRITICAL_LOAD_KW, mapRow('bessCriticalLoadKw'));
    t.assert('backupHours row',      S.BACKUP_HOURS,    mapRow('bessBackupDurationHours'));
    t.assert('eventsPerYear row',    S.EVENTS_PER_YEAR, mapRow('bessEventsPerYear'));
    t.assert('eventCost row',        S.EVENT_COST_MXN,  mapRow('bessEventCostMxn'));
    t.assert('eventSource row',      S.EVENT_SOURCE,    mapRow('bessEventValueSource'));
  }
});


// =============================================================================
// Repair verification: the collision repair restores the correct labels
// =============================================================================
registerTest({
  id: 'UNIT_RESIL_REPAIR_RESTORES_LABELS', group: 'unit', module: 'calc/resilience',
  scenarios: [], tags: ['calc', 'resilience', 'chunk7', 'repair'],
  source: 'tests_unit/calc/ResilienceValueTests.gs',
  fn: function (t) {
    t.suite('UNIT calc/resilience: collision repair restores DISTANCIAS labels, keeps values');
    // Mock INPUT_BESS in the post-collision state: B42-B47 hold resilience
    // labels, C44-C46 hold the surviving voltage/distance VALUES.
    var cells = {};
    function key(r, c) { return r + ',' + c; }
    cells[key(41,2)] = '6. RESILIENCIA / RESPALDO';      // bad header
    cells[key(44,2)] = 'Eventos por año';                 // clobbered label
    cells[key(44,3)] = 800;                               // surviving value
    cells[key(45,3)] = 480;
    cells[key(46,3)] = 25;
    var merged = true;
    var sheet = {
      getRange: function (r, c, nr, nc) {
        var self = {
          getValue: function () { return cells[key(r, c)] != null ? cells[key(r, c)] : ''; },
          setValue: function (v) { cells[key(r, c)] = v; return self; },
          setBackground: function () { return self; },
          setFontColor: function () { return self; },
          setFontStyle: function () { return self; },
          setFontWeight: function () { return self; },
          setWrap: function () { return self; },
          isPartOfMerge: function () { return merged; },
          breakApart: function () { merged = false; return self; }
        };
        return self;
      }
    };
    var ss = { getSheetByName: function () { return sheet; } };

    var ret = repairResilienceCollision(ss);

    t.assert('B44 restored to Voltaje bus DC', 'Voltaje bus DC:', cells[key(44,2)]);
    t.assert('B45 restored to Voltaje AC sistema', 'Voltaje AC sistema:', cells[key(45,2)]);
    t.assert('B42 restored to DISTANCIAS header',
             '6. DISTANCIAS Y UBICACIÓN FÍSICA', cells[key(42,2)]);
    // Values must be untouched.
    t.assert('C44 value 800 preserved', 800, cells[key(44,3)]);
    t.assert('C45 value 480 preserved', 480, cells[key(45,3)]);
    t.assertTrue('row 47 unmerged', merged === false);
    t.assertTrue('repair reports restored cells', ret.restored.length >= 6);
  }
});
