"""Regression checks on source identity, conservative merging and marker placement."""
import json
import unittest
from shapely.geometry import Point, Polygon, mapping, shape
from reconcile_bologna import ROOT, SOURCE, reconcile

class GeometryReviewTests(unittest.TestCase):
    def fixture(self, polygons, codes=None):
        codes = codes or ['1'] * len(polygons)
        rows, features = [], []
        for i, (poly, code) in enumerate(zip(polygons, codes)):
            rows.append(dict(id=i, source_record_id=str(i), source_building_code=code,
                lat=poly.centroid.y, lon=poly.centroid.x))
            features.append(dict(properties=dict(ID=i, COD_EDIFIC=code), geometry=mapping(poly)))
        return rows, features

    def test_same_code_and_overlapping_variants_merge_and_preserve_aliases(self):
        rows, features = self.fixture([Polygon([(0,0),(10,0),(10,10),(0,10)]), Polygon([(1,0),(11,0),(11,10),(1,10)])])
        rows[1]['legacy_ids'] = [9]
        result, report = reconcile(rows, features)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['legacy_ids'], [1,9])
        self.assertEqual(result[0]['source_record_ids'], ['0','1'])

    def test_same_geometry_different_codes_do_not_merge(self):
        poly = Polygon([(0,0),(1,0),(1,1),(0,1)])
        result, _ = reconcile(*self.fixture([poly, poly], ['1','2']))
        self.assertEqual(len(result), 2)

    def test_containment_is_not_enough_to_merge(self):
        result, _ = reconcile(*self.fixture([Polygon([(0,0),(10,0),(10,10),(0,10)]), Polygon([(0,0),(1,0),(1,1),(0,1)])]))
        self.assertEqual(len(result), 2)
        self.assertTrue(all(r['verification_status']=='legacy_review_required' for r in result))

    def test_concave_footprint_centroid_outside_is_relocated_inside(self):
        poly = Polygon([(0,0),(4,0),(4,1),(1,1),(1,4),(0,4)])
        self.assertFalse(poly.covers(poly.centroid))
        result, report = reconcile(*self.fixture([poly]))
        self.assertEqual(len(report['relocated_markers']), 1)
        self.assertTrue(poly.covers(Point(result[0]['lon'],result[0]['lat'])))

    def test_published_rows_cover_all_source_features_and_old_links(self):
        rows = json.loads((ROOT/'cities/bologna/addresses.json').read_text())
        features = json.loads(SOURCE.read_text())['features']
        by_id = {str(f['properties']['ID']): f for f in features}
        source_ids, links = [], []
        for r in rows:
            source_ids.extend(r.get('source_record_ids', [r['source_record_id']]))
            links.extend([r['id'], *r.get('legacy_ids', [])])
            self.assertTrue(shape(by_id[r['source_record_id']]['geometry']).covers(Point(r['lon'],r['lat'])))
            if r['verification_status']=='source_verified':
                polygons = [shape(by_id[s]['geometry']) for s in r['source_record_ids']]
                for a in polygons:
                    for b in polygons:
                        self.assertGreaterEqual(a.intersection(b).area/max(a.area,b.area), .75)
        self.assertCountEqual(source_ids, by_id.keys())
        self.assertCountEqual(links, range(630))
        self.assertEqual(sum(r['verification_status']=='legacy_review_required' for r in rows),6)

if __name__ == '__main__': unittest.main()
