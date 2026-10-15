from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from app.database.mongodb import db
from app.utils.auth_utils import require_user_id
from app.services import payment_service as payments, booking_service as bookings

router = APIRouter()


class BookingRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    trip_id: str = Field(min_length=1, max_length=100)
    kind: Literal['flight', 'hotel']
    source: Literal['discovered', 'sample']
    option_id: str = Field(min_length=1, max_length=200)
    rooms: int = Field(default=1, ge=1, le=10)
    expected_revision: int = Field(ge=1)


@router.post('/orders')
def create(payload: BookingRequest, user_id: str = Depends(require_user_id)):
    return payments.public(bookings.create_order(db, payload, user_id), db)


@router.get('/history')
def history(user_id: str = Depends(require_user_id)):
    return [payments.public(payments.settle(db, order), db) for order in
        db.payments.find({'user_id': user_id, 'product': {'$in': list(bookings.PRODUCTS)}}).sort('created_at', -1).limit(100)]


@router.get('/status')
def status(trip_id: str, user_id: str = Depends(require_user_id)):
    return bookings.trip_status(db, trip_id, user_id)


@router.get('/orders/{order_id}/confirmation')
def confirmation(order_id: str, user_id: str = Depends(require_user_id)):
    order = payments.get_order(db, order_id, user_id)
    if order['product'] not in bookings.PRODUCTS or order['status'] != 'succeeded':
        raise HTTPException(409, 'A demo booking confirmation is available after successful booking.')
    return dict(payments.public(order, db), confirmation_type='demo', money_charged=0, reservation_made=False)
