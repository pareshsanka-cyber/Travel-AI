import re
import math
from typing import Dict, Any, List, Optional, Set, Tuple

# Known aliases mapping canonical place names
KNOWN_PLACE_ALIASES: Dict[str, str] = {
    # Goa
    "fort aguada": "aguada fort",
    "aguada fort": "aguada fort",
    "aguada fortress": "aguada fort",
    "sinquerim fort": "sinquerim fort",
    "fort sinquerim": "sinquerim fort",
    "cabo de rama fort": "cabo de rama fort",
    "fort cabo de rama": "cabo de rama fort",
    "cabo de rama": "cabo de rama fort",
    "chapora fort": "chapora fort",
    "fort chapora": "chapora fort",
    "basilica of bom jesus": "basilica of bom jesus",
    "bom jesus basilica": "basilica of bom jesus",
    "basilica bom jesus": "basilica of bom jesus",
    "se cathedral": "se cathedral",
    "se cathedral church": "se cathedral",
    "cathedral of santa catarina": "se cathedral",
    "mangueshi temple": "mangueshi temple",
    "mangeshi temple": "mangueshi temple",
    "manguesh temple": "mangueshi temple",
    "mangesh temple": "mangueshi temple",
    "shri manguesh temple": "mangueshi temple",
    "shri mangesh temple": "mangueshi temple",
    "shri mangueshi temple": "mangueshi temple",
    "shri mangeshi temple": "mangueshi temple",
    "shree manguesh temple": "mangueshi temple",
    "shree mangesh temple": "mangueshi temple",
    "shri mahalasa temple": "shri mahalasa temple",
    "shri mahalasa narayani temple": "shri mahalasa temple",
    "mahalasa narayani temple": "shri mahalasa temple",
    "church of our lady of the immaculate conception": "immaculate conception church",
    "our lady of the immaculate conception church": "immaculate conception church",
    "immaculate conception church": "immaculate conception church",
    "panaji church": "immaculate conception church",
    # Jaipur
    "hawa mahal": "hawa mahal",
    "palace of breeze": "hawa mahal",
    "palace of winds": "hawa mahal",
    "palace of the breeze": "hawa mahal",
    "amber fort": "amber fort",
    "amer fort": "amber fort",
    "amber palace": "amber fort",
    "amer palace": "amber fort",
    "amer qil a": "amber fort",
    "city palace jaipur": "city palace jaipur",
    "jaipur city palace": "city palace jaipur",
    "jantar mantar jaipur": "jantar mantar",
    "nahargarh fort": "nahargarh fort",
    "fort nahargarh": "nahargarh fort",
    "jaigarh fort": "jaigarh fort",
    "fort jaigarh": "jaigarh fort",
    "jal mahal": "jal mahal",
    "water palace": "jal mahal",
    # Hyderabad
    "charminar": "charminar",
    "char minar": "charminar",
    "golconda fort": "golconda fort",
    "golkonda fort": "golconda fort",
    "fort golconda": "golconda fort",
    "qutb shahi tombs": "qutb shahi tombs",
    "qutub shahi tombs": "qutb shahi tombs",
    "chowmahalla palace": "chowmahalla palace",
    "salar jung museum": "salar jung museum",
    "salarjung museum": "salar jung museum",
    # Delhi & Agra
    "qutub minar": "qutub minar",
    "qutb minar": "qutub minar",
    "red fort delhi": "red fort delhi",
    "lal qila delhi": "red fort delhi",
    "taj mahal": "taj mahal",
    "agra fort": "agra fort",
    "fort agra": "agra fort",
    "red fort agra": "agra fort",
    "fatehpur sikri": "fatehpur sikri",
    # Amritsar
    "golden temple": "golden temple",
    "harmandir sahib": "golden temple",
    "sri harmandir sahib": "golden temple",
    "darbar sahib": "golden temple",
    "jallianwala bagh": "jallianwala bagh",
    "wagah border": "wagah border",
    # Mumbai
    "gateway of india": "gateway of india",
    "marine drive": "marine drive",
    "elephanta caves": "elephanta caves",
}

STOPWORDS = {
    "the", "a", "an", "of", "in", "at", "on", "and", "&", "to", "for", "by", "with", "from",
    "shri", "sri", "shree", "saint", "st"
}

CITY_SUFFIXES = [
    "goa", "north goa", "south goa", "jaipur", "rajasthan", "hyderabad", "telangana",
    "delhi", "new delhi", "mumbai", "maharashtra", "agra", "amritsar", "punjab",
    "kerala", "bengaluru", "bangalore", "india"
]

CATEGORY_TYPES = {
    "beach", "fort", "temple", "church", "cathedral", "palace", "museum", "mosque",
    "lake", "waterfall", "falls", "market", "bazaar", "garden", "park", "wildlife",
    "sanctuary", "monument", "ghat", "restaurant", "cafe", "resort", "hotel"
}

def distance_meters(coord1: Tuple[float, float], coord2: Tuple[float, float]) -> float:
    """Haversine distance in meters between two lat/lon pairs."""
    lat1, lon1 = coord1
    lat2, lon2 = coord2
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return 6371000 * c

def clean_place_name(name: str) -> str:
    """Removes parentheticals, city suffixes, and extra punctuation."""
    if not name:
        return ""
    # Strip parentheticals like (Goa), [attraction], (1612)
    cleaned = re.sub(r'[\(\[\{].*?[\)\]\}]', '', str(name))
    cleaned = re.sub(r'[^a-zA-Z0-9\s]', ' ', cleaned).lower()
    
    # Strip known trailing city/state names
    tokens = cleaned.split()
    for suffix in CITY_SUFFIXES:
        suffix_tokens = suffix.split()
        if len(tokens) > len(suffix_tokens) and tokens[-len(suffix_tokens):] == suffix_tokens:
            tokens = tokens[:-len(suffix_tokens)]
            break
            
    return ' '.join(tokens)

def clean_display_name(name: str) -> str:
    """
    Cleans a venue name for human display:
    - Strips parentheticals like (Goa), [North Goa]
    - Strips trailing commas and periods (e.g. 'Shri Nageshi Temple,')
    - Strips trailing city, district, state, country suffixes (e.g. ', Goa', ' Goa', ', Tambdisurla', ', Rajasthan', ', India')
    - Trims excess whitespace while preserving natural capitalization.
    """
    if not name:
        return ""
    s = str(name).strip()
    s = re.sub(r'[\(\[\{].*?[\)\]\}]', '', s).strip()
    s = re.sub(r'[,.\s]+$', '', s).strip()
    suffixes_to_remove = [
        ", goa", " goa", ", north goa", ", south goa",
        ", jaipur", " jaipur", ", rajasthan", " rajasthan",
        ", hyderabad", " hyderabad", ", telangana", " telangana",
        ", delhi", " delhi", ", new delhi", ", mumbai", " mumbai",
        ", tambdisurla", " tambdisurla", ", old goa", " old goa",
        ", agra", ", amritsar", ", india"
    ]
    changed = True
    while changed:
        changed = False
        s_lower = s.lower()
        for suffix in suffixes_to_remove:
            if s_lower.endswith(suffix):
                s = s[:len(s) - len(suffix)].strip()
                s = re.sub(r'[,.\s]+$', '', s).strip()
                changed = True
                break
    return s

def get_canonical_place_id(place: Any) -> str:
    """
    Returns a deterministic canonical identifier for a venue based on
    normalized name tokens, known aliases, and provider identifiers.
    """
    if isinstance(place, str):
        name = place
        place_dict = {"name": place}
    elif isinstance(place, dict):
        name = place.get("name") or place.get("title") or ""
        place_dict = place
    else:
        name = getattr(place, "name", "")
        place_dict = getattr(place, "__dict__", {})

    cleaned = clean_place_name(name)
    if not cleaned:
        return "unknown_place"

    # 1. Direct match in curated aliases
    if cleaned in KNOWN_PLACE_ALIASES:
        return KNOWN_PLACE_ALIASES[cleaned]

    # 2. Check tokens without stopwords
    raw_tokens = cleaned.split()
    tokens = [t for t in raw_tokens if t not in STOPWORDS]
    if not tokens:
        tokens = raw_tokens

    # Check alias match on joined tokens
    joined = ' '.join(tokens)
    if joined in KNOWN_PLACE_ALIASES:
        return KNOWN_PLACE_ALIASES[joined]

    # 3. Inversion normalization: e.g. "fort aguada" -> "aguada fort"
    # If the string starts with a category keyword (fort, temple, beach, etc.), move it to the end
    if len(tokens) >= 2 and tokens[0] in {"fort", "temple", "church", "palace", "beach", "hotel", "resort"}:
        inverted = ' '.join(tokens[1:] + [tokens[0]])
        if inverted in KNOWN_PLACE_ALIASES:
            return KNOWN_PLACE_ALIASES[inverted]
        return inverted

    return joined

def get_substantive_tokens(name: str) -> Set[str]:
    """Extracts substantive word tokens, omitting generic stopwords."""
    cleaned = clean_place_name(name)
    tokens = [t for t in cleaned.split() if t not in STOPWORDS and (len(t) > 2 or t.isdigit())]
    return set(tokens)

def is_same_physical_place(place1: Dict[str, Any], place2: Dict[str, Any]) -> bool:
    """
    Determines if two place objects represent the same physical attraction.
    Considers:
    - Provider place IDs (exact match)
    - Canonical name aliases and token inversion
    - Coordinate distance thresholding with category consistency
    - Safeguards against conflating distinct places (e.g., Aguada rocky Beach vs Aguada Fort)
    """
    if not place1 or not place2:
        return False

    name1 = place1.get("name") or place1.get("title") or ""
    name2 = place2.get("name") or place2.get("title") or ""

    # 1. Exact name match (case-insensitive)
    if name1.strip().lower() == name2.strip().lower():
        return True

    # 2. Provider ID match
    pid1 = place1.get("place_id") or place1.get("placeId") or place1.get("osm_id")
    pid2 = place2.get("place_id") or place2.get("placeId") or place2.get("osm_id")
    if pid1 and pid2 and str(pid1).strip() == str(pid2).strip():
        return True

    # 3. Canonical place ID match
    canon1 = get_canonical_place_id(place1)
    canon2 = get_canonical_place_id(place2)
    if canon1 and canon2 and canon1 == canon2:
        return True

    tokens1 = get_substantive_tokens(name1)
    tokens2 = get_substantive_tokens(name2)

    # Distinguish genuinely distinct venues: e.g. "Aguada rocky Beach" vs "Aguada Fort"
    # If one has "beach" and the other has "fort" (or church/temple), they are distinct!
    cats_in_1 = tokens1.intersection(CATEGORY_TYPES)
    cats_in_2 = tokens2.intersection(CATEGORY_TYPES)
    if cats_in_1 and cats_in_2 and not cats_in_1.intersection(cats_in_2):
        # Conflicting venue categories (e.g. beach vs fort) -> distinct places
        return False

    # 4. Token equality (e.g. {"aguada", "fort"} == {"fort", "aguada"})
    if tokens1 and tokens2 and tokens1 == tokens2:
        return True

    # 5. Coordinate proximity check
    lat1 = place1.get("lat") or place1.get("latitude")
    lon1 = place1.get("lon") or place1.get("longitude")
    lat2 = place2.get("lat") or place2.get("latitude")
    lon2 = place2.get("lon") or place2.get("longitude")

    if lat1 is not None and lon1 is not None and lat2 is not None and lon2 is not None:
        try:
            c1 = (float(lat1), float(lon1))
            c2 = (float(lat2), float(lon2))
            dist_m = distance_meters(c1, c2)
            
            # Within 150m and sharing at least one major substantive token
            shared_tokens = tokens1.intersection(tokens2)
            if dist_m < 150 and len(shared_tokens) >= 1:
                return True
            # Within 30m (same building/footprint) even if names are slightly phrased differently
            if dist_m < 30 and (cats_in_1 == cats_in_2 or not cats_in_1 or not cats_in_2):
                return True
        except (ValueError, TypeError):
            pass

    # 6. Word-boundary containment (e.g. {"calangute", "beach"} subset of {"calangute", "beach", "goa"})
    if tokens1 and tokens2:
        if (tokens1.issubset(tokens2) and len(tokens1) >= 2) or (tokens2.issubset(tokens1) and len(tokens2) >= 2):
            if cats_in_1 == cats_in_2 or not cats_in_1 or not cats_in_2:
                return True

    return False

def deduplicate_place_list(places: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Deduplicates a list of place dictionaries while:
    - Preserving original priority order
    - Merging missing metadata from duplicates into the retained record
    - Preserving must-visit flags and activity IDs
    """
    unique_places: List[Dict[str, Any]] = []

    for place in places:
        if not place or not isinstance(place, dict):
            continue

        duplicate_idx = -1
        for idx, existing in enumerate(unique_places):
            if is_same_physical_place(place, existing):
                duplicate_idx = idx
                break

        if duplicate_idx >= 0:
            existing = unique_places[duplicate_idx]
            # Merge missing details into retained record
            if existing.get("rating") is None and place.get("rating") is not None:
                existing["rating"] = place["rating"]
            if not existing.get("address") and place.get("address"):
                existing["address"] = place["address"]
            if not existing.get("image_url") and place.get("image_url"):
                existing["image_url"] = place["image_url"]
            if place.get("is_must_visit") or place.get("must_visit"):
                existing["is_must_visit"] = True
                existing["must_visit"] = True
        else:
            unique_places.append(place)

    return unique_places

def is_place_already_scheduled(candidate: Dict[str, Any], scheduled_stops: List[Dict[str, Any]]) -> bool:
    """Checks whether a candidate attraction is already present in a scheduled itinerary."""
    for stop in scheduled_stops:
        if not isinstance(stop, dict):
            continue
        # Only compare against attractions / places
        stop_type = stop.get("type") or stop.get("category")
        if stop_type in {"hotel", "airport", "breakfast"} and candidate.get("category") not in {"hotel", "airport"}:
            continue
        if is_same_physical_place(candidate, stop):
            return True
    return False
