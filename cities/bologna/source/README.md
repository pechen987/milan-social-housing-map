# Bologna source

`addresses.json` is generated from the Comune di Bologna public ArcGIS layer `ACER/EDIFICI_PATRIMONIO_ALLOGGI_ACER`, retrieved October 2026. Each marker is the centroid of an official ACER building footprint.

## Source recheck, 2026-10-15

All 630 local building IDs match the current layer’s 630 polygons. No additional source IDs were found. Query and response checksum: `verification-2026-10-15.json`. There are 314 condominium entries, 310 full-ownership entries and 6 leased entries. These ownership categories do not prove a building is entirely social housing; tenure scope remains unknown. Source as-of date is not published in the response and is retained as null.

### Building identity reconciliation

The 630 features are not 630 proven distinct buildings: they use 579 distinct `COD_EDIFIC` codes. Exact duplicate geometry plus the same building code supports 8 removals (8 groups), with original share-link IDs retained as aliases. Published records: 622; unambiguous building-code records: 536. Other repeated-code geometries are flagged for review, not automatically merged or counted as verified buildings. See `merges-2026-10-15.json`.

## Building and position review, 2026-10-16

The latest review supersedes the counts above. Downloaded the full official layer again: the 630 features have the same checksum as the 15 October response. The raw response is preserved in `review-2026-10-16/official-buildings.geojson`; per-group decisions, source IDs, overlap scores, relocated points and checksums are in `review-2026-10-16/decisions.json`. This is municipal public GIS evidence already used for this dataset; the service advertises no explicit redistribution licence, so no new licence is asserted over the source snapshot.

Reviewed all 622 previously mapped records, including all 86 unresolved records. Forty repeated-code pairs represent overlapping footprint variants of the same source building: they share an official `COD_EDIFIC` and the intersection covers at least 75% of **each** footprint, across every feature in the group. The code and overlap are jointly required; this is a source-specific reconciliation rule, not permission to merge neighbouring buildings or arbitrary nearby points. Exact geometry alone and containment of a smaller polygon alone are insufficient. No different-code pair has overlap above this threshold.

Consolidated those 40 pairs into 40 buildings: **582 published records, 576 verified buildings, six unresolved features**. The latter have codes **318, 320 and 1282**; their minimum overlap fractions are approximately 0.388, 0.490 and 0.447. A building/cadastral crosswalk or clarification from the publisher is needed before merging or splitting them. Retained all 630 original numeric share-link IDs through aliases, and all 630 original source IDs in the surviving records. No source feature was silently discarded.

Position checks found 92 of the previous markers outside their own polygons. One was removed during duplicate consolidation; **91 surviving markers were moved to interior points** using Shapely's point-on-surface operation. Every resulting marker lies in its retained source polygon. Existing points already inside were preserved. All use `footprint_point` rather than claiming that approximate vertex averages are true centroids. They do not indicate entrances or prove current occupancy. This review found no new source buildings.

### Reproduce

Use Python with `shapely==2.2.0`. The input is the pre-review version; do not pass the already-reconciled output when reproducing the decision log.

```sh
git show 6ede1ef:cities/bologna/addresses.json > /tmp/bologna-before-round2.json
python tools/reconcile_bologna.py --before /tmp/bologna-before-round2.json
python -m unittest discover -s tools -p 'test_*.py'
python tools/audit_data.py --write
```
