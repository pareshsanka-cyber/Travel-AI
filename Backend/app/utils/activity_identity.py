import re
from typing import Optional, Dict, Any, List, Tuple


def generate_persistent_activity_id(
    stop_type: Optional[str],
    name: Optional[str],
    place_id: Optional[str] = None,
    disambiguator: Optional[int] = None
) -> str:
    """
    Generates a deterministic, persistent activity ID that survives:
    - scheduling & reordering
    - activity insertion & deletion
    - itinerary regeneration & trip reopen / refresh
    Format: act_{type}_{slug} or act_{type}_{slug}_{placeId[:8]}
    """
    type_str = re.sub(r'[^a-z0-9]+', '_', (stop_type or "activity").strip().lower()).strip('_') or "activity"
    name_str = (name or "activity").strip()
    name_lower = name_str.lower()

    # Specialized normalization for recurring lifecycle stops
    if "checkout" in name_lower or "check-out" in name_lower:
        type_str = "hotel_checkout"
    elif type_str == "hotel":
        type_str = "hotel_stay"
    elif type_str == "airport":
        if "departure" in name_lower or "check-in" in name_lower or "boarding" in name_lower:
            type_str = "airport_dep"
        elif "arrival" in name_lower or "touchdown" in name_lower or "baggage" in name_lower:
            type_str = "airport_arr"

    # Clean name slug (max 32 chars)
    name_clean = re.sub(r'[^a-z0-9]+', '_', name_lower).strip('_')[:32]
    if not name_clean:
        name_clean = "stop"

    parts = ["act", type_str, name_clean]
    if place_id:
        pid_clean = re.sub(r'[^a-z0-9]+', '', str(place_id).strip().lower())[:8]
        if pid_clean:
            parts.append(pid_clean)

    base_id = "_".join(parts)
    if disambiguator and disambiguator > 1:
        return f"{base_id}_{disambiguator}"
    return base_id


def resolve_activity_status(
    activity: Dict[str, Any],
    day_number: int,
    activity_index: int,
    activity_log: Optional[Dict[str, Any]] = None
) -> Tuple[str, Optional[Dict[str, Any]]]:
    """
    Safely resolves the execution status of an activity without accidental status transfer.
    Priority order:
    1. Primary: activity_log[activity.id] (persistent ID)
    2. Secondary: activity_log[canonical_id] (canonical fallback)
    3. Legacy: activity_log[f"{day_number}_{activity_index}"]
       SAFETY CHECKS: Only matched if not tagged with a mismatched activity_id or activity_title.
    4. Legacy: activity_log[f"day_{day_number}_act_{activity_index + 1}"]
    """
    if not activity_log:
        return "pending", None

    act_id = activity.get("id")
    canonical_id = generate_persistent_activity_id(
        activity.get("type") or activity.get("category"),
        activity.get("name") or activity.get("title"),
        activity.get("place_id") or activity.get("placeId")
    )
    current_title = (activity.get("name") or activity.get("title") or "").strip().lower()

    # 1. Primary: check by persistent activity ID
    if act_id and act_id in activity_log:
        entry = activity_log[act_id]
        if entry and isinstance(entry, dict) and entry.get("status"):
            return entry.get("status", "pending"), entry

    # 2. Secondary: check by canonical generated ID
    if canonical_id and canonical_id in activity_log:
        entry = activity_log[canonical_id]
        if entry and isinstance(entry, dict) and entry.get("status"):
            return entry.get("status", "pending"), entry

    # 3. Fallback: check legacy key "{day}_{index}"
    legacy_key = f"{day_number}_{activity_index}"
    if legacy_key in activity_log:
        entry = activity_log[legacy_key]
        if entry and isinstance(entry, dict) and entry.get("status"):
            # SAFETY CHECK:
            # If the legacy record was tagged with an activity_id, it MUST match
            stored_act_id = entry.get("activity_id")
            if stored_act_id and stored_act_id not in (act_id, canonical_id):
                # Conflict! Belonged to another activity that used to be at this position
                return "pending", None

            stored_title = (entry.get("activity_title") or "").strip().lower()
            if stored_title and current_title and stored_title != current_title:
                # Conflict! Title mismatch
                return "pending", None

            return entry.get("status", "pending"), entry

    # 4. Fallback: check positional key "day_{day}_act_{index + 1}"
    pos_key = f"day_{day_number}_act_{activity_index + 1}"
    if pos_key in activity_log:
        entry = activity_log[pos_key]
        if entry and isinstance(entry, dict) and entry.get("status"):
            stored_act_id = entry.get("activity_id")
            if stored_act_id and stored_act_id not in (act_id, canonical_id):
                return "pending", None

            stored_title = (entry.get("activity_title") or "").strip().lower()
            if stored_title and current_title and stored_title != current_title:
                return "pending", None

            return entry.get("status", "pending"), entry

    return "pending", None


def migrate_legacy_activity_log(
    activity_log: Dict[str, Any],
    daily_routes: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Safely migrates legacy activity_log records (keyed by '{day}_{index}' or 'day_X_act_Y')
    into persistent activity IDs, tagging them with activity_id and activity_title.
    Existing persistent keys are preserved intact.
    """
    migrated: Dict[str, Any] = dict(activity_log)

    for day_idx, day_obj in enumerate(daily_routes):
        day_num = day_obj.get("day") or day_obj.get("day_number") or (day_idx + 1)
        stops = day_obj.get("stops") or day_obj.get("activities") or []

        for s_idx, stop in enumerate(stops):
            act_id = stop.get("id")
            if not act_id or act_id.startswith("day_"):
                act_id = generate_persistent_activity_id(
                    stop.get("type") or stop.get("category"),
                    stop.get("name") or stop.get("title"),
                    stop.get("place_id") or stop.get("placeId")
                )

            title = stop.get("name") or stop.get("title") or "Activity"
            legacy_key = f"{day_num}_{s_idx}"
            pos_key = f"day_{day_num}_act_{s_idx + 1}"

            # Check if there is an un-migrated record under legacy keys
            legacy_entry = None
            if legacy_key in activity_log:
                legacy_entry = activity_log[legacy_key]
            elif pos_key in activity_log:
                legacy_entry = activity_log[pos_key]

            if legacy_entry and isinstance(legacy_entry, dict):
                # Verify safety against conflicting tags
                stored_id = legacy_entry.get("activity_id")
                stored_title = (legacy_entry.get("activity_title") or "").strip().lower()
                if stored_id and stored_id != act_id:
                    continue
                if stored_title and stored_title != title.strip().lower():
                    continue

                tagged_entry = dict(legacy_entry)
                tagged_entry["activity_id"] = act_id
                tagged_entry["activity_title"] = title

                # Store under primary persistent ID
                if act_id not in migrated:
                    migrated[act_id] = tagged_entry

                # Dual-write / update legacy key with safety metadata
                migrated[legacy_key] = tagged_entry

    return migrated
