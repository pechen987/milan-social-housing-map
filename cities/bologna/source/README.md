# Bologna source

`addresses.json` is generated from the Comune di Bologna public ArcGIS layer `ACER/EDIFICI_PATRIMONIO_ALLOGGI_ACER`, retrieved October 2026. Each marker is the centroid of an official ACER building footprint.

## Source recheck, 2026-10-15

All 630 local building IDs match the current layer’s 630 polygons. No additional source IDs were found. Query and response checksum: `verification-2026-10-15.json`. There are 314 condominium entries, 310 full-ownership entries and 6 leased entries. These ownership categories do not prove a building is entirely social housing; tenure scope remains unknown. Source as-of date is not published in the response and is retained as null.

### Building identity reconciliation

The 630 features are not 630 proven distinct buildings: they use 579 distinct `COD_EDIFIC` codes. Exact duplicate geometry plus the same building code supports 8 removals (8 groups), with original share-link IDs retained as aliases. Published records: 622; unambiguous building-code records: 536. Other repeated-code geometries are flagged for review, not automatically merged or counted as verified buildings. See `merges-2026-10-15.json`.
