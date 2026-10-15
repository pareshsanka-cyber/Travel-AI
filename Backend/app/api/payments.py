from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from app.database.mongodb import db
from app.utils.auth_utils import require_user_id
from app.services import payment_service as payments

router = APIRouter()


class OrderRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    trip_id: str = Field(min_length=1, max_length=100)


class AttemptRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    method: Literal['upi', 'card', 'netbanking']
    outcome: Literal['success', 'failure', 'delayed', 'cancel']


@router.post('/orders')
def create(payload: OrderRequest, user_id: str = Depends(require_user_id)):
    return payments.public(payments.create_order(db, payload.trip_id, user_id), db)


@router.get('/history')
def history(user_id: str = Depends(require_user_id)):
    return [payments.public(payments.settle(db, order), db) for order in
        db.payments.find({'user_id': user_id}).sort('created_at', -1).limit(100)]


@router.get('/orders/{order_id}')
def get(order_id: str, user_id: str = Depends(require_user_id)):
    return payments.public(payments.get_order(db, order_id, user_id), db)


@router.post('/orders/{order_id}/simulate')
def simulate(order_id: str, payload: AttemptRequest, user_id: str = Depends(require_user_id)):
    return payments.public(payments.simulate(db, order_id, user_id, payload.method, payload.outcome), db)


@router.get('/orders/{order_id}/receipt')
def receipt(order_id: str, user_id: str = Depends(require_user_id)):
    order = payments.get_order(db, order_id, user_id)
    if order['status'] != 'succeeded':
        raise HTTPException(409, 'A demo receipt is available after successful confirmation.')
    return dict(payments.public(order, db), receipt_type='demo', money_charged=0)
