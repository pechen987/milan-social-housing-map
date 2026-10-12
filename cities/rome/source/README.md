# Rome source

`addresses.json` was generated in October 2026 from Roma Capitale’s public **Atlante del Patrimonio** WFS layer `atlante:beni_puntuali`, filtered where `tipo_bene = Edilizia Residenziale Pubblica` and requested in EPSG:4326.

The source returned 790 ERP records. Two records did not carry a published point geometry and were withheld; the map contains the remaining 788 official property points. Each record retains the source property identifier and description in `original`.
