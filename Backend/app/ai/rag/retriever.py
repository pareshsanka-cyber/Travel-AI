import os
import re
import difflib
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from app.ai.rag.chroma_client import vector_store

KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge"

# Curated landmark-to-destination knowledge mapping
LANDMARK_DESTINATIONS: Dict[str, str] = {
    "hawa mahal": "Jaipur",
    "amber fort": "Jaipur",
    "amer fort": "Jaipur",
    "city palace": "Jaipur",
    "jantar mantar": "Jaipur",
    "nahargarh fort": "Jaipur",
    "jal mahal": "Jaipur",
    "birla mandir jaipur": "Jaipur",
    "charminar": "Hyderabad",
    "golconda fort": "Hyderabad",
    "golkonda fort": "Hyderabad",
    "chowmahalla palace": "Hyderabad",
    "salar jung museum": "Hyderabad",
    "qutb shahi tombs": "Hyderabad",
    "hussain sagar": "Hyderabad",
    "birla mandir hyderabad": "Hyderabad",
    "ramoji film city": "Hyderabad",
    "taj mahal": "Agra",
    "agra fort": "Agra",
    "fatehpur sikri": "Agra",
    "mehtab bagh": "Agra",
    "golden temple": "Amritsar",
    "harmandir sahib": "Amritsar",
    "jallianwala bagh": "Amritsar",
    "wagah border": "Amritsar",
    "gateway of india": "Mumbai",
    "marine drive": "Mumbai",
    "elephanta caves": "Mumbai",
    "red fort": "Delhi",
    "qutub minar": "Delhi",
    "qutb minar": "Delhi",
    "humayun's tomb": "Delhi",
    "india gate": "Delhi",
    "lotus temple": "Delhi",
    "jama masjid": "Delhi",
    "baga beach": "Goa",
    "calangute beach": "Goa",
    "anjuna beach": "Goa",
    "palolem beach": "Goa",
    "aguada fort": "Goa",
    "dudhsagar falls": "Goa",
    "dudhsagar waterfalls": "Goa",
    "basilica of bom jesus": "Goa",
    "se cathedral": "Goa",
    "mangueshi temple": "Goa",
    "chapora fort": "Goa",
    "pangong lake": "Leh",
    "khardung la": "Leh",
    "nubra valley": "Leh",
    "solang valley": "Manali",
    "rohtang pass": "Manali",
    "hadimba temple": "Manali",
    "kashi vishwanath": "Varanasi",
    "dashashwamedh ghat": "Varanasi",
    "assi ghat": "Varanasi",
    "sarnath": "Varanasi",
    "city palace udaipur": "Udaipur",
    "lake pichola": "Udaipur",
    "fateh sagar lake": "Udaipur",
    "saheliyon ki bari": "Udaipur",
    "lalbagh botanical garden": "Bengaluru",
    "cubbon park": "Bengaluru",
    "bangalore palace": "Bengaluru",
}

CITY_GUIDE_FILES: Dict[str, str] = {
    "jaipur": "jaipur_guide.txt",
    "hyderabad": "hyderabad_guide.txt",
    "goa": "goa_guide.txt",
    "delhi": "delhi_guide.txt",
    "mumbai": "mumbai_guide.txt",
    "agra": "agra_guide.txt",
    "amritsar": "amritsar_guide.txt",
    "bengaluru": "bengaluru_guide.txt",
    "bangalore": "bengaluru_guide.txt",
    "kerala": "kerala_guide.txt",
    "kochi": "kerala_guide.txt",
    "leh": "leh_guide.txt",
    "ladakh": "leh_guide.txt",
    "manali": "manali_guide.txt",
    "shimla": "shimla_guide.txt",
    "ooty": "ooty_guide.txt",
    "darjeeling": "darjeeling_guide.txt",
    "udaipur": "udaipur_guide.txt",
    "varanasi": "varanasi_guide.txt",
}

def resolve_destination_from_query(query: str) -> Optional[str]:
    """Infers canonical destination from query keywords or known landmarks."""
    q_lower = query.lower()
    for landmark, dest in LANDMARK_DESTINATIONS.items():
        if re.search(r'\b' + re.escape(landmark) + r'\b', q_lower):
            return dest
    for city, canonical in {
        "hyderabad": "Hyderabad", "jaipur": "Jaipur", "goa": "Goa",
        "delhi": "Delhi", "mumbai": "Mumbai", "agra": "Agra",
        "amritsar": "Amritsar", "bengaluru": "Bengaluru", "bangalore": "Bengaluru",
        "kerala": "Kerala", "leh": "Leh", "manali": "Manali",
        "shimla": "Shimla", "ooty": "Ooty", "darjeeling": "Darjeeling",
        "udaipur": "Udaipur", "varanasi": "Varanasi"
    }.items():
        if re.search(r'\b' + re.escape(city) + r'\b', q_lower):
            return canonical
    return None

def retrieve_local_guide_knowledge(query: str, destination: Optional[str] = None, k: int = 2) -> str:
    """
    Retrieves authentic factual chunks directly from the local travel guides in knowledge/.
    Ensures zero-latency, high-precision retrieval without external service dependencies.
    """
    dest_key = (destination or "").lower().strip()
    target_files: List[Path] = []

    if dest_key in CITY_GUIDE_FILES:
        target_file = KNOWLEDGE_DIR / CITY_GUIDE_FILES[dest_key]
        if target_file.exists():
            target_files.append(target_file)

    if not target_files:
        # Check if a landmark in query reveals the destination
        inferred = resolve_destination_from_query(query)
        if inferred and inferred.lower() in CITY_GUIDE_FILES:
            target_file = KNOWLEDGE_DIR / CITY_GUIDE_FILES[inferred.lower()]
            if target_file.exists():
                target_files.append(target_file)

    if not target_files and KNOWLEDGE_DIR.exists():
        # Scan all available txt guides if destination is unspecified
        target_files = list(KNOWLEDGE_DIR.glob("*_guide.txt"))

    if not target_files:
        return ""

    query_tokens = [w for w in re.findall(r'\b\w{3,}\b', query.lower()) if w not in {"what", "when", "where", "which", "about", "tell", "give", "famous", "place", "places", "visit"}]
    
    scored_paragraphs: List[Tuple[float, str]] = []

    for file_path in target_files:
        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        paragraphs = [p.strip() for p in re.split(r'\n{2,}', content) if len(p.strip()) > 60]
        for p in paragraphs:
            p_lower = p.lower()
            score = 0.0

            # Direct landmark or full phrase match bonus
            for landmark in LANDMARK_DESTINATIONS:
                if landmark in query.lower() and landmark in p_lower:
                    score += 50.0

            # Word token matches
            for token in query_tokens:
                if token in p_lower:
                    score += 5.0
                    # Additional weight if token is in header or first sentence
                    if token in p_lower[:80]:
                        score += 5.0

            if score > 0:
                scored_paragraphs.append((score, p))

    if not scored_paragraphs:
        return ""

    scored_paragraphs.sort(key=lambda x: x[0], reverse=True)
    top_chunks = [p for _, p in scored_paragraphs[:k]]
    return "\n\n".join(top_chunks)


def is_ollama_available(base_url: str = "http://localhost:11434") -> bool:
    import urllib.parse
    import socket
    try:
        parsed = urllib.parse.urlparse(base_url)
        host = parsed.hostname or "localhost"
        port = parsed.port or 11434
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.3)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception:
        return False

def retrieve_travel_knowledge(query: str, destination: Optional[str] = None, k: int = 2) -> str:
    """
    Search travel knowledge for documents relevant to the query.
    Uses ChromaDB vector store when available, with strict destination isolation.
    Gracefully falls back to local knowledge guides for factual accuracy.
    """
    dest = destination or resolve_destination_from_query(query)
    
    # 1. Try vector store search if Ollama is available
    vector_text = ""
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    if is_ollama_available(ollama_url):
        try:
            results = vector_store.similarity_search(query, k=k)
            if results:
                chunks = [doc.page_content for doc in results if doc.page_content]
                # Verify destination relevance to prevent cross-city leakage (e.g. Goa chunks for non-Goa city)
                if dest:
                    chunks = [c for c in chunks if dest.lower() in c.lower()]
                vector_text = "\n".join(chunks).strip()
        except Exception:
            vector_text = ""

    if vector_text:
        return vector_text

    # 2. High-precision local guide retrieval fallback
    return retrieve_local_guide_knowledge(query, destination=dest, k=k)
