import re
from datetime import datetime
from app.ai.orchestrator.state import TravelState


def determine_status_from_hours(opening_hours, target_date: datetime, start_time=None, end_time=None) -> tuple[str, str]:
    if not opening_hours:
        return "UNKNOWN", "No verified operating hours available."
    day = target_date.strftime("%A").lower()
    if isinstance(opening_hours, list):
        hours = next((str(h) for h in opening_hours if day in str(h).lower()), "")
    elif isinstance(opening_hours, dict):
        hours = next((str(v) for k, v in opening_hours.items() if k.lower() == day), "")
    else:
        hours = str(opening_hours)
        if re.search(r'\b(?:Mo|Tu|We|Th|Fr|Sa|Su)\b', hours):
            return "UNKNOWN", "Weekday shorthand needs operating-hours verification."
        if any(d in hours.lower() for d in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')) and day not in hours.lower():
            hours = ""
    if not hours:
        return "UNKNOWN", "No operating hours verified for this weekday."
    if "closed" in hours.lower():
        return "CLOSED", f"Closed on {day.title()}."
    if "24" in hours and ('hour' in hours.lower() or '24/7' in hours):
        return "OPEN", "Open 24 hours."
    if not start_time or not end_time:
        return "UNKNOWN", "Hours listed; visit time still needs verification."
    # Parse 12-hour or 24-hour daily windows without treating missing data as open.
    ranges = re.findall(r'(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-??]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)', hours, re.I)
    def minutes(value):
        value = value.strip().upper().replace(' ', '')
        marker = value[-2:] if value.endswith(('AM','PM')) else None
        value = value[:-2] if marker else value
        parts = value.split(':')
        h, m = int(parts[0]), int(parts[1]) if len(parts)>1 else 0
        if marker: h = h % 12 + (12 if marker == 'PM' else 0)
        if h > 23 or m > 59: raise ValueError('Invalid hours')
        return h * 60 + m
    try:
        start, end = minutes(start_time), minutes(end_time)
        for lower, upper in ranges:
            if upper.upper().endswith(('AM','PM')) and not lower.upper().endswith(('AM','PM')):
                lower += upper.strip()[-2:]
            a, b = minutes(lower), minutes(upper)
            if b < a: b += 1440
            if a <= start and end <= b:
                return "OPEN", f"Visit fits listed hours: {hours}"
        if ranges: return "CLOSED", "Visit falls outside listed operating hours."
    except ValueError:
        pass
    return "UNKNOWN", "Operating hours could not be verified for this visit."


def opening_hours_node(state: TravelState) -> dict:
    routes = state.get('route_details') or {}
    for day in routes.get('day_by_day_route', []):
        for stop in day.get('stops', []):
            if stop.get('type') not in {'attraction', 'restaurant'}: continue
            status, reason = determine_status_from_hours(stop.get('opening_hours'), datetime.fromisoformat(day['date']), stop['start_time'], stop['end_time'])
            stop['status'], stop['status_reason'] = status, reason
            stop['opening_hours_status'] = {'OPEN': 'VERIFIED_OPEN', 'CLOSED': 'VERIFIED_CLOSED', 'UNKNOWN': 'UNVERIFIED'}[status]
    from app.ai.agents.budget_agent import budget_node
    return {'route_details': routes, 'budget_breakdown': budget_node(dict(state, route_details=routes))['budget_breakdown'], 'completed_steps': ['opening_hours']}
