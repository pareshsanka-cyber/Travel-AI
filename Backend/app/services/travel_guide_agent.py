"""
Dedicated, modular Travel Guide Agent for TravelAI.

Provides personalized travel recommendations, factual place discovery,
proximity/nearby searches around GPS or active stops, RAG-grounded destination advice,
and safe itinerary integration with revision locking.
"""

import re
import math
import difflib
import logging
from typing import Dict, Any, List, Optional, Tuple
from app.ai.llm import llm
from langchain_core.prompts import ChatPromptTemplate
from app.ai.agents.attraction_agent import (
    discover_via_serpapi,
    discover_via_overpass,
    resolve_destination_coordinates,
    enrich_place_nominatim,
    verify_and_enrich_place,
    calculate_fame_level,
)
from app.ai.agents.restaurant_agent import (
    discover_restaurants_serpapi,
    fetch_real_restaurants_overpass,
    AUTHENTIC_DESTINATION_RESTAURANTS,
)
from app.ai.agents.weather_agent import fetch_realtime_weather_openmeteo
from app.ai.rag.retriever import retrieve_travel_knowledge, LANDMARK_DESTINATIONS, resolve_destination_from_query
from app.services.road_routing import distance, coords, configuration
from app.schemas.travel_guide import PlaceRecommendation, SuggestedAction

logger = logging.getLogger("travelai.guide")

DESTINATION_ALIASES = {
    "hyderabad": "Hyderabad",
    "hyd": "Hyderabad",
    "hyderanad": "Hyderabad",
    "hyderbad": "Hyderabad",
    "secunderabad": "Hyderabad",
    "cyberabad": "Hyderabad",
    "bengaluru": "Bengaluru",
    "bangalore": "Bengaluru",
    "blr": "Bengaluru",
    "delhi": "Delhi",
    "new delhi": "Delhi",
    "del": "Delhi",
    "dilli": "Delhi",
    "mumbai": "Mumbai",
    "bombay": "Mumbai",
    "bom": "Mumbai",
    "chennai": "Chennai",
    "madras": "Chennai",
    "maa": "Chennai",
    "kolkata": "Kolkata",
    "calcutta": "Kolkata",
    "ccu": "Kolkata",
    "goa": "Goa",
    "panaji": "Goa",
    "jaipur": "Jaipur",
    "pink city": "Jaipur",
    "kerala": "Kerala",
    "kochi": "Kerala",
    "cochin": "Kerala",
    "munnar": "Kerala",
    "alleppey": "Kerala",
    "alappuzha": "Kerala",
    "agra": "Agra",
    "amritsar": "Amritsar",
    "varanasi": "Varanasi",
    "banaras": "Varanasi",
    "kashi": "Varanasi",
    "udaipur": "Udaipur",
    "ladakh": "Ladakh",
    "leh": "Ladakh",
    "manali": "Manali",
    "shimla": "Shimla",
    "ooty": "Ooty",
    "darjeeling": "Darjeeling",
    "pune": "Pune",
    "ahmedabad": "Ahmedabad",
}

def normalize_destination_name(raw: Optional[str]) -> Optional[str]:
    """Resolve destination from aliases, abbreviations, and common typos (e.g. hyderanad -> Hyderabad)."""
    if not raw:
        return None
    cleaned = str(raw).lower().strip().split(',')[0].strip()
    if not cleaned:
        return None
    if cleaned in DESTINATION_ALIASES:
        return DESTINATION_ALIASES[cleaned]
    matches = difflib.get_close_matches(cleaned, list(DESTINATION_ALIASES.keys()), n=1, cutoff=0.7)
    if matches:
        return DESTINATION_ALIASES[matches[0]]
    return raw.strip().title()

AUTHENTIC_DESTINATION_ATTRACTIONS = {
    "hyderabad": [
        {
            "name": "Charminar",
            "category": "UNESCO Monument & Landmark",
            "description": "Iconic 16th-century mosque with four grand minarets, situated in the heart of the historic Old City.",
            "why_visit": "The quintessential landmark of Hyderabad, flanked by the bustling Laad Bazaar.",
            "interests": ["history", "heritage", "architecture", "culture"],
            "lat": 17.3616,
            "lon": 78.4747,
            "image_url": "https://images.unsplash.com/photo-1605649487212-47bdab064df8?auto=format&fit=crop&w=800&q=80",
            "rating": 4.6,
            "review_count": 142000,
            "address": "Charminar Rd, Char Kaman, Ghansi Bazaar, Hyderabad",
            "source": "curated_verified"
        },
        {
            "name": "Golconda Fort",
            "category": "Historic Hilltop Fortress",
            "description": "Massive medieval fortress complex famed for ingenious acoustic architecture, royal palaces, and diamond vaults.",
            "why_visit": "Explore grand royal ruins and witness panoramic sunset views over the city.",
            "interests": ["history", "heritage", "architecture"],
            "lat": 17.3833,
            "lon": 78.4011,
            "image_url": "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80",
            "rating": 4.6,
            "review_count": 96000,
            "address": "Ibrahim Bagh, Hyderabad, Telangana",
            "source": "curated_verified"
        },
        {
            "name": "Salar Jung Museum",
            "category": "Art & Heritage Museum",
            "description": "One of India's three national museums housing one man's priceless global art collection, including the Veiled Rebecca.",
            "why_visit": "Houses 40,000+ rare artifacts, antique clocks, and royal European paintings.",
            "interests": ["museums", "history", "culture", "art"],
            "lat": 17.3713,
            "lon": 78.4804,
            "image_url": "https://images.unsplash.com/photo-1566127444979-b3d2b654e3d7?auto=format&fit=crop&w=800&q=80",
            "rating": 4.5,
            "review_count": 68000,
            "address": "Salarganj, Darulshifa, Hyderabad",
            "source": "curated_verified"
        },
        {
            "name": "Chowmahalla Palace",
            "category": "Royal Nizam Palace",
            "description": "Magnificent seat of the Asaf Jahi dynasty featuring opulent durbar halls, crystal chandeliers, and vintage car collection.",
            "why_visit": "Experience royal Nizami opulence and beautifully restored Persian gardens.",
            "interests": ["history", "heritage", "architecture", "culture"],
            "lat": 17.3578,
            "lon": 78.4717,
            "image_url": "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80",
            "rating": 4.6,
            "review_count": 52000,
            "address": "Motigallu, Khilwat, Hyderabad",
            "source": "curated_verified"
        },
        {
            "name": "Hussain Sagar Lake & Buddha Statue",
            "category": "Scenic Lake & Promenade",
            "description": "Heart-shaped historic lake featuring an 18-meter monolithic white granite statue of Lord Buddha standing on Gibraltar Rock.",
            "why_visit": "Scenic boat rides, sunset views along Tank Bund, and waterfront parks.",
            "interests": ["nature", "scenic", "family", "culture"],
            "lat": 17.4239,
            "lon": 78.4738,
            "image_url": "https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=800&q=80",
            "rating": 4.4,
            "review_count": 86000,
            "address": "Tank Bund Road, Hyderabad",
            "source": "curated_verified"
        },
        {
            "name": "Qutb Shahi Tombs",
            "category": "Royal Heritage Tombs",
            "description": "Grand domed funerary monuments of the founding rulers of Hyderabad surrounded by landscaped historic gardens.",
            "why_visit": "Unique blend of Persian, Pashtun, and Hindu architectural styles.",
            "interests": ["history", "heritage", "architecture"],
            "lat": 17.3941,
            "lon": 78.3963,
            "rating": 4.5,
            "review_count": 31000,
            "address": "Ibrahim Bagh, Hyderabad",
            "source": "curated_verified"
        },
        {
            "name": "Birla Mandir",
            "category": "Spiritual Temple & Viewpoint",
            "description": "Exquisite temple built entirely of 2,000 tons of white Rajasthani marble atop the 280-foot Naubat Pahad hill.",
            "why_visit": "Panoramic views of Hyderabad and tranquil spiritual ambience.",
            "interests": ["temples", "architecture", "scenic"],
            "lat": 17.4062,
            "lon": 78.4691,
            "rating": 4.7,
            "review_count": 65000,
            "address": "Hill Fort Rd, Hyderabad",
            "source": "curated_verified"
        }
    ],
    "goa": [
        {
            "name": "Palolem Beach",
            "category": "Beach & Scenic Coast",
            "description": "Crescent-shaped white sand beach in South Goa fringed by coconut palms and calm swimming waters.",
            "why_visit": "One of Goa's most scenic, peaceful beaches with calm waters and vibrant beach shacks.",
            "interests": ["beach", "nature", "peaceful", "swimming"],
            "lat": 15.0100,
            "lon": 74.0232,
            "image_url": "https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=800&q=80",
            "rating": 4.7,
            "review_count": 48000,
            "address": "Canacona, South Goa",
            "source": "curated_verified"
        },
        {
            "name": "Anjuna Beach",
            "category": "Beach & Nightlife",
            "description": "Famous rocky beach renowned for dramatic sunsets, beachside cafes, watersports, and Wednesday flea market.",
            "why_visit": "Vibrant coastal atmosphere with iconic beach shacks like Curlies and stunning sea views.",
            "interests": ["beach", "nightlife", "shopping", "food"],
            "lat": 15.5819,
            "lon": 73.7429,
            "image_url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
            "rating": 4.5,
            "review_count": 52000,
            "address": "Anjuna, North Goa",
            "source": "curated_verified"
        },
        {
            "name": "Aguada Fort",
            "category": "17th-Century Portuguese Fort",
            "description": "Well-preserved 1612 Portuguese fortress and historic 4-storey lighthouse standing at the mouth of Mandovi River.",
            "why_visit": "Spectacular panoramic views of the Arabian Sea and historic coastal defense ramparts.",
            "interests": ["history", "heritage", "architecture", "viewpoint"],
            "lat": 15.4920,
            "lon": 73.7737,
            "image_url": "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=80",
            "rating": 4.6,
            "review_count": 85000,
            "address": "Sinquerim, Candolim, North Goa",
            "source": "curated_verified"
        },
        {
            "name": "Basilica of Bom Jesus",
            "category": "UNESCO World Heritage Church",
            "description": "16th-century baroque basilica housing the sacred mortal remains of Saint Francis Xavier.",
            "why_visit": "Masterpiece of Portuguese baroque architecture and premier pilgrimage site in Old Goa.",
            "interests": ["temples", "history", "heritage", "architecture", "culture"],
            "lat": 15.5009,
            "lon": 73.9116,
            "image_url": "https://images.unsplash.com/photo-1548013146-72479768bada?auto=format&fit=crop&w=800&q=80",
            "rating": 4.7,
            "review_count": 64000,
            "address": "Old Goa Road, Bainguinim, Goa",
            "source": "curated_verified"
        },
        {
            "name": "Mangueshi Temple",
            "category": "Historic Hindu Temple",
            "description": "400-year-old temple dedicated to Lord Shiva featuring unique Goan Hindu architecture and a seven-storey deepstambha.",
            "why_visit": "The most prominent Hindu temple in Goa with serene courtyard and historic water tank.",
            "interests": ["temples", "culture", "heritage", "peaceful"],
            "lat": 15.4344,
            "lon": 73.9680,
            "image_url": "https://images.unsplash.com/photo-1566127444979-b3d2b654e3d7?auto=format&fit=crop&w=800&q=80",
            "rating": 4.6,
            "review_count": 31000,
            "address": "Mangeshi, Priol, Ponda, Goa",
            "source": "curated_verified"
        },
        {
            "name": "Dudhsagar Waterfalls",
            "category": "Tiered Waterfall & Nature Reserve",
            "description": "Four-tiered waterfall cascading 310 meters through lush Western Ghats forest in Bhagwan Mahavir Sanctuary.",
            "why_visit": "A breathtaking natural spectacle accessible via exciting jungle jeep safari and trekking.",
            "interests": ["nature", "adventure", "waterfall", "wildlife"],
            "lat": 15.3144,
            "lon": 74.3144,
            "image_url": "https://images.unsplash.com/photo-1511556532299-8f662fc26c06?auto=format&fit=crop&w=800&q=80",
            "rating": 4.7,
            "review_count": 42000,
            "address": "Sonaulim, Goa",
            "source": "curated_verified"
        }
    ],
    "jaipur": [
        {
            "name": "Amber Fort",
            "category": "UNESCO Royal Hilltop Fortress",
            "description": "16th-century red sandstone and marble fortress overlooking Maota Lake with the dazzling Sheesh Mahal mirror palace.",
            "why_visit": "Grand courtyards, ornamental gardens, and sweeping panoramic views of the Aravalli Hills.",
            "interests": ["history", "heritage", "architecture", "culture"],
            "lat": 26.9855,
            "lon": 75.8513,
            "image_url": "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?auto=format&fit=crop&w=800&q=80",
            "rating": 4.7,
            "review_count": 125000,
            "address": "Devisinghpura, Amer, Jaipur, Rajasthan",
            "source": "curated_verified"
        },
        {
            "name": "Hawa Mahal",
            "category": "Palace of Winds & Royal Monument",
            "description": "Iconic 1799 five-storey pink sandstone facade featuring 953 honeycomb casements built for royal ladies to view city streets.",
            "why_visit": "World-famous architectural masterpiece symbolizing the Pink City with breathtaking street facade.",
            "interests": ["history", "heritage", "architecture", "photography"],
            "lat": 26.9239,
            "lon": 75.8267,
            "image_url": "https://images.unsplash.com/photo-1609137144822-0a1532454685?auto=format&fit=crop&w=800&q=80",
            "rating": 4.6,
            "review_count": 98000,
            "address": "Hawa Mahal Rd, Badi Choupad, J.D.A. Market, Jaipur",
            "source": "curated_verified"
        },
        {
            "name": "City Palace Jaipur",
            "category": "Royal Palace & Museum Complex",
            "description": "Sprawling royal residence blending Rajput and Mughal design, housing Mubarak Mahal, Chandra Mahal, and heritage courtyards.",
            "why_visit": "Explore the royal living quarters, antique armory, and the famous Peacock Gate.",
            "interests": ["history", "heritage", "architecture", "museums"],
            "lat": 26.9258,
            "lon": 75.8236,
            "image_url": "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80",
            "rating": 4.5,
            "review_count": 76000,
            "address": "Gangori Bazaar, J.D.A. Market, Pink City, Jaipur",
            "source": "curated_verified"
        },
        {
            "name": "Jantar Mantar Jaipur",
            "category": "UNESCO Astronomical Observatory",
            "description": "Collection of nineteen architectural astronomical instruments built by Rajput King Sawai Jai Singh II.",
            "why_visit": "Features the world's largest stone sundial and brilliant 18th-century scientific geometry.",
            "interests": ["history", "architecture", "heritage", "science"],
            "lat": 26.9248,
            "lon": 75.8246,
            "image_url": "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80",
            "rating": 4.5,
            "review_count": 62000,
            "address": "Gangori Bazaar, J.D.A. Market, Pink City, Jaipur",
            "source": "curated_verified"
        },
        {
            "name": "Nahargarh Fort",
            "category": "Hilltop Fortress & Sunset Viewpoint",
            "description": "Historic fort perched on the edge of the Aravalli Hills offering dramatic panoramic vistas over Jaipur city.",
            "why_visit": "The ultimate sunset viewpoint in Jaipur featuring Madhavendra Bhawan royal suites.",
            "interests": ["nature", "viewpoint", "history", "heritage"],
            "lat": 26.9378,
            "lon": 75.8156,
            "image_url": "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80",
            "rating": 4.6,
            "review_count": 58000,
            "address": "Krishna Nagar, Brahampuri, Jaipur",
            "source": "curated_verified"
        }
    ],
    "delhi": [
        {
            "name": "Red Fort",
            "category": "UNESCO Mughal Citadel",
            "description": "Massive 17th-century red sandstone fortress built by Emperor Shah Jahan as the seat of the Mughal Empire.",
            "why_visit": "Historical epicenter of India with Diwan-i-Aam, Lahori Gate, and independence celebrations.",
            "interests": ["history", "heritage", "architecture", "culture"],
            "lat": 28.6562,
            "lon": 77.2410,
            "image_url": "https://images.unsplash.com/photo-1584132967334-10e028bd69f7?auto=format&fit=crop&w=800&q=80",
            "rating": 4.5,
            "review_count": 145000,
            "address": "Netaji Subhash Marg, Lal Qila, Chandni Chowk, New Delhi",
            "source": "curated_verified"
        },
        {
            "name": "Qutub Minar",
            "category": "UNESCO Victory Tower",
            "description": "73-meter-tall red sandstone minaret built in 1192 surrounded by ancient ruins and the rust-free Iron Pillar.",
            "why_visit": "World's tallest brick minaret with magnificent Indo-Islamic carvings and calligraphy.",
            "interests": ["history", "heritage", "architecture"],
            "lat": 28.5245,
            "lon": 77.1855,
            "image_url": "https://images.unsplash.com/photo-1584132967334-10e028bd69f7?auto=format&fit=crop&w=800&q=80",
            "rating": 4.6,
            "review_count": 110000,
            "address": "Seth Sarai, Mehrauli, New Delhi",
            "source": "curated_verified"
        }
    ],
    "agra": [
        {
            "name": "Taj Mahal",
            "category": "UNESCO World Heritage & 7 Wonders",
            "description": "Immense white marble mausoleum built between 1631 and 1648 by Shah Jahan in memory of his beloved wife Mumtaz Mahal.",
            "why_visit": "The pinnacle of Mughal architecture and the world's most celebrated testament of love.",
            "interests": ["history", "heritage", "architecture", "photography"],
            "lat": 27.1751,
            "lon": 78.0421,
            "image_url": "https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&w=800&q=80",
            "rating": 4.8,
            "review_count": 210000,
            "address": "Dharmapuri, Forest Colony, Tajganj, Agra, Uttar Pradesh",
            "source": "curated_verified"
        },
        {
            "name": "Agra Fort",
            "category": "UNESCO Mughal Imperial Citadel",
            "description": "Massive 16th-century red sandstone fortress housing royal marble palaces and courtyards overlooking the Taj Mahal.",
            "why_visit": "Explore Jahangir Palace, Khas Mahal, and Shah Jahan's historic prison tower.",
            "interests": ["history", "heritage", "architecture"],
            "lat": 27.1795,
            "lon": 78.0211,
            "image_url": "https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&w=800&q=80",
            "rating": 4.6,
            "review_count": 92000,
            "address": "Agra Fort, Rakabganj, Agra, Uttar Pradesh",
            "source": "curated_verified"
        }
    ]

}


# Supported Interest Categories with keyword patterns
INTEREST_KEYWORD_MAP = {
    "history": ["history", "historic", "heritage", "monument", "fort", "palace", "ruins", "castle", "ancient", "dynasty"],
    "heritage": ["heritage", "historic", "history", "monument", "fort", "palace", "ruins", "castle", "ancient", "dynasty"],
    "architecture": ["architecture", "architectural", "structure", "haveli", "facade", "design", "monumental"],
    "nature": ["nature", "scenic", "viewpoint", "view", "waterfall", "valley", "hills", "greenery", "wildlife", "forest", "reserve", "lake", "river", "park"],
    "beach": ["beach", "coast", "coastal", "cove", "bay", "sea", "shore", "sunset point"],
    "adventure": ["adventure", "trek", "trekking", "hike", "hiking", "outdoor", "camping", "rafting", "watersports", "safari"],
    "food": ["food", "dining", "restaurant", "cafe", "café", "coffee", "bistro", "street food", "culinary", "delicacy", "breakfast", "lunch", "dinner", "seafood", "bakery"],
    "culture": ["culture", "cultural", "tradition", "traditional", "art", "folk", "craft", "dance", "heritage walk"],
    "temples": ["temple", "church", "cathedral", "mosque", "shrine", "monastery", "spiritual", "worship", "ashram"],
    "museums": ["museum", "gallery", "exhibit", "archive"],
    "shopping": ["shopping", "bazaar", "market", "souvenir", "handicrafts", "mall"],
    "nightlife": ["nightlife", "pub", "bar", "club", "lounge", "brewery"],
    "family": ["family", "kids", "kid-friendly", "children", "park", "amusement"],
    "peaceful": ["peaceful", "quiet", "relaxing", "calm", "serene", "offbeat", "less crowded", "hidden gem"],
    "budget": ["budget", "cheap", "free", "affordable", "low cost"],
}

GUIDE_SYNTHESIS_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are TravelAI's expert, friendly, and reliable Travel Guide Agent. "
        "Your mission is to provide accurate, personalized, and practical travel guidance for the requested destination ({destination}).\n\n"
        "RULES:\n"
        "- Focus strictly on {destination}. Never divert to or mention unrelated cities (such as Goa) unless explicitly asked by the traveler.\n"
        "- Be concise, warm, and highly informative (2 to 4 sentences).\n"
        "- Explain WHY the recommended places match the traveler's interests or query.\n"
        "- Never fabricate opening status, coordinates, reviews, or prices.\n"
        "- If specific information is unverified (such as opening hours or exact walking time), acknowledge it clearly.\n"
        "- Suggest 1-2 practical next steps or follow-ups for the traveler.\n\n"
        "Grounding Context:\n{context}\n\n"
        "User Preferences: {preferences}"
    ),
    ("human", "{user_message}")
])


def extract_interest_tags(text: str, context: Optional[Dict[str, Any]] = None) -> List[str]:
    """Extract recognized interest categories from query text and travel context."""
    text_lower = text.lower()
    matched_interests = set()

    for category, keywords in INTEREST_KEYWORD_MAP.items():
        if any(kw in text_lower for kw in keywords):
            matched_interests.add(category)

    if context:
        ctx_interests = context.get("interests") or context.get("preferences") or []
        if isinstance(ctx_interests, list):
            for item in ctx_interests:
                item_lower = str(item).lower()
                for category, keywords in INTEREST_KEYWORD_MAP.items():
                    if any(kw in item_lower for kw in keywords):
                        matched_interests.add(category)

        style = str(context.get("travel_style") or "").lower()
        if "luxury" in style:
            matched_interests.add("culture")
        elif "budget" in style:
            matched_interests.add("budget")

    return list(matched_interests)


def classify_guide_query(
    user_message: str,
    qa_category: Optional[str] = None,
    current_lat: Optional[float] = None,
    current_lon: Optional[float] = None
) -> str:
    """Classify the user's travel question into an actionable query type."""
    text = user_message.lower().strip()

    # 1. Add to itinerary request
    if re.search(r'\b(add|put|insert|schedule)\b.*\b(day\s*\d+|itinerary|plan)\b', text):
        return "ADD_RECOMMENDATION_TO_TRIP"

    # 2. Weather queries
    if qa_category == "WEATHER" or any(w in text for w in ("weather", "temperature", "forecast", "climate", "monsoon", "rain", "rainy", "hot", "cold")):
        return "WEATHER"

    # 3. Follow-up referencing previously recommended place
    if re.search(r'\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|the last one|that place|more details|tell me more|how to reach|timing|timings)\b', text):
        return "FOLLOW_UP"

    # 4. Nearby places / radius query
    if any(w in text for w in ("nearby", "near me", "close to me", "closest", "around here", "walking distance", "near our stop", "near the hotel", "within")):
        return "NEARBY_PLACES"

    # 5. Food, cafés, restaurants, markets
    if qa_category == "RESTAURANT" or any(w in text for w in ("food", "eat", "dining", "restaurant", "restaurants", "cafe", "cafes", "café", "coffee", "bistro", "street food", "market", "bazaar", "bakery", "breakfast", "lunch", "dinner", "seafood")):
        return "LOCAL_EXPERIENCES"

    # 6. Destination comparison / Day trips
    if any(w in text for w in (" vs ", " versus ", "compare", "or should i visit", "better than", "day trip", "excursion", "getaway from")):
        return "DESTINATION_COMPARISON"

    # 7. Practical advice / Tips
    if any(w in text for w in ("how to get", "transport", "cab", "taxi", "bus", "metro", "safe", "safety", "dress code", "cost", "tips", "advice", "entry fee", "rules", "permit")):
        return "PRACTICAL_TIPS"

    # 8. Interest-specific recommendations
    interests = extract_interest_tags(text)
    if interests:
        return "INTEREST_RECOMMENDATIONS"

    # 9. Default: Famous attractions
    return "FAMOUS_ATTRACTIONS"


def normalize_place_name(name: str) -> str:
    """Clean and normalize a venue name for safe deduplication."""
    cleaned = re.sub(r'[\(\[\{].*?[\)\]\}]', '', name)
    cleaned = re.sub(r'[^a-zA-Z0-9\s]', ' ', cleaned)
    return ' '.join(cleaned.lower().split())


def deduplicate_places(places: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicate records by provider identifiers, coordinate proximity, and name matching."""
    unique_places: List[Dict[str, Any]] = []
    seen_names = set()

    for p in places:
        name = p.get("name") or ""
        norm_name = normalize_place_name(name)
        if not norm_name or len(norm_name) < 3:
            continue

        p_lat, p_lon = p.get("lat") or p.get("latitude"), p.get("lon") or p.get("longitude")

        # Check coordinate collision within 60 meters
        duplicate = False
        for existing in unique_places:
            e_name = normalize_place_name(existing.get("name") or "")
            if norm_name == e_name or norm_name in e_name or e_name in norm_name:
                duplicate = True
                # Merge details if existing was missing them
                if existing.get("rating") is None and p.get("rating") is not None:
                    existing["rating"] = p["rating"]
                if not existing.get("address") and p.get("address"):
                    existing["address"] = p["address"]
                if not existing.get("image_url") and p.get("image_url"):
                    existing["image_url"] = p["image_url"]
                break

            e_lat, e_lon = existing.get("lat") or existing.get("latitude"), existing.get("lon") or existing.get("longitude")
            if p_lat is not None and p_lon is not None and e_lat is not None and e_lon is not None:
                dist_km = distance((float(p_lat), float(p_lon)), (float(e_lat), float(e_lon)))
                if dist_km < 0.06:  # within 60 meters
                    duplicate = True
                    break

        if not duplicate:
            seen_names.add(norm_name)
            unique_places.append(p)

    return unique_places


def calculate_place_relevance_score(
    place: Dict[str, Any],
    user_interests: List[str],
    reference_coords: Optional[Tuple[float, float]] = None,
    must_visit_names: Optional[List[str]] = None
) -> Tuple[float, str]:
    """
    Transparent relevance scoring formula:
    Score = W_interest * S_interest + W_fame * S_fame + W_prox * S_prox + W_rating * S_rating
    """
    score = 20.0  # Base visibility score
    reasons = []

    name = place.get("name", "").lower()
    cat = str(place.get("category", "")).lower()
    desc = str(place.get("description", "")).lower()
    full_text = f"{name} {cat} {desc} {' '.join(place.get('interests', []))}"

    # 1. Must-visit check
    if must_visit_names:
        for mv in must_visit_names:
            mv_clean = mv.lower().strip()
            if mv_clean and (mv_clean in name or name in mv_clean):
                score += 500.0
                reasons.append(f"Requested must-visit place ({mv})")
                break

    # 2. User interest match
    matched_tags = []
    if user_interests:
        for rank_idx, interest in enumerate(user_interests):
            keywords = INTEREST_KEYWORD_MAP.get(interest.lower(), [interest.lower()])
            if any(kw in full_text for kw in keywords):
                weight = max(20.0, 80.0 - (rank_idx * 15.0))
                score += weight
                matched_tags.append(interest.title())

    if matched_tags:
        # Deduplicate while preserving order
        seen_tags = set()
        deduped_tags = [t for t in matched_tags if not (t in seen_tags or seen_tags.add(t))]
        reasons.append(f"Matches your interest in {', '.join(deduped_tags)}")

    # 3. Fame level & provider review count
    rating = place.get("rating")
    reviews = place.get("review_count") or place.get("reviews")
    try:
        if rating is not None:
            r_val = float(rating)
            if r_val >= 4.5:
                score += 15.0
            elif r_val >= 4.0:
                score += 8.0
        if reviews is not None:
            rev_val = int(reviews)
            if rev_val >= 5000:
                score += 25.0
                reasons.append(f"Top-rated landmark with {rev_val:,}+ verified reviews")
            elif rev_val >= 500:
                score += 15.0
                reasons.append(f"Popular destination ({rev_val:,} reviews)")
    except (ValueError, TypeError):
        pass

    # 4. Proximity to reference coordinates (for nearby queries)
    if reference_coords:
        p_lat = place.get("lat") or place.get("latitude")
        p_lon = place.get("lon") or place.get("longitude")
        if p_lat is not None and p_lon is not None:
            try:
                dist_km = distance(reference_coords, (float(p_lat), float(p_lon)))
                # Proximity score decay: within 1km +40, within 3km +25, within 5km +10
                if dist_km <= 1.0:
                    score += 40.0
                    reasons.append(f"Just {int(dist_km * 1000)}m from your location")
                elif dist_km <= 3.0:
                    score += 25.0
                    reasons.append(f"Approx {dist_km:.1f} km away")
                elif dist_km <= 5.0:
                    score += 10.0
                    reasons.append(f"{dist_km:.1f} km away")
                else:
                    score = max(5.0, score - 15.0)  # Beyond 5 km penalty for nearby searches
            except Exception:
                pass

    reason_str = " · ".join(reasons) if reasons else f"Noteworthy {cat or 'attraction'} to explore"
    return score, reason_str


def discover_nearby_osm_places(
    lat: float,
    lon: float,
    radius_meters: int = 2500,
    category: str = "all",
    limit: int = 10
) -> List[Dict[str, Any]]:
    """Query OSM Overpass around specific coordinates with bounded radius."""
    import httpx

    amenity_filter = ""
    if category in ("food", "cafe", "restaurant"):
        amenity_filter = """
          node["amenity"="restaurant"](around:{radius},{lat},{lon});
          node["amenity"="cafe"](around:{radius},{lat},{lon});
        """
    elif category == "attraction":
        amenity_filter = """
          node["tourism"="attraction"](around:{radius},{lat},{lon});
          node["tourism"="museum"](around:{radius},{lat},{lon});
          node["historic"="monument"](around:{radius},{lat},{lon});
          node["leisure"="nature_reserve"](around:{radius},{lat},{lon});
          node["natural"="beach"](around:{radius},{lat},{lon});
        """
    else:
        amenity_filter = """
          node["tourism"="attraction"](around:{radius},{lat},{lon});
          node["tourism"="museum"](around:{radius},{lat},{lon});
          node["historic"="monument"](around:{radius},{lat},{lon});
          node["amenity"="restaurant"](around:{radius},{lat},{lon});
          node["amenity"="cafe"](around:{radius},{lat},{lon});
          node["natural"="beach"](around:{radius},{lat},{lon});
        """

    query = f"""
    [out:json][timeout:8];
    (
      {amenity_filter.format(radius=radius_meters, lat=lat, lon=lon)}
    );
    out body {limit * 2};
    """

    try:
        resp = httpx.post("https://overpass-api.de/api/interpreter", data={"data": query}, timeout=8.0)
        if resp.status_code == 200:
            elements = resp.json().get("elements", [])
            places = []
            for el in elements:
                tags = el.get("tags", {})
                name = tags.get("name")
                if not name or len(name) < 3:
                    continue

                cat = (
                    tags.get("tourism") or
                    tags.get("amenity") or
                    tags.get("historic") or
                    tags.get("natural") or
                    "point_of_interest"
                )

                street = tags.get("addr:street", "")
                city = tags.get("addr:city", "")
                addr = f"{street}, {city}".strip(", ") if street or city else None

                places.append({
                    "name": name,
                    "category": cat,
                    "description": tags.get("description") or f"A verified {cat.replace('_', ' ')}.",
                    "lat": float(el["lat"]),
                    "lon": float(el["lon"]),
                    "address": addr,
                    "source": "osm_overpass",
                    "rating": None,
                    "review_count": None,
                    "opening_hours": tags.get("opening_hours")
                })
            return places
    except Exception as e:
        logger.debug("Nearby OSM search failed: %s", type(e).__name__)
    return []


def build_place_recommendation(
    raw_place: Dict[str, Any],
    reason: str,
    reference_coords: Optional[Tuple[float, float]] = None
) -> PlaceRecommendation:
    """Format a raw discovered venue into a strictly typed PlaceRecommendation."""
    p_lat = raw_place.get("lat") or raw_place.get("latitude")
    p_lon = raw_place.get("lon") or raw_place.get("longitude")
    
    lat_val = float(p_lat) if p_lat is not None else None
    lon_val = float(p_lon) if p_lon is not None else None

    # Calculate distance if reference coordinates provided
    dist_m = None
    if reference_coords and lat_val is not None and lon_val is not None:
        try:
            d_km = distance(reference_coords, (lat_val, lon_val))
            dist_m = int(round(d_km * 1000))
        except Exception:
            dist_m = None

    # Determine opening status without fabricating hours
    opening_status = "UNKNOWN"
    raw_hours = raw_place.get("opening_hours")
    if raw_hours:
        hours_str = str(raw_hours).lower()
        if "24/7" in hours_str or "open" in hours_str:
            opening_status = "OPEN"
        elif "closed" in hours_str:
            opening_status = "CLOSED"

    source = raw_place.get("source") or "google_maps"
    source_url = None
    if lat_val and lon_val:
        source_url = f"https://www.google.com/maps/search/?api=1&query={lat_val},{lon_val}"

    rating_val = None
    try:
        if raw_place.get("rating") is not None:
            rating_val = float(raw_place["rating"])
    except (ValueError, TypeError):
        pass

    reviews_val = None
    try:
        rev = raw_place.get("review_count") or raw_place.get("reviews")
        if rev is not None:
            reviews_val = int(rev)
    except (ValueError, TypeError):
        pass

    return PlaceRecommendation(
        name=raw_place.get("name") or "Notable Place",
        category=raw_place.get("category") or "attraction",
        description=raw_place.get("description") or f"A notable place to visit.",
        latitude=lat_val,
        longitude=lon_val,
        address=raw_place.get("address"),
        distance_meters=dist_m,
        travel_duration_minutes=None,  # Straight-line distance used; exact pedestrian duration unverified
        rating=rating_val,
        review_count=reviews_val,
        opening_status=opening_status,
        source=source,
        source_url=source_url,
        image_url=raw_place.get("image_url"),
        reason_recommended=reason,
        supported_actions=["view_details", "directions", "add_to_itinerary", "ask_followup"]
    )


def resolve_place_from_reference(
    user_message: str,
    last_recommendations: Optional[List[Dict[str, Any]]]
) -> Optional[Dict[str, Any]]:
    """Resolve ordinal reference like 'the second one' or name to a cached recommendation."""
    if not last_recommendations:
        return None

    text = user_message.lower()

    # Ordinal mappings
    ordinal_patterns = [
        (r'\b(first|1st|number\s*1|place\s*1|option\s*1)\b', 0),
        (r'\b(second|2nd|number\s*2|place\s*2|option\s*2)\b', 1),
        (r'\b(third|3rd|number\s*3|place\s*3|option\s*3)\b', 2),
        (r'\b(fourth|4th|number\s*4|place\s*4|option\s*4)\b', 3),
        (r'\b(fifth|5th|number\s*5|place\s*5|option\s*5)\b', 4),
    ]

    for pat, idx in ordinal_patterns:
        if re.search(pat, text):
            if 0 <= idx < len(last_recommendations):
                return last_recommendations[idx]

    # Name matching
    for rec in last_recommendations:
        name = rec.get("name", "").lower()
        if name and (name in text or text in name):
            return rec

    return None


def handle_travel_guide_query(
    user_message: str,
    travel_context: Dict[str, Any],
    qa_category: Optional[str] = None,
    current_lat: Optional[float] = None,
    current_lon: Optional[float] = None,
    current_day: Optional[int] = None,
    active_segment_id: Optional[str] = None,
    destination: Optional[str] = None,
    user_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    has_current_trip: bool = False,
    active_trip: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Main entry point for the Travel Guide Agent.
    Routes queries to specialized factual discovery, personalized ranking, and structured response construction.
    """
    # 1. Resolve Destination
    dest = (
        destination or
        travel_context.get("destination") or
        (active_trip.get("destination") if active_trip else None)
    )
    if isinstance(dest, list):
        dest = dest[0] if dest else None
    if isinstance(dest, str):
        dest = dest.split(',')[0].strip()

    dest = normalize_destination_name(dest)

    # Extract destination from user message if query mentions a specific city (e.g. "famous places in hyderanad", "places in hyd")
    dest_match = re.search(r'\b(?:in|at|for|to|around|near|visiting)\s+([A-Za-z\s]{2,20})\b', user_message, re.IGNORECASE)
    if dest_match:
        cand_dest = dest_match.group(1).strip()
        # Ensure it's not a general word
        if cand_dest.lower() not in ("the city", "the area", "my location", "here", "india", "today", "tomorrow", "this place"):
            normalized = normalize_destination_name(cand_dest)
            if normalized:
                dest = normalized

    # Also scan for known destination aliases anywhere in user message (e.g. "give me famous places hyd")
    msg_words = user_message.lower()
    for alias, canonical in DESTINATION_ALIASES.items():
        if re.search(r'\b' + re.escape(alias) + r'\b', msg_words):
            dest = canonical
            break

    # Scan for known landmark references (e.g. "Why is Hawa Mahal famous?" -> Jaipur)
    if not dest:
        for landmark, l_dest in LANDMARK_DESTINATIONS.items():
            if re.search(r'\b' + re.escape(landmark) + r'\b', msg_words):
                dest = l_dest
                break

    if not dest:
        inferred = resolve_destination_from_query(user_message)
        if inferred:
            dest = inferred

    # 2. Extract Interests
    interests = extract_interest_tags(user_message, travel_context)

    # 3. Classify Query
    query_type = classify_guide_query(user_message, qa_category, current_lat, current_lon)
    print(f"--- TRAVEL GUIDE AGENT: Query Type = {query_type} | Destination = '{dest}' | Interests = {interests} ---")

    # 4. Handle WEATHER
    if query_type == "WEATHER":
        if not dest:
            return {
                "answer": "Which destination's weather would you like to check? (e.g., Jaipur, Goa, Paris)",
                "places": [],
                "suggested_actions": [],
                "category": "WEATHER",
                "destination": "",
                "user_location_used": False
            }
        days_count = int(travel_context.get("days") or 3)
        weather_res = fetch_realtime_weather_openmeteo(dest, days=days_count)
        rag_notes = retrieve_travel_knowledge(f"{dest} climate season weather temperature", k=1)

        summary = weather_res.get("summary") if isinstance(weather_res, dict) else None
        cloth = weather_res.get("clothing_recommendation") if isinstance(weather_res, dict) else None
        reason = weather_res.get("reason") if isinstance(weather_res, dict) else None

        if summary and weather_res.get("data_status") != "unavailable":
            ans = f"In {dest.title()}: {summary}. Recommendation: {cloth or 'Dress comfortably for local conditions.'}"
        elif reason:
            ans = f"Weather forecast for {dest.title()} is currently unavailable: {summary}. {rag_notes}".strip()
        else:
            ans = f"Regarding weather in {dest.title()}: {rag_notes or 'Expect typical seasonal temperatures.'}"

        return {
            "answer": ans,
            "places": [],
            "suggested_actions": [
                {"label": f"Top attractions in {dest.title()}", "action": "ask_attractions"},
                {"label": f"Best local food in {dest.title()}", "action": "ask_food"}
            ],
            "category": "WEATHER",
            "destination": dest,
            "user_location_used": False
        }

    # 5. Handle FOLLOW_UP (Referencing previous recommendation)
    last_recs = travel_context.get("last_recommendations") or []
    if query_type == "FOLLOW_UP":
        resolved_place = resolve_place_from_reference(user_message, last_recs)
        if resolved_place and any(w in user_message.lower() for w in ("near", "around", "close to", "nearby")):
            # User wants places near the referenced attraction
            p_lat = resolved_place.get("latitude") or resolved_place.get("lat")
            p_lon = resolved_place.get("longitude") or resolved_place.get("lon")
            if p_lat is not None and p_lon is not None:
                current_lat = float(p_lat)
                current_lon = float(p_lon)
                query_type = "NEARBY_PLACES"
        elif resolved_place:
            p_name = resolved_place.get("name")
            p_cat = resolved_place.get("category") or "attraction"
            p_addr = resolved_place.get("address") or f"{dest or 'Central area'}"
            p_rating = resolved_place.get("rating")
            p_desc = resolved_place.get("description") or f"A notable {p_cat} in {dest}."

            detail_facts = retrieve_travel_knowledge(f"{p_name} {dest} history architecture significance timing", k=2)
            rating_text = f"Rated ⭐ {p_rating}." if p_rating else ""
            ans = (
                f"**{p_name}** ({p_cat.title()}): {p_desc} {rating_text}\n\n"
                f"📍 Address: {p_addr}\n"
                f"{detail_facts}".strip()
            )

            actions = [
                {"label": f"Directions to {p_name}", "action": "directions", "payload": {"name": p_name, "lat": resolved_place.get("latitude"), "lon": resolved_place.get("longitude")}},
            ]
            if has_current_trip and active_trip:
                actions.append({"label": f"Add {p_name} to Day 1", "action": "add_to_day", "payload": {"place": resolved_place, "day": 1}})
                actions.append({"label": f"Add {p_name} to Day 2", "action": "add_to_day", "payload": {"place": resolved_place, "day": 2}})

            return {
                "answer": ans,
                "places": [resolved_place],
                "suggested_actions": actions,
                "category": "FOLLOW_UP",
                "destination": dest or "",
                "user_location_used": False
            }
        else:
            # Ambiguous reference
            if last_recs:
                names = [r.get("name") for r in last_recs[:3]]
                return {
                    "answer": f"Which of the previous places would you like to know more about? ({', '.join(names)})",
                    "places": [],
                    "suggested_actions": [{"label": n, "action": "ask_place", "payload": {"name": n}} for n in names],
                    "category": "FOLLOW_UP",
                    "destination": dest or "",
                    "user_location_used": False
                }
            else:
                return {
                    "answer": "I don't have a previous place saved in our chat yet. Which attraction or venue would you like to explore?",
                    "places": [],
                    "suggested_actions": [],
                    "category": "FOLLOW_UP",
                    "destination": dest or "",
                    "user_location_used": False
                }

    # 6. Check destination presence for place-based queries
    if not dest:
        rag_direct = retrieve_travel_knowledge(user_message, k=2)
        if rag_direct:
            pref_blob = f"Interests: {', '.join(interests) if interests else 'General sightseeing'} | Travel Style: {travel_context.get('travel_style', 'Balanced')}"
            try:
                prompt_val = GUIDE_SYNTHESIS_PROMPT.format_messages(
                    destination="Travel Guide",
                    context=rag_direct,
                    preferences=pref_blob,
                    user_message=user_message
                )
                conversational_answer = llm.invoke(prompt_val).content.strip()
            except Exception:
                conversational_answer = rag_direct
            return {
                "answer": conversational_answer,
                "places": [],
                "suggested_actions": [],
                "category": "GENERAL_QA",
                "destination": "",
                "user_location_used": False
            }
        return {
            "answer": "Which city or destination would you like recommendations for? Tell me a destination (e.g. Jaipur, Goa, Munnar) and I will discover top places tailored to your style!",
            "places": [],
            "suggested_actions": [
                {"label": "Explore Goa", "action": "set_dest", "payload": {"destination": "Goa"}},
                {"label": "Explore Jaipur", "action": "set_dest", "payload": {"destination": "Jaipur"}},
                {"label": "Explore Kerala", "action": "set_dest", "payload": {"destination": "Kerala"}}
            ],
            "category": "GENERAL_QA",
            "destination": "",
            "user_location_used": False
        }

    # 7. Check if valid GPS coordinates or Active Stop Coordinates are available
    ref_coords: Optional[Tuple[float, float]] = None
    user_location_used = False

    if current_lat is not None and current_lon is not None:
        try:
            c_lat, c_lon = float(current_lat), float(current_lon)
            if math.isfinite(c_lat + c_lon) and -90 <= c_lat <= 90 and -180 <= c_lon <= 180:
                ref_coords = (c_lat, c_lon)
                user_location_used = True
        except (ValueError, TypeError):
            ref_coords = None

    # Fallback to active segment stop coordinates if user asks for nearby around active stop
    if not ref_coords and active_segment_id and active_trip:
        days = (active_trip.get("route_details") or {}).get("day_by_day_route") or []
        for d in days:
            for s in (d.get("stops") or d.get("activities") or []):
                if s.get("id") == active_segment_id:
                    s_lat, s_lon = s.get("lat"), s.get("lon")
                    if s_lat is not None and s_lon is not None:
                        ref_coords = (float(s_lat), float(s_lon))
                        break

    # If query is NEARBY_PLACES but no coordinates are available:
    location_unavailable_note = ""
    if query_type == "NEARBY_PLACES" and not ref_coords:
        location_unavailable_note = (
            "*(Your current GPS location was not provided. Showing notable places across "
            f"{dest.title()} instead. To view spots near you, please grant location permission or name a specific area.)*\n\n"
        )

    # 8. Discover Candidate Places
    raw_candidates: List[Dict[str, Any]] = []

    # Priority 1: If query has nearby GPS coordinates, discover venues closest to user location first
    if ref_coords and user_location_used:
        is_food_query = any(w in user_message.lower() for w in ("food", "restaurant", "cafe", "café", "dining"))
        try:
            nearby_osm = discover_nearby_osm_places(
                ref_coords[0], ref_coords[1],
                radius_meters=3000,
                category="food" if is_food_query else "all",
                limit=10
            )
            if nearby_osm:
                raw_candidates.extend(nearby_osm)
        except Exception as e:
            logger.warning("Nearby OSM discovery error in travel guide: %s", type(e).__name__)

    # Priority 2: If query is about food / cafes / dining and we need candidates
    if (not raw_candidates or (not user_location_used and len(raw_candidates) < 4)) and (query_type == "LOCAL_EXPERIENCES" or any(w in user_message.lower() for w in ("food", "restaurant", "cafe", "café", "dining"))):
        try:
            serp_rest = discover_restaurants_serpapi(dest, limit=6)
            if serp_rest:
                raw_candidates.extend(serp_rest)
        except Exception as e:
            logger.warning("SerpApi restaurant error in travel guide: %s", type(e).__name__)

        if not raw_candidates:
            try:
                overpass_rest = fetch_real_restaurants_overpass(dest, limit=8)
                if overpass_rest:
                    raw_candidates.extend(overpass_rest)
            except Exception as e:
                logger.warning("Overpass restaurant error in travel guide: %s", type(e).__name__)

        if not raw_candidates:
            dest_clean = dest.lower().strip()
            if dest_clean in AUTHENTIC_DESTINATION_RESTAURANTS:
                raw_candidates.extend(AUTHENTIC_DESTINATION_RESTAURANTS[dest_clean])

    # Priority 3: Famous attractions / interest recommendations
    if not raw_candidates or (not user_location_used and len(raw_candidates) < 4):
        try:
            serp_cand = discover_via_serpapi(dest, candidate_count=8, ranked_interests=interests)
            if serp_cand:
                raw_candidates.extend(serp_cand)
        except Exception as e:
            logger.warning("SerpApi discovery error in travel guide: %s", type(e).__name__)

        if not raw_candidates:
            try:
                osm_cand = discover_via_overpass(dest, candidate_count=8)
                if osm_cand:
                    raw_candidates.extend(osm_cand)
            except Exception as e:
                logger.warning("Overpass discovery error in travel guide: %s", type(e).__name__)

        if not raw_candidates:
            dest_clean = dest.lower().strip() if dest else ""
            if dest_clean in AUTHENTIC_DESTINATION_ATTRACTIONS:
                raw_candidates.extend(AUTHENTIC_DESTINATION_ATTRACTIONS[dest_clean])

    # 9. Deduplicate
    unique_candidates = deduplicate_places(raw_candidates)

    # 10. Rank and Score
    must_visits = travel_context.get("must_visit_places") or []
    scored_places: List[Tuple[float, str, Dict[str, Any]]] = []

    for cand in unique_candidates:
        score, reason = calculate_place_relevance_score(
            cand,
            user_interests=interests,
            reference_coords=ref_coords if user_location_used else None,
            must_visit_names=must_visits
        )
        scored_places.append((score, reason, cand))

    # Sort descending by score
    scored_places.sort(key=lambda x: x[0], reverse=True)
    top_scored = scored_places[:4]

    # Convert to PlaceRecommendation objects
    recommended_places: List[PlaceRecommendation] = []
    for score, reason, cand in top_scored:
        rec = build_place_recommendation(cand, reason, reference_coords=ref_coords if user_location_used else None)
        recommended_places.append(rec)

    # 11. Retrieve RAG Knowledge for Synthesis
    rag_context = retrieve_travel_knowledge(f"{dest} {user_message}", k=2)
    # Filter out cross-destination vector leakage (e.g. Goa guide matching for Hyderabad query)
    if rag_context and dest and dest.lower() not in rag_context.lower():
        rag_context = ""

    # 12. Conversational Synthesis
    places_summary = "\n".join([f"- {p.name} ({p.category}): {p.description} (Reason: {p.reason_recommended})" for p in recommended_places])
    context_blob = f"Destination: {dest}\nPlaces:\n{places_summary}\nRAG Knowledge:\n{rag_context}"
    pref_blob = f"Interests: {', '.join(interests) if interests else 'General sightseeing'} | Travel Style: {travel_context.get('travel_style', 'Balanced')}"

    try:
        prompt_val = GUIDE_SYNTHESIS_PROMPT.format_messages(
            destination=dest.title() if dest else "Destination",
            context=context_blob,
            preferences=pref_blob,
            user_message=user_message
        )
        conversational_answer = llm.invoke(prompt_val).content.strip()
    except Exception as e:
        logger.debug("Guide synthesis fallback: %s", type(e).__name__)
        if recommended_places:
            names = [p.name for p in recommended_places]
            conversational_answer = f"Here are verified recommendations for {dest.title()} matching your request: {', '.join(names)}. Check the cards below for details!"
        else:
            conversational_answer = f"Here is what you need to know about {dest.title()}: {rag_context or 'A wonderful travel destination.'}"

    if location_unavailable_note:
        conversational_answer = location_unavailable_note + conversational_answer

    # 13. Formulate Suggested Actions
    suggested_actions: List[SuggestedAction] = []
    if recommended_places:
        first_place = recommended_places[0]
        if first_place.name:
            suggested_actions.append(SuggestedAction(
                label=f"Tell me more about {first_place.name}",
                action="ask_followup",
                payload={"name": first_place.name}
            ))
            if has_current_trip and active_trip:
                suggested_actions.append(SuggestedAction(
                    label=f"Add {first_place.name} to Day 2",
                    action="add_to_day",
                    payload={"place_name": first_place.name, "day": 2}
                ))
        suggested_actions.append(SuggestedAction(
            label="Explore local food & cafés",
            action="explore_food",
            payload={"category": "food"}
        ))
        suggested_actions.append(SuggestedAction(
            label="Show more attractions",
            action="show_more",
            payload={"destination": dest}
        ))

    return {
        "answer": conversational_answer,
        "places": [p.model_dump() for p in recommended_places],
        "suggested_actions": [a.model_dump() for a in suggested_actions],
        "category": query_type,
        "destination": dest,
        "user_location_used": user_location_used
    }
