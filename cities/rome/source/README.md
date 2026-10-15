# Rome source

`addresses.json` was generated in October 2026 from Roma Capitale’s public **Atlante del Patrimonio** WFS layer `atlante:beni_puntuali`, filtered where `tipo_bene = Edilizia Residenziale Pubblica` and requested in EPSG:4326.

The source returned 790 ERP records. Two records did not carry a published point geometry and were withheld; the map contains the remaining 788 official property points. Each record retains the source property identifier and description in `original`.

## Methodology audit, 2026-10-15

The currently published file contains **782** records, not the earlier 788 noted above. The earlier extraction narrative has not been reconciled to a retained source snapshot. Treat these as property assets, not verified buildings. All 782 are flagged for individual source/building review; no missing six records have been invented.
