"""Opt-in local HTTP check using a disposable account and a copy of the legacy trip.

Run with the backend virtualenv from Backend. Never modifies the source trip.
"""
import copy
import json
import logging
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from dotenv import load_dotenv
load_dotenv('.env')
from bson import ObjectId
from app.database.mongodb import db


def main():
    source_id = ObjectId('6abb8ee4dcdb88f7063bbac2')
    source = db.trips.find_one({'_id': source_id})
    if not source:
        raise RuntimeError('Legacy Sydney fixture no longer exists; no data changed.')
    assert not source.get('revision') and not source.get('selections')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    user_id = None
    token = ''
    references = []

    def request(path, body=None, expected=200):
        headers = {'Content-Type': 'application/json', 'Origin': 'http://localhost:3000'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        req = Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            response = urlopen(req, timeout=20)
        except HTTPError as error:
            response = error
        with response:
            data = json.load(response)
            assert response.status == expected, (path, response.status, data)
            assert response.headers.get('Access-Control-Allow-Origin') == 'http://localhost:3000'
            reference = response.headers.get('X-Request-ID')
            assert reference
            references.append(reference)
            return data

    with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as log:
        command = "import logging,uvicorn; logging.basicConfig(level=logging.INFO); uvicorn.run('app.main:app',host='127.0.0.1',port=" + str(port) + ")"
        server = subprocess.Popen([sys.executable, '-c', command], stdout=log, stderr=log,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        try:
            for _ in range(60):
                if server.poll() is not None:
                    raise RuntimeError('Temporary backend did not start')
                try:
                    request('/health/ready')
                    break
                except (OSError, ValueError):
                    time.sleep(0.5)
            else:
                raise RuntimeError('Temporary backend readiness timed out')
            registered = request('/api/auth/register', {'name': 'Disposable booking check',
                'email': f'booking-check-{secrets.token_hex(8)}@example.com', 'password': secrets.token_urlsafe(24)})
            user_id, token = registered['user']['id'], registered['token']
            trip = copy.deepcopy(source)
            trip.pop('_id'); trip.pop('id', None)
            trip['user_id'] = user_id
            trip['execution_state'] = {'is_active': True, 'activity_log': {'preserved': 'completed'}}
            trip_id = str(db.trips.insert_one(trip).inserted_id)
            before = db.trips.find_one({'_id': ObjectId(trip_id)})
            selected = request(f'/api/trips/{trip_id}/selections', {'hotel_id': 'hotels-0', 'expected_revision': 1})['trip']
            assert selected['revision'] == 2
            for field in ('route_details', 'execution_state', 'budget_breakdown'):
                assert selected.get(field) == before.get(field), field
            conflict = request(f'/api/trips/{trip_id}/selections', {'hotel_id': 'hotels-1', 'expected_revision': 2}, 409)
            assert 'Companion' in conflict['detail'] or 'active' in conflict['detail']
            order = request('/api/bookings/orders', {'trip_id': trip_id, 'kind': 'hotel', 'source': 'discovered',
                'option_id': 'hotels-0', 'rooms': 1, 'expected_revision': 2})
            request(f"/api/payments/orders/{order['id']}/simulate", {'method': 'upi', 'outcome': 'success'})
            time.sleep(3.2)
            paid = request(f"/api/payments/orders/{order['id']}")
            assert paid['status'] == 'succeeded'
            status = request('/api/bookings/status?trip_id=' + trip_id)
            assert status['current'][0]['id'] == paid['id'] and status['current'][0]['status'] == 'succeeded'
            request(f"/api/bookings/orders/{paid['id']}/confirmation")
            assert request('/api/trips/' + trip_id)['plus_access'] is True
            assert db.trips.find_one({'_id': source_id}) == source, 'Original Sydney trip changed'
            print('PASS: live legacy current-hotel checkout, active Companion, selection lock, simulated success, status, confirmation, Plus and CORS/request IDs.')
        finally:
            server.terminate()
            server.wait(timeout=15)
            if user_id:
                # Exact disposable owner only; no existing accounts or trips touched.
                for collection in ('payments', 'sessions', 'trips'):
                    db[collection].delete_many({'user_id': user_id})
                db.users.delete_one({'_id': ObjectId(user_id)})
            log.seek(0)
            output = log.read()
            assert all(reference in output for reference in references), 'Request IDs missing from local server logs'
            print(f'PASS: {len(references)} HTTP requests matched server logs; disposable test data removed.')


if __name__ == '__main__':
    main()
