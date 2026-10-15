"""Offline API and schedule regression tests. No provider calls or production writes."""
import copy
import hashlib
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
from bson import ObjectId
from fastapi.testclient import TestClient
from app.main import app
from app.utils import auth_utils
from app.services import conversation_service
from app.api import auth, trips
from app.services.itinerary_edit_service import apply_schedule_edits
from app.services.trip_consistency import revision_filter, validate_reroute
from app.services.reroute_service import apply_reroute_proposal
from app.ai.agents.opening_hours_agent import determine_status_from_hours
from app.ai.agents.weather_agent import fetch_realtime_weather_openmeteo
from app.ai.agents.budget_agent import budget_node
from app.ai.reviewer.reviewer_agent import reviewer_node
from app.ai.orchestrator.langgraph_graph import should_continue


def matches(doc, query):
    for key, value in query.items():
        if isinstance(value, dict):
            if '$exists' in value and (key in doc) != value['$exists']: return False
            if '$gt' in value and (key not in doc or doc[key] <= value['$gt']): return False
            if '$in' in value and doc.get(key) not in value['$in']: return False
        elif doc.get(key) != value: return False
    return True


class Collection:
    def __init__(self, docs=()): self.docs = copy.deepcopy(list(docs))
    def find_one(self, query): return next((copy.deepcopy(d) for d in self.docs if matches(d, query)), None)
    def find(self, query): return Cursor(copy.deepcopy([d for d in self.docs if matches(d, query)]))
    def insert_one(self, doc):
        doc['_id'] = doc.get('_id', ObjectId())
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc['_id'])
    def update_one(self, query, update):
        for doc in self.docs:
            if matches(doc, query):
                doc.update(copy.deepcopy(update.get('$set', {})))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)
    def delete_one(self, query):
        for doc in self.docs:
            if matches(doc, query):
                self.docs.remove(doc)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)
    def delete_many(self, query):
        self.docs = [d for d in self.docs if not matches(d, query)]


class Cursor(list):
    def sort(self, field, direction):
        super().sort(key=lambda doc: doc.get(field, ''), reverse=direction < 0)
        return self
    def limit(self, count): return Cursor(self[:count])


def sample_trip():
    stops = [dict(id='a', name='Museum', title='Museum', type='attraction', start_time='09:00', end_time='10:00', duration_minutes=60, lat=17.4, lon=78.4),
             dict(id='b', name='Fort', title='Fort', type='attraction', start_time='11:00', end_time='12:00', duration_minutes=60, lat=17.4, lon=78.4)]
    return dict(_id=ObjectId(), user_id='owner', revision=1, destination='Hyderabad', days=1, budget=10000, currency='INR',
                bedtime='22:00', route_details={'day_by_day_route': [{'day': 1, 'date': '2026-12-01', 'stops': stops}]},
                execution_state={'activity_log': {}, 'reroute_history': []}, attractions=[{'name':'Museum','entrance_fee':100},{'name':'Fort','entrance_fee':200}])


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.owner = str(ObjectId())
        self.trip = sample_trip(); self.trip['user_id'] = self.owner
        self.db = SimpleNamespace(users=Collection([{'_id':ObjectId(self.owner),'name':'Owner','email':'owner@example.com'}]),
            sessions=Collection(), trips=Collection([self.trip]), reroute_proposals=Collection(),
            payments=Collection([dict(_id=ObjectId(), user_id=self.owner, trip_id=str(self.trip['_id']),
                product='trip_plus', mode='demo', amount=49900, currency='INR', status='succeeded')]))
        for module in (auth_utils, auth, trips):
            p = patch.object(module, 'db', self.db); p.start(); self.addCleanup(p.stop)
        self.token = auth_utils.generate_token('owner@example.com', self.owner)
        self.headers = {'Authorization': f'Bearer {self.token}'}
        self.client = TestClient(app)  # Lifespan deliberately excluded: isolated in-memory storage.

    def test_unsigned_and_missing_tokens_rejected(self):
        for header in ({}, {'Authorization':'Bearer invented'}, {'x-user-id':self.owner}):
            self.assertEqual(self.client.get('/api/auth/me',headers=header).status_code,401)
            self.assertEqual(self.client.get('/api/trips/history',headers=header).status_code,401)

    def test_new_plans_reject_past_dates_before_provider_calls(self):
        with patch.object(trips.graph, 'invoke') as planning:
            result = self.client.post('/api/trips/plan', headers=self.headers, json={
                'destination': 'Goa', 'days': 2, 'start_date': '2020-01-01', 'end_date': '2020-01-02'})
            self.assertEqual(result.status_code, 400)
            self.assertIn('Past travel dates are not allowed', result.json()['detail'])
            planning.assert_not_called()
        self.db.trips.docs[0]['start_date'] = '2020-01-01'
        self.assertEqual(self.client.get('/api/trips/' + str(self.trip['_id']), headers=self.headers).status_code, 200)

    def test_every_travel_endpoint_requires_session(self):
        requests = [('POST','/api/trips/plan',{}), ('POST','/api/flights/search',{'destination':'Goa'}),
            ('POST','/api/trips/flights/search',{'destination':'Goa'}),('POST','/api/chat/message',{'message':'hello'}),
            ('GET','/api/chat/conversations',None),('GET','/api/chat/conversations/private',None),
            ('DELETE','/api/chat/conversations/private',None),('DELETE','/api/trips/private',None),
            ('POST','/api/trips/private/reroute/preview',{'day_number':1,'skipped_activity_id':'a'}),
            ('POST','/api/trips/private/reroute/apply',{'proposal_id':'p','day_number':1,'skipped_activity_id':'a','proposed_stops':[]}),
            ('POST','/api/trips/private/execution_state',{'expected_revision':1,'execution_state':{}}),
            ('GET','/api/trips/private',None),('POST','/api/trips/private/selections',{'expected_revision':1,'hotel_id':'h2'})]
        for method, path, payload in requests:
            with self.subTest(path=path):
                self.assertEqual(self.client.request(method,path,**({'json':payload} if payload is not None else {})).status_code,401)

    def test_registration_and_password_verification(self):
        payload = {'name':'New User','email':'NEW@example.com','password':'correct-password'}
        response = self.client.post('/api/auth/register',json=payload)
        self.assertEqual(response.status_code,200,response.text)
        stored = self.db.users.find_one({'email':'new@example.com'})
        self.assertNotEqual(stored['password'],payload['password'])
        self.assertTrue(auth_utils.verify_password(stored['password'],payload['password']))
        self.assertEqual(self.client.post('/api/auth/login',json={'email':payload['email'],'password':'wrong-password'}).status_code,401)
        self.assertEqual(self.client.post('/api/auth/login',json={'email':payload['email'],'password':payload['password']}).status_code,200)
        self.assertEqual(self.client.post('/api/auth/register',json=payload).status_code,400)

    def test_trip_history_filters_by_verified_session(self):
        self.db.trips.insert_one(dict(sample_trip(),user_id='someone-else'))
        self.db.trips.insert_one(dict(sample_trip(),user_id=None))
        result = self.client.get('/api/trips/history',headers=dict(self.headers,**{'x-user-id':'someone-else'})).json()
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['user_id'],self.owner)

    def test_token_digest_and_verified_identity(self):
        self.assertEqual(self.db.sessions.docs[0]['token_hash'], hashlib.sha256(self.token.encode()).hexdigest())
        self.assertNotIn(self.token, str(self.db.sessions.docs))
        response = self.client.get('/api/auth/me',headers=self.headers)
        self.assertEqual(response.json()['user']['id'], self.owner)

    def test_expiration_and_revocation(self):
        self.db.sessions.docs[0]['expires_at'] = datetime.utcnow()-timedelta(seconds=1)
        self.assertEqual(self.client.get('/api/auth/me',headers=self.headers).status_code,401)
        token = auth_utils.generate_token('owner@example.com',self.owner)
        headers = {'Authorization':f'Bearer {token}'}
        self.assertEqual(self.client.post('/api/auth/logout',headers=headers).status_code,200)
        self.assertEqual(self.client.get('/api/auth/me',headers=headers).status_code,401)

    def test_user_header_cannot_impersonate_owner(self):
        other = str(ObjectId()); self.db.users.insert_one({'_id':ObjectId(other)})
        token = auth_utils.generate_token('other@example.com',other)
        response = self.client.delete('/api/trips/'+str(self.trip['_id']),headers={'Authorization':f'Bearer {token}','x-user-id':self.owner})
        self.assertEqual(response.status_code,404)
        self.assertEqual(len(self.db.trips.docs),1)

    def test_execution_state_revision_and_identity(self):
        payload = {'expected_revision':1,'execution_state':{'activity_log':{'a':{'status':'completed'}}}}
        endpoint = '/api/trips/'+str(self.trip['_id'])+'/execution_state'
        self.assertEqual(self.client.post(endpoint,json=payload,headers=self.headers).json()['revision'],2)
        self.assertEqual(self.client.post(endpoint,json=payload,headers=self.headers).status_code,409)
        payload['expected_revision']=2; payload['execution_state']['activity_log']={'invented':{'status':'completed'}}
        self.assertEqual(self.client.post(endpoint,json=payload,headers=self.headers).status_code,400)
        payload['execution_state']['activity_log']={'a':{'status':'banana'}}
        self.assertEqual(self.client.post(endpoint,json=payload,headers=self.headers).status_code,422)

    def test_legacy_dual_written_progress_is_normalized(self):
        entry = {'status':'completed','activity_id':'a','activity_title':'Museum'}
        response = self.client.post('/api/trips/'+str(self.trip['_id'])+'/execution_state',headers=self.headers,
            json={'expected_revision':1,'execution_state':{'activity_log':{'a':entry,'1_0':entry}}})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(set(response.json()['execution_state']['activity_log']),{'a'})

    def test_legacy_companion_ids_and_progress_survive_refresh_without_rewriting_trip(self):
        stored = self.db.trips.docs[0]
        stored.pop('revision', None)
        stored['route_details'] = {'day_by_day_route': [
            {'day': 1, 'stops': [{'name': 'Hyderabad Airport', 'type': 'airport'}, {'name': 'Hotel', 'type': 'hotel'}]},
            {'day': 2, 'stops': [{'name': 'Hotel', 'type': 'hotel'}]}]}
        original = copy.deepcopy(stored['route_details'])
        endpoint = '/api/trips/' + str(self.trip['_id'])
        detail = self.client.get(endpoint, headers=self.headers).json()
        history = self.client.get('/api/trips/history', headers=self.headers).json()[0]
        self.assertEqual(history['route_details'], detail['route_details'])
        routes = detail['route_details']['day_by_day_route']
        airport_id = routes[0]['stops'][0]['id']
        self.assertNotEqual(routes[0]['stops'][1]['id'], routes[1]['stops'][0]['id'])
        for status, revision in [('completed', 1), ('skipped', 2)]:
            result = self.client.post(endpoint + '/execution_state', headers=self.headers, json={
                'expected_revision': revision, 'execution_state': {'is_active': True,
                    'activity_log': {airport_id: {'status': status, 'activity_id': airport_id}}}})
            self.assertEqual(result.status_code, 200, result.text)
            refreshed = self.client.get(endpoint, headers=self.headers).json()
            self.assertEqual(refreshed['execution_state']['activity_log'][airport_id]['status'], status)
        self.assertEqual(stored['route_details'], original)
        invalid = self.client.post(endpoint + '/execution_state', headers=self.headers, json={
            'expected_revision': 3, 'execution_state': {'activity_log': {'invented': {'status': 'completed'}}}})
        self.assertEqual(invalid.status_code, 400)

    def test_legacy_positional_progress_uses_server_activity_id(self):
        stored = self.db.trips.docs[0]
        stored['route_details']['day_by_day_route'][0]['stops'][0].pop('id')
        endpoint = '/api/trips/' + str(self.trip['_id'])
        identity = self.client.get(endpoint, headers=self.headers).json()['route_details']['day_by_day_route'][0]['stops'][0]['id']
        result = self.client.post(endpoint + '/execution_state', headers=self.headers, json={
            'expected_revision': 1, 'execution_state': {'activity_log': {'1_0': {'status': 'completed'}}}})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(set(result.json()['execution_state']['activity_log']), {identity})

    def test_reroute_requires_server_preview(self):
        response = self.client.post('/api/trips/'+str(self.trip['_id'])+'/reroute/apply',headers=self.headers,
            json={'proposal_id':'forged','day_number':1,'skipped_activity_id':'a','proposed_stops':[{'id':'made_up'}]})
        self.assertEqual(response.status_code,409)
        self.assertEqual(self.db.trips.docs[0]['revision'],1)

    def test_reroute_ignores_client_supplied_stops(self):
        proposal = {'proposed_stops':[self.trip['route_details']['day_by_day_route'][0]['stops'][1]],'reason':'Skip museum'}
        self.db.reroute_proposals.insert_one({'proposal_id':'valid','trip_id':str(self.trip['_id']),'user_id':self.owner,
            'revision':1,'day_number':1,'skipped_activity_id':'a','proposal':proposal,'expires_at':datetime.utcnow()+timedelta(minutes=1)})
        response = self.client.post('/api/trips/'+str(self.trip['_id'])+'/reroute/apply',headers=self.headers,
            json={'proposal_id':'valid','day_number':1,'skipped_activity_id':'a','proposed_stops':[{'id':'made_up'}]})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['route_details']['day_by_day_route'][0]['stops'][0]['id'],'b')

    def test_legacy_reroute_preview_accept_and_refresh_preserve_saved_schedule(self):
        stored = self.db.trips.docs[0]
        stored.pop('revision', None)
        stored['destination'] = 'Sydney, Australia'
        stored['route_details'] = {'day_by_day_route': [
            {'day': 1, 'stops': [{'name': 'Hyderabad Airport', 'type': 'airport'},
                {'name': 'Sydney, Australia Airport', 'type': 'airport'}, {'name': 'Sydney Hotel', 'type': 'hotel'}]},
            {'day': 2, 'stops': [{'name': 'Sydney Hotel', 'type': 'hotel'}]}]}
        before = copy.deepcopy(stored)
        endpoint = '/api/trips/' + str(self.trip['_id'])
        identity = self.client.get(endpoint, headers=self.headers).json()['route_details']['day_by_day_route'][0]['stops'][1]['id']
        with patch('app.services.reroute_service.resolve_destination_coordinates') as discovery:
            preview = self.client.post(endpoint + '/reroute/preview', headers=self.headers, json={
                'day_number': 1, 'skipped_activity_id': identity, 'expected_revision': 1})
            discovery.assert_not_called()
        self.assertEqual(preview.status_code, 200, preview.text)
        proposal = preview.json()
        self.assertEqual(proposal['mode'], 'skip_only')
        self.assertFalse(proposal['rescheduled_stops'])
        self.assertEqual(stored, before)  # Cancelling a preview leaves everything intact.
        payload = dict(proposal_id=proposal['proposal_id'], day_number=1, skipped_activity_id=identity,
            proposed_stops=[{'id': 'browser-tampered'}], expected_revision=1)
        accepted = self.client.post(endpoint + '/reroute/apply', headers=self.headers, json=payload)
        self.assertEqual(accepted.status_code, 200, accepted.text)
        refreshed = self.client.get(endpoint, headers=self.headers).json()
        self.assertEqual(refreshed['execution_state']['activity_log'][identity]['status'], 'skipped')
        for key in ('route_details', 'budget_breakdown', 'planner_draft', 'final_itinerary'):
            self.assertEqual(stored.get(key), before.get(key))
        self.assertEqual(self.client.post(endpoint + '/reroute/apply', headers=self.headers, json=payload).status_code, 409)

    def test_legacy_reroute_blocks_skipping_completed_and_changing_untimed_stops(self):
        from app.utils.activity_identity import routes_with_activity_ids
        trip = copy.deepcopy(self.trip)
        stops = trip['route_details']['day_by_day_route'][0]['stops']
        for stop in stops:
            stop.pop('id', None); stop.pop('start_time', None); stop.pop('end_time', None)
        identified = routes_with_activity_ids(trip['route_details']['day_by_day_route'])[0]['stops']
        skipped = identified[0]['id']
        changed = dict(identified[1], start_time='09:00', end_time='10:00')
        with self.assertRaisesRegex(ValueError, 'incomplete timings'):
            validate_reroute(trip, 1, skipped, [changed])
        trip['execution_state']['activity_log'][skipped] = {'status': 'completed'}
        with self.assertRaisesRegex(ValueError, 'cannot be skipped'):
            validate_reroute(trip, 1, skipped, identified[1:])

    def test_timed_legacy_reroute_accepts_same_ids_as_preview(self):
        from app.utils.activity_identity import routes_with_activity_ids
        stored = self.db.trips.docs[0]
        for day in stored['route_details']['day_by_day_route']:
            for stop in day['stops']:
                stop.pop('id', None)
        identified = routes_with_activity_ids(stored['route_details']['day_by_day_route'])[0]['stops']
        result = apply_reroute_proposal(self.db, str(stored['_id']), 1, identified[0]['id'], identified[1:],
            expected_revision=1, x_user_id=self.owner)
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['route_details']['day_by_day_route'][0]['stops'][0]['id'], identified[1]['id'])

    def test_conversation_ownership(self):
        conversations=Collection([{'conversation_id':'private','user_id':'other','travel_context':{}}]); messages=Collection([{'conversation_id':'private'}])
        with patch.object(conversation_service,'conversations_col',conversations), patch.object(conversation_service,'messages_col',messages):
            self.assertEqual(self.client.get('/api/chat/conversations/private',headers=self.headers).status_code,404)
            self.assertEqual(self.client.delete('/api/chat/conversations/private',headers=self.headers).status_code,404)
            self.assertEqual(self.client.post('/api/chat/message',headers=self.headers,json={'conversation_id':'private','message':'delete it'}).status_code,404)
            self.assertEqual(len(messages.docs),1)

    def test_recent_history_keeps_latest_messages_in_order(self):
        messages=Collection([{'conversation_id':'test','created_at':i,'content':str(i)} for i in range(20)])
        with patch.object(conversation_service,'messages_col',messages):
            result=conversation_service.get_conversation_messages('test',limit=3)
            self.assertEqual([m['content'] for m in result],['17','18','19'])

    def selection_fixture(self):
        self.db.trips.docs[0]['hotels'] = [{'id':'h1','name':'First Hotel','lat':17.4,'lon':78.4,'total_cost':1000},
                                         {'id':'h2','name':'Second Hotel','lat':17.4,'lon':78.4,'total_cost':3000}]
        return '/api/trips/'+str(self.trip['_id'])+'/selections'

    def test_saved_choices_update_budget_schedule_and_survive_retrieval(self):
        endpoint=self.selection_fixture()
        response=self.client.post(endpoint,headers=self.headers,json={'expected_revision':1,'hotel_id':'h2'})
        self.assertEqual(response.status_code,200,response.text)
        trip=response.json()['trip']
        self.assertEqual(trip['selections']['hotel_id'],'h2')
        self.assertEqual(trip['revision'],2)
        self.assertEqual(trip['budget_breakdown']['hotel_cost'],3000)
        self.assertIn('Second Hotel',trip['planner_draft'])
        self.assertEqual(trip['start_date'],'2026-12-01')
        reloaded=self.client.get(endpoint.removesuffix('/selections'),headers=self.headers).json()
        self.assertEqual(reloaded['selections'],trip['selections'])

    def test_invalid_and_stale_choices_cannot_change_trip(self):
        endpoint=self.selection_fixture(); before=copy.deepcopy(self.db.trips.docs[0])
        self.assertEqual(self.client.post(endpoint,headers=self.headers,json={'expected_revision':1,'hotel_id':'invented'}).status_code,400)
        self.assertEqual(self.client.post(endpoint,headers=self.headers,json={'expected_revision':9,'hotel_id':'h2'}).status_code,409)
        self.assertEqual(self.db.trips.docs[0],before)

    def test_choices_are_frozen_after_companion_mode_starts(self):
        endpoint=self.selection_fixture(); self.db.trips.docs[0]['execution_state']['is_active']=True
        self.assertEqual(self.client.post(endpoint,headers=self.headers,json={'expected_revision':1,'hotel_id':'h2'}).status_code,409)

    def test_choices_preserve_custom_visits_and_durations(self):
        endpoint=self.selection_fixture()
        self.db.trips.docs[0]['route_details']['day_by_day_route'][0]['stops'] = [self.trip['route_details']['day_by_day_route'][0]['stops'][1]]
        self.db.trips.docs[0]['route_details']['day_by_day_route'][0]['stops'][0].update(end_time='12:30',duration_minutes=90)
        response=self.client.post(endpoint,headers=self.headers,json={'expected_revision':1,'hotel_id':'h2'})
        self.assertEqual(response.status_code,200,response.text)
        stops=response.json()['trip']['route_details']['day_by_day_route'][0]['stops']
        self.assertEqual([s['id'] for s in stops],['b'])
        self.assertEqual(stops[0]['duration_minutes'],90)

    def test_saved_flight_choice_updates_known_costs(self):
        self.db.trips.docs[0]['flights']=[{'id':'f1','price':1000},{'id':'f2','price':2000}]
        response=self.client.post('/api/trips/'+str(self.trip['_id'])+'/selections',headers=self.headers,
            json={'expected_revision':1,'flight_id':'f2'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['trip']['selections']['flight_id'],'f2')
        self.assertEqual(response.json()['trip']['budget_breakdown']['flight_cost'],4000)

    def test_overnight_flight_change_cannot_desync_arrival_day(self):
        departure = dict(id='departure', name='Origin airport', type='airport', start_time='21:00', end_time='23:00', duration_minutes=120)
        arrival = dict(id='arrival', name='Destination airport', type='airport', start_time='01:00', end_time='01:50', duration_minutes=50)
        self.db.trips.docs[0].update(days=2, flights=[{'id': 'f1', 'price': 1000}, {'id': 'f2', 'price': 2000}],
            selections={'flight_id': 'f1', 'hotel_id': None}, route_details={'day_by_day_route': [
                {'day': 1, 'date': '2026-12-01', 'stops': [departure]}, {'day': 2, 'date': '2026-12-02', 'stops': [arrival]}]})
        before = copy.deepcopy(self.db.trips.docs[0])
        response = self.client.post('/api/trips/' + str(self.trip['_id']) + '/selections', headers=self.headers,
            json={'expected_revision': 1, 'flight_id': 'f2'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.db.trips.docs[0], before)

    def test_choice_over_fixed_budget_is_not_saved(self):
        endpoint=self.selection_fixture(); self.db.trips.docs[0].update(budget=2000,budget_mode='FIXED')
        self.assertEqual(self.client.post(endpoint,headers=self.headers,json={'expected_revision':1,'hotel_id':'h2'}).status_code,400)
        self.assertEqual(self.db.trips.docs[0]['revision'],1)

    def test_readiness_reports_database_outage(self):
        with patch('app.main.client',SimpleNamespace(admin=SimpleNamespace(command=MagicMock(side_effect=RuntimeError('database down'))))):
            response=self.client.get('/health/ready')
            self.assertEqual(response.status_code,503)
            self.assertEqual(response.json()['status'],'unavailable')
            self.assertTrue(response.headers.get('X-Request-ID'))

    def test_internal_error_details_do_not_leak_to_clients(self):
        with patch('app.api.trips.db.trips.find',side_effect=RuntimeError('secret-database-password')):
            response=self.client.get('/api/trips/history',headers=self.headers)
            self.assertEqual(response.status_code,500)
            self.assertNotIn('secret-database-password',response.text)
            self.assertEqual(response.json()['request_id'],response.headers['X-Request-ID'])


class ScheduleTests(unittest.TestCase):
    def test_atomic_revision_compare_and_write(self):
        trip=sample_trip(); collection=Collection([trip]); query=revision_filter({'_id':trip['_id']},trip)
        self.assertEqual(collection.update_one(query,{'$set':{'revision':2}}).matched_count,1)
        self.assertEqual(collection.update_one(query,{'$set':{'revision':2}}).matched_count,0)

    def test_legacy_revision_compare_and_write(self):
        trip=sample_trip(); del trip['revision']; collection=Collection([trip]); query=revision_filter({'_id':trip['_id']},trip)
        self.assertEqual(collection.update_one(query,{'$set':{'revision':2}}).matched_count,1)
        self.assertEqual(collection.update_one(query,{'$set':{'revision':2}}).matched_count,0)

    def test_write_conflict_returns_409(self):
        trip=sample_trip(); db=SimpleNamespace(trips=Collection([trip]))
        db.trips.update_one=MagicMock(return_value=SimpleNamespace(matched_count=0))
        with self.assertRaises(Exception) as error:
            apply_reroute_proposal(db,str(trip['_id']),1,'a',[trip['route_details']['day_by_day_route'][0]['stops'][1]],expected_revision=1,x_user_id='owner')
        self.assertEqual(error.exception.status_code,409)

    def test_remove_updates_text_schedule_and_costs(self):
        trip=sample_trip(); result=apply_schedule_edits(trip,[{'action':'remove','day_number':1,'activity_id':'a'}])
        self.assertNotIn('Museum',result['planner_draft'])
        self.assertEqual(len(result['route_details']['day_by_day_route'][0]['stops']),1)
        self.assertEqual(len(trip['route_details']['day_by_day_route'][0]['stops']),2)
        self.assertEqual(result['budget_breakdown']['activities_cost'],400)  # default two travelers

    def test_duration_reflows_following_stops(self):
        result=apply_schedule_edits(sample_trip(),[{'action':'duration','day_number':1,'activity_id':'a','duration_minutes':180}])
        stops=result['route_details']['day_by_day_route'][0]['stops']
        self.assertEqual(stops[0]['end_time'],'12:00')
        self.assertGreaterEqual(stops[1]['start_time'],'12:00')

    def test_protect_completed_stops_and_unknown_replacements(self):
        trip=sample_trip(); trip['execution_state']['activity_log']['a']={'status':'completed'}
        with self.assertRaises(ValueError): apply_schedule_edits(trip,[{'action':'remove','day_number':1,'activity_id':'a'}])
        with self.assertRaises(ValueError): apply_schedule_edits(sample_trip(),[{'action':'replace','day_number':1,'activity_id':'a','replacement_name':'Invented Museum'}])

    def test_invalid_reroute_is_rejected(self):
        trip=sample_trip(); stops=copy.deepcopy(trip['route_details']['day_by_day_route'][0]['stops'][1:]); stops[0]['end_time']='10:00'
        with self.assertRaises(ValueError): validate_reroute(trip,1,'a',stops)

    def test_unknown_hours_and_visit_window(self):
        t=datetime(2026,12,1)
        self.assertEqual(determine_status_from_hours({'monday':'09:00-17:00'},t)[0],'UNKNOWN')
        self.assertEqual(determine_status_from_hours(['Monday: Closed'],t)[0],'UNKNOWN')
        self.assertEqual(determine_status_from_hours('09:00-17:00',t,'10:00','11:00')[0],'OPEN')
        self.assertEqual(determine_status_from_hours('09:00-17:00',t,'16:30','18:00')[0],'CLOSED')

    def test_far_future_weather_does_not_fabricate(self):
        with patch('app.ai.agents.weather_agent.httpx.get') as network:
            result=fetch_realtime_weather_openmeteo('Goa',3,'2099-12-01','2099-12-03')
            self.assertEqual(result['data_status'],'unavailable'); network.assert_not_called()

    def test_unknown_weather_location_does_not_use_india(self):
        with patch('app.ai.agents.weather_agent.httpx.get',side_effect=RuntimeError('offline')):
            self.assertEqual(fetch_realtime_weather_openmeteo('Unknown Location')['data_status'],'unavailable')

    def test_one_way_cost_not_doubled(self):
        result=budget_node({'budget':10000,'travelers':2,'flights':[{'price':1000,'total_price':2000}]})['budget_breakdown']
        self.assertEqual(result['flight_cost'],2000)
        self.assertFalse(result['is_complete']); self.assertIn('food',result['missing_categories'])

    def test_rejection_cannot_bypass_review(self):
        with self.assertRaises(ValueError): should_continue({'is_approved':False,'completed_steps':['planner']})
        self.assertFalse(reviewer_node({'destination':'Goa','days':2,'route_details':{'day_by_day_route':[]}})['is_approved'])

    def test_fixed_budget_overrun_is_rejected(self):
        trip=sample_trip(); trip.update(budget=100, budget_mode='FIXED',budget_breakdown={'total_trip_cost':500})
        self.assertFalse(reviewer_node(trip)['is_approved'])

    def test_actual_graph_with_mocked_discovery(self):
        import importlib
        from contextlib import ExitStack
        import app.ai.orchestrator.langgraph_graph as module
        fixture = {'destination':'Hyderabad','days':2,'budget':10000,'start_date':'2026-12-01','end_date':'2026-12-02',
                   'completed_steps':[],'is_approved':False}
        outputs = {
            'flight': {'flights':[], 'flight_metadata':{}},
            'hotel': {'hotels':[{'name':'Fixture Hotel','lat':17.4,'lon':78.4,'total_cost':1000}]},
            'weather': {'weather':{'data_status':'unavailable'}},
            'attraction': {'attractions':[{'name':'Museum','lat':17.4,'lon':78.4,'entrance_fee':100}]},
            'restaurant': {'restaurants':[]},
        }
        try:
            with ExitStack() as stack:
                for name, result in outputs.items():
                    stack.enter_context(patch(f'app.ai.agents.{name}_agent.{name}_node',return_value=result))
                importlib.reload(module)
                result = module.graph.invoke(fixture)
                self.assertTrue(result['is_approved'])
                self.assertEqual(result['start_date'],'2026-12-01')
                self.assertEqual(result['days'],2)
                self.assertIn('opening_hours',result['completed_steps'])
                self.assertIn('Museum',result['planner_draft'])
                self.assertFalse(result['budget_breakdown']['is_complete'])
        finally:
            importlib.reload(module)


if __name__ == '__main__': unittest.main(verbosity=2)
