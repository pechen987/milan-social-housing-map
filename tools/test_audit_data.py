import json
from pathlib import Path
import tempfile
import unittest
from audit_data import audit

class ContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root/'cities/test').mkdir(parents=True)
        (self.root/'site.json').write_text('{"cities":[{"id":"test"}]}')
        (self.root/'cities/test/config.json').write_text('{"sources":[{"key":"register"}]}')
        self.row = dict(id=0, record_uid='test:0', methodology_version=1, entity_type='building', verification_status='source_verified', building_ref='official:1', source='register', source_record_id='1', reviewed_on='2026-10-15', verification_note='Source says one building.', source_as_of=None, tenure_scope='unknown', coordinate_method='address_point', coordinate_source='https://example.org/civic/1', address='Example 1', lat=45, lon=9)
    def run_rows(self, rows):
        (self.root/'cities/test/addresses.json').write_text(json.dumps(rows))
        return audit(self.root)
    def test_entrance_does_not_claim_rooftop_but_can_represent_building(self):
        self.assertFalse(self.run_rows([self.row])['errors'])
    def test_duplicate_building_identity_fails(self):
        other = dict(self.row, id=1, record_uid='test:1')
        self.assertTrue(any('duplicate building identity' in x for x in self.run_rows([self.row,other])['errors']))
    def test_same_coordinates_are_review_queue_not_auto_merge(self):
        other = dict(self.row, id=1, record_uid='test:1', building_ref='official:2')
        r=self.run_rows([self.row,other]);self.assertFalse(r['errors']);self.assertEqual(len(r['cities']['test']['coincident_coordinate_groups']),1)
    def test_street_only_cannot_be_verified_building(self):
        self.assertTrue(self.run_rows([dict(self.row,coordinate_method='street_point')])['errors'])
    def test_alias_cannot_shadow_existing_link(self):
        self.assertTrue(self.run_rows([dict(self.row,legacy_ids=[0])])['errors'])

if __name__ == '__main__': unittest.main()
