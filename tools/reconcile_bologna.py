#!/usr/bin/env python3
"""Reproduce the 2026-10-16 review from official polygons and pre-review rows.

Requires Shapely 2.2.0. This rule is specific to the ACER building layer:
same nonempty building code AND every pair covers >=75% of BOTH footprints.
Different codes, adjacent polygons and containment alone never justify merging.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
from shapely.geometry import Point, shape

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'cities/bologna/source/review-2026-10-16/official-buildings.geojson'

def overlap_fraction(a, b):
    return a.intersection(b).area / max(a.area, b.area)

def reconcile(rows, features):
    source = {str(f['properties']['ID']): f for f in features}
    assert len(source) == len(features), 'Duplicate source IDs'
    grouped = collections.defaultdict(list)
    for row in rows:
        feature = source[row['source_record_id']]
        code = str(feature['properties']['COD_EDIFIC'])
        assert code == row['source_building_code'] and code not in {'', 'None', '0'}
        grouped[code].append(row)
    output, decisions, moved = [], [], []
    for code, group in grouped.items():
        group = sorted(group, key=lambda r: r['id'])
        source_ids = sorted({sid for r in group for sid in r.get('source_record_ids', [r['source_record_id']])}, key=int)
        footprints = [shape(source[sid]['geometry']) for sid in source_ids]
        assert all(s.is_valid and s.geom_type == 'Polygon' and s.area > 0 for s in footprints)
        minimum = min((overlap_fraction(a, b) for i, a in enumerate(footprints) for b in footprints[i+1:]), default=1)
        mergeable = minimum >= 0.75
        if len(group) > 1:
            decisions.append(dict(building_code=code, source_ids=source_ids,
                previous_ids=[r['id'] for r in group], minimum_overlap_fraction=minimum,
                decision='merge' if mergeable else 'retain_unresolved', retained_id=group[0]['id'] if mergeable else None))
        if mergeable:
            kept = dict(group[0])
            aliases = sorted({n for r in group for n in [r['id'], *r.get('legacy_ids', [])]} - {kept['id']})
            if aliases: kept['legacy_ids'] = aliases
            kept['source_record_ids'] = source_ids
            kept['verification_status'] = 'source_verified'
            kept['building_ref'] = f'bologna-acer:building:{code}'
            kept['verification_note'] = ('Official ACER building polygon matched by source ID and building code. '
                'Repeated features were consolidated only when they share that code and overlap at least 75% of each footprint. '
                'Social-tenure share and current occupancy are unknown.')
            selected = [kept]
        else:
            selected = [dict(r) for r in group]
            for row in selected:
                row.pop('building_ref', None)
                row['verification_status'] = 'legacy_review_required'
                row['verification_note'] = ('Multiple substantially different polygons share this official building code. '
                    'Retained as unresolved source features, not verified individual buildings; do not sum them as buildings.')
        for row in selected:
            polygon = shape(source[row['source_record_id']]['geometry'])
            old = Point(row['lon'], row['lat'])
            if not polygon.covers(old):
                point = polygon.representative_point()
                row['lon'], row['lat'] = point.x, point.y
                moved.append(dict(id=row['id'], source_record_id=row['source_record_id'],
                    before=[old.x, old.y], after=[point.x, point.y]))
            assert polygon.covers(Point(row['lon'], row['lat']))
            row['coordinate_method'] = 'footprint_point'
            row['precision'] = 'Point inside the official building footprint; not an entrance or surveyed address'
            row['reviewed_on'] = '2026-10-16'
            output.append(row)
    return sorted(output, key=lambda r: r['id']), dict(decisions=decisions, relocated_markers=moved)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', type=Path, required=True, help='addresses.json from commit 6ede1ef')
    args = parser.parse_args()
    original = json.loads(args.before.read_text())
    rows, report = reconcile(original, json.loads(SOURCE.read_text())['features'])
    report.update(reviewed_on='2026-10-16', source_url='https://sit-test-mappe.comune.bologna.it/arcgis/rest/services/ACER/EDIFICI_PATRIMONIO_ALLOGGI_ACER/MapServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson', source_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(), input_sha256=hashlib.sha256(args.before.read_bytes()).hexdigest(), previous_records=len(original), published_records=len(rows), verified_buildings=sum(r['verification_status']=='source_verified' for r in rows))
    (ROOT/'cities/bologna/addresses.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n')
    (SOURCE.parent/'decisions.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print({k: v for k, v in report.items() if k not in {'decisions', 'relocated_markers'}})
