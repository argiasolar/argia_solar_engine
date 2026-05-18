/**
 * 30_ArgiaKicker.gs  —  v14  (2026-04-09)
 * ═══════════════════════════════════════════════════════════════════
 * CHANGES v14:
 *   S01  — SOLAR PPA repositioned between separator lines (y=28, h=36)
 *   S02  — White ARGIA logo removed (photo already has branding)
 *   S05  — Step descriptions added (s05_p*_desc keys in SLIDE_DATA)
 *          Photo height increased to 145pt to fit label + description
 *   S09  — Helioscope uses _img (not _imgCover) — prevents overflow
 *          into spec table on landscape aerial photos
 *   S10  — Chart replaced: CFE stacked bar (BASE/INTER/PUNTA) + solar
 *          line, read from CFE_SIMULATION rows 5-8, cols 3-14.
 *          Falls back to simple monthly bar if sheet unavailable.
 *   S10  — Duplicate TOTAL row bug fixed (was showing value twice)
 *   §8   — _footer updated to match PPTX exact positions
 *   §2   — 5 new SLIDE_DATA rows for step descriptions
 * ═══════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────
// §1  CONSTANTS
// ─────────────────────────────────────────────────────────────────
var K = {
  IMAGE_FOLDER_ID : '',  // fallback — overridden at runtime from 00_MASTERLINK!K2
  SD_TAB          : 'SLIDE_DATA',
  W : 720, H : 405,
  C : { WHITE:'#FFFFFF', BLACK:'#000000', NAVY:'#0D1B2A', DARK:'#1A1A2E',
        MID:'#555555',   LITE:'#888888',  PALE:'#CCCCCC', BG:'#F7F7F7',
        LINE:'#DDDDDD',  GREEN:'#2E7D32' },
  SH: { GEN:'INPUT_GENERAL', CFE:'CFE_SIMULATION', FIN:'FINANCE', DES:'INPUT_DESIGN' },
  FONT_DISPLAY : 'Barlow Condensed', // DIN Pro closest match — geometric condensed
  FONT_BODY    : 'Barlow',           // clean geometric body
};
var W = K.W, H = K.H;

// ─────────────────────────────────────────────────────────────────
// §2  SLIDE_DATA DEFAULT ROWS
// ─────────────────────────────────────────────────────────────────
var SD_DEFAULTS = [
  ['KEY','SLIDE','TYPE','DESCRIPTION','VALUE_EN','VALUE_ES','STATUS'],
  // ── PROJECT DATA ──────────────────────────────────────────────
  ['--- PROJECT DATA ---','','---','Fill these for every new project','','',''],
  ['client_name',         0,'---','Full company name',                          '','',''],
  ['client_location',     0,'---','City, State  e.g. "Guadalajara, Jalisco"',   '','',''],
  ['project_type',        0,'---','ROOF | PARKING | LAND',                      '','',''],
  ['tariff_type',         0,'---','CFE tariff  e.g. GDMTH, PDMT',               '','',''],
  ['offer_date',          0,'---','dd/mm/yyyy',                                  '','',''],
  ['offer_valid_until',   0,'---','dd/mm/yyyy',                                  '','',''],
  ['salesperson_name',    0,'---','Full name',                                   '','',''],
  ['salesperson_title',   0,'---','e.g. Sales Director',                         '','',''],
  ['salesperson_email',   0,'---','email',                                        '','',''],
  ['salesperson_phone',   0,'---','phone',                                        '','',''],
  ['solar_name',          0,'---','Solar Design Director name (optional)',        '','',''],
  ['solar_email',         0,'---','Solar Design Director email',                  '','',''],
  ['solar_phone',         0,'---','Solar Design Director phone',                  '','',''],
  ['tech_name',           0,'---','Technical Director name (optional)',            '','',''],
  ['tech_email',          0,'---','Technical Director email',                      '','',''],
  ['tech_phone',          0,'---','Technical Director phone',                      '','',''],
  ['system_kwp',          0,'---','DC kWp — numeric',                            '','',''],
  ['system_kwac',         0,'---','AC kW — numeric (leave blank = 85% of kWp)', '','',''],
  ['panel_model',         0,'---','Full panel model string',                      '','',''],
  ['panel_qty',           0,'---','Panel count — integer',                        '','',''],
  ['panel_w',             0,'---','Panel watt-peak — numeric',                    '','',''],
  ['panel_tech',          0,'---','e.g. Monocrystalline PERC',                    '','',''],
  ['panel_warranty',      0,'---','e.g. 12 yr product / 25 yr linear',            '','',''],
  ['inv_model',           0,'---','Primary inverter model',                        '','',''],
  ['inv_qty',             0,'---','Inverter count',                                '','',''],
  ['inv_kw',              0,'---','Inverter kW',                                   '','',''],
  ['inv_warranty',        0,'---','e.g. 5 yr (extendable to 10)',                  '','',''],
  ['mounting_type',       0,'---','e.g. Aluminum roof structure',                  '','',''],
  ['epc_warranty',        0,'---','e.g. 5 yr workmanship',                         '','',''],
  ['area_m2',             0,'---','Roof/install area m²',                          '','',''],
  ['annual_mwh',          0,'---','Total annual site consumption MWh — numeric', '','',''],
  ['solar_mwh',           0,'---','Annual solar production MWh (leave blank to compute from annual_mwh × coverage)','','',''],
  ['system_coverage_pct', 0,'---','e.g. 32.77%  or  0.3277  (both accepted)',    '','',''],
  ['co2_tons',            0,'---','tCO₂ avoided per year — numeric',              '','',''],
  ['avg_kwh_price',       0,'---','Current blended CFE rate MXN/kWh',             '','',''],
  ['annual_energy_cost',  0,'---','Current annual CFE bill MXN',                  '','',''],
  ['ppa_rate',            0,'---','ARGIA PPA tariff MXN/kWh  e.g. 2.217',        '','',''],
  ['ppa_discount',        0,'---','Discount vs CFE  e.g. 15%  or 0.15',           '','',''],
  ['annual_argia_payment',0,'---','Annual ARGIA solar payment MXN',              '','',''],
  ['total_annual_payment',0,'---','New total energy payment MXN',                '','',''],
  ['annual_savings',      0,'---','Year-1 solar savings MXN',                    '','',''],
  ['savings_10yr',        0,'---','Cumulative savings at end of contract MXN',   '','',''],
  ['capex_total',         0,'---','Total investment MXN (CAPEX mode only)',       '','',''],
  ['roi_years',           0,'---','Payback period in years  e.g. 2.8',           '','',''],
  ['irr_10yr',            0,'---','IRR  e.g. 32%',                               '','',''],
  ['contract_years',      0,'---','PPA/CAPEX contract length years',              '','',''],
  ['impl_days',           0,'---','Implementation duration in days',              '','',''],
  ['offer_valid_days',    0,'---','Offer validity in days',                       '','',''],
  ['indexation',          0,'---','Indexation basis  e.g. IPC, CPI/IPC',         '','',''],
  ['observations',        0,'---','Free text — appears on Summary slide',         '','',''],
  ['notes',               0,'---','Free text — appears on Summary slide',         '','',''],
  // ── MONTHLY PRODUCTION ────────────────────────────────────────
  ['--- MONTHLY PRODUCTION ---','','---','kWh Grid from Helioscope per month','','',''],
  ['prod_jan',0,'---','kWh Grid — January',  '','',''],
  ['prod_feb',0,'---','kWh Grid — February', '','',''],
  ['prod_mar',0,'---','kWh Grid — March',    '','',''],
  ['prod_apr',0,'---','kWh Grid — April',    '','',''],
  ['prod_may',0,'---','kWh Grid — May',      '','',''],
  ['prod_jun',0,'---','kWh Grid — June',     '','',''],
  ['prod_jul',0,'---','kWh Grid — July',     '','',''],
  ['prod_aug',0,'---','kWh Grid — August',   '','',''],
  ['prod_sep',0,'---','kWh Grid — September','','',''],
  ['prod_oct',0,'---','kWh Grid — October',  '','',''],
  ['prod_nov',0,'---','kWh Grid — November', '','',''],
  ['prod_dec',0,'---','kWh Grid — December', '','',''],
  // ── IMAGES ────────────────────────────────────────────────────
  ['--- IMAGES ---','','---','Drive filename (no extension) in VALUE_EN','','',''],
  ['cover_bg',        1,'IMG','S01 Cover hero background photo',             'cover_bg',        '',''],
  ['step1_photo',     5,'IMG','S05 Step 1 AUDIT photo',                      'step1_photo',     '',''],
  ['step2_photo',     5,'IMG','S05 Step 2 DESIGN photo',                     'step2_photo',     '',''],
  ['step3_photo',     5,'IMG','S05 Step 3 APPROVAL photo',                   'step3_photo',     '',''],
  ['step4_photo',     5,'IMG','S05 Step 4 INSTALLATION photo',               'step4_photo',     '',''],
  ['step5_photo',     5,'IMG','S05 Step 5 OPERATION photo',                  'step5_photo',     '',''],
  ['helioscope',      9,'IMG','S09 Helioscope project render (aerial photo)','helioscope',      '',''],
  ['argia_logo_white',0,'IMG','ARGIA logo WHITE version (dark backgrounds)', 'argia_logo_white','',''],
  ['argia_logo_dark', 0,'IMG','ARGIA logo DARK version (white backgrounds)', 'argia_logo_dark', '',''],
  ['client_logo',     0,'IMG','Client logo (update per project)',             'client_logo',     '',''],
  ['toc_city',        2,'IMG','S02 TOC right panel city photo',              'toc_city',        '',''],
  ['numbers_bg',      4,'IMG','S04 ARGIA in Numbers dark city strip',        'numbers_bg',      '',''],
  ['ppa_field',       6,'IMG','S06 What is PPA solar field photo',           'ppa_field',       '',''],
  ['ppa_aerial',      7,'IMG','S07 How it Works left photo',                 'ppa_aerial',      '',''],
  ['checkmark',       8,'IMG','S08 Requirements green checkmark icon',       'checkmark',       '',''],
  ['project_render',  11,'IMG','S11 Financial Benefits left photo',          'project_render',  '',''],
  ['om_photo_wide',   13,'IMG','S13 O&M right panel workers on solar photo', 'om_photo_wide',   '',''],
  ['env_photo',       14,'IMG','S14 Environmental aerial trees+solar strip', 'env_photo',       '',''],
  ['env_strip',       12,'IMG','S12 Implementation panoramic strip',         'env_strip',       '',''],
  // ── CONFIG ────────────────────────────────────────────────────
  ['--- CONFIG ---','','---','Global config — VALUE_EN only','','',''],
  ['url',           0,'CFG','Website URL',         'www.argia.solar',                                         '',''],
  ['footer_left',   0,'CFG','Footer left text',    'SMART ENERGY SOLUTIONS',                                  '',''],
  ['supplier_name', 0,'CFG','Supplier legal name', 'ARGIA MEXICO S.A. de C.V.',                               '',''],
  ['supplier_addr', 0,'CFG','Supplier address',    'Provincias del Campestre 1904-4, León, 37138, Guanajuato, México','',''],
  // ── S01 COVER ─────────────────────────────────────────────────
  ['--- S01 COVER ---','','---','','','',''],
  ['s01_tagline',   1,'TXT','Tagline','Zero Investment – Immediate Savings – Long-Term Clean Energy','Cero Inversión – Ahorro Inmediato – Energía Limpia a Largo Plazo',''],
  ['s01_title',     1,'TXT','Cover title prefix','SOLAR PPA SOLUTION FOR','SOLUCIÓN SOLAR PPA PARA',''],
  ['s01_acc_label', 1,'TXT','Accumulated savings label','Accumulated Savings:','Ahorro Acumulado:',''],
  ['s01_yrs_label', 1,'TXT','Years label','Years:','Años:',''],
  // ── S02 TOC ───────────────────────────────────────────────────
  ['--- S02 TOC ---','','---','','','',''],
  ['s02_title',    2,'TXT','TOC slide title','TABLE OF CONTENTS','TABLA DE CONTENIDO',''],
  ['s02_customer', 2,'TXT','Customer label','CUSTOMER:','CLIENTE:',''],
  ['s02_supplier', 2,'TXT','Supplier label','SUPPLIER:','PROVEEDOR:',''],
  ['s02_toc_01',   2,'TXT','TOC item 1', 'About ARGIA MEXICO',              'Acerca de ARGIA MEXICO',''],
  ['s02_toc_02',   2,'TXT','TOC item 2', 'ARGIA In Numbers',                'ARGIA en Números',''],
  ['s02_toc_03',   2,'TXT','TOC item 3', 'Why Choose ARGIA',                'Por Qué Elegir ARGIA',''],
  ['s02_toc_04',   2,'TXT','TOC item 4', 'What is a Solar PPA',             'Qué es un PPA Solar',''],
  ['s02_toc_05',   2,'TXT','TOC item 5', 'How it Works',                    'Cómo Funciona',''],
  ['s02_toc_06',   2,'TXT','TOC item 6', 'Your Requirements',               'Tus Requerimientos',''],
  ['s02_toc_07',   2,'TXT','TOC item 7', 'Project Overview',                'Descripción General del Proyecto',''],
  ['s02_toc_08',   2,'TXT','TOC item 8', 'General Project Description',     'Descripción Técnica',''],
  ['s02_toc_09',   2,'TXT','TOC item 9', 'Financial Benefits & PPA Summary','Beneficios Financieros y Resumen PPA',''],
  ['s02_toc_10',   2,'TXT','TOC item 10','Implementation Process',          'Proceso de Implementación',''],
  ['s02_toc_11',   2,'TXT','TOC item 11','O&M, Warranty and Durability',    'O&M, Garantía y Durabilidad',''],
  ['s02_toc_12',   2,'TXT','TOC item 12','Environmental & Social Impact',   'Impacto Ambiental y Social',''],
  ['s02_toc_13',   2,'TXT','TOC item 13','Validity, Contacts and Annexes',  'Validez, Contactos y Anexos',''],
  // ── S03 ABOUT ─────────────────────────────────────────────────
  ['--- S03 ABOUT ---','','---','','','',''],
  ['s03_title',     3,'TXT','Slide title','ABOUT ARGIA MEXICO','ACERCA DE ARGIA MEXICO',''],
  ['s03_bold',      3,'TXT','Big bold headline left','TRANSFORM YOUR BUSINESS\nWITH SMART\nENERGY SOLUTIONS','TRANSFORMA TU NEGOCIO\nCON SOLUCIONES\nINTELIGENTES DE ENERGÍA',''],
  ['s03_desc',      3,'TXT','Description right','ARGIA MEXICO is a turnkey provider of Smart Energy Solutions for industrial customers. We deliver sustainable, profitable, and fully managed projects across solar generation, battery systems, lighting, and energy efficiency.','ARGIA MEXICO es proveedor llave en mano de Soluciones Energéticas Inteligentes para clientes industriales. Entregamos proyectos sostenibles, rentables y totalmente administrados en generación solar, sistemas de baterías, iluminación y eficiencia energética.',''],
  ['s03_mission_t', 3,'TXT','Mission label','ARGIA MISSION','MISIÓN ARGIA',''],
  ['s03_mission_v', 3,'TXT','Mission text',"To reduce our clients' energy costs and carbon footprint through reliable, efficient, and innovative technology.",'Reducir los costos de energía y la huella de carbono de nuestros clientes mediante tecnología confiable, eficiente e innovadora.',''],
  ['s03_ben_t',     3,'TXT','Benefits label','BENEFITS FOR YOU','BENEFICIOS PARA TI',''],
  ['s03_ben_1',     3,'TXT','Benefit 1','Solar Energy (PPA Model): Zero CAPEX distributed generation systems.','Energía Solar (Modelo PPA): Sistemas de generación distribuida sin CAPEX.',''],
  ['s03_ben_2',     3,'TXT','Benefit 2','Lighting as a Service: Energy-efficient upgrades with remote management.','Iluminación como Servicio: Mejoras eficientes con gestión remota.',''],
  ['s03_ben_3',     3,'TXT','Benefit 3','Battery as a Service (BAAS): Peak shaving and backup for critical loads.','Batería como Servicio (BAAS): Reducción de picos y respaldo para cargas críticas.',''],
  ['s03_ben_4',     3,'TXT','Benefit 4','Energy Monitoring & Audits: Transparent performance control.','Monitoreo y Auditorías: Control de desempeño transparente.',''],
  // ── S04 NUMBERS ───────────────────────────────────────────────
  ['--- S04 NUMBERS ---','','---','','','',''],
  ['s04_title',     4,'TXT','Slide title',   'ARGIA IN NUMBERS',       'ARGIA EN NÚMEROS',''],
  ['s04_stat1_val', 4,'TXT','Stat 1 number', '+2,000',                 '+2,000',''],
  ['s04_stat1_lbl', 4,'TXT','Stat 1 label',  'projects completed',     'proyectos completados',''],
  ['s04_stat2_val', 4,'TXT','Stat 2 number', '+27.5M',                 '+27.5M',''],
  ['s04_stat2_lbl', 4,'TXT','Stat 2 label',  'million m² of facilities','millones m² de instalaciones',''],
  ['s04_stat3_val', 4,'TXT','Stat 3 number', '70%',                    '70%',''],
  ['s04_stat3_lbl', 4,'TXT','Stat 3 label',  'average energy savings', 'ahorro promedio de energía',''],
  ['s04_stat4_val', 4,'TXT','Stat 4 number', '15+',                    '15+',''],
  ['s04_stat4_lbl', 4,'TXT','Stat 4 label',  'years of experience\nin Europe and Mexico','años de experiencia\nen Europa y México',''],
  // ── S05 WHY CHOOSE ────────────────────────────────────────────
  ['--- S05 WHY CHOOSE ---','','---','','','',''],
  ['s05_title',     5,'TXT','Slide title','WHY CHOOSE ARGIA','POR QUÉ ELEGIR ARGIA',''],
  ['s05_lead',      5,'TXT','Big headline','WE DELIVER REAL TURNKEY\nINDUSTRIAL SOLUTIONS','ENTREGAMOS SOLUCIONES\nINDUSTRIALES LLAVE EN MANO',''],
  ['s05_desc',      5,'TXT','Sub-description',"Everything under one roof, from audit to operation managed by ARGIA's in-house engineering, project management, financing, and O&M teams.",'Todo bajo un mismo techo, desde la auditoría hasta la operación, gestionado por los equipos internos de ingeniería, gestión de proyectos, financiamiento y O&M de ARGIA.',''],
  ['s05_bul1',      5,'TXT','Bullet 1','One trusted partner for the entire project','Un socio confiable para todo el proyecto',''],
  ['s05_bul2',      5,'TXT','Bullet 2','No investment or operating costs','Sin inversión ni costos operativos',''],
  ['s05_bul3',      5,'TXT','Bullet 3','Clear performance tracking and proven savings','Seguimiento claro del rendimiento y ahorros comprobados',''],
  ['s05_bul4',      5,'TXT','Bullet 4','Durable, high-quality systems built to last','Sistemas duraderos y de alta calidad',''],
  ['s05_proc_t',    5,'TXT','Process section label','Our Process:','Nuestro Proceso:',''],
  ['s05_p1_num',    5,'TXT','Step 1 number','1','1',''],
  ['s05_p2_num',    5,'TXT','Step 2 number','2','2',''],
  ['s05_p3_num',    5,'TXT','Step 3 number','3','3',''],
  ['s05_p4_num',    5,'TXT','Step 4 number','4','4',''],
  ['s05_p5_num',    5,'TXT','Step 5 number','5','5',''],
  ['s05_p1_lbl',    5,'TXT','Step 1 label','AUDIT','AUDITORÍA',''],
  ['s05_p2_lbl',    5,'TXT','Step 2 label','DESIGN','DISEÑO',''],
  ['s05_p3_lbl',    5,'TXT','Step 3 label','APPROVAL','APROBACIÓN',''],
  ['s05_p4_lbl',    5,'TXT','Step 4 label','INSTALLATION','INSTALACIÓN',''],
  ['s05_p5_lbl',    5,'TXT','Step 5 label','OPERATION','OPERACIÓN',''],
  ['s05_p1_desc',   5,'TXT','Step 1 description','understanding your energy consumption and site conditions','entendiendo tu consumo de energía y condiciones del sitio',''],
  ['s05_p2_desc',   5,'TXT','Step 2 description','detailed solar and electrical engineering with 3D modeling','ingeniería solar y eléctrica detallada con modelado 3D',''],
  ['s05_p3_desc',   5,'TXT','Step 3 description','financial model, ROI, and PPA offer','modelo financiero, ROI y oferta PPA',''],
  ['s05_p4_desc',   5,'TXT','Step 4 description','safe and efficient EPC delivery','entrega EPC segura y eficiente',''],
  ['s05_p5_desc',   5,'TXT','Step 5 description','24/7 monitoring and maintenance','monitoreo y mantenimiento 24/7',''],
  // ── S06 PPA ───────────────────────────────────────────────────
  ['--- S06 PPA ---','','---','','','',''],
  ['s06_title', 6,'TXT','Slide title','WHAT IS A SOLAR PPA','QUÉ ES UN PPA SOLAR',''],
  ['s06_bold',  6,'TXT','Big left heading','POWER PURCHASE\nAGREEMENT (PPA)','ACUERDO DE COMPRA\nDE ENERGÍA (PPA)',''],
  ['s06_desc',  6,'TXT','PPA description','PPA is a contract in which ARGIA installs, owns, and operates a solar plant at your site and sells the generated electricity to you at a fixed price per kWh, usually 15 to 20% lower than CFE tariffs.','El PPA es un contrato en el que ARGIA instala, posee y opera una planta solar en tu sitio y te vende la electricidad generada a un precio fijo por kWh, generalmente entre 15 y 20% más bajo que las tarifas CFE.',''],
  // ── S07 HOW IT WORKS ──────────────────────────────────────────
  ['--- S07 HOW IT WORKS ---','','---','','','',''],
  ['s07_title', 7,'TXT','Slide title','WHAT IS A SOLAR PPA','QUÉ ES UN PPA SOLAR',''],
  ['s07_how_t', 7,'TXT','How it works label','HOW IT WORKS','CÓMO FUNCIONA',''],
  ['s07_how1',  7,'TXT','How item 1','ARGIA finances and installs the system.','ARGIA financia e instala el sistema.',''],
  ['s07_how2',  7,'TXT','How item 2','ARGIA operates and maintains it at no cost to you.','ARGIA lo opera y mantiene sin costo para ti.',''],
  ['s07_how3',  7,'TXT','How item 3','You pay only for electricity consumed at the agreed tariff.','Solo pagas la electricidad consumida a la tarifa acordada.',''],
  ['s07_how4',  7,'TXT','How item 4','Savings start from day one – no investment required.','Los ahorros inician desde el día uno, sin inversión requerida.',''],
  ['s07_key_t', 7,'TXT','Key benefits label','KEY BENEFITS','BENEFICIOS CLAVE',''],
  ['s07_key1',  7,'TXT','Key benefit 1','Zero CAPEX and OPEX','Cero CAPEX y OPEX',''],
  ['s07_key2',  7,'TXT','Key benefit 2','Lower electricity costs','Menores costos de electricidad',''],
  ['s07_key3',  7,'TXT','Key benefit 3','Fixed price for 10 to 15 years','Precio fijo por 10 a 15 años',''],
  ['s07_key4',  7,'TXT','Key benefit 4','No operational risks','Sin riesgos operativos',''],
  ['s07_key5',  7,'TXT','Key benefit 5','Option to purchase the system at any time','Opción de compra del sistema en cualquier momento',''],
  // ── S08 REQUIREMENTS ──────────────────────────────────────────
  ['--- S08 REQUIREMENTS ---','','---','','','',''],
  ['s08_title',   8,'TXT','Slide title','YOUR REQUIREMENTS','TUS REQUERIMIENTOS',''],
  ['s08_cust_t',  8,'TXT','Customer needs label','CUSTOMER NEEDS','NECESIDADES DEL CLIENTE',''],
  ['s08_cust1',   8,'TXT','Customer need 1','Reduce electricity costs','Reducir costos de electricidad',''],
  ['s08_cust2',   8,'TXT','Customer need 2','Zero investment','Cero inversión',''],
  ['s08_cust3',   8,'TXT','Customer need 3','Sustainability / CO₂ reduction','Sustentabilidad / reducción de CO₂',''],
  ['s08_cust4',   8,'TXT','Customer need 4','Reliable operation','Operación confiable',''],
  ['s08_argia_t', 8,'TXT','ARGIA solution label','ARGIA SOLUTION','SOLUCIÓN ARGIA',''],
  ['s08_argia1',  8,'TXT','ARGIA solution 1','Solar energy at fixed rate below CFE','Energía solar a tarifa fija menor a CFE',''],
  ['s08_argia2',  8,'TXT','ARGIA solution 2','Fully financed PPA model','Modelo PPA totalmente financiado',''],
  ['s08_argia3',  8,'TXT','ARGIA solution 3','Renewable energy supply','Suministro de energía renovable',''],
  ['s08_argia4',  8,'TXT','ARGIA solution 4','Tier-1 equipment and professional O&M','Equipos Tier-1 y O&M profesional',''],
  // ── S09 PROJECT OVERVIEW ──────────────────────────────────────
  ['--- S09 PROJECT OVERVIEW ---','','---','','','',''],
  ['s09_title',  9,'TXT','Slide title','PROJECT OVERVIEW','DESCRIPCIÓN GENERAL DEL PROYECTO',''],
  ['s09_tech_t', 9,'TXT','Technology label','TECHNOLOGY','TECNOLOGÍA',''],
  ['s09_warr_t', 9,'TXT','Warranties label','WARRANTIES','GARANTÍAS',''],
  ['s09_row1',   9,'TXT','Spec row 1','Project Type','Tipo de Proyecto',''],
  ['s09_row2',   9,'TXT','Spec row 2','Location','Ubicación',''],
  ['s09_row3',   9,'TXT','Spec row 3','Installed Capacity','Capacidad Instalada',''],
  ['s09_row4',   9,'TXT','Spec row 4','Estimated Annual Generation','Generación Anual Estimada',''],
  ['s09_row5',   9,'TXT','Spec row 5','Annual Generation Yield','Rendimiento de Generación',''],
  ['s09_row6',   9,'TXT','Spec row 6','Consumption Coverage','Cobertura de Consumo',''],
  ['s09_row7',   9,'TXT','Spec row 7','CO₂ Emission Reduction','Reducción Emisiones CO₂',''],
  ['s09_row8',   9,'TXT','Spec row 8','Lifetime','Vida Útil',''],
  ['s09_tech1',  9,'TXT','Technology row 1','Modules','Módulos',''],
  ['s09_tech2',  9,'TXT','Technology row 2','Inverters','Inversores',''],
  ['s09_tech3',  9,'TXT','Technology row 3','Mounting','Montaje',''],
  ['s09_warr1',  9,'TXT','Warranty row 1','Panels','Paneles',''],
  ['s09_warr2',  9,'TXT','Warranty row 2','Inverters','Inversores',''],
  ['s09_warr3',  9,'TXT','Warranty row 3','Construction','Construcción',''],
  ['s09_life',   9,'TXT','Lifetime value','25+ years','25+ años',''],
  // ── S10 GENERAL DESC ──────────────────────────────────────────
  ['--- S10 GENERAL DESC ---','','---','','','',''],
  ['s10_title',     10,'TXT','Slide title','GENERAL PROJECT DESCRIPTION (Y01)','DESCRIPCIÓN GENERAL DEL PROYECTO (Y01)',''],
  ['s10_en_ovr_t',  10,'TXT','Energy overview label','ENERGY OVERVIEW','RESUMEN ENERGÉTICO',''],
  ['s10_en1_lbl',   10,'TXT','Energy row 1','Current Consumption','Consumo Actual',''],
  ['s10_en2_lbl',   10,'TXT','Energy row 2','Solar Production','Producción Solar',''],
  ['s10_en3_lbl',   10,'TXT','Energy row 3','Solar Coverage','Cobertura Solar',''],
  ['s10_fin_t',     10,'TXT','Financial comparison label','FINANCIAL COMPARISON','COMPARATIVA FINANCIERA',''],
  ['s10_fin1_lbl',  10,'TXT','Finance row 1','Current CFE Rate','Tarifa CFE Actual',''],
  ['s10_fin2_lbl',  10,'TXT','Finance row 2','Annual Payment to CFE','Pago Anual a CFE',''],
  ['s10_fin3_lbl',  10,'TXT','Finance row 3','ARGIA Solar Rate','Tarifa Solar ARGIA',''],
  ['s10_fin4_lbl',  10,'TXT','Finance row 4','Annual ARGIA Payment','Pago Anual ARGIA',''],
  ['s10_sav_t',     10,'TXT','Savings banner','SAVINGS & ENVIRONMENTAL IMPACT','AHORROS E IMPACTO AMBIENTAL',''],
  ['s10_sav1_lbl',  10,'TXT','Savings row 1','Average Annual Savings (PPA)','Ahorro Anual Promedio (PPA)',''],
  ['s10_sav2_lbl',  10,'TXT','Savings row 2','Annual CO₂ Emissions Avoided','Emisiones CO₂ Evitadas',''],
  // ── S11 FINANCIAL ─────────────────────────────────────────────
  ['--- S11 FINANCIAL ---','','---','','','',''],
  ['s11_title',    11,'TXT','Slide title','FINANCIAL BENEFITS AND PPA SUMMARY','BENEFICIOS FINANCIEROS Y RESUMEN DEL PPA',''],
  ['s11_r1_lbl',   11,'TXT','Row 1 label','Annual Savings','Ahorro Anual',''],
  ['s11_r2_lbl',   11,'TXT','Row 2 label','Accumulated Savings','Ahorro Acumulado',''],
  ['s11_r3_lbl',   11,'TXT','Row 3 label','CFE Tariff Discount','Descuento Tarifa CFE',''],
  ['s11_r4_lbl',   11,'TXT','Row 4 label','Energy Tariff','Tarifa de Energía',''],
  ['s11_r5_lbl',   11,'TXT','Row 5 label','Indexation','Indexación',''],
  ['s11_r6_lbl',   11,'TXT','Row 6 label','Contract Term','Plazo del Contrato',''],
  ['s11_r7_lbl',   11,'TXT','Row 7 label','Maintenance & Insurance','Mantenimiento y Seguro',''],
  ['s11_r7_val',   11,'TXT','Row 7 value','No costs – Included','Sin costo – Incluido',''],
  ['s11_r8_lbl',   11,'TXT','Row 8 label','CO₂ Reduction','Reducción CO₂',''],
  ['s11_r9_lbl',   11,'TXT','Row 9 label','Buyout Option','Opción de Compra',''],
  ['s11_r9_val',   11,'TXT','Row 9 value','Residual value after contract term','Valor residual al final del contrato',''],
  ['s11_r10_lbl',  11,'TXT','Row 10 label','Early Termination','Terminación Anticipada',''],
  ['s11_r10_val',  11,'TXT','Row 10 value','Allowed after 6 years (CPA lease clause)','Permitida después de 6 años (cláusula CPA)',''],
  ['s11_vat_suffix',11,'TXT','VAT suffix','+ VAT','+ IVA',''],
  ['s11_yr_suffix', 11,'TXT','Years suffix','years','años',''],
  // ── S12 IMPLEMENTATION ────────────────────────────────────────
  ['--- S12 IMPLEMENTATION ---','','---','','','',''],
  ['s12_title',    12,'TXT','Slide title','IMPLEMENTATION PROCESS','PROCESO DE IMPLEMENTACIÓN',''],
  ['s12_day_lbl',  12,'TXT','Day count label','Days Total Project\nDuration','Días de Duración\nTotal del Proyecto',''],
  ['s12_ph0_lbl',  12,'TXT','Header: Phase','Phase','Fase',''],
  ['s12_ph0_dur',  12,'TXT','Header: Duration','Duration','Duración',''],
  ['s12_ph0_desc', 12,'TXT','Header: Description','Description','Descripción',''],
  ['s12_ph1_lbl',  12,'TXT','Phase 1 name','Feasibility Study','Estudio de Factibilidad',''],
  ['s12_ph1_dur',  12,'TXT','Phase 1 duration','—','—',''],
  ['s12_ph1_desc', 12,'TXT','Phase 1 description','Initial technical study','Estudio técnico inicial',''],
  ['s12_ph2_lbl',  12,'TXT','Phase 2 name','Technology Selection','Selección de Tecnología',''],
  ['s12_ph2_dur',  12,'TXT','Phase 2 duration','3 days','3 días',''],
  ['s12_ph2_desc', 12,'TXT','Phase 2 description','Modules, inverters, structure','Módulos, inversores, estructura',''],
  ['s12_ph3_lbl',  12,'TXT','Phase 3 name','Engineering Documentation','Ingeniería',''],
  ['s12_ph3_dur',  12,'TXT','Phase 3 duration','5 days','5 días',''],
  ['s12_ph3_desc', 12,'TXT','Phase 3 description','Detailed construction design','Diseño de construcción detallado',''],
  ['s12_ph4_lbl',  12,'TXT','Phase 4 name','EPC Execution','Ejecución EPC',''],
  ['s12_ph4_dur',  12,'TXT','Phase 4 duration','60 days','60 días',''],
  ['s12_ph4_desc', 12,'TXT','Phase 4 description','Installation and commissioning','Instalación y puesta en marcha',''],
  ['s12_ph5_lbl',  12,'TXT','Phase 5 name','Operation & Maintenance','Operación y Mantenimiento',''],
  ['s12_ph5_dur',  12,'TXT','Phase 5 duration','Entire contract','Contrato completo',''],
  ['s12_ph5_desc', 12,'TXT','Phase 5 description','Monitoring and service','Monitoreo y servicio',''],
  // ── S13 O&M ───────────────────────────────────────────────────
  ['--- S13 O&M ---','','---','','','',''],
  ['s13_title',  13,'TXT','Slide title','O&M, WARRANTY AND DURABILITY','O&M, GARANTÍA Y DURABILIDAD',''],
  ['s13_om_t',   13,'TXT','O&M label','OPERATION & MAINTENANCE','OPERACIÓN Y MANTENIMIENTO',''],
  ['s13_om1',    13,'TXT','O&M bullet 1',"24/7 monitoring through ARGIA's platform",'Monitoreo 24/7 a través de la plataforma ARGIA',''],
  ['s13_om2',    13,'TXT','O&M bullet 2','Preventive and corrective maintenance','Mantenimiento preventivo y correctivo',''],
  ['s13_om3',    13,'TXT','O&M bullet 3','Regular cleaning and inspections','Limpieza e inspecciones regulares',''],
  ['s13_om4',    13,'TXT','O&M bullet 4','Monthly performance and financial reports','Reportes mensuales de desempeño y financieros',''],
  ['s13_om5',    13,'TXT','O&M bullet 5','Insurance for equipment, property damage, and liability','Seguro de equipos, daños a terceros y responsabilidad civil',''],
  ['s13_warr_t', 13,'TXT','Warranty label','WARRANTY AND DURABILITY','GARANTÍA Y DURABILIDAD',''],
  ['s13_warr1',  13,'TXT','Warranty 1','Modules: up to 25 years','Módulos: hasta 25 años',''],
  ['s13_warr2',  13,'TXT','Warranty 2','Inverters: up to 10 years','Inversores: hasta 10 años',''],
  ['s13_warr3',  13,'TXT','Warranty 3','Structures: 10 years','Estructuras: 10 años',''],
  ['s13_warr4',  13,'TXT','Warranty 4','EPC workmanship: 5 years','Mano de obra EPC: 5 años',''],
  ['s13_warr5',  13,'TXT','Warranty 5','Continuous O&M service for 15 years','Servicio continuo de O&M por 15 años',''],
  // ── S14 ENVIRONMENTAL ─────────────────────────────────────────
  ['--- S14 ENVIRONMENTAL ---','','---','','','',''],
  ['s14_title',  14,'TXT','Slide title','ENVIRONMENTAL & SOCIAL IMPACT','IMPACTO AMBIENTAL Y SOCIAL',''],
  ['s14_s1_unit',14,'TXT','Stat 1 unit','tons/year','ton/año',''],
  ['s14_s1_lbl', 14,'TXT','Stat 1 label','CO₂ emissions avoided','Emisiones CO₂ evitadas',''],
  ['s14_s2_unit',14,'TXT','Stat 2 unit','trees','árboles',''],
  ['s14_s2_lbl', 14,'TXT','Stat 2 label','Equivalent trees planted/year','Árboles equivalentes plantados por año',''],
  ['s14_s3_val', 14,'TXT','Stat 3 value','ISO 14001','ISO 14001',''],
  ['s14_s3_lbl', 14,'TXT','Stat 3 label','Supports ISO 14001 and ESG objectives','Apoya objetivos ISO 14001 y ESG',''],
  ['s14_s4_val', 14,'TXT','Stat 4 value','Improves','Mejora',''],
  ['s14_s4_lbl', 14,'TXT','Stat 4 label','Improves corporate\nsocial responsibility','Mejora la responsabilidad\nsocial corporativa',''],
  // ── S15 VALIDITY ──────────────────────────────────────────────
  ['--- S15 VALIDITY ---','','---','','','',''],
  ['s15_title',     15,'TXT','Slide title','VALIDITY, CONTACTS AND ANNEXES','VALIDEZ, CONTACTOS Y ANEXOS',''],
  ['s15_valid_t',   15,'TXT','Validity label','PROPOSAL VALIDITY','VALIDEZ DE LA PROPUESTA',''],
  ['s15_valid_v',   15,'TXT','Validity text','This offer is valid for {days} days from the date of issuance and is subject to change based on key conditions:','Esta oferta es válida por {days} días a partir de la fecha de emisión y está sujeta a cambios basados en condiciones clave:',''],
  ['s15_cond1',     15,'TXT','Condition 1','Current exchange rate (USD/MXN)','Tipo de cambio vigente (USD/MXN)',''],
  ['s15_cond2',     15,'TXT','Condition 2','Market equipment availability','Disponibilidad de equipos en el mercado',''],
  ['s15_cond3',     15,'TXT','Condition 3','Final technical site validation','Validación técnica final del sitio',''],
  ['s15_contact_t', 15,'TXT','Contact label','CONTACT','CONTACTO',''],
  ['s15_role1',     15,'TXT','Contact role 1','SALES DIRECTOR','DIRECTOR COMERCIAL',''],
  ['s15_role2',     15,'TXT','Contact role 2','SOLAR DESIGN DIRECTOR','DIRECTOR DE DISEÑO SOLAR',''],
  ['s15_role3',     15,'TXT','Contact role 3','TECHNICAL DIRECTOR','DIRECTOR TÉCNICO',''],
  ['s15_annex_t',   15,'TXT','Annexes label','ANNEXES','ANEXOS',''],
  ['s15_ann1',      15,'TXT','Annex 1','Annex 1: INSTALLATION SCHEDULE','Anexo 1: CRONOGRAMA DE INSTALACIÓN',''],
  ['s15_ann2',      15,'TXT','Annex 2','Annex 2: SOLAR DESIGN','Anexo 2: DISEÑO SOLAR',''],
  ['s15_ann3',      15,'TXT','Annex 3','Annex 3: REFERENCES','Anexo 3: REFERENCIAS',''],
  ['s15_ann4',      15,'TXT','Annex 4','Annex 4: PRODUCT DATASHEETS','Anexo 4: FICHAS TÉCNICAS DE PRODUCTOS',''],
];

// ─────────────────────────────────────────────────────────────────
// §3  SETUP
// ─────────────────────────────────────────────────────────────────
function setupSlideDataTab() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(K.SD_TAB) || ss.insertSheet(K.SD_TAB);
  var existing = {}, lr = tab.getLastRow();
  if (lr > 1) tab.getRange(2,1,lr-1,1).getValues().forEach(function(r,i){ if(r[0]) existing[r[0]]=i+2; });
  if (lr < 1) tab.getRange(1,1,1,7).setValues([SD_DEFAULTS[0]]);
  var toAppend = SD_DEFAULTS.slice(1).filter(function(r){ return !existing[r[0]]; });
  if (toAppend.length) tab.getRange(Math.max(tab.getLastRow()+1,2),1,toAppend.length,7).setValues(toAppend);
  _formatSD(tab);
  SpreadsheetApp.getUi().alert('✅ SLIDE_DATA ready! ('+tab.getLastRow()+' rows)\n\nFill column E (VALUE_EN) for each project row.\nRun testKickerData() to verify, then generateKickerEN().');
}

function _formatSD(tab) {
  var lr = tab.getLastRow(); if(lr<1) return;
  [180,45,45,200,280,280,80].forEach(function(w,i){ tab.setColumnWidth(i+1,w); });
  tab.setFrozenRows(1);
  tab.getRange(1,1,1,7).setBackground('#0D1B2A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10);
  var types = tab.getRange(2,3,lr-1,1).getValues();
  var keys  = tab.getRange(2,1,lr-1,1).getValues();
  types.forEach(function(row,i){
    var r=i+2, t=row[0], k=keys[i][0];
    if(t==='---'||String(k).indexOf('---')===0){
      tab.getRange(r,1,1,7).setBackground('#444444').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(8);
    } else if(t==='IMG'){ tab.getRange(r,1,1,7).setBackground('#E8F5E9');
    } else if(t==='CFG'){ tab.getRange(r,1,1,7).setBackground('#E3F2FD');
    } else {               tab.getRange(r,1,1,7).setBackground('#FFFFFF'); }
    if(t!=='---'&&String(k).indexOf('---')!==0){
      var f = t==='TXT'
        ? '=IF(AND(E'+r+'<>"",F'+r+'<>""),"✅ Both",IF(E'+r+'<>"","⚠️ EN only","❌ Missing"))'
        : '=IF(E'+r+'<>"","✅ Set","❌ Missing")';
      tab.getRange(r,7).setFormula(f);
    }
  });
  tab.getRange(1,1,lr,7).setVerticalAlignment('middle').setWrap(false);
  tab.getRange(1,5,lr,2).setWrap(true).setVerticalAlignment('top');
}

// ─────────────────────────────────────────────────────────────────
// §4  READER
// ─────────────────────────────────────────────────────────────────
function _readSlideData(ss) {
  var sd={img:{},cfg:{},txt:{},dat:{}}, tab=ss.getSheetByName(K.SD_TAB);
  if(!tab){ Logger.log('[Kicker] SLIDE_DATA tab missing'); return sd; }
  var lr=tab.getLastRow(); if(lr<2) return sd;
  var structVals = tab.getRange(2,1,lr-1,4).getValues();
  var dispVals   = tab.getRange(2,1,lr-1,6).getDisplayValues();
  structVals.forEach(function(row, i) {
    var key  = String(row[0]).trim();
    var typ  = String(row[2]).trim();
    var en   = String(dispVals[i][4]).trim();
    var es   = String(dispVals[i][5]).trim();
    if(!key||key.indexOf('---')===0||typ==='---') return;
    if     (typ==='IMG') sd.img[key]=en;
    else if(typ==='CFG') sd.cfg[key]=en;
    else if(typ==='TXT') sd.txt[key]={en:en, es:(es&&es!==''?es:en)};
    else if(typ==='DAT') sd.dat[key]=en;
    else {
      var val = String(dispVals[i][1]).trim();
      if(!val||val===''||val==='undefined') val = en;
      if(val&&val!=='undefined'&&val!=='') sd.dat[key]=val;
    }
  });
  Logger.log('[Kicker] SD: '+Object.keys(sd.img).length+' imgs | '+
    Object.keys(sd.cfg).length+' cfg | '+Object.keys(sd.txt).length+' txt | '+
    Object.keys(sd.dat).length+' dat');
  return sd;
}

function _sd(sd,key,lang,fb){
  var e=sd.txt[key]; if(!e) return (fb!==undefined)?fb:'—';
  var v=e[lang.toLowerCase()]||e['en']; return (v&&v!=='')?v:((fb!==undefined)?fb:'—');
}
function _cfg(sd,key,fb){ var v=sd.cfg[key]; return (v&&v!=='')?v:((fb!==undefined)?String(fb):'—'); }
function _sdImg(sd,key){ return sd.img[key]||key; }

// ─────────────────────────────────────────────────────────────────
// §4b  PROGRESS BAR  (HTML modeless dialog + ScriptProperties)
// ─────────────────────────────────────────────────────────────────
var KICKER_PROGRESS_KEY = 'KICKER_PROGRESS';

// Called by the HTML dialog every 600 ms via google.script.run
function getKickerProgress(){
  var raw=PropertiesService.getScriptProperties().getProperty(KICKER_PROGRESS_KEY);
  return raw ? JSON.parse(raw) : null;
}

function _setProgress(step,total,label){
  PropertiesService.getScriptProperties().setProperty(KICKER_PROGRESS_KEY,
    JSON.stringify({step:step,total:total,pct:Math.round(step/total*100),label:label,done:step>=total}));
}

var KICKER_PROGRESS_HTML = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
  '<style>' +
  'body{font-family:Arial,sans-serif;padding:18px 22px;margin:0;background:#fff;box-sizing:border-box;}' +
  'h3{font-size:13px;color:#0D1B2A;margin:0 0 12px;font-weight:700;letter-spacing:0.03em;}' +
  '#task{font-size:11px;color:#555;margin-bottom:9px;min-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
  '.bg{background:#E5E7EB;border-radius:5px;height:10px;overflow:hidden;}' +
  '.fill{background:#0D1B2A;height:10px;border-radius:5px;width:0%;transition:width 0.35s ease;}' +
  '#pct{font-size:10px;color:#999;text-align:right;margin-top:4px;}' +
  '</style></head><body>' +
  '<h3>ARGIA — Generating offer</h3>' +
  '<div id="task">Starting…</div>' +
  '<div class="bg"><div class="fill" id="bar"></div></div>' +
  '<div id="pct">0 %</div>' +
  '<script>' +
  'function poll(){' +
    'google.script.run' +
      '.withSuccessHandler(function(p){' +
        'if(!p){setTimeout(poll,600);return;}' +
        'document.getElementById("task").textContent=p.label;' +
        'document.getElementById("bar").style.width=p.pct+"%";' +
        'document.getElementById("pct").textContent=p.pct+" %";' +
        'if(p.done){setTimeout(function(){google.script.host.close();},1400);}' +
        'else{setTimeout(poll,600);}' +
      '})' +
      '.withFailureHandler(function(){setTimeout(poll,800);})' +
      '.getKickerProgress();' +
  '}' +
  'setTimeout(poll,400);' +
  '<\/script></body></html>';

// ─────────────────────────────────────────────────────────────────
// §5  ENTRY POINTS
// ─────────────────────────────────────────────────────────────────
// onOpen_Kicker removed — menu now in 00_Main.gs onOpen()
function generateKickerEN(){ _runKicker('EN'); }
function generateKickerES(){ _runKicker('ES'); }
function _runKicker(lang){
  var ui=SpreadsheetApp.getUi();
  var TOTAL=18; // steps: 1 init + 1 read + 1 images + 1 create + 15 slides - 1 done
  _setProgress(0,TOTAL,'Initialising…');

  // Open HTML progress dialog (modeless — stays open while main runs)
  ui.showModelessDialog(
    HtmlService.createHtmlOutput(KICKER_PROGRESS_HTML).setWidth(420).setHeight(130),
    'ARGIA — Generating offer'
  );

  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();

    _setProgress(1,TOTAL,'Reading SLIDE_DATA…');
    var sd=_readSlideData(ss), data=_readProjectData(sd);

    _setProgress(2,TOTAL,'Loading images from Drive…');
    var imgs=_loadImages(sd);

    _setProgress(3,TOTAL,'Creating presentation…');
    var pres=SlidesApp.create('ARGIA Solar PPA — '+data.clientName+' — '+lang+' — '+_today());
    var blank=pres.getSlides()[0];

    var slideFns=[_s01,_s02,_s03,_s04,_s05,_s06,_s07,_s08,_s09,_s10,_s11,_s12,_s13,_s14,_s15];
    var slideNames=['Cover','Table of Contents','About ARGIA','ARGIA in Numbers','Why Choose ARGIA',
      'What is a Solar PPA','How it Works','Your Requirements','Project Overview',
      'General Description','Financial Benefits','Implementation Process',
      'O&M and Warranty','Environmental Impact','Validity and Contacts'];

    slideFns.forEach(function(fn,i){
      _setProgress(3+i+1,TOTAL,'Slide '+(i+1)+'/15 — '+slideNames[i]);
      var sl=i===0?blank:pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
      _clearSlide(sl); sl.getBackground().setSolidFill(K.C.WHITE);
      fn(sl,data,imgs,lang,sd);
      Logger.log('[Kicker] Slide '+(i+1)+' done');
    });

    // Move presentation to Offer folder (MASTERLINK H2) -----------------------
    try{
      var folders=getMasterLinkFolderIds(ss);
      var offerFolder=DriveApp.getFolderById(folders.offerFolderId);
      var presFile=DriveApp.getFileById(pres.getId());
      offerFolder.addFile(presFile);
      DriveApp.getRootFolder().removeFile(presFile);
      Logger.log('[Kicker] Offer moved to folder: '+offerFolder.getName());
    }catch(moveErr){
      // Non-fatal: presentation created OK, just stays in Drive root
      Logger.log('[Kicker] WARNING: could not move offer to folder: '+moveErr.message+'\nURL: '+pres.getUrl());
    }

    _setProgress(TOTAL,TOTAL,'✅ Done!');
    Utilities.sleep(1600); // let dialog reach 100 % before auto-close

    ui.alert('✅ Offer ('+lang+') ready!\n\n'+pres.getUrl());
  }catch(e){
    _setProgress(TOTAL,TOTAL,'❌ Error — see alert');
    ui.alert('❌ '+e.message+'\n\n'+e.stack);
    throw e;
  }
}
// ─────────────────────────────────────────────────────────────────
// §6  PROJECT DATA READER
// ─────────────────────────────────────────────────────────────────
function _readProjectData(sd) {
  var D = sd.dat || {};

  function _fmtVal(v, dec, unit) {
    if (!v || v === '—') return '—';
    var s = String(v).trim();
    var raw = parseFloat(s.replace(/[$,\s]/g,''));
    if (isNaN(raw)) return s;
    var hasLongDecimal = (s.indexOf('.') > -1 && s.split('.')[1].length > 3);
    var isLargeRaw     = (raw > 1000 && s.indexOf(',') === -1 && s.indexOf('$') === -1);
    if (hasLongDecimal || isLargeRaw) {
      s = raw.toLocaleString('es-MX', {minimumFractionDigits:dec, maximumFractionDigits:dec});
      return unit ? s + ' ' + unit : s;
    }
    s = s.replace(/\$/g,'').trim();
    return unit ? s + ' ' + unit : s;
  }
  function _fmtPct(v) {
    if (!v || v === '—') return '—';
    var s = String(v).trim();
    if (s.indexOf('%') > -1) return s;
    var n = parseFloat(s.replace(/[,\s]/g,''));
    if (isNaN(n)) return s;
    if (n > 0 && n <= 1) n = n * 100;
    return n.toFixed(1) + '%';
  }
  function g(k, fb) {
    var v = D[k];
    return (v !== undefined && v !== null && String(v).trim() !== '') ? String(v).trim() : (fb !== undefined ? String(fb) : '—');
  }
  function gN(k, fb) {
    var n = parseFloat(String(g(k,'')).replace(/[$%,\s\u00A0]/g,''));
    return isNaN(n) ? (fb !== undefined ? fb : 0) : n;
  }
  function fN(v, dec) {
    dec = (dec === undefined) ? 0 : dec;
    return (typeof v === 'number' && !isNaN(v))
      ? v.toLocaleString('es-MX', {minimumFractionDigits:dec, maximumFractionDigits:dec})
      : String(v);
  }

  var kwp            = gN('system_kwp');
  var consumptionMwh = gN('annual_mwh');
  var coverageStr    = g('system_coverage_pct','');
  var coverageNum    = parseFloat(coverageStr.replace(/[%,\s]/g,'')) || 0;
  var coveragePct    = (coverageNum > 0 && coverageNum <= 1) ? coverageNum * 100 : coverageNum;
  var solarMwh       = gN('solar_mwh', 0);
  if (solarMwh === 0 && consumptionMwh > 0 && coveragePct > 0) solarMwh = consumptionMwh * (coveragePct / 100);
  var co2            = gN('co2_tons');
  var contractYears  = gN('contract_years', 15);
  var offerValidDays = gN('offer_valid_days', 60);
  var implDays       = gN('impl_days', 75);
  var coverageFmt    = (coveragePct > 0)
    ? (coverageStr.indexOf('%') > -1 ? coverageStr : fN(coveragePct,1)+'%') : '—';

  return {
    clientName:           g('client_name'),
    projectName:          g('client_name'),
    clientAddress:        g('client_location'),
    projectLocation:      g('client_location'),
    projectType:          g('project_type', 'Rooftop PV Power Plant'),
    contractYears:        contractYears,
    offerValidDays:       offerValidDays,
    implDays:             implDays,
    panelModel:           g('panel_model'),
    inverterModel:        g('inv_model'),
    mountingType:         g('mounting_type', 'Aluminum roof structure'),
    panelWarranty:        g('panel_warranty', '12 yr product / 25 yr linear'),
    inverterWarranty:     g('inv_warranty', '5 yr (extendable to 10)'),
    epcWarranty:          g('epc_warranty', '5 yr workmanship'),
    contacts: {
      sales: { name:g('salesperson_name'), email:g('salesperson_email'), phone:g('salesperson_phone') },
      solar: { name:g('solar_name'),       email:g('solar_email'),       phone:g('solar_phone')       },
      tech:  { name:g('tech_name'),        email:g('tech_email'),        phone:g('tech_phone')        },
    },
    capacityKWpFmt:       kwp > 0 ? fN(kwp,1)+' kWp' : g('system_kwp'),
    capacityKWacFmt:      g('system_kwac', kwp > 0 ? fN(Math.round(kwp*0.85),0)+' kW AC' : '—'),
    annualGenMWhFmt:      solarMwh > 0 ? fN(solarMwh,0)+' MWh' : '—',
    annualGenMWh:         solarMwh > 0 ? fN(solarMwh,0) : '—',
    annualGenKWhFmt:      solarMwh > 0 ? fN(solarMwh*1000,0)+' kWh' : '—',
    currentConsumption:   consumptionMwh > 0 ? fN(consumptionMwh,0) : '—',
    generationYieldFmt:   (kwp>0&&solarMwh>0) ? fN(Math.round(solarMwh*1000/kwp),0)+' kWh/kWp' : '—',
    generationYield:      (kwp>0&&solarMwh>0) ? fN(Math.round(solarMwh*1000/kwp),0) : '—',
    solarCoveragePct:     coverageFmt,
    currentCFERate:       _fmtVal(g('avg_kwh_price'),      3, null),
    currentCFERateFmt:    _fmtVal(g('avg_kwh_price'),      3, 'MXN/kWh'),
    annualCFEPayment:     _fmtVal(g('annual_energy_cost'), 0, null),
    annualCFEPaymentFmt:  _fmtVal(g('annual_energy_cost'), 0, null),
    ppaRate:              _fmtVal(g('ppa_rate','—'),        3, null),
    ppaRateFmt:           _fmtVal(g('ppa_rate','—'),        3, 'MXN/kWh'),
    ppaDiscountPct:       _fmtPct(g('ppa_discount','—')),
    annualSavings:        _fmtVal(g('annual_savings'),      0, null),
    annualSavingsFmt:     _fmtVal(g('annual_savings'),      0, null),
    accumulatedSavings:   _fmtVal(g('savings_10yr'),        0, null),
    accumulatedSavingsFmt:_fmtVal(g('savings_10yr'),        0, null),
    annualARGIAPayment:   _fmtVal(g('annual_argia_payment','—'), 0, null),
    annualARGIAPaymentFmt:_fmtVal(g('annual_argia_payment','—'), 0, null),
    totalAnnualPayment:   _fmtVal(g('total_annual_payment','—'), 0, null),
    totalAnnualPaymentFmt:_fmtVal(g('total_annual_payment','—'), 0, null),
    indexation:           g('indexation', 'IPC'),
    co2TonsYearFmt:       co2 > 0 ? fN(co2,0) : g('co2_tons'),
    treesEquivFmt:        co2 > 0 ? fN(Math.round(co2*18),0) : '—',
    capexTotal:           g('capex_total'),
    roiYears:             g('roi_years'),
    irr10yr:              g('irr_10yr'),
    observations:         g('observations'),
    notes:                g('notes'),
    prodMonths: ['prod_jan','prod_feb','prod_mar','prod_apr','prod_may','prod_jun',
                 'prod_jul','prod_aug','prod_sep','prod_oct','prod_nov','prod_dec']
                .map(function(k){ return g(k,'0'); }),
  };
}

// ─────────────────────────────────────────────────────────────────
// §7  IMAGE LOADER
// ─────────────────────────────────────────────────────────────────
function _normalise(s){ return String(s).toLowerCase().replace(/[\s\-]+/g,'_').trim(); }

function _loadImages(sd){
  // Step 1: preload image assets — folder ID from 00_MASTERLINK!K2 (col 11, row 2)
  // Falls back to K.IMAGE_FOLDER_ID constant if K2 is blank.
  var map={};
  try{
    var _imgFolderId = K.IMAGE_FOLDER_ID;
    try {
      var _ss = SpreadsheetApp.getActiveSpreadsheet();
      var _ml = _ss.getSheetByName('00_MASTER_LINK') || _ss.getSheetByName('00_MASTERLINK');
      if (_ml) {
        var _k2 = String(_ml.getRange(2, 11).getValue() || '').trim();
        if (_k2) _imgFolderId = _k2;
      }
    } catch(e_) {}
    if (!_imgFolderId) throw new Error('Image assets folder ID not configured in 00_MASTERLINK!K2');
    var folder=DriveApp.getFolderById(_imgFolderId);
    var files=folder.getFiles(), list=[];
    while(files.hasNext()) list.push(files.next());
    list.forEach(function(fi){
      var key=_normalise(fi.getName().replace(/\.[^.]+$/,''));
      try{ map[key]=fi.getBlob(); }
      catch(e){ Logger.log('[Kicker] Blob load fail: '+key+': '+e.message); }
    });
    Logger.log('[Kicker] Assets folder: preloaded '+Object.keys(map).length+' blobs from '+folder.getName());
  }catch(e){ Logger.log('[Kicker] Drive assets folder error: '+e.message); }

  // Step 2: load Helioscope.png from the Helioscope folder (MASTERLINK I2).
  // Registers it under key 'helioscope' so slide S09 picks it up automatically.
  // If not present (import not yet run) a grey placeholder renders instead.
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var folders=getMasterLinkFolderIds(ss);
    var helioFolder=DriveApp.getFolderById(folders.helioFolderId);
    var helioFiles=helioFolder.getFilesByName('Helioscope.png');
    if(helioFiles.hasNext()){
      map['helioscope']=helioFiles.next().getBlob();
      Logger.log('[Kicker] Helioscope.png loaded from Helioscope folder (I2)');
    }else{
      Logger.log('[Kicker] Helioscope.png not found in I2 — placeholder will render');
    }
  }catch(e){ Logger.log('[Kicker] Helioscope folder lookup failed: '+e.message); }

  Logger.log('[Kicker] Total blobs loaded: '+Object.keys(map).length);
  return map;
}

function _imgCover(slide,imgs,sd,role,l,t,w,h){
  var blob=imgs[_normalise(_sdImg(sd,role))];   // blob preloaded in _loadImages
  if(!blob){
    Logger.log('[Kicker] Missing blob: '+role);
    var ph=slide.insertShape(SlidesApp.ShapeType.RECTANGLE,l,t,w,h);
    ph.getFill().setSolidFill('#E8E8E8'); ph.getBorder().setTransparent();
    ph.getText().setText('['+role+']');
    ph.getText().getTextStyle().setFontSize(7).setForegroundColor(K.C.PALE);
    return ph;
  }
  try{
    var img=slide.insertImage(blob,l,t,w,h);
    var ow=img.getInherentWidth(), oh=img.getInherentHeight();
    if(ow>0&&oh>0){
      var scale=Math.max(w/ow, h/oh);
      var nw=ow*scale, nh=oh*scale;
      img.setLeft(l+(w-nw)/2).setTop(t+(h-nh)/2).setWidth(nw).setHeight(nh);
    }
    return img;
  }catch(e){ Logger.log('[Kicker] imgCover fail ('+role+'): '+e.message); return null; }
}

function _img(slide,imgs,sd,role,l,t,w,h){
  var blob=imgs[_normalise(_sdImg(sd,role))];   // blob preloaded in _loadImages
  if(!blob){
    Logger.log('[Kicker] Missing blob: '+role);
    var ph=slide.insertShape(SlidesApp.ShapeType.RECTANGLE,l,t,w,h);
    ph.getFill().setSolidFill('#E8E8E8'); ph.getBorder().setTransparent();
    var ptf=ph.getText(); ptf.setText('['+role+']'); ptf.getTextStyle().setFontSize(7).setForegroundColor(K.C.PALE);
    return ph;
  }
  try{
    return slide.insertImage(blob,l,t,w,h);
  }catch(e){ Logger.log('[Kicker] Insert fail ('+role+'): '+e.message); return null; }
}

// ─────────────────────────────────────────────────────────────────
// §8  LAYOUT HELPERS
// ─────────────────────────────────────────────────────────────────
function _tx(slide,text,l,t,w,h,o){
  o=o||{};
  var str=String(text===null||text===undefined?'':text);
  var tb=slide.insertTextBox(str||' ',l,t,w,h), tf=tb.getText();
  var s=tf.getTextStyle();
  if(o.bold)   s.setBold(true);
  if(o.italic) s.setItalic(true);
  s.setFontSize(o.size||11);
  s.setForegroundColor(o.color||K.C.BLACK);
  s.setFontFamily(o.font||(o.size>=20?K.FONT_DISPLAY:K.FONT_BODY));
  tf.getParagraphStyle().setParagraphAlignment(
    o.align==='center'?SlidesApp.ParagraphAlignment.CENTER:
    o.align==='right' ?SlidesApp.ParagraphAlignment.END:
                        SlidesApp.ParagraphAlignment.START);
  tb.setContentAlignment(
    o.valign==='middle'?SlidesApp.ContentAlignment.MIDDLE:
    o.valign==='bottom'?SlidesApp.ContentAlignment.BOTTOM:
                        SlidesApp.ContentAlignment.TOP);
  tf.setText(str);
  tb.getFill().setTransparent(); tb.getBorder().setTransparent();
  return tb;
}
function _rect(slide,l,t,w,h,fill,alpha){
  var sh=slide.insertShape(SlidesApp.ShapeType.RECTANGLE,l,t,w,h);
  if(fill) sh.getFill().setSolidFill(fill,alpha!==undefined?alpha:1); else sh.getFill().setTransparent();
  sh.getBorder().setTransparent(); return sh;
}
function _hr(slide,l,t,w,color,weight){
  var ln=slide.insertLine(SlidesApp.LineCategory.STRAIGHT,l,t,l+w,t);
  ln.getLineFill().setSolidFill(color||K.C.LINE); ln.setWeight(weight||0.5); return ln;
}
function _vl(slide,x,y,h){
  var ln=slide.insertLine(SlidesApp.LineCategory.STRAIGHT,x,y,x,y+h);
  ln.getLineFill().setSolidFill(K.C.LINE); ln.setWeight(0.75); return ln;
}
function _logo(slide,imgs,sd,l,t,w,h,dark){
  var role=dark?'argia_logo_dark':'argia_logo_white';
  return _img(slide,imgs,sd,role,l,t,w,h)||
    _tx(slide,'AR3IA',l,t,w,h,{bold:true,size:14,color:dark?K.C.NAVY:K.C.WHITE,align:'right'});
}
// Footer — positions from PPTX template (scaled to 720×405)
function _footer(slide,n,sd){
  var fy=H-16, fh=14;
  _tx(slide,_cfg(sd,'footer_left','SMART ENERGY SOLUTIONS'),14,fy,160,fh,{size:7,color:K.C.LITE,valign:'middle'});
  _tx(slide,_cfg(sd,'url','www.argia.solar'),576,fy,108,fh,{size:8,bold:true,color:K.C.LITE,align:'center',valign:'middle'});
  _rect(slide,690,fy,24,fh,K.C.NAVY);
  _tx(slide,String(n),690,fy,24,fh,{size:8,color:K.C.WHITE,align:'center',valign:'middle'});
}
function _clearSlide(slide){ slide.getPlaceholders().forEach(function(p){p.remove();}); }

// ─────────────────────────────────────────────────────────────────
// §9  SLIDE BUILDERS  v14
// Source: PPTX template 17"×11" → scaled to 720×405
// Font scale: SY=0.511 (template pt × 0.511 = script pt)
// ─────────────────────────────────────────────────────────────────

// Header helpers (two styles from template)
function _hdrA(slide,imgs,sd,title,lang){   // used on data-heavy slides (2,4,8,9,11,12,15)
  _tx(slide,title,25,8,580,44,{bold:false,size:18,color:K.C.DARK,font:K.FONT_DISPLAY});
  _logo(slide,imgs,sd,W-90,8,80,24,true);
}
function _hdrB(slide,imgs,sd,title,lang){   // used on content slides (3,5,6,7,10,13,14)
  _tx(slide,title,41,10,560,44,{bold:false,size:18,color:K.C.DARK,font:K.FONT_DISPLAY});
  _logo(slide,imgs,sd,W-90,8,80,24,true);
}

// ── S01 COVER ──────────────────────────────────────────────────
function _s01(slide,data,imgs,lang,sd){
  _imgCover(slide,imgs,sd,'cover_bg',0,0,W,H);
  // no top navy rect — logo and lines sit directly on photo
  _hr(slide,14,26,692,K.C.WHITE,0.5);
  _hr(slide,14,66,692,K.C.WHITE,0.5);
  _logo(slide,imgs,sd,14,34,108,22,false);
  // SOLAR PPA — size 27
  _tx(slide,'SOLAR PPA',340,26,W-354,40,{bold:false,size:27,color:K.C.WHITE,align:'right',font:K.FONT_DISPLAY});
  // tagline + URL — size 12, white
  _tx(slide,_sd(sd,'s01_tagline',lang),14,70,520,16,{size:12,color:K.C.WHITE});
  _tx(slide,_cfg(sd,'url','www.argia.solar'),540,70,170,16,{size:12,color:K.C.WHITE,align:'right'});
  // client name block — size 26 for both label and name
  _tx(slide,_sd(sd,'s01_title',lang),49,248,380,22,{bold:false,size:14,color:'#DDDDDD',font:K.FONT_DISPLAY});
  _tx(slide,data.clientName.toUpperCase(),49,268,375,80,{bold:true,size:26,color:K.C.WHITE,font:K.FONT_DISPLAY});
  // savings
  _tx(slide,_sd(sd,'s01_acc_label',lang),49,332,152,18,{size:10,color:'#BBBBBB'});
  _tx(slide,data.accumulatedSavings+' MXN',205,332,210,18,{size:13,bold:true,color:K.C.WHITE});
  _tx(slide,_sd(sd,'s01_yrs_label',lang),49,353,60,16,{size:10,color:'#BBBBBB'});
  _tx(slide,String(data.contractYears),118,353,60,16,{size:13,bold:true,color:K.C.WHITE});
  _rect(slide,596,297,99,87,K.C.WHITE);
  _img(slide,imgs,sd,'client_logo',599,300,93,81);
}

// ── S02 TABLE OF CONTENTS ──────────────────────────────────────
// FIX: ARGIA logo removed — photo already contains ARGIA branding
function _s02(slide,data,imgs,lang,sd){
  _imgCover(slide,imgs,sd,'toc_city',W-320,0,320,H);
  // No _logo() call — city photo has ARGIA branding built in
  _tx(slide,_sd(sd,'s02_title',lang),25,8,370,32,{bold:false,size:18,color:K.C.DARK,font:K.FONT_DISPLAY});
  var tocKeys=['s02_toc_01','s02_toc_02','s02_toc_03','s02_toc_04','s02_toc_05',
               's02_toc_06','s02_toc_07','s02_toc_08','s02_toc_09','s02_toc_10',
               's02_toc_11','s02_toc_12','s02_toc_13'];
  var pageNums=[3,4,5,6,7,8,9,10,11,12,13,14,15];
  var startY=46, rowH=25;
  tocKeys.forEach(function(k,i){
    var y=startY+i*rowH;
    _tx(slide,_sd(sd,k,lang,'—'),41,y,285,rowH-3,{size:11,color:K.C.DARK});
    _tx(slide,String(pageNums[i]),314,y,30,rowH-3,{size:11,color:K.C.DARK,align:'right'});
    _hr(slide,42,y+rowH-2,318,K.C.LINE,0.5);
  });
  _rect(slide,534,72,186,81,K.C.WHITE,0.95);
  _tx(slide,_sd(sd,'s02_customer',lang),542,78,172,14,{bold:true,size:9,color:K.C.DARK});
  _tx(slide,data.clientName,542,93,172,14,{size:9,color:K.C.DARK});
  _tx(slide,data.clientAddress,542,108,172,36,{size:8,color:K.C.MID});
  _rect(slide,534,166,186,81,K.C.WHITE,0.95);
  _tx(slide,_sd(sd,'s02_supplier',lang),542,172,172,14,{bold:true,size:9,color:K.C.DARK});
  _tx(slide,_cfg(sd,'supplier_name','ARGIA MEXICO S.A. de C.V.'),542,187,172,14,{size:9,color:K.C.DARK});
  _tx(slide,_cfg(sd,'supplier_addr','León, Guanajuato'),542,202,172,36,{size:8,color:K.C.MID});
  _footer(slide,2,sd);
}

// ── S03 ABOUT ARGIA ────────────────────────────────────────────
function _s03(slide,data,imgs,lang,sd){
  _hdrB(slide,imgs,sd,_sd(sd,'s03_title',lang),lang);
  _tx(slide,_sd(sd,'s03_bold',lang),42,52,240,110,{bold:true,size:18,color:K.C.DARK,font:K.FONT_DISPLAY});
  _tx(slide,_sd(sd,'s03_desc',lang),282,52,420,110,{size:13,color:K.C.DARK});
  _hr(slide,42,210,651,K.C.DARK,0.75);
  _tx(slide,_sd(sd,'s03_mission_t',lang),42,222,194,22,{bold:false,size:15,color:K.C.DARK,font:K.FONT_DISPLAY});
  // extra line-height for mission text
  _tx(slide,_sd(sd,'s03_mission_v',lang),42,248,194,110,{size:12,color:K.C.MID});
  _tx(slide,_sd(sd,'s03_ben_t',lang),282,222,410,22,{bold:false,size:15,color:K.C.DARK,font:K.FONT_DISPLAY});
  // tighter benefit rows
  var benY=248;
  ['s03_ben_1','s03_ben_2','s03_ben_3','s03_ben_4'].forEach(function(k,i){
    if(i>0) _hr(slide,283,benY-3,395,K.C.LINE,0.5);
    _tx(slide,'• '+_sd(sd,k,lang),282,benY,420,26,{size:10,color:K.C.DARK}); benY+=28;
  });
  _footer(slide,3,sd);
}

// ── S04 ARGIA IN NUMBERS ───────────────────────────────────────
function _s04(slide,data,imgs,lang,sd){
  _hdrA(slide,imgs,sd,_sd(sd,'s04_title',lang),lang);
  // photo bounded within slide (no overflow), moved up to reveal footer
  _img(slide,imgs,sd,'numbers_bg',0,228,W,H-228-18);
  _rect(slide,0,228,W,H-228-18,K.C.NAVY,0.40);
  // vertical center of white zone: title ends ~y=52, photo starts y=228
  // visible text (number+label) ≈ 80pt. Mid = (52+228)/2 = 140. Top = 140-40 = 100
  var stats=[
    [_sd(sd,'s04_stat1_val',lang,'+2,000'),_sd(sd,'s04_stat1_lbl',lang,'projects\ncompleted'),      14, 100],
    [_sd(sd,'s04_stat2_val',lang,'+27.5'), _sd(sd,'s04_stat2_lbl',lang,'million m\u00B2\nof facilities'),194,100],
    [_sd(sd,'s04_stat3_val',lang,'70%'),   _sd(sd,'s04_stat3_lbl',lang,'average\nenergy savings'),  374,100],
    [_sd(sd,'s04_stat4_val',lang,'15+'),   _sd(sd,'s04_stat4_lbl',lang,'years of experience\nin Europe and Mexico'),554,100],
  ];
  var colW=166;
  // arrow line height = same span as old vertical separators (y=52→y=114)
  stats.forEach(function(st,i){
    var x=st[2], y=st[3], val=String(st[0]);
    var sz=val.length<=3?36:val.length<=5?32:28;
    _tx(slide,val,x,y,colW-8,56,{bold:false,size:sz,color:K.C.DARK,align:'center',font:K.FONT_DISPLAY});
    _tx(slide,st[1],x,y+56,colW-8,32,{size:9,color:K.C.MID,align:'center'});
  });
  _footer(slide,4,sd);
}

// ── S05 WHY CHOOSE ARGIA ───────────────────────────────────────
// FIX: Step descriptions added below labels in photo overlay
function _s05(slide,data,imgs,lang,sd){
  _hdrB(slide,imgs,sd,_sd(sd,'s05_title',lang),lang);
  _tx(slide,_sd(sd,'s05_lead',lang),42,77,275,91,{bold:true,size:18,color:K.C.DARK,font:K.FONT_DISPLAY});
  _tx(slide,_sd(sd,'s05_desc',lang,''),42,150,275,48,{size:10,color:K.C.MID});
  _tx(slide,'Why Choose ARGIA MEXICO:',426,71,269,18,{bold:true,size:10,color:K.C.DARK});
  var bY=91;
  ['s05_bul1','s05_bul2','s05_bul3','s05_bul4'].forEach(function(k){
    _tx(slide,'• '+_sd(sd,k,lang),426,bY,269,24,{size:10,color:K.C.DARK}); bY+=26;
  });
  _hr(slide,42,210,651,K.C.LINE,0.75);
  _tx(slide,_sd(sd,'s05_proc_t',lang,'Our Process:'),42,213,160,16,{bold:true,size:10,color:K.C.DARK});
  var stepX   =[0,  175,309,439,575];
  var stepW   =[161,120,120,120,144];
  var stepImgs=['step1_photo','step2_photo','step3_photo','step4_photo','step5_photo'];
  var stepNums=['s05_p1_num','s05_p2_num','s05_p3_num','s05_p4_num','s05_p5_num'];
  var stepLbls=['s05_p1_lbl','s05_p2_lbl','s05_p3_lbl','s05_p4_lbl','s05_p5_lbl'];
  var stepDesc=['s05_p1_desc','s05_p2_desc','s05_p3_desc','s05_p4_desc','s05_p5_desc'];
  var imgY=220, imgH=145; // taller to accommodate label + description
  stepImgs.forEach(function(role,i){
    var x=stepX[i], w=stepW[i];
    _img(slide,imgs,sd,role,x,imgY,w,imgH);
    _rect(slide,x,imgY+imgH-52,w,52,K.C.NAVY,0.80);
    _tx(slide,_sd(sd,stepNums[i],lang),x+4,imgY+4,18,14,{size:10,color:K.C.WHITE});
    _tx(slide,_sd(sd,stepLbls[i],lang),x+2,imgY+imgH-50,w-4,16,{bold:true,size:10,color:K.C.WHITE});
    _tx(slide,_sd(sd,stepDesc[i],lang,''),x+2,imgY+imgH-32,w-4,28,{size:7,color:'#CCCCCC'});
  });
  _footer(slide,5,sd);
}

// ── S06 WHAT IS A SOLAR PPA ────────────────────────────────────
function _s06(slide,data,imgs,lang,sd){
  _hdrB(slide,imgs,sd,_sd(sd,'s06_title',lang),lang);
  _imgCover(slide,imgs,sd,'ppa_field',296,82,424,276);
  _tx(slide,_sd(sd,'s06_bold',lang),42,77,210,130,{bold:true,size:18,color:K.C.DARK,font:K.FONT_DISPLAY});
  _tx(slide,_sd(sd,'s06_desc',lang),42,242,240,120,{size:11,color:K.C.DARK});
  _footer(slide,6,sd);
}

// ── S07 HOW IT WORKS ───────────────────────────────────────────
function _s07(slide,data,imgs,lang,sd){
  _hdrB(slide,imgs,sd,_sd(sd,'s07_title',lang),lang);
  _imgCover(slide,imgs,sd,'ppa_aerial',0,82,296,276);
  var rx=335;
  _tx(slide,_sd(sd,'s07_how_t',lang),rx,77,370,22,{bold:false,size:13,color:K.C.DARK,font:K.FONT_DISPLAY});
  var howY=100;
  ['s07_how1','s07_how2','s07_how3','s07_how4'].forEach(function(k,i){
    _tx(slide,(i+1)+'.  '+_sd(sd,k,lang),rx,howY,370,26,{size:11,color:K.C.DARK,bold:i===0});
    _hr(slide,rx,howY+24,360,K.C.LINE,0.5); howY+=28;
  });
  _tx(slide,_sd(sd,'s07_key_t',lang),rx,212,370,22,{bold:false,size:13,color:K.C.DARK,font:K.FONT_DISPLAY});
  var keyY=238;
  ['s07_key1','s07_key2','s07_key3','s07_key4','s07_key5'].forEach(function(k){
    _tx(slide,'• '+_sd(sd,k,lang),rx,keyY,370,22,{size:11,color:K.C.DARK}); keyY+=24;
  });
  _footer(slide,7,sd);
}

// ── S08 YOUR REQUIREMENTS ──────────────────────────────────────
function _s08(slide,data,imgs,lang,sd){
  _hdrA(slide,imgs,sd,_sd(sd,'s08_title',lang),lang);
  _tx(slide,_sd(sd,'s08_cust_t',lang),42,103,200,44,{bold:true,size:18,color:K.C.DARK,font:K.FONT_DISPLAY});
  var custY=175;
  ['s08_cust1','s08_cust2','s08_cust3','s08_cust4'].forEach(function(k,i){
    if(i>0) _hr(slide,43,custY-3,320,K.C.LINE,0.5);
    _tx(slide,'• '+_sd(sd,k,lang),39,custY,320,22,{size:11,bold:true,color:K.C.DARK}); custY+=25;
  });
  _rect(slide,387,110,42,36,'#008E73');
  _tx(slide,'✓',387,110,42,36,{size:18,bold:true,color:K.C.WHITE,align:'center',valign:'middle'});
  _tx(slide,_sd(sd,'s08_argia_t',lang),449,103,235,44,{bold:true,size:18,color:K.C.DARK,font:K.FONT_DISPLAY});
  var solY=175;
  ['s08_argia1','s08_argia2','s08_argia3','s08_argia4'].forEach(function(k,i){
    if(i>0) _hr(slide,416,solY-3,286,K.C.LINE,0.5);
    _tx(slide,'✓  '+_sd(sd,k,lang),416,solY,290,22,{size:11,color:K.C.DARK}); solY+=25;
  });
  _footer(slide,8,sd);
}

// ── S09 PROJECT OVERVIEW ───────────────────────────────────────
// FIX: _img (not _imgCover) — prevents landscape photo overflow into spec table
function _s09(slide,data,imgs,lang,sd){
  _hdrA(slide,imgs,sd,_sd(sd,'s09_title',lang),lang);
  _img(slide,imgs,sd,'helioscope',0,67,295,292);
  var lx=323, vx=486, rw=W-vx-10, ry=58, rh=19;
  function specRow(lbl,val){
    _tx(slide,lbl,lx,ry,155,rh,{size:9,color:K.C.MID});
    _tx(slide,val,vx,ry,rw,rh,{size:9,bold:true,color:K.C.DARK});
    _hr(slide,lx,ry+rh-1,W-lx-10,K.C.LINE,0.3); ry+=rh;
  }
  specRow(_sd(sd,'s09_row1',lang),data.projectType);
  specRow(_sd(sd,'s09_row2',lang),data.projectLocation);
  specRow(_sd(sd,'s09_row3',lang),data.capacityKWpFmt+' ('+data.capacityKWacFmt+')');
  specRow(_sd(sd,'s09_row4',lang),data.annualGenMWhFmt);
  specRow(_sd(sd,'s09_row5',lang),data.generationYield+' kWh/kWp');
  specRow(_sd(sd,'s09_row6',lang),data.solarCoveragePct);
  specRow(_sd(sd,'s09_row7',lang),data.co2TonsYearFmt+' ton/yr');
  specRow(_sd(sd,'s09_row8',lang,'Lifetime'),_sd(sd,'s09_life',lang,'25+ years'));
  ry+=4;
  _tx(slide,_sd(sd,'s09_tech_t',lang),lx,ry,W-lx-10,16,{bold:true,size:9,color:K.C.DARK}); ry+=18;
  [[_sd(sd,'s09_tech1',lang),data.panelModel],
   [_sd(sd,'s09_tech2',lang),data.inverterModel],
   [_sd(sd,'s09_tech3',lang),data.mountingType]].forEach(function(r){ specRow(r[0],r[1]); });
  ry+=4;
  _tx(slide,_sd(sd,'s09_warr_t',lang),lx,ry,W-lx-10,16,{bold:true,size:9,color:K.C.DARK}); ry+=18;
  [[_sd(sd,'s09_warr1',lang),data.panelWarranty],
   [_sd(sd,'s09_warr2',lang),data.inverterWarranty],
   [_sd(sd,'s09_warr3',lang),data.epcWarranty]].forEach(function(r){ specRow(r[0],r[1]); });
  _footer(slide,9,sd);
}

// ── S10 GENERAL PROJECT DESCRIPTION ───────────────────────────
// FIX: CFE stacked chart (BASE/INTER/PUNTA + solar line) replaces simple bar
// FIX: Duplicate TOTAL row removed
function _s10(slide,data,imgs,lang,sd){
  _hdrB(slide,imgs,sd,_sd(sd,'s10_title',lang),lang);
  var lx=41, ly=70, lw=340, valX=198, unitX=300;
  function sect(label){ _rect(slide,lx,ly,lw,15,K.C.NAVY,0.08); _tx(slide,label,lx+2,ly,lw-4,15,{bold:true,size:9,color:K.C.DARK,valign:'middle'}); ly+=18; }
  function row(lbl,val,unit,hi){
    if(hi) _rect(slide,lx,ly,lw,13,K.C.NAVY,0.08);
    _tx(slide,lbl,lx+2,ly,152,13,{size:9,color:hi?K.C.DARK:K.C.MID,bold:!!hi});
    _tx(slide,val,valX,ly,95,13,{size:9,bold:true,color:K.C.DARK,align:'right'});
    if(unit) _tx(slide,unit,unitX,ly,lw-unitX+lx-4,13,{size:9,bold:true,color:K.C.DARK});
    _hr(slide,lx,ly+12,lw,K.C.LINE,0.3); ly+=15;
  }
  sect(_sd(sd,'s10_en_ovr_t',lang));
  row(_sd(sd,'s10_en1_lbl',lang),data.currentConsumption,'MWh/yr');
  row(_sd(sd,'s10_en2_lbl',lang),data.annualGenMWh,'MWh/yr');
  row(_sd(sd,'s10_en3_lbl',lang),data.solarCoveragePct,'');
  ly+=10; _hr(slide,lx,ly,lw,K.C.DARK,1.5); ly+=6;
  sect(_sd(sd,'s10_fin_t',lang));
  row(_sd(sd,'s10_fin1_lbl',lang),data.currentCFERate,'MXN/kWh');
  row(_sd(sd,'s10_fin2_lbl',lang),data.annualCFEPayment,'MXN');
  row(_sd(sd,'s10_fin3_lbl',lang),data.ppaRate,'MXN/kWh');
  row(_sd(sd,'s10_fin4_lbl',lang),data.annualARGIAPayment,'MXN');
  // TOTAL row (highlighted, no duplicate)
  _tx(slide,'TOTAL ENERGY PAYMENT',lx+2,ly,152,13,{size:9,bold:true,color:K.C.DARK});
  _tx(slide,data.totalAnnualPayment,valX,ly,95,13,{size:9,bold:true,color:K.C.DARK,align:'right'});
  _tx(slide,'MXN',unitX,ly,lw-unitX+lx-4,13,{size:9,color:K.C.MID});
  _hr(slide,lx,ly+12,lw,K.C.LINE,0.3); ly+=18;
  ly+=4; _hr(slide,lx,ly,lw,K.C.DARK,1.5); ly+=6;
  _rect(slide,lx,ly-1,lw,15,K.C.NAVY,0.08);
  _tx(slide,_sd(sd,'s10_sav_t',lang),lx+4,ly,lw-4,13,{bold:true,size:8,color:K.C.DARK,valign:'middle'}); ly+=18;
  row(_sd(sd,'s10_sav1_lbl',lang),data.annualSavings,'MXN');
  row(_sd(sd,'s10_sav2_lbl',lang),data.co2TonsYearFmt,'Ton/yr');
  // Chart: try CFE stacked first, fall back to simple monthly bar
  if(!_drawCFEStackedChart(slide,sd,lang,390,78,322,230)){
    _barChart(slide,data,390,78,322,230);
  }
  _footer(slide,10,sd);
}

// ── S11 FINANCIAL BENEFITS ─────────────────────────────────────
function _s11(slide,data,imgs,lang,sd){
  _hdrA(slide,imgs,sd,_sd(sd,'s11_title',lang),lang);
  _imgCover(slide,imgs,sd,'project_render',0,82,216,257);
  var rx=245, ry=82, rw=450, rowH=28;
  var vat=_sd(sd,'s11_vat_suffix',lang,'+ VAT');
  var yrs=_sd(sd,'s11_yr_suffix',lang,'years');
  var rows=[
    [_sd(sd,'s11_r1_lbl',lang,'Annual Savings'),           data.annualSavings,     'MXN'],
    [_sd(sd,'s11_r2_lbl',lang,'Accumulated Savings'),      data.accumulatedSavings,'MXN'],
    [_sd(sd,'s11_r3_lbl',lang,'CFE Tariff Discount'),      data.ppaDiscountPct,    ''],
    [_sd(sd,'s11_r4_lbl',lang,'Energy Tariff'),            data.ppaRate,           'MXN/kWh '+vat],
    [_sd(sd,'s11_r5_lbl',lang,'Indexation'),               data.indexation,        'annually'],
    [_sd(sd,'s11_r6_lbl',lang,'Contract Term'),            String(data.contractYears),yrs],
    [_sd(sd,'s11_r7_lbl',lang,'Maintenance & Insurance'),  _sd(sd,'s11_r7_val',lang,'No costs'),'Included'],
    [_sd(sd,'s11_r8_lbl',lang,'CO₂ Reduction'),            data.co2TonsYearFmt,    'tons/yr'],
    [_sd(sd,'s11_r9_lbl',lang,'Buyout Option'),            _sd(sd,'s11_r9_val',lang,'Residual value'),'15 yr residual'],
    [_sd(sd,'s11_r10_lbl',lang,'Early Termination'),       _sd(sd,'s11_r10_val',lang,'After 6 yrs'),'CPA clause'],
  ];
  rows.forEach(function(row,i){
    _hr(slide,rx,ry-1,rw,K.C.LINE,0.5);
    _tx(slide,row[0],rx+4,ry+3,rw*0.36,rowH-6,{size:10,color:K.C.MID});
    _tx(slide,row[1],rx+rw*0.36,ry+2,rw*0.38,rowH-4,{size:10,bold:true,color:K.C.DARK,align:'right',font:K.FONT_DISPLAY});
    _tx(slide,row[2],rx+rw*0.74+4,ry+5,rw*0.24,rowH-8,{size:8,color:K.C.MID});
    ry+=rowH;
  });
  _hr(slide,rx,ry,rw,K.C.LINE,0.5);
  _footer(slide,11,sd);
}

// ── S12 IMPLEMENTATION ─────────────────────────────────────────
function _s12(slide,data,imgs,lang,sd){
  _hdrA(slide,imgs,sd,_sd(sd,'s12_title',lang),lang);
  _tx(slide,String(data.implDays),42,72,160,72,{bold:false,size:52,color:K.C.DARK,font:K.FONT_DISPLAY});
  _tx(slide,_sd(sd,'s12_day_lbl',lang,'Days Total Project\nDuration'),42,146,160,34,{size:10,color:K.C.MID});
  // no arrow/line between label and table
  _imgCover(slide,imgs,sd,'env_strip',213,82,507,81);
  var tableX=61, tableY=195, tableW=634, hdrH=26;
  _rect(slide,tableX,tableY,tableW,hdrH,K.C.NAVY);
  var cols=[0.27,0.20,0.08,0.45], cx=tableX+4;
  [_sd(sd,'s12_ph0_lbl',lang,'PHASE'),_sd(sd,'s12_ph0_dur',lang,'DURATION'),
   '',_sd(sd,'s12_ph0_desc',lang,'DESCRIPTION')].forEach(function(h,j){
    _tx(slide,h,cx,tableY+4,tableW*cols[j]-4,hdrH-8,{bold:true,size:10,color:K.C.WHITE,valign:'middle'});
    cx+=tableW*cols[j];
  });
  var phases=[
    [_sd(sd,'s12_ph1_lbl',lang,'Feasibility Study'),         '—',   '',     _sd(sd,'s12_ph1_desc',lang,'ROI and technical study')],
    [_sd(sd,'s12_ph2_lbl',lang,'Technology Selection'),       '3',   'days', _sd(sd,'s12_ph2_desc',lang,'Modules, inverters, structure')],
    [_sd(sd,'s12_ph3_lbl',lang,'Engineering Documentation'),  '5',   'days', _sd(sd,'s12_ph3_desc',lang,'Detailed construction design')],
    [_sd(sd,'s12_ph4_lbl',lang,'EPC Execution'),              '60',  'days', _sd(sd,'s12_ph4_desc',lang,'Installation and commissioning')],
    [_sd(sd,'s12_ph5_lbl',lang,'Operation & Maintenance'),
     _sd(sd,'s12_ph5_dur',lang,'Entire contract'),'',_sd(sd,'s12_ph5_desc',lang,'Monitoring and service')],
  ];
  var ry=tableY+hdrH, ph=24;
  phases.forEach(function(row){
    _hr(slide,tableX,ry,tableW,K.C.LINE,0.5);
    var cx2=tableX+4;
    _tx(slide,row[0],cx2,ry+4,tableW*cols[0]-4,ph-6,{size:10,bold:true,color:K.C.DARK}); cx2+=tableW*cols[0];
    _tx(slide,row[1],cx2,ry+4,tableW*cols[1]-4,ph-6,{size:11,bold:true,color:K.C.DARK,align:'center'}); cx2+=tableW*cols[1];
    _tx(slide,row[2],cx2,ry+4,tableW*cols[2]-4,ph-6,{size:10,color:K.C.MID}); cx2+=tableW*cols[2];
    _tx(slide,row[3],cx2,ry+4,tableW*cols[3]-6,ph-6,{size:10,color:K.C.DARK});
    ry+=ph;
  });
  _hr(slide,tableX,ry,tableW,K.C.LINE,0.5);
  _footer(slide,12,sd);
}

// ── S13 O&M ────────────────────────────────────────────────────
function _s13(slide,data,imgs,lang,sd){
  _hdrA(slide,imgs,sd,_sd(sd,'s13_title',lang),lang);
  var LW=360, rx=397, rw=323;
  _imgCover(slide,imgs,sd,'om_photo_wide',rx,82,rw,276);
  var ly=77;
  _tx(slide,_sd(sd,'s13_om_t',lang),42,ly,LW,26,{bold:true,size:18,color:K.C.DARK,font:K.FONT_DISPLAY}); ly+=30;
  ['s13_om1','s13_om2','s13_om3','s13_om4','s13_om5'].forEach(function(k){
    _tx(slide,'• '+_sd(sd,k,lang),42,ly,LW-22,22,{size:11,color:K.C.DARK}); ly+=24;
  });
  ly+=8; _hr(slide,42,ly,LW-22,K.C.LINE,0.75); ly+=14;
  _tx(slide,_sd(sd,'s13_warr_t',lang),42,ly,LW,26,{bold:true,size:18,color:K.C.DARK,font:K.FONT_DISPLAY}); ly+=30;
  ['s13_warr1','s13_warr2','s13_warr3','s13_warr4','s13_warr5'].forEach(function(k){
    _tx(slide,'• '+_sd(sd,k,lang),42,ly,LW-22,20,{size:10,color:K.C.DARK}); ly+=20;
  });
  _footer(slide,13,sd);
}

// ── S14 ENVIRONMENTAL ──────────────────────────────────────────
function _s14(slide,data,imgs,lang,sd){
  _hdrB(slide,imgs,sd,_sd(sd,'s14_title',lang),lang);
  _imgCover(slide,imgs,sd,'env_photo',0,244,W,131);
  _rect(slide,0,244,W,131,K.C.NAVY,0.15);
  var statData=[
    {x:58, w:137,val:data.co2TonsYearFmt,  unit:_sd(sd,'s14_s1_unit',lang,'tons/year'),lbl:_sd(sd,'s14_s1_lbl',lang,'CO₂ reduction')},
    {x:195,w:178,val:data.treesEquivFmt,   unit:_sd(sd,'s14_s2_unit',lang,'trees'),    lbl:_sd(sd,'s14_s2_lbl',lang,'Equal to planting')},
    {x:373,w:143,val:_sd(sd,'s14_s3_val',lang,'ISO'),unit:'',                           lbl:_sd(sd,'s14_s3_lbl',lang,'Supports ISO 14001\nand ESG objectives')},
    {x:516,w:169,val:_sd(sd,'s14_s4_val',lang,'Improves'),unit:'',                      lbl:_sd(sd,'s14_s4_lbl',lang,'Improves corporate\nsustainability ranking')},
  ];
  // Numbers centered in space between title (ends ~y=54) and unit/label text
  // Title bottom ≈ y=54, unit text at y=172 → center = 113 → number top = 113-45 = 68
  statData.forEach(function(st,i){
    var val=String(st.val);
    var sz=val.length<=3?36:val.length<=5?30:val.length<=7?24:20;
    _tx(slide,val,st.x,96,st.w,58,{bold:false,size:sz,color:K.C.DARK,align:'center',font:K.FONT_DISPLAY});
    if(st.unit) _tx(slide,st.unit,st.x,156,st.w,14,{size:9,color:K.C.MID,align:'center'});
    _tx(slide,st.lbl,st.x,168,st.w,34,{size:9,color:K.C.MID,align:'center'});
  });
  // Separator lines in middle of gap between label text and photo (y=216 midpoint)
  [195,373,516].forEach(function(x){ _vl(slide,x,96,106); });
  _footer(slide,14,sd);
}

// ── S15 VALIDITY ───────────────────────────────────────────────
function _s15(slide,data,imgs,lang,sd){
  _hdrA(slide,imgs,sd,_sd(sd,'s15_title',lang),lang);
  // Gray band (bottom section for annexes)
  _rect(slide,0,276,W,129,'#F3F3F3');

  // LEFT: Proposal Validity
  var ly=60;
  _tx(slide,_sd(sd,'s15_valid_t',lang),42,ly,360,28,{bold:true,size:18,color:K.C.DARK,font:K.FONT_DISPLAY}); ly+=30;
  var vText=_sd(sd,'s15_valid_v',lang).replace('{days}',String(data.offerValidDays));
  _tx(slide,vText,42,ly,360,36,{size:9,color:K.C.DARK}); ly+=42;

  // RIGHT: Conditions panel (white area, x=440)
  _tx(slide,'Conditions:',440,60,258,14,{bold:true,size:10,color:K.C.DARK});
  var cy2=76;
  ['s15_cond1','s15_cond2','s15_cond3'].forEach(function(k){
    _tx(slide,'• '+_sd(sd,k,lang),440,cy2,258,16,{size:9,color:K.C.DARK}); cy2+=18;
  });

  // CONTACTS header
  _tx(slide,_sd(sd,'s15_contact_t',lang),42,ly,284,28,{bold:true,size:18,color:K.C.DARK,font:K.FONT_DISPLAY}); ly+=30;
  var roles=[_sd(sd,'s15_role1',lang),_sd(sd,'s15_role2',lang),_sd(sd,'s15_role3',lang)];
  var contacts=[data.contacts.sales,data.contacts.solar,data.contacts.tech];
  contacts.forEach(function(c,i){
    _hr(slide,42,ly-2,420,K.C.LINE,0.5);
    _tx(slide,roles[i],42, ly,200,14,{size:9,color:K.C.MID});
    _tx(slide,c.name,  248,ly,148,14,{size:9,bold:true,color:K.C.DARK});
    _tx(slide,c.email, 400,ly,170,14,{size:7.5,color:K.C.DARK});
    _tx(slide,c.phone, 580,ly,130,14,{size:9,bold:true,color:K.C.DARK});
    ly+=24;
  });
  _hr(slide,42,ly,660,K.C.LINE,0.75);

  // ANNEXES (in gray zone)
  var ay=Math.max(ly+8,290);
  _tx(slide,_sd(sd,'s15_annex_t',lang),42,ay,160,22,{bold:true,size:18,color:K.C.DARK,font:K.FONT_DISPLAY}); ay+=24;
  // 4 annex items in a row — keep within slide width (max x=595+118=713)
  [[42,'s15_ann1'],[198,'s15_ann2'],[354,'s15_ann3'],[510,'s15_ann4']].forEach(function(pair){
    _tx(slide,_sd(sd,pair[1],lang),pair[0],ay,152,18,{size:8,bold:true,color:K.C.DARK});
  });
  _footer(slide,15,sd);
}

// ── CFE STACKED CHART ──────────────────────────────────────────
// Reads CFE_SIMULATION sheet: rows 5-8, columns 3-14 (12 months)
//   row 5 = kWh BASE     row 6 = kWh INTERMEDIA
//   row 7 = kWh PUNTA    row 8 = kWh SOLAR (yellow line overlay)
// Returns true on success, false if sheet missing or data zero.
function _drawCFEStackedChart(slide,sd,lang,x,y,w,h){
  try{
    var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CFE_SIMULATION');
    if(!sh){ Logger.log('[Chart] CFE_SIMULATION not found — using fallback.'); return false; }
    var base  =sh.getRange(5,3,1,12).getValues()[0].map(Number);
    var interm=sh.getRange(6,3,1,12).getValues()[0].map(Number);
    var punta =sh.getRange(7,3,1,12).getValues()[0].map(Number);
    var solar =sh.getRange(8,3,1,12).getValues()[0].map(Number);
    var total =base.reduce(function(a,b){return a+b;},0);
    if(total<=0){ Logger.log('[Chart] CFE data all-zero.'); return false; }
    var totals =base.map(function(b,i){return b+interm[i]+punta[i];});
    var maxTot =Math.max.apply(null,totals);
    var niceMax=_niceAxisMax(maxTot*1.10);
    var lblW=38, monH=11, legH=14, topPad=16;
    var plotX=x+lblW, plotY=y+topPad;
    var plotW=w-lblW-4, plotH=h-topPad-monH-legH-8;
    _rect(slide,x,y,w,h,'#F7F7F7');
    _tx(slide,'kWh',x,y+1,lblW-3,9,{size:5,color:K.C.LITE,align:'right'});
    for(var s=0;s<=4;s++){
      var val=  (s/4)*niceMax;
      var yPos= plotY+plotH-Math.round((s/4)*plotH);
      _rect(slide,plotX,yPos,plotW,0.5,'#DDDDDD');
      var lbl=val>=1000000?(val/1000000).toFixed(1)+'M':val>=1000?Math.round(val/1000)+'k':Math.round(val).toString();
      _tx(slide,lbl,x,yPos-6,lblW-3,11,{size:5,color:K.C.LITE,align:'right'});
    }
    var barW=Math.floor((plotW-6)/12)-2;
    var solPts=[];
    var months=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
    for(var i=0;i<12;i++){
      var bx=plotX+3+i*(barW+2), curY=plotY+plotH;
      var h1=Math.max(0,Math.round((base[i]  /niceMax)*plotH));
      var h2=Math.max(0,Math.round((interm[i]/niceMax)*plotH));
      var h3=Math.max(0,Math.round((punta[i] /niceMax)*plotH));
      if(h1>0){curY-=h1; _rect(slide,bx,curY,barW,h1,'#5B9BD5');}
      if(h2>0){curY-=h2; _rect(slide,bx,curY,barW,h2,'#2E75B6');}
      if(h3>0){curY-=h3; _rect(slide,bx,curY,barW,h3,'#1F4E79');}
      var topBarY=plotY+plotH-Math.round((totals[i]/niceMax)*plotH);
      var totLbl=totals[i]>=1000?Math.round(totals[i]/1000)+'k':Math.round(totals[i]).toString();
      _tx(slide,totLbl,bx-2,topBarY-13,barW+4,11,{size:5,color:K.C.DARK,align:'center'});
      _tx(slide,months[i],bx-7,plotY+plotH+2,barW+14,monH,{size:5,color:K.C.DARK,align:'center'});
      var cx=bx+Math.floor(barW/2);
      var sy=plotY+plotH-Math.round((solar[i]/niceMax)*plotH);
      solPts.push({x:cx,y:sy});
    }
    _rect(slide,plotX,plotY+plotH,plotW,1,'#888888');
    for(var j=1;j<solPts.length;j++){
      try{
        var ln=slide.insertLine(SlidesApp.LineCategory.STRAIGHT,
          solPts[j-1].x,solPts[j-1].y,solPts[j].x,solPts[j].y);
        ln.getLineFill().setSolidFill('#F0B429'); ln.setWeight(1.5);
      }catch(le){ Logger.log('[Chart] Line: '+le.message); }
    }
    solPts.forEach(function(pt){ _rect(slide,pt.x-2.5,pt.y-2.5,5,5,'#F0B429'); });
    var legY=y+h-legH-2, legX=plotX, legIW=Math.floor(plotW/4);
    [{c:'#5B9BD5',t:'kWh base'},{c:'#2E75B6',t:'kWh intermedia'},{c:'#1F4E79',t:'kWh punta'},{c:'#F0B429',t:'kWh solar'}]
    .forEach(function(item,idx){
      var lx=legX+idx*legIW;
      _rect(slide,lx,legY+2,7,7,item.c);
      _tx(slide,item.t,lx+9,legY+1,legIW-11,10,{size:5,color:K.C.DARK});
    });
    Logger.log('[Chart] CFE stacked chart OK.'); return true;
  }catch(e){ Logger.log('[Chart] Error: '+e.message); return false; }
}

// Simple monthly bar chart (fallback when CFE_SIMULATION is unavailable)
function _barChart(slide,data,cx,cy,cw,ch){
  var months=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  var vals=data.prodMonths.map(function(v){return parseFloat(String(v).replace(/[$,\s]/g,''))||0;});
  var maxVal=Math.max.apply(null,vals)||1;
  var niceMax=_niceAxisMax(maxVal*1.10);
  var lblW=38, monH=11, topPad=16, legH=14;
  var plotX=cx+lblW, plotY=cy+topPad;
  var plotW=cw-lblW-4, plotH=ch-topPad-monH-legH-8;
  _rect(slide,cx,cy,cw,ch,'#F7F7F7');
  _tx(slide,'kWh',cx,cy+1,lblW-3,9,{size:5,color:K.C.LITE,align:'right'});
  for(var s=0;s<=4;s++){
    var val=(s/4)*niceMax;
    var yPos=plotY+plotH-Math.round((s/4)*plotH);
    _rect(slide,plotX,yPos,plotW,0.5,'#DDDDDD');
    var lbl=val>=1000?Math.round(val/1000)+'k':Math.round(val).toString();
    _tx(slide,lbl,cx,yPos-6,lblW-3,11,{size:5,color:K.C.LITE,align:'right'});
  }
  var barW=Math.floor((plotW-6)/12)-2;
  vals.forEach(function(v,i){
    var barH=Math.max(2,Math.round((v/niceMax)*plotH));
    var bx=plotX+3+i*(barW+2), by=plotY+plotH-barH;
    _rect(slide,bx,by,barW,barH,K.C.DARK);
    _tx(slide,months[i],bx-7,plotY+plotH+2,barW+14,monH,{size:5,color:K.C.DARK,align:'center'});
  });
  _rect(slide,plotX,plotY+plotH,plotW,1,'#888888');
}

// Axis max rounding (used by both chart functions)
function _niceAxisMax(val){
  if(val<=0) return 10;
  var exp=Math.pow(10,Math.floor(Math.log(val)/Math.LN10));
  var frac=val/exp;
  var nice=frac<=1.0?1.0:frac<=1.2?1.2:frac<=1.5?1.5:frac<=2.0?2.0:frac<=2.5?2.5:frac<=3.0?3.0:frac<=4.0?4.0:frac<=5.0?5.0:10.0;
  return nice*exp;
}

// ─────────────────────────────────────────────────────────────────
// §10  UTILS
// ─────────────────────────────────────────────────────────────────
function _today(){ return Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd'); }

// ─────────────────────────────────────────────────────────────────
// §11  TESTS
// ─────────────────────────────────────────────────────────────────
function testKickerData(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sd=_readSlideData(ss), data=_readProjectData(sd);
  var log=[], pass=0, fail=0, warn=0;
  function chk(label,val,test,hint){
    var ok=test(val); if(ok) pass++; else fail++;
    log.push((ok?'✅':'❌')+' '+label+'\n   '+String(val).substring(0,70)+(ok?'':'\n   ⚠ '+hint));
  }
  function w(label,val,test,hint){
    var ok=test(val); if(ok) pass++; else warn++;
    log.push((ok?'✅':'⚠️')+' '+label+'\n   '+String(val).substring(0,70)+(ok?'':'\n   → '+hint));
  }
  function notBlank(v){ return v!=='—'&&String(v).trim().length>1; }
  chk('client_name',       data.clientName,          notBlank,'Add client_name to SLIDE_DATA');
  w(  'client_location',   data.clientAddress,        function(v){return notBlank(v)&&v.indexOf('miasto')===-1;},'Replace placeholder city');
  chk('project_type',      data.projectType,          notBlank,'Add project_type to SLIDE_DATA');
  chk('system_kwp',        data.capacityKWpFmt,       function(v){return v.indexOf('kWp')>-1;},'Add system_kwp (numeric)');
  chk('panel_model',       data.panelModel,           notBlank,'Add panel_model to SLIDE_DATA');
  w(  'inv_model',         data.inverterModel,        notBlank,'Add inv_model to SLIDE_DATA');
  chk('solar production',  data.annualGenMWhFmt,      function(v){return v!=='—';},'Add solar_mwh OR annual_mwh+coverage');
  w(  'system_coverage',   data.solarCoveragePct,     function(v){return v!=='—'&&v!=='';},'Add system_coverage_pct');
  chk('annual_savings',    data.annualSavingsFmt,     notBlank,'Add annual_savings to SLIDE_DATA');
  chk('savings_10yr',      data.accumulatedSavingsFmt,notBlank,'Add savings_10yr to SLIDE_DATA');
  chk('co2_tons',          data.co2TonsYearFmt,       function(v){return v!=='—'&&Number(v.replace(/,/g,''))>0;},'Add co2_tons (numeric)');
  chk('salesperson_name',  data.contacts.sales.name,  notBlank,'Add salesperson_name to SLIDE_DATA');
  w(  'salesperson_email', data.contacts.sales.email, notBlank,'Add salesperson_email to SLIDE_DATA');
  w(  'solar/tech contacts',data.contacts.solar.name+' / '+data.contacts.tech.name,function(){return true;},'Optional: add solar_name/tech_name');
  var datCount=Object.keys(sd.dat).length, txtCount=Object.keys(sd.txt).length, imgCount=Object.keys(sd.img).length;
  chk('SLIDE_DATA DAT rows',datCount,function(v){return v>=5;},'Run setupSlideDataTab()');
  chk('SLIDE_DATA TXT rows',txtCount,function(v){return v>=50;},'Run setupSlideDataTab()');
  chk('SLIDE_DATA IMG rows',imgCount,function(v){return v>=10;},'Run setupSlideDataTab()');
  SpreadsheetApp.getUi().alert('=== SLIDE_DATA Test ===\n\n✅ '+pass+' passed  ❌ '+fail+' failed  ⚠️ '+warn+' warnings\n\n'+log.join('\n\n'));
}

function testKickerImages(){
  var ss=SpreadsheetApp.getActiveSpreadsheet(), sd=_readSlideData(ss), imgs=_loadImages(sd);
  var required=['cover_bg','argia_logo_dark','argia_logo_white','client_logo',
                'toc_city','numbers_bg','ppa_field','ppa_aerial',
                'project_render','om_photo_wide','env_photo','env_strip',
                'step1_photo','step2_photo','step3_photo','step4_photo','step5_photo','helioscope'];
  var ok=0, miss=0, log=['Drive files in folder: '+Object.keys(imgs).length,'','Drive keys: '+Object.keys(imgs).sort().join(', '),''];
  required.forEach(function(role){
    var driveKey=_normalise(_sdImg(sd,role)), fileId=imgs[driveKey], pass=!!fileId;
    if(pass) ok++; else miss++;
    log.push((pass?'✅':'❌ MISSING')+' '+role+' → "'+driveKey+'"'+(pass?' (id:'+fileId.substring(0,8)+'...)':''));
  });
  log.unshift('✅ '+ok+' found  ❌ '+miss+' missing\n');
  SpreadsheetApp.getUi().alert(log.join('\n'));
}

function testKickerFirst3EN(){ _t3('EN'); }
function testKickerFirst3ES(){ _t3('ES'); }
function _t3(lang){
  var ss=SpreadsheetApp.getActiveSpreadsheet(), sd=_readSlideData(ss), data=_readProjectData(sd), imgs=_loadImages(sd);
  var pres=SlidesApp.create('KICKER TEST 1-3 '+lang+' '+_today()), blank=pres.getSlides()[0];
  [_s01,_s02,_s03].forEach(function(fn,i){
    var sl=i===0?blank:pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    _clearSlide(sl); sl.getBackground().setSolidFill(K.C.WHITE); fn(sl,data,imgs,lang,sd);
  });
  SpreadsheetApp.getUi().alert('Test 1-3 ('+lang+'):\n'+pres.getUrl());
}
