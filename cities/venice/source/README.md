# Venice source

Map records in `../addresses.json` were compiled from the Regione del Veneto's 2013 ATER Venezia register of dwellings excluded from sale (DGR 1974/2013, Annex C1).

- Register: https://www.regione.veneto.it/c/document_library/get_file?groupId=10725&uuid=685b1f05-0327-4bbe-b407-21988f5248ee
- Civic coordinates: https://cigno.atlantedellalaguna.it/layers/sil%3Acivici
- Retrieved and matched: 2026-10-12

The register has 568 records within the Comune di Venezia. Repeated records at the same civic location are consolidated; the `unit_records` property preserves the number of source dwelling entries. Three civics without an exact official-coordinate match are excluded.
