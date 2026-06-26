// =============================================================================
// ARGIA ENGINE v7 -- File: 05_CalcAC.gs
// AC-side NOM calculations.
// Rules: AC-01, AC-02, AC-03, AC-04, AC-06, AC-07, AC-08, TRANS-01
// Per-inverter calculations + main feeder aggregation.
// =============================================================================

// AC-02 conductor sizing: continuous-load factor.
// NEC 690.8(B)/310.15 (and NOM 690-8): a conductor carrying a continuous PV
// current must be sized so that BOTH hold:
//   (a) base ampacity >= CONTINUOUS_FACTOR x I            (125% rule, no derate)
//   (b) base ampacity >= I / (Ft x Fag)                   (derated to the load)
// The conductor that satisfies the GREATER required ampacity governs. The prior
// code applied only (b), undersizing feeders whose 1.25xI exceeded I/derate.
// Exposed as a constant so UVIE can confirm/adjust the exact rule.
var AC_CONTINUOUS_FACTOR = 1.25;

/**
 * Required base (table) ampacity for a continuous AC current.
 * Pure helper -- unit-testable without a workbook.
 * @param {number} iNom        continuous current (A)
 * @param {number} ft          temperature derating factor (<=1)
 * @param {number} fag         grouping/agrupamiento derating factor (<=1)
 * @param {number} [contFactor] continuous-load factor (default AC_CONTINUOUS_FACTOR)
 * @return {number} required base ampacity (A) = max(contFactor*I, I/(ft*fag))
 */
function requiredAmpacity(iNom, ft, fag, contFactor) {
  var cf      = (contFactor && contFactor > 0) ? contFactor : AC_CONTINUOUS_FACTOR;
  var derate  = (ft > 0 && fag > 0) ? (ft * fag) : 1;
  var byCont  = cf * iNom;          // 125% continuous, before adjustment
  var byDerate= iNom / derate;      // load after temp/grouping adjustment
  return Math.max(byCont, byDerate);
}

/**
 * Main AC calculation function.
 * Returns ac object with per-inverter results and main feeder results.
 */
function calcAC(inp, panel, invBank, nom, tbls, dc) {
  const ac = {};
  const SQRT3 = Math.sqrt(3);

  // -- Ambient temperature for AC side ---------------------------------------
  // AC cables typically outdoors or in conduit at max ambient (no roof adder for AC feeder)
  const ambientAC = inp.maxTemp;
  ac.ambientAC    = ambientAC;

  // -- Per-inverter calculations (AC-01, per unit) ---------------------------
  // Produce one result per INVERTER TYPE (not per unit)
  ac.perInverter = invBank.map(inv => {
    const result = {};
    result.model = inv.model;
    result.qty   = inv.qty;

    // AC-01: Nominal AC output current per inverter unit
    // I = P / (SQRT3 x V) for 3-phase; P / V for 1-phase
    const iNom = (inv.phase === 3)
      ? (inv.acKw * 1000) / (SQRT3 * inv.voltage)
      : (inv.acKw * 1000) / inv.voltage;
    result.iNom = iNom;

    // AC-01: OCPD = next breaker >= iNom x 1.25 (125% continuous rule)
    var ocpdReq = iNom * nom.currentFactor1; // NOM 690.9 125% from NOM_DB
    const ocpd    = nextBreaker(ocpdReq, tbls);
    result.ocpdReq = ocpdReq;
    result.ocpd    = ocpd;
    result.ocpdPass= ocpd >= ocpdReq;

    // AC-02: Conductor sizing (Ft, Fag for AC branch)
    // AC cables per phase for 3-phase: 3 phase + neutral + EGC = 5 total
    // For grouping factor: count current-carrying conductors only (3 for 3-phase)
    const ccConductors = (inv.phase === 3) ? 3 : 2;
    const Ft_ac  = getTempFactor(ambientAC, tbls);
    const Fag_ac = getGroupingFactor(ccConductors, tbls);
    const ampReq = requiredAmpacity(iNom, Ft_ac, Fag_ac);
    // Run length up-front so the conductor is sized for BOTH ampacity and vdrop.
    const acLenInv = estimateAcRunM(inp, {
      arrayLength: (dc && dc.arrayLength) || 0,
      arrayWidth : (dc && dc.arrayWidth)  || 0
    });
    const kAC  = (inv.phase === 3) ? SQRT3 : 2;
    const cond = selectConductorForVdrop(ampReq,
      { k: kAC, lengthM: acLenInv, rho: nom.cuResistivity,
        iA: iNom, voltageV: inv.voltage, limitFrac: nom.acVdropTarget },
      tbls, AC_CONTINUOUS_FACTOR * iNom);   // T1: 75C terminal cap on the 1.25*I basis
    result.Ft_ac     = Ft_ac;
    result.Fag_ac    = Fag_ac;
    result.ampReqAC  = ampReq;
    result.conductor = cond.size;
    result.cuAreaMm2 = cond.cuAreaMm2;
    result.insAreaMm2= cond.insAreaMm2;
    result.condGovernedBy = cond.governedBy;

    // AC-03: EGC for inverter AC branch
    const egc = getEgcSize(ocpd, tbls);
    result.egc        = egc.egcSize;
    result.egcAreaMm2 = egc.cuAreaMm2;

    // AC-04: Voltage drop per inverter (conductor already sized for it above).
    var RperM_ac = nom.cuResistivity / cond.cuAreaMm2;
    const vdropAC = cond.vdrop;
    result.acLenInv    = acLenInv;
    result.vdropAC     = vdropAC;
    result.vdropACPct  = vdropAC * 100;
    result.vdropACPass = vdropAC <= nom.acVdropTarget; // limit from NOM_DB

    // Conduit fill: phase conductors + EGC
    const totalCables = (inv.phase === 3) ? 4 : 3; // 3ph+EGC or 2ph+EGC (no neutral counted)
    const totalInsArea= (cond.insAreaMm2 * ccConductors) + egc.cuAreaMm2;
    result.conduit     = selectConduit(totalInsArea, nom.fillRatioOver2, tbls);
    result.totalInsArea= totalInsArea;

    // Overall per-inverter result
    // Bug B1 fix (3.7.8): previous status was `result.pass ? '[PASS]' : (result.vdropACPass ? '[PASS]' : '[REVIEW]')`
    // which mislabeled OCPD-fail / vdrop-pass as [PASS]. Now: pass==false => [REVIEW] unconditionally.
    // Bug B2 fix (3.7.8): "Cada AC" -> "Caída AC" (UTF-8 accents restored).
    result.pass = result.ocpdPass && result.vdropACPass;
    result.status = result.pass ? '[PASS]' : '[REVIEW] -- Caída AC';

    return result;
  });

  // -- Determine primary inverter type for MDC display ------------------------
  // Use the largest kW type (usually the dominant inverter)
  const primary = ac.perInverter.reduce((best, inv) =>
    (inv.model && (best === null || invBank.find(b => b.model === inv.model).acKw >
                   invBank.find(b => b.model === best.model).acKw)) ? inv : best
  , null) || ac.perInverter[0];
  ac.primary = primary;

  // -- Main feeder / 3.0 TABLERO AC ------------------------------------------
  // AC-02: Main feeder aggregation
  const iTotalAC = invBank.reduce((s, inv) => {
    const iNom = (inv.phase === 3)
      ? (inv.acKw * 1000) / (SQRT3 * inv.voltage)
      : (inv.acKw * 1000) / inv.voltage;
    return s + iNom * inv.qty;
  }, 0);
  ac.iTotalAC = iTotalAC;

  // Main breaker = next breaker >= iTotalAC x 1.25
  var mainBreakerReq = iTotalAC * nom.currentFactor1; // 125% from NOM_DB
  const mainBreaker    = nextBreaker(mainBreakerReq, tbls);
  ac.mainBreaker       = mainBreaker;

  // Parallel feeder runs: NEC/NOM allows parallel runs when conductor > 1/0 AWG
  // Use 400A per run as practical limit for this table
  var MAX_PER_RUN = nom.maxParallelRunA; // from NOM_DB limits
  const parallelRuns = Math.ceil(iTotalAC / MAX_PER_RUN);
  const iPerRun      = iTotalAC / parallelRuns;
  ac.parallelRuns    = parallelRuns;
  ac.iPerRun         = iPerRun;

  // Feeder conductor sizing
  const Ft_main   = getTempFactor(ambientAC, tbls);
  const Fag_main  = getGroupingFactor(3 * parallelRuns, tbls); // 3-phase x runs
  const ampReqMain= requiredAmpacity(iPerRun, Ft_main, Fag_main);
  // Feeder length + voltage up-front so the conductor is sized for vdrop too.
  const feederLen   = inp.distAcProt + inp.distGrid + inp.feederExtraM;
  const mainVoltage = invBank.reduce((best, inv) => Math.max(best, inv.voltage), 0);
  const condMain  = selectConductorForVdrop(ampReqMain,
      { k: SQRT3, lengthM: feederLen, rho: nom.cuResistivity,
        iA: iPerRun, voltageV: mainVoltage, limitFrac: nom.acVdropTarget },
      tbls, AC_CONTINUOUS_FACTOR * iPerRun);   // T1: 75C terminal cap on the 1.25*I/run basis
  ac.Ft_main     = Ft_main;
  ac.Fag_main    = Fag_main;
  ac.ampReqMain  = ampReqMain;
  ac.condMain    = condMain.size;
  ac.condMainInsufficient = !!condMain.insufficient;  // true => no table conductor meets ampReqMain
  ac.condMainGovernedBy   = condMain.governedBy;
  ac.areaConMain = condMain.cuAreaMm2;
  ac.insAreaMain = condMain.insAreaMm2;

  // AC-03: Main EGC
  const egcMain = getEgcSize(mainBreaker, tbls);
  ac.egcMain    = egcMain.egcSize;
  ac.egcMainArea= egcMain.cuAreaMm2;

  // AC-04: Main feeder voltage drop (conductor already sized for it above).
  var RperM_main = nom.cuResistivity / condMain.cuAreaMm2;
  const vdropFeeder = condMain.vdrop;
  ac.feederLen      = feederLen;
  ac.vdropFeeder    = vdropFeeder;
  ac.vdropFeederPct = vdropFeeder * 100;
  ac.vdropFeederPass = vdropFeeder <= nom.acVdropTarget; // limit from NOM_DB
  ac.mainVoltage    = mainVoltage;

  // Conduit main: 3 phase conductors x parallelRuns + EGC
  const totalInsMain  = (condMain.insAreaMm2 * 3 * parallelRuns) + egcMain.cuAreaMm2;
  ac.conduitMain      = selectConduit(totalInsMain, nom.fillRatioOver2, tbls);
  ac.totalInsMain     = totalInsMain;

  // TRANS-01: Transformer sizing
  const apparentPower    = dc.acKwTotal / inp.powerFactor; // kVA
  var apparentWith20pct = apparentPower * (1 + nom.transformerMargin); // margin from NOM_DB
  const transformer      = nextTransformer(apparentWith20pct, tbls);
  ac.apparentPower       = apparentPower;
  ac.apparentWith20pct   = apparentWith20pct;
  ac.transformer         = transformer;
  ac.transformerPass     = transformer >= apparentWith20pct;

  // AC-07: Busbar 120% rule (backfeed check)
  // (mainBreaker + pvBreaker) / busRating <= 1.20
  // We use mainBreaker as PV breaker; bus rating = next transformer kVA / voltage x 1.25 (estimated)
  // This is a flag for manual review since busbar rating comes from project-specific panelboard
  ac.busBusbarNote = `Breaker PV: ${mainBreaker}A -- verificar regla 120% con tablero del sitio`;

  // AC-06: Voltage rise (complementary to voltage drop -- check total)
  // For interconnection, total vdrop should stay < acVdropLimit
  ac.vdropTotal    = vdropFeeder; // simplified; detailed per run in perInverter
  ac.vdropTotalPct = vdropFeeder * 100;

  // -- Main feeder overall result ---------------------------------------------
  const feederPass = ac.vdropFeederPass && ac.transformerPass;
  ac.resultFeeder  = feederPass
    ? '[PASS] -- Alimentador principal OK'
    : '[REVIEW] -- Verificar caída de tensión o transformador';

  return ac;
}
