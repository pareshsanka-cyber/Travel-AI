import os
import sys
import time
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
load_dotenv()

# Ensure backend path is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.ai.agents.flight_agent import (
    fetch_real_flights_serpapi,
    get_airport_code,
    get_current_product_date,
    parse_and_validate_flight_date,
    PRODUCT_TIMEZONE,
    _FLIGHT_CACHE
)

def run_tests():
    print("=" * 80)
    print("TravelAI Real Flight Data & Timezone Policy (Asia/Kolkata) Audit Test Suite")
    print("=" * 80)

    kolkata_tz = PRODUCT_TIMEZONE
    assert kolkata_tz.key == "Asia/Kolkata", f"Expected Asia/Kolkata, got {kolkata_tz}"

    # Determine authoritative product date in Asia/Kolkata
    kolkata_now = datetime.now(kolkata_tz)
    current_product_date = kolkata_now.date()
    
    expected_default_date = (current_product_date + timedelta(days=7)).strftime("%Y-%m-%d")
    expected_default_display = (current_product_date + timedelta(days=7)).strftime("%d %b %Y")

    print(f"\n[ENVIRONMENT & TIMEZONE POLICY AUDIT]")
    print(f"  Authoritative Timezone: {kolkata_tz.key} ({kolkata_now.strftime('%z')})")
    print(f"  Current Time (Asia/Kolkata): {kolkata_now.isoformat()}")
    print(f"  Current Product Date: {current_product_date}")
    print(f"  Expected Missing-Date Policy (+7d): {expected_default_date} ({expected_default_display})")

    # 0. Test Explicit Timezone & Midnight Boundary Calculations
    print("\n[TEST 0] Explicit ZoneInfo('Asia/Kolkata') Midnight & Cross-Timezone Audit")

    # Case 0A: 1 second before midnight in Kolkata
    dt_pre_midnight = datetime(2026, 10, 11, 23, 59, 59, tzinfo=kolkata_tz)
    d_pre = get_current_product_date(reference_dt=dt_pre_midnight)
    iso_pre, is_past_pre, is_est_pre, disp_pre = parse_and_validate_flight_date(None, reference_dt=dt_pre_midnight)
    print(f"  Case 0A (23:59:59 IST): Product Date = {d_pre} | Default +7d = {iso_pre} ({disp_pre})")
    assert d_pre == date(2026, 10, 11), f"Expected 2026-10-11, got {d_pre}"
    assert iso_pre == "2026-10-18", f"Expected 2026-10-18, got {iso_pre}"
    assert is_est_pre is True, "Must be estimated"

    # Case 0B: 1 second after midnight in Kolkata (Day transition)
    dt_post_midnight = datetime(2026, 10, 12, 0, 0, 1, tzinfo=kolkata_tz)
    d_post = get_current_product_date(reference_dt=dt_post_midnight)
    iso_post, is_past_post, is_est_post, disp_post = parse_and_validate_flight_date(None, reference_dt=dt_post_midnight)
    print(f"  Case 0B (00:00:01 IST): Product Date = {d_post} | Default +7d = {iso_post} ({disp_post})")
    assert d_post == date(2026, 10, 12), f"Expected 2026-10-12, got {d_post}"
    assert iso_post == "2026-10-19", f"Expected 2026-10-19, got {iso_post}"
    assert is_est_post is True, "Must be estimated"

    # Case 0C: Cross-Timezone Decoupling (20:00:00 UTC = 01:30:00 IST next day)
    # An OS running in UTC would see 2026-10-11, but the product policy must see 2026-10-12 in Kolkata
    dt_utc_evening = datetime(2026, 10, 11, 20, 0, 0, tzinfo=timezone.utc)
    d_cross = get_current_product_date(reference_dt=dt_utc_evening)
    iso_cross, _, _, _ = parse_and_validate_flight_date(None, reference_dt=dt_utc_evening)
    print(f"  Case 0C (20:00:00 UTC -> 01:30:00 IST): Product Date = {d_cross} | Default +7d = {iso_cross}")
    assert d_cross == date(2026, 10, 12), f"Expected 2026-10-12 in Kolkata, got {d_cross}"
    assert iso_cross == "2026-10-19", f"Expected 2026-10-19, got {iso_cross}"

    # Case 0D: Past date transition right at midnight
    # At 00:00:05 IST on 12-Oct, an itinerary for 11-Oct becomes historical
    dt_just_past = datetime(2026, 10, 12, 0, 0, 5, tzinfo=kolkata_tz)
    _, is_past_trans, _, _ = parse_and_validate_flight_date("2026-10-11", reference_dt=dt_just_past)
    print(f"  Case 0D (Itinerary 2026-10-11 evaluated at 00:00:05 on 2026-10-12): is_past_date = {is_past_trans}")
    assert is_past_trans is True, "Date 2026-10-11 must be past when evaluated on 2026-10-12"
    print("  [OK] All midnight & timezone boundary assertions passed!")

    # 1. Test IATA Code Resolution
    print("\n[TEST 1] Airport IATA Code Resolution")
    test_airports = [
        ("Tokyo", "NRT"),
        ("Tokyo Narita", "NRT"),
        ("Tokyo Haneda", "HND"),
        ("Sydney", "SYD"),
        ("Melbourne", "MEL"),
        ("Hyderabad", "HYD"),
        ("Delhi", "DEL"),
        ("Goa", "GOI"),
        ("North Goa", "GOX"),
        ("Kochi", "COK"),
    ]
    for place, expected in test_airports:
        actual = get_airport_code(place)
        assert actual == expected, f"Expected {expected} for '{place}', got '{actual}'"
        print(f"  [OK] '{place}' -> '{actual}' (expected '{expected}')")

    # 2. Test Missing Departure Date (Dynamic Today + 7 Calendar Days)
    print("\n[TEST 2] Missing Departure Date -> Current Product Date + 7 Calendar Days")
    iso_calc, is_past_calc, is_est_calc, disp_calc = parse_and_validate_flight_date(None)
    print(f"  parse_and_validate_flight_date(None) returned:")
    print(f"    iso_date: {iso_calc}")
    print(f"    is_past_date: {is_past_calc}")
    print(f"    is_estimated_date: {is_est_calc}")
    print(f"    display_date: {disp_calc}")

    assert iso_calc == expected_default_date, f"Expected {expected_default_date}, got {iso_calc}"
    assert is_past_calc is False, "Default future date must not be classified as past"
    assert is_est_calc is True, "Default future date must have is_estimated_date=True"
    assert disp_calc == expected_default_display, f"Expected {expected_default_display}, got {disp_calc}"

    t0 = time.time()
    res_missing = fetch_real_flights_serpapi(
        destination="Goa",
        origin="Hyderabad",
        start_date=None,
        currency="INR",
        travelers_count=1
    )
    missing_dur = time.time() - t0
    meta_missing = res_missing.get("metadata", {})
    flights_missing = res_missing.get("flights", [])

    print(f"  fetch_real_flights_serpapi(start_date=None):")
    print(f"    Duration: {missing_dur:.2f}s | Flights found: {len(flights_missing)}")
    print(f"    metadata.departure_date: {meta_missing.get('departure_date')} (matches expected: {expected_default_date})")
    print(f"    metadata.is_estimated_date: {meta_missing.get('is_estimated_date')}")
    print(f"    metadata.is_past_date: {meta_missing.get('is_past_date')}")
    print(f"    metadata.timezone: {meta_missing.get('timezone')}")

    assert meta_missing.get("departure_date") == expected_default_date, f"Expected {expected_default_date}, got {meta_missing.get('departure_date')}"
    assert meta_missing.get("is_estimated_date") is True, "Expected is_estimated_date == True"
    assert meta_missing.get("is_past_date") is False, "Expected is_past_date == False"
    assert meta_missing.get("timezone") == "Asia/Kolkata", f"Expected Asia/Kolkata, got {meta_missing.get('timezone')}"
    assert len(flights_missing) > 0, "Missing date fallback must query SerpApi for valid +7 day date and return flights"

    # 3. Test Explicit Valid Future Date (Must NOT be replaced or marked estimated)
    valid_future_date = (current_product_date + timedelta(days=14)).strftime("%Y-%m-%d")
    valid_future_display = (current_product_date + timedelta(days=14)).strftime("%d %b %Y")
    print(f"\n[TEST 3] Explicit Valid Future Date ({valid_future_date}) -> Must NOT be replaced")
    iso_future, is_past_future, is_est_future, disp_future = parse_and_validate_flight_date(valid_future_date)
    assert iso_future == valid_future_date, f"Expected {valid_future_date}, got {iso_future}"
    assert is_past_future is False, "Future date must not be classified as past"
    assert is_est_future is False, "Explicitly provided date must have is_estimated_date=False"

    res_explicit = fetch_real_flights_serpapi(
        destination="Delhi",
        origin="Hyderabad",
        start_date=valid_future_date,
        currency="INR",
        travelers_count=1
    )
    meta_explicit = res_explicit.get("metadata", {})
    flights_explicit = res_explicit.get("flights", [])
    print(f"  fetch_real_flights_serpapi(start_date='{valid_future_date}'):")
    print(f"    metadata.departure_date: {meta_explicit.get('departure_date')}")
    print(f"    metadata.is_estimated_date: {meta_explicit.get('is_estimated_date')}")
    print(f"    metadata.is_past_date: {meta_explicit.get('is_past_date')}")
    print(f"    metadata.timezone: {meta_explicit.get('timezone')}")
    print(f"    Flights found: {len(flights_explicit)}")

    assert meta_explicit.get("departure_date") == valid_future_date, f"Expected {valid_future_date}, got {meta_explicit.get('departure_date')}"
    assert meta_explicit.get("is_estimated_date") is False, "Explicit date must have is_estimated_date == False"
    assert meta_explicit.get("is_past_date") is False, "Explicit future date must have is_past_date == False"
    assert len(flights_explicit) > 0, "Explicit future date must return real flights"

    # 4. Test Past-Date Saved Itinerary (Historical Record)
    past_date = (current_product_date - timedelta(days=4)).strftime("%Y-%m-%d")
    past_display = (current_product_date - timedelta(days=4)).strftime("%d %b %Y")
    print(f"\n[TEST 4] Past-Date Saved Itinerary ({past_date}) -> Historical Record")
    iso_past, is_past_past, is_est_past, disp_past = parse_and_validate_flight_date(past_date)
    assert iso_past == past_date, f"Expected {past_date}, got {iso_past}"
    assert is_past_past is True, "Past date must have is_past_date=True"
    assert is_est_past is False, "Explicit past date must have is_estimated_date=False"

    t0 = time.time()
    res_past = fetch_real_flights_serpapi(
        destination="Delhi",
        origin="Hyderabad",
        start_date=past_date,
        currency="INR",
        travelers_count=1
    )
    past_dur = time.time() - t0
    meta_past = res_past.get("metadata", {})
    flights_past = res_past.get("flights", [])

    print(f"  fetch_real_flights_serpapi(start_date='{past_date}'):")
    print(f"    Duration: {past_dur:.2f}s | Flights returned: {len(flights_past)}")
    print(f"    Status: {meta_past.get('data_status')}")
    print(f"    is_past_date: {meta_past.get('is_past_date')}")
    print(f"    is_estimated_date: {meta_past.get('is_estimated_date')}")
    print(f"    departure_date: {meta_past.get('departure_date')} (must be exact past date, NOT replaced)")

    assert meta_past.get("data_status") == "historical_record", "Expected data_status == 'historical_record'"
    assert meta_past.get("is_past_date") is True, "Expected is_past_date == True"
    assert meta_past.get("is_estimated_date") is False, "Expected is_estimated_date == False"
    assert meta_past.get("departure_date") == past_date, f"Expected {past_date}, got {meta_past.get('departure_date')}"
    assert len(flights_past) == 0, "Past dates must return empty list (no fake flights!)"

    # 5. Scenario A: HYD -> Tokyo (NRT) for valid future date
    print(f"\n[TEST 5] Scenario A: HYD -> Tokyo ({valid_future_date})")
    t0 = time.time()
    res_tokyo = fetch_real_flights_serpapi(
        destination="Tokyo",
        origin="Hyderabad",
        start_date=valid_future_date,
        currency="INR",
        travelers_count=1
    )
    tokyo_dur = time.time() - t0
    flights_tokyo = res_tokyo.get("flights", [])
    meta_tokyo = res_tokyo.get("metadata", {})

    print(f"  Duration: {tokyo_dur:.2f}s | Found: {len(flights_tokyo)} flights")
    print(f"  Metadata status: {meta_tokyo.get('data_status')} | Origin: {meta_tokyo.get('origin')} -> Dest: {meta_tokyo.get('destination')}")
    assert len(flights_tokyo) > 0, "Scenario A must return at least 1 genuine flight"
    assert meta_tokyo.get("destination") in ["NRT", "HND"], f"Expected NRT/HND, got {meta_tokyo.get('destination')}"

    first_tokyo = flights_tokyo[0]
    print(f"  Sample flight: {first_tokyo.get('airline_name')} {first_tokyo.get('flight_number')} | "
          f"{first_tokyo.get('departure_time')} - {first_tokyo.get('arrival_time')} | "
          f"INR {first_tokyo.get('price_per_person'):,.0f} | Stops: {first_tokyo.get('stops')} | "
          f"Aircraft: {first_tokyo.get('aircraft')}")
    assert first_tokyo.get("source") == "serpapi_google_flights"

    # 6. Scenario B: HYD -> Sydney (SYD) for valid future date
    print(f"\n[TEST 6] Scenario B: HYD -> Sydney ({valid_future_date})")
    t0 = time.time()
    res_syd = fetch_real_flights_serpapi(
        destination="Sydney",
        origin="Hyderabad",
        start_date=valid_future_date,
        currency="INR",
        travelers_count=1
    )
    syd_dur = time.time() - t0
    flights_syd = res_syd.get("flights", [])
    meta_syd = res_syd.get("metadata", {})

    print(f"  Duration: {syd_dur:.2f}s | Found: {len(flights_syd)} flights")
    print(f"  Metadata status: {meta_syd.get('data_status')} | Origin: {meta_syd.get('origin')} -> Dest: {meta_syd.get('destination')}")
    assert len(flights_syd) > 0, "Scenario B must return at least 1 genuine flight"
    assert meta_syd.get("destination") == "SYD", f"Expected SYD, got {meta_syd.get('destination')}"

    # 7. Scenario D: In-Memory Cache Verification
    print(f"\n[TEST 7] Scenario D: In-Memory Caching Verification (Tokyo re-query)")
    t0 = time.time()
    res_cached = fetch_real_flights_serpapi(
        destination="Tokyo",
        origin="Hyderabad",
        start_date=valid_future_date,
        currency="INR",
        travelers_count=1
    )
    cached_dur = time.time() - t0
    print(f"  Cached query duration: {cached_dur:.4f}s (vs initial {tokyo_dur:.2f}s)")
    assert cached_dur < 0.05, f"Cache read took too long: {cached_dur}s"
    assert len(res_cached.get("flights", [])) == len(flights_tokyo), "Cached result must match original"

    # 8. Scenario F: Extreme / Same Airport Route
    print(f"\n[TEST 8] Scenario F: Handling Same Airport Transit Route")
    res_none = fetch_real_flights_serpapi(
        destination="Hyderabad",
        origin="Hyderabad",
        start_date=valid_future_date
    )
    meta_none = res_none.get("metadata", {})
    print(f"  Fallback status: {meta_none.get('data_status')} | Message: {meta_none.get('message')}")
    assert len(res_none.get("flights", [])) == 0, "Same origin/destination must return empty flights list"
    assert meta_none.get("data_status") == "no_flights_found", f"Unexpected status: {meta_none.get('data_status')}"

    print("\n" + "=" * 80)
    print("ALL AUDIT TEST SUITES (INCLUDING TIMEZONE & MIDNIGHT BOUNDARIES) PASSED!")
    print("=" * 80)

if __name__ == "__main__":
    run_tests()
