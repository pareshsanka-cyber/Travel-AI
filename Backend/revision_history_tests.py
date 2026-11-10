"""Unit tests for trip revision snapshots, history tracking, and restore capability."""
import copy
import threading
import unittest
from types import SimpleNamespace
from fastapi import HTTPException
from app.services.revision_service import create_snapshot, get_trip_revisions, restore_trip_revision


class MockCollection:
    def __init__(self):
        self.docs = []
        self.lock = threading.RLock()

    def find_one(self, query, projection=None):
        with self.lock:
            for doc in self.docs:
                matches = True
                for k, v in query.items():
                    if k == '_id' and doc.get('_id') != v:
                        matches = False
                        break
                    elif k == 'user_id' and doc.get('user_id') != v:
                        matches = False
                        break
                if matches:
                    return copy.deepcopy(doc)
            return None

    def update_one(self, query, update):
        with self.lock:
            doc = self.find_one(query)
            if not doc:
                return SimpleNamespace(matched_count=0)
            for k, v in update.get('$set', {}).items():
                doc[k] = copy.deepcopy(v)
            # Update the stored doc
            for i, existing in enumerate(self.docs):
                if existing.get('_id') == doc.get('_id'):
                    self.docs[i] = copy.deepcopy(doc)
            return SimpleNamespace(matched_count=1)

    def insert_one(self, doc):
        with self.lock:
            self.docs.append(copy.deepcopy(doc))
            return SimpleNamespace(inserted_id=doc.get('_id', 'test_id'))


class RevisionHistoryTests(unittest.TestCase):
    def setUp(self):
        self.db = SimpleNamespace(trips=MockCollection(), payments=MockCollection())
        self.user_id = 'user-test-123'
        self.trip_id = 'trip-goa-456'
        self.initial_trip = {
            '_id': self.trip_id,
            'id': self.trip_id,
            'user_id': self.user_id,
            'destination': 'Goa, India',
            'days': 2,
            'revision': 1,
            'budget': 35000,
            'route_details': {
                'day_by_day_route': [
                    {
                        'day': 1,
                        'date': '2026-11-10',
                        'title': 'Day 1: Arrival & North Goa',
                        'stops': [
                            {
                                'id': 'stop-1',
                                'title': 'Calangute Beach',
                                'start_time': '10:00',
                                'end_time': '12:00',
                                'time': '10:00 - 12:00',
                                'duration_minutes': 120,
                                'type': 'attraction',
                            },
                            {
                                'id': 'stop-2',
                                'title': 'Baga Beach Shacks',
                                'start_time': '13:00',
                                'end_time': '15:00',
                                'time': '01:00 PM - 03:00 PM',
                                'duration_minutes': 120,
                                'type': 'restaurant',
                            },
                        ],
                    },
                    {
                        'day': 2,
                        'date': '2026-11-11',
                        'title': 'Day 2: Heritage & Forts',
                        'stops': [
                            {
                                'id': 'stop-3',
                                'title': 'Aguada Fort',
                                'start_time': '09:00',
                                'end_time': '11:00',
                                'time': '09:00 AM - 11:00 AM',
                                'duration_minutes': 120,
                                'type': 'attraction',
                            },
                        ],
                    },
                ]
            },
        }
        self.db.trips.insert_one(self.initial_trip)

    def test_create_snapshot_extracts_full_schedule(self):
        snap = create_snapshot(self.initial_trip, summary='Initial test itinerary', trigger='initial')
        self.assertEqual(snap['revision'], 1)
        self.assertEqual(snap['summary'], 'Initial test itinerary')
        self.assertEqual(snap['trigger'], 'initial')
        self.assertEqual(len(snap['days']), 2)
        self.assertEqual(len(snap['days'][0]['activities']), 2)
        self.assertEqual(snap['days'][0]['activities'][0]['title'], 'Calangute Beach')

    def test_get_trip_revisions_seeds_initial_if_empty(self):
        res = get_trip_revisions(self.db, self.trip_id, self.user_id)
        self.assertEqual(res['current_revision'], 1)
        self.assertEqual(len(res['revisions']), 1)
        self.assertEqual(res['revisions'][0]['revision'], 1)

    def test_restore_trip_revision_restores_and_increments(self):
        # First add Revision 2 to history
        rev2_trip = copy.deepcopy(self.initial_trip)
        rev2_trip['revision'] = 2
        # In Rev 2, Calangute was replaced with Reis Magos Fort
        rev2_trip['route_details']['day_by_day_route'][0]['stops'][0] = {
            'id': 'stop-99',
            'title': 'Reis Magos Fort',
            'start_time': '10:00',
            'end_time': '12:00',
            'duration_minutes': 120,
            'type': 'attraction',
        }
        snap2 = create_snapshot(rev2_trip, summary='Added Reis Magos Fort', trigger='ai_edit')

        snap1 = create_snapshot(self.initial_trip, summary='Initial', trigger='initial')
        self.db.trips.update_one(
            {'_id': self.trip_id},
            {'$set': {'revision': 2, 'revision_history': [snap1, snap2]}}
        )

        # Now restore back to Revision 1 (expected_revision = 2)
        restored = restore_trip_revision(
            self.db,
            self.trip_id,
            self.user_id,
            target_revision=1,
            expected_revision=2,
        )

        # Revision must bump to 3
        self.assertEqual(restored['revision'], 3)
        # Day 1 stop 1 should be Calangute Beach from Rev 1
        stops = restored['route_details']['day_by_day_route'][0]['stops']
        self.assertEqual(stops[0]['title'], 'Calangute Beach')

        # Check revision history now has 3 snapshots
        updated = self.db.trips.find_one({'_id': self.trip_id})
        self.assertEqual(len(updated['revision_history']), 3)
        self.assertEqual(updated['revision_history'][2]['revision'], 3)
        self.assertEqual(updated['revision_history'][2]['trigger'], 'restore')

    def test_restore_trip_revision_rejects_stale_concurrency(self):
        with self.assertRaises(HTTPException) as cm:
            restore_trip_revision(
                self.db,
                self.trip_id,
                self.user_id,
                target_revision=1,
                expected_revision=999,  # Stale revision
            )
        self.assertEqual(cm.exception.status_code, 409)

    def test_restore_trip_revision_rejects_invalid_target(self):
        with self.assertRaises(HTTPException) as cm:
            restore_trip_revision(
                self.db,
                self.trip_id,
                self.user_id,
                target_revision=42,  # Doesn't exist
                expected_revision=1,
            )
        self.assertEqual(cm.exception.status_code, 404)


if __name__ == '__main__':
    unittest.main()
