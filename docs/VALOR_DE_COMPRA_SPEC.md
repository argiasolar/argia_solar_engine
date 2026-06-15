# Valor de Compra (Residual Value / Buyout Schedule) — Spec

**Status:** built 2026-06-15. Module `32_CalcValorDeCompra.js`.
**Provenance:** reverse-engineered from the live BaaS proposal workbooks
(PPA sheet, "ANEXO 7 — Valor Residual"), verified identical across three real
proposals: Taigene (León), Draexlmaier, Autoplastek (Puebla).

> NOTE on module number: the originally-planned `31_CalcValorDeCompra.js` name
> collides with the existing `31_CalcClientFinancials.js`. This module is
> `32_CalcValorDeCompra.js`.

## What it computes

The **Valor de Compra** (purchase/buyout value, a.k.a. Valor Residual) is the
amount the customer pays to buy out the BaaS-leased system at a given year of
the contract. In the live workbooks it is a **straight-line depreciation** of
the installed CAPEX over the contract term.

```
valorDeCompra(n) = capexConIva × max(0, 1 − n / term)      for n = 0 .. term
capexConIva      = systemCapexMxn × (1 + ivaPct)
annualDecline    = capexConIva / term      ("CUOTA" in the workbook)
```

- `n` = contract year (0 = signing, full value; term = end, value 0).
- The schedule is **clamped to [0, term]**: at year `term` the value is exactly
  0; the module does NOT project negative/over-depreciated values past the term
  (the workbook's raw formula goes negative past year 16 — that is an artifact,
  not intended output).

## Verified parameters (from the live workbooks)

| Parameter      | Value         | Source                                            |
|----------------|---------------|---------------------------------------------------|
| `systemCapexMxn` | full installed CAPEX (PV + BESS + install), pre-IVA | RESULTS!B24 "CAPEX MXN" → engine: `capexMxn` already in calcBaasEconomics |
| `ivaPct`       | 0.16          | PPA!C38 `× 1.16`; matches engine's 16% IVA everywhere |
| `term`         | **16** years  | PPA!C41 = `B27 + 1` (15-yr projection horizon + 1) |
| interest rate  | **0**         | PPA!C40 = 0 → straight-line (NOT declining-balance) |

**Important:** the workbook builds an amortization-schedule *structure*
(CUOTA / INTERÉS / CAPITAL columns) but hardcodes interest = 0, making it pure
straight-line in every real proposal. This module implements the straight-line
result directly. The term is **16, not 15** — one year longer than the lease
projection horizon; this is deliberate in the workbooks.

**CAPEX basis is FULL SYSTEM, not BESS-only.** Even though BaaS is
"battery-as-a-service", the live proposals compute the residual on the whole
delivered system CAPEX (RESULTS!B24), because the buyout transfers the entire
installed system. Using BESS-only CAPEX would understate the buyout value.

## Worked example — CULLIGAN

- systemCapexMxn = 37,051,893.49 (BOM 36,303,902 + INSTALL 747,992; pre-IVA)
- capexConIva    = 37,051,893.49 × 1.16 = 42,980,196.45
- term           = 16
- annualDecline  = 42,980,196.45 / 16 = 2,686,262.28 / yr

| Año | Valor de Compra (MXN) | Año | Valor de Compra (MXN) |
|-----|----------------------:|-----|----------------------:|
| 0   | 42,980,196.45         | 9   | 18,803,835.95         |
| 1   | 40,293,934.17         | 10  | 16,117,573.67         |
| 2   | 37,607,671.89         | 11  | 13,431,311.39         |
| 3   | 34,921,409.61         | 12  | 10,745,049.11         |
| 4   | 32,235,147.34         | 13  |  8,058,786.83         |
| 5   | 29,548,885.06         | 14  |  5,372,524.56         |
| 6   | 26,862,622.78         | 15  |  2,686,262.28         |
| 7   | 24,176,360.50         | 16  |          0.00         |
| 8   | 21,490,098.22         |     |                       |

These exact numbers are locked as the regression fixture.

## Module interface

```
calcValorDeCompra({ systemCapexMxn, ivaPct=0.16, term=16 }) -> {
  capexConIva,            // capexMxn × (1+iva)
  term,
  annualDeclineMxn,       // capexConIva / term
  schedule: [             // length term+1, years 0..term
    { year, valorMxn },
    ...
  ],
  provenance: 'STRAIGHT_LINE_RESIDUAL'
}
```

Pure function, no sheet I/O. Linear, clamped, matches every live proposal.
