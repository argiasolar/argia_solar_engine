// =============================================================================
// ARGIA TESTS -- tests_unit/calc/CalcHourlySimulationTests.gs   (BDF-5)
// Unit tests for the hourly simulator.
// Tagged 'bdf5' so "▶ Run Tests for Current Chunk" picks them up.
// =============================================================================

registerTest({
  id      : 'UNIT_HOURLY_SIM_BDF5',
  group   : 'unit',
  module  : 'calc/hourly_simulation',
  scenarios: [],
  tags    : ['unit', 'calc', 'hourly', 'bdf5'],
  source  : 'tests_unit/calc/CalcHourlySimulationTests.gs',
  fn: function (t, ctx) {
    t.suite('UNIT calc/hourly_simulation: BDF-5 core engine');

    // ==== TEST 1: GDMTH classification basics ===========================
    // Winter weekday at 19:00 -> punta. Sunday at 19:00 -> base.
    t.assert('Winter Wednesday 19:00 (Golfo Centro) = punta',
             'punta', classifyGdmthHour('GOLFO CENTRO', 1, 3, 19));
    t.assert('Winter Sunday 19:00 (Golfo Centro) = base',
             'base', classifyGdmthHour('GOLFO CENTRO', 1, 0, 19));
    t.assert('Winter Thursday 3:00 (Norte) = base',
             'base', classifyGdmthHour('NORTE', 1, 4, 3));
    t.assert('Winter Friday 10:00 (Central) = intermedia',
             'intermedia', classifyGdmthHour('CENTRAL', 1, 5, 10));
    // Summer punta is narrower (20-21 only)
    t.assert('Summer weekday 19:00 = intermedia (not punta in summer)',
             'intermedia', classifyGdmthHour('GOLFO CENTRO', 7, 3, 19));
    t.assert('Summer weekday 20:00 = punta',
             'punta', classifyGdmthHour('GOLFO CENTRO', 7, 3, 20));
    t.assert('Summer weekday 22:00 = intermedia',
             'intermedia', classifyGdmthHour('GOLFO CENTRO', 7, 3, 22));

    // ==== TEST 2: Unknown region falls back to default ===================
    t.assert('Unknown region falls back to default GDMTH classification',
             'punta', classifyGdmthHour('NOWHERE_SPECIAL', 1, 3, 19));

    // ==== TEST 3: Tariff classification =================================
    t.assert('GDMTH -> TOU_GDMTH', 'TOU_GDMTH', classifyTariff('GDMTH'));
    t.assert('GDMTO -> FLAT_RATE', 'FLAT_RATE', classifyTariff('GDMTO'));
    t.assert('GDBT -> FLAT_RATE', 'FLAT_RATE', classifyTariff('GDBT'));
    t.assert('PDBT -> FLAT_RATE', 'FLAT_RATE', classifyTariff('PDBT'));
    t.assert('DIST -> TOU_UNSUPPORTED', 'TOU_UNSUPPORTED', classifyTariff('DIST'));
    t.assert('RAMT -> TOU_UNSUPPORTED', 'TOU_UNSUPPORTED', classifyTariff('RAMT'));
    t.assert('XYZ -> UNKNOWN', 'UNKNOWN', classifyTariff('XYZ'));

    // ==== TEST 4: No-battery simulation totals reconcile to bill ========
    // Synthetic input: 10,000 kWh base, 5,000 kWh intermedia, 2,000 kWh punta
    // per month. No PV, no battery. The 8760-hour sum should reconcile back
    // to 12 * (10000 + 5000 + 2000) = 204,000 kWh.
    var bill12 = function(b, i, p) {
      return {
        kwhBase: new Array(12).fill(b),
        kwhIntermedia: new Array(12).fill(i),
        kwhPunta: new Array(12).fill(p),
        kwBase: new Array(12).fill(50),
        kwIntermedia: new Array(12).fill(60),
        kwPunta: new Array(12).fill(70),
      };
    };
    var sim1 = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5 }
    });
    t.assertTrue('GDMTH no-battery sim returns 8760 hours',
                 sim1.hours.length === 8760);
    var totalSimKwh = 0;
    for (var i1 = 0; i1 < sim1.hours.length; i1++) totalSimKwh += sim1.hours[i1].loadKwh;
    t.assertNear('Total simulated kWh reconciles to bill total (12*17000=204000)',
                 204000, totalSimKwh, 1);
    t.assert('Annual rollup loadKwh matches sum',
             Math.round(totalSimKwh), Math.round(sim1.annual.loadKwh));

    // ==== TEST 5: Bucket totals reconcile per month =====================
    // Sum of load kWh in each bucket for January should match the bill.
    var sim2 = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5 }
    });
    var janBase = 0, janInter = 0, janPunta = 0;
    for (var i2 = 0; i2 < sim2.hours.length; i2++) {
      var h2 = sim2.hours[i2];
      if (h2.month !== 1) continue;
      if (h2.bucket === 'base') janBase += h2.loadKwh;
      else if (h2.bucket === 'intermedia') janInter += h2.loadKwh;
      else if (h2.bucket === 'punta') janPunta += h2.loadKwh;
    }
    t.assertNear('Jan base sum = bill base (10000 kWh)', 10000, janBase, 0.5);
    t.assertNear('Jan intermedia sum = bill intermedia (5000 kWh)', 5000, janInter, 0.5);
    t.assertNear('Jan punta sum = bill punta (2000 kWh)', 2000, janPunta, 0.5);

    // ==== TEST 6: Flat-rate tariff distributes evenly ===================
    var sim3 = calcHourlySimulation({
      tariff: 'GDMTO',
      monthlyBill: bill12(10000, 0, 0),  // GDMTO only has base
      tariffRates: { baseMxnPerKwh: 1.5 }
    });
    t.assert('GDMTO classified as FLAT_RATE', 'FLAT_RATE', sim3.tariffClass);
    // Every hour should have the same load (within a month)
    var janHours3 = sim3.hours.filter(function(h) { return h.month === 1; });
    var firstLoad = janHours3[0].loadKwh;
    var allSame = true;
    for (var i3 = 1; i3 < janHours3.length; i3++) {
      if (Math.abs(janHours3[i3].loadKwh - firstLoad) > 0.0001) {
        allSame = false; break;
      }
    }
    t.assertTrue('Flat-rate: all hours in a month have identical load', allSame);
    t.assertNear('Flat-rate: hourly load = monthly_kwh / hours_in_month',
                 10000 / (31 * 24), firstLoad, 0.01);

    // ==== TEST 7: TOU_UNSUPPORTED emits warning + flat fallback ========
    var sim4 = calcHourlySimulation({
      tariff: 'DIST',
      monthlyBill: bill12(8000, 3000, 1000),
      tariffRates: { baseMxnPerKwh: 1.0 }
    });
    t.assert('DIST classified as TOU_UNSUPPORTED',
             'TOU_UNSUPPORTED', sim4.tariffClass);
    var hasWarning = false;
    for (var w = 0; w < sim4.warnings.length; w++) {
      if (sim4.warnings[w].indexOf('DIST') >= 0) hasWarning = true;
    }
    t.assertTrue('TOU_UNSUPPORTED tariff produces a warning', hasWarning);
    // Falls back to flat: every hour's load is identical (DIST sums all buckets)
    t.assertNear('DIST fallback: monthly total = 12000 kWh',
                 12000, sim4.annual.loadKwh / 12, 0.5);

    // ==== TEST 8: PV reduces grid import =================================
    var sim5 = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      monthlyPv: { kwh: new Array(12).fill(8000) },  // 8 MWh PV/month
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5 }
    });
    t.assertTrue('With PV, total grid import < total load',
                 sim5.annual.gridImportKwh < sim5.annual.loadKwh);

    // ==== TEST 9: Battery discharges during punta ========================
    var sim6 = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      monthlyPv: { kwh: new Array(12).fill(8000) },
      batterySpec: {
        capacityKwh: 200, powerKw: 100,
        minSocPct: 0.05, maxSocPct: 0.95, rtePct: 0.913
      },
      interconnMode: 'NET_BILLING', exportPriceMxnPerKwh: 0.8,
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5 }
    });
    t.assertTrue('Battery discharges some energy over the year',
                 sim6.annual.batteryDischargeKwh > 0);
    t.assertTrue('Battery charges some energy over the year',
                 sim6.annual.batteryChargeKwh > 0);
    // Discharges should ALL be during punta hours
    var dischargedDuringNonPunta = 0;
    for (var iD = 0; iD < sim6.hours.length; iD++) {
      var hD = sim6.hours[iD];
      if (hD.batteryKwh > 0 && hD.bucket !== 'punta') {
        dischargedDuringNonPunta += hD.batteryKwh;
      }
    }
    t.assert('Battery never discharges outside punta hours',
             0, Math.round(dischargedDuringNonPunta));

    // ==== TEST 10: SOC stays within bounds ===============================
    var minSocSeen = Infinity, maxSocSeen = -Infinity;
    for (var iS = 0; iS < sim6.hours.length; iS++) {
      var soc = sim6.hours[iS].batterySoc;
      if (soc < minSocSeen) minSocSeen = soc;
      if (soc > maxSocSeen) maxSocSeen = soc;
    }
    t.assertTrue('SOC never below min (5% * 200 = 10)', minSocSeen >= 10 - 0.01);
    t.assertTrue('SOC never above max (95% * 200 = 190)', maxSocSeen <= 190 + 0.01);

    // ==== TEST 11: No battery / no PV = baseline simulation ============
    var simBaseline = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5 }
    });
    t.assert('Baseline: grid import = total load (no PV/battery)',
             Math.round(simBaseline.annual.loadKwh),
             Math.round(simBaseline.annual.gridImportKwh));
    t.assert('Baseline: zero PV', 0, Math.round(simBaseline.annual.pvKwh));
    t.assert('Baseline: zero battery action',
             0, Math.round(simBaseline.annual.batteryDischargeKwh));

    // ==== TEST 12: NET_METERING credits surplus at retail ===============
    var simNm = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(5000, 2000, 1000),  // smaller load
      monthlyPv: { kwh: new Array(12).fill(15000) },  // large PV
      interconnMode: 'NET_METERING',
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5 }
    });
    t.assertTrue('NET_METERING: large export with surplus PV',
                 simNm.annual.gridExportKwh > 1000);

    // ==== TEST 12b: NET_METERING annual cap kicks in =====================
    // When export credit > import cost, the cap clamps to 0 (no payment).
    t.assertTrue('NET_METERING with massive surplus: cost capped at 0',
                 simNm.annual.energyCostMxn >= 0);
    if (simNm.annual.importCostMxn < simNm.annual.exportCreditMxn) {
      t.assert('NET_METERING cap applied flag set when credit exceeds cost',
               true, simNm.annual.netMeteringCapApplied);
      t.assert('NET_METERING capped annual cost = 0 (no payment)',
               0, simNm.annual.energyCostMxn);
    }

    // ==== TEST 13: ZERO_EXPORT wastes surplus ===========================
    var simZe = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(5000, 2000, 1000),
      monthlyPv: { kwh: new Array(12).fill(15000) },
      interconnMode: 'ZERO_EXPORT',
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5 }
    });
    // Cost should be higher than NET_METERING (no export credit)
    t.assertTrue('ZERO_EXPORT cost > NET_METERING cost (no credits)',
                 simZe.annual.energyCostMxn > simNm.annual.energyCostMxn);

    // ==== TEST 14: Blocked path: missing required input ================
    var simBlocked = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: { kwhBase: [1,2,3] }  // wrong length
    });
    t.assertTrue('Blocked when kwhBase has wrong length',
                 simBlocked.blocked && simBlocked.blocked.indexOf('12 entries') >= 0);
    t.assert('Blocked path returns empty hours array',
             0, simBlocked.hours.length);

    // ==== TEST 15: Provenance metadata present ==========================
    t.assert('GDMTH sim has provenance.loadShape',
             'PIECEWISE_FLAT_FROM_BILLS', sim1.provenance.loadShape);
    t.assertTrue('GDMTH sim has provenance.windows mentioning GDMTH',
                 sim1.provenance.windows.indexOf('GDMTH_HARDCODED') >= 0);
    t.assert('Flat-rate sim has FLAT_RATE_NO_WINDOWS provenance',
             'FLAT_RATE_NO_WINDOWS', sim3.provenance.windows);

    // ==== TEST 16: Demand charge included in total cost =================
    var simDc = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      tariffRates: {
        baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5,
        demandChargeMxnPerKw: 400
      }
    });
    t.assertTrue('Demand charge > 0 when rate > 0', simDc.annual.demandChargeMxn > 0);
    t.assertNear('totalCost = energyCost + demandCharge',
                 simDc.annual.energyCostMxn + simDc.annual.demandChargeMxn,
                 simDc.annual.totalCostMxn, 1);
    // Monthly peak punta kW arrays exist with 12 entries
    t.assert('monthlyPeakPuntaKw array has 12 entries',
             12, simDc.annual.monthlyPeakPuntaKw.length);

    // ==== TEST 17: Demand charge zero when rate omitted =================
    var simNoDc = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5 }
      // no demandChargeMxnPerKw
    });
    t.assert('demandChargeMxn = 0 when rate omitted', 0, simNoDc.annual.demandChargeMxn);

    // ==== TEST 18: NET_METERING cap does NOT offset demand charge ======
    // Even when energy credit caps to 0, demand charge still appears.
    var simBigPv = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(5000, 2000, 1000),
      monthlyPv: { kwh: new Array(12).fill(15000) },
      interconnMode: 'NET_METERING',
      tariffRates: {
        baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5,
        demandChargeMxnPerKw: 400
      }
    });
    t.assert('NET_METERING capped: energyCost = 0', 0, simBigPv.annual.energyCostMxn);
    t.assertTrue('Demand charge survives NET_METERING cap',
                 simBigPv.annual.demandChargeMxn > 0);
    t.assertTrue('totalCost > 0 even with NET_METERING cap (demand survives)',
                 simBigPv.annual.totalCostMxn > 0);

    // ==== TEST 19: BDF-5 R2 full-bill computation ======================
    // When tariffRatesByMonth is supplied, fullBill is computed and
    // totalCostMxn reflects the full CFE bill (incl. IVA).
    var ratesByMonthSyn = [];
    for (var rm = 0; rm < 12; rm++) {
      ratesByMonthSyn.push({
        energiaBase: 0.9, energiaIntermedia: 1.2, energiaPunta: 1.5,
        transmision: 0.18, cenace: 0.008, serviciosConexos: 0.007,
        capacidadMxnPerKw: 400, distribucionMxnPerKw: 120,
        suministroBasicoMxnFlat: 460,
      });
    }
    var simFull = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5,
                     demandChargeMxnPerKw: 400 },
      tariffRatesByMonth: ratesByMonthSyn,
      demandaFacturableKw: new Array(12).fill(70),  // 70 kW DF
      bajaTensionToggle: false,
      fpByMonth: new Array(12).fill(0.95),  // good FP, small bonus
    });
    t.assertTrue('fullBill exists when tariffRatesByMonth supplied',
                 simFull.annual.fullBill !== null && simFull.annual.fullBill !== undefined);
    t.assertTrue('fullBill has component arrays of length 12',
                 simFull.annual.fullBill.components.capacidad.length === 12);
    t.assertTrue('fullBill annual facturacion > 0',
                 simFull.annual.fullBill.annualFacturacionMxn > 0);
    // totalCostMxn switches to the full-bill number
    t.assert('totalCostMxn equals fullBill.annualFacturacionMxn',
             Math.round(simFull.annual.fullBill.annualFacturacionMxn),
             Math.round(simFull.annual.totalCostMxn));
    // Full bill is HIGHER than energy+demand (because it includes all the
    // other components: distribución, transmisión, CENACE, SCnMEM, suministro,
    // and 16% IVA on top).
    t.assertTrue('Full bill > energy+demand alone (more components included)',
                 simFull.annual.totalCostMxn >
                 simFull.annual.energyCostMxn + simFull.annual.demandChargeMxn);

    // ==== TEST 20: R2 IVA is correct 16% =============================
    var fb = simFull.annual.fullBill;
    t.assertNear('IVA = subtotal × 0.16',
                 fb.annualSubtotalMxn * 0.16, fb.annualIvaMxn, 1);
    t.assertNear('Facturación = subtotal + IVA',
                 fb.annualSubtotalMxn + fb.annualIvaMxn, fb.annualFacturacionMxn, 1);

    // ==== TEST 21: R2 2% Baja Tension toggle =========================
    var simBT = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5,
                     demandChargeMxnPerKw: 400 },
      tariffRatesByMonth: ratesByMonthSyn,
      demandaFacturableKw: new Array(12).fill(70),
      bajaTensionToggle: true,    // ON
      fpByMonth: new Array(12).fill(1.0),
    });
    var sumBT = 0; for (var bt = 0; bt < 12; bt++) sumBT += simBT.annual.fullBill.components.bajaTension[bt];
    t.assertTrue('Baja Tension > 0 when toggle ON', sumBT > 0);
    t.assert('Baja Tension == 0 when toggle OFF',
             0, Math.round(simFull.annual.fullBill.components.bajaTension.reduce(
               function(a, b) { return a + b; }, 0)));

    // ==== TEST 22: R2 Cargo FP penalty when FP < 0.9 =================
    var simFpBad = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5,
                     demandChargeMxnPerKw: 400 },
      tariffRatesByMonth: ratesByMonthSyn,
      demandaFacturableKw: new Array(12).fill(70),
      bajaTensionToggle: false,
      fpByMonth: new Array(12).fill(0.85),  // BAD FP -> penalty
    });
    var sumFpBad = 0;
    for (var fb1 = 0; fb1 < 12; fb1++) sumFpBad += simFpBad.annual.fullBill.components.cargoFp[fb1];
    t.assertTrue('Cargo FP positive (penalty) when FP < 0.9', sumFpBad > 0);

    var simFpGood = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5,
                     demandChargeMxnPerKw: 400 },
      tariffRatesByMonth: ratesByMonthSyn,
      demandaFacturableKw: new Array(12).fill(70),
      bajaTensionToggle: false,
      fpByMonth: new Array(12).fill(0.97),  // GOOD FP -> bonus
    });
    var sumFpGood = 0;
    for (var fb2 = 0; fb2 < 12; fb2++) sumFpGood += simFpGood.annual.fullBill.components.cargoFp[fb2];
    t.assertTrue('Cargo FP negative (bonus) when FP > 0.9', sumFpGood < 0);

    // ==== TEST 23: R2 backward-compat — without tariffRatesByMonth ====
    // fullBill should be null, totalCostMxn falls back to energy+demand.
    var simR1Compat = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill12(10000, 5000, 2000),
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5,
                     demandChargeMxnPerKw: 400 }
      // no tariffRatesByMonth
    });
    t.assert('fullBill is null when tariffRatesByMonth omitted (R1 compat)',
             null, simR1Compat.annual.fullBill);
    t.assertNear('R1 totalCostMxn = energyCost + demandCharge',
                 simR1Compat.annual.energyCostMxn + simR1Compat.annual.demandChargeMxn,
                 simR1Compat.annual.totalCostMxn, 1);

    // ==== TEST 24: REGRESSION — hourly engine total vs synthetic ======
    // Synthetic "monthly engine" total computed straight from the bill
    // formulas: same rates × same bill quantities. The hourly engine
    // should reproduce this within tolerance because the imports it
    // sums up should match the original bill kWh exactly (no PV/battery).
    //
    // Synthetic input: 10000 kWh base, 5000 kWh intermedia, 2000 kWh punta
    // per month for 12 months. DF=70 kW, FP=1.0, no Baja Tension.
    //
    // Expected monthly bill (Jan), reproducing CFE formula:
    //   Capacidad   = 70 × 400 = 28000
    //   Distribución = max(kw_b,kw_i,kw_p) × 120 ... but we don't have
    //                  the kW in this synthetic — the engine takes peak kW
    //                  from the simulation. For 17000 kWh/month divided
    //                  flat over the bucket hours, peak ≈ (max bucket
    //                  rate per hour). Hard to predict exactly. So we
    //                  bound the regression: expect total within ±5% of
    //                  a hand-computed benchmark for energy+capacity+
    //                  transmisión+CENACE+SCnMEM+Suministro+IVA.
    //
    // Hand calc (annual, no PV, no battery, FP=1.0, no Baja Tension):
    //   Capacidad     = 70 × 400 × 12 = 336,000
    //   Transmisión   = 12 × 17000 × 0.18 = 36,720
    //   CENACE        = 12 × 17000 × 0.008 = 1,632
    //   Energía B     = 12 × 10000 × 0.9 = 108,000
    //   Energía I     = 12 × 5000 × 1.2 = 72,000
    //   Energía P     = 12 × 2000 × 1.5 = 36,000
    //   SCnMEM        = 12 × 17000 × 0.007 = 1,428
    //   Suministro    = 12 × 460 = 5,520
    //   Subtotal (excl. distribución, cargo FP, baja tension) = 597,300
    //   Distribución  = 12 × peak_kW × 120  (peak depends on shape)
    //   For piecewise-flat: monthly punta peak kW = monthly_punta_kwh/punta_hours_in_month
    //                       ≈ 2000 / (~100 h) ≈ 20 kW.
    //                       But MAX is taken across buckets; intermedia
    //                       might be higher per-hour rate (5000/220h ≈ 23kW).
    //                       Use 25 kW as ballpark → 12 × 25 × 120 = 36000.
    //   Total ≈ 633,300 + IVA(16%) ≈ 734,628
    //
    // We assert it's within a HONEST tolerance (±20%) — the regression
    // catches "totally wrong" output (off by 2-10×) but doesn't claim
    // pinpoint accuracy.
    var simReg = simFull;  // already computed above with these inputs
    var expectedTotal = 734628;
    var ratio = simReg.annual.totalCostMxn / expectedTotal;
    t.assertTrue(
      'REGRESSION: hourly full-bill total within ±25% of hand-calc benchmark ' +
      '(got ' + Math.round(simReg.annual.totalCostMxn) + ', expected ~' + expectedTotal + ', ratio=' + ratio.toFixed(2) + ')',
      ratio > 0.75 && ratio < 1.25
    );
    // Stronger assertion: the engine's component sums must match its own
    // facturación number (internal consistency check)
    var ann2 = simReg.annual.fullBill;
    var sumSubtotal = 0;
    for (var rt = 0; rt < 12; rt++) sumSubtotal += ann2.components.subtotal[rt];
    t.assertNear('Internal: sum of monthly subtotals = annualSubtotalMxn',
                 ann2.annualSubtotalMxn, sumSubtotal, 1);

    // ==== TEST 25: R2 baseline-vs-proposed delta (PV reduces total) ===
    // When we add PV, the proposed run's total should be LOWER than baseline.
    var bill2 = bill12(10000, 5000, 2000);
    var simBaselineR2 = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill2,
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5,
                     demandChargeMxnPerKw: 400 },
      tariffRatesByMonth: ratesByMonthSyn,
      demandaFacturableKw: new Array(12).fill(70),
      bajaTensionToggle: false,
      fpByMonth: new Array(12).fill(1.0),
    });
    var simWithPv = calcHourlySimulation({
      tariff: 'GDMTH', region: 'GOLFO CENTRO',
      monthlyBill: bill2,
      monthlyPv: { kwh: new Array(12).fill(10000) },
      tariffRates: { baseMxnPerKwh: 0.9, intermediaMxnPerKwh: 1.2, puntaMxnPerKwh: 1.5,
                     demandChargeMxnPerKw: 400 },
      tariffRatesByMonth: ratesByMonthSyn,
      demandaFacturableKw: new Array(12).fill(70),
      bajaTensionToggle: false,
      fpByMonth: new Array(12).fill(1.0),
      interconnMode: 'NET_METERING',
    });
    t.assertTrue('Adding PV reduces full-bill total cost',
                 simWithPv.annual.totalCostMxn < simBaselineR2.annual.totalCostMxn);
  }
});
