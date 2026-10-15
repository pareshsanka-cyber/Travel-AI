"""Validate new planning dates; historical saved trips remain readable."""
from datetime import date
from dateutil.parser import parse


def validate_planning_dates(start_date=None, end_date=None):
    today = date.today()
    try:
        start = parse(str(start_date)).date() if start_date else None
        end = parse(str(end_date)).date() if end_date else None
    except (ValueError, TypeError, OverflowError):
        raise ValueError('Choose valid travel dates.')
    if (start and start < today) or (end and end < today):
        raise ValueError(f'Past travel dates are not allowed for a new itinerary. Choose {today.isoformat()} (today) or a future date.')
    if start and end and end < start:
        raise ValueError('The end date must be on or after the start date.')
