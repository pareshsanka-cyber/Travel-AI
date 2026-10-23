import os
import re
import difflib
import logging
from pathlib import Path
from typing import Optional, Dict, List, Tuple, Any
from app.ai.rag.chroma_client import vector_store

logger = logging.getLogger("travelai.retriever")

KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge"

# Curated landmark-to-destination knowledge mapping
LANDMARK_DESTINATIONS: Dict[str, str] = {
    "hawa mahal": "Jaipur",
    "palace of breeze": "Jaipur",
    "palace of the breeze": "Jaipur",
    "palace of winds": "Jaipur",
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
    "fort aguada": "Goa",
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

DESTINATION_KEYWORDS: Dict[str, str] = {
    "hyderabad": "Hyderabad", "hyd": "Hyderabad",
    "jaipur": "Jaipur", "pink city": "Jaipur",
    "goa": "Goa", "panaji": "Goa",
    "delhi": "Delhi", "new delhi": "Delhi",
    "mumbai": "Mumbai", "bombay": "Mumbai",
    "agra": "Agra",
    "amritsar": "Amritsar",
    "bengaluru": "Bengaluru", "bangalore": "Bengaluru", "blr": "Bengaluru",
    "kerala": "Kerala", "kochi": "Kerala", "munnar": "Kerala", "alleppey": "Kerala",
    "leh": "Leh", "ladakh": "Leh",
    "manali": "Manali",
    "shimla": "Shimla",
    "ooty": "Ooty",
    "darjeeling": "Darjeeling",
    "udaipur": "Udaipur",
    "varanasi": "Varanasi", "kashi": "Varanasi", "banaras": "Varanasi"
}

def resolve_destination_from_query(query: str) -> Optional[str]:
    """Infers canonical destination from query keywords or known landmarks."""
    q_lower = query.lower()
    for landmark, dest in LANDMARK_DESTINATIONS.items():
        if re.search(r'\b' + re.escape(landmark) + r'\b', q_lower):
            return dest
    for city, canonical in DESTINATION_KEYWORDS.items():
        if re.search(r'\b' + re.escape(city) + r'\b', q_lower):
            return canonical
    return None

def retrieve_local_guide_knowledge(query: str, destination: Optional[str] = None, k: int = 3) -> str:
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
        inferred = resolve_destination_from_query(query)
        if inferred and inferred.lower() in CITY_GUIDE_FILES:
            target_file = KNOWLEDGE_DIR / CITY_GUIDE_FILES[inferred.lower()]
            if target_file.exists():
                target_files.append(target_file)

    if not target_files and KNOWLEDGE_DIR.exists():
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
                    if token in p_lower[:80]:
                        score += 5.0

            if score > 0:
                scored_paragraphs.append((score, p))

    if not scored_paragraphs:
        return ""

    scored_paragraphs.sort(key=lambda x: x[0], reverse=True)
    top_chunks = [p for _, p in scored_paragraphs[:k]]
    return "\n\n".join(top_chunks)


def retrieve_travel_knowledge_with_metadata(
    query: str,
    destination: Optional[str] = None,
    k: int = 3,
    score_threshold: float = 1.35
) -> Dict[str, Any]:
    """
    Search travel knowledge for documents relevant to the query.
    1. Queries ChromaDB vector store with strict destination isolation if destination is known.
    2. Validates relevance score against threshold.
    3. Falls back gracefully to local guide text files if vector search fails or yields no confident results.
    4. Returns rich metadata including observable retrieval method ('vector', 'local_keyword', 'none').
    """
    dest = destination or resolve_destination_from_query(query)
    dest_normalized = dest.lower().strip() if dest else None

    # Destination filter for Chroma to guarantee destination isolation
    filter_dict = {"destination": dest_normalized} if dest_normalized else None

    vector_chunks: List[str] = []
    vector_records: List[Dict[str, Any]] = []
    vector_sources: List[str] = []

    # 1. Attempt ChromaDB vector retrieval
    try:
        if vector_store is not None:
            raw_results = vector_store.similarity_search_with_score(
                query,
                k=k,
                filter=filter_dict
            )
            for doc, score in raw_results:
                # In Chroma L2 distance, lower score is closer.
                # Threshold of 1.35 filters out irrelevant chunks.
                if score <= score_threshold and doc.page_content:
                    # Double-check destination isolation if destination is specified
                    doc_dest = str(doc.metadata.get("destination", "")).lower()
                    if dest_normalized and doc_dest and doc_dest != dest_normalized:
                        continue
                    
                    vector_chunks.append(doc.page_content.strip())
                    src = doc.metadata.get("source", "knowledge_base")
                    if src not in vector_sources:
                        vector_sources.append(src)
                    vector_records.append({
                        "content": doc.page_content.strip(),
                        "score": round(float(score), 4),
                        "confidence": round(max(0.0, 1.0 - (float(score) / 1.5)), 3),
                        "source": src,
                        "destination": doc_dest,
                        "is_historical": bool(doc.metadata.get("is_historical", False))
                    })
    except Exception as e:
        logger.warning("ChromaDB vector retrieval encountered exception: %s. Falling back to local guides.", e)
        vector_chunks = []

    if vector_chunks:
        return {
            "text": "\n\n".join(vector_chunks),
            "method": "vector",
            "destination": dest,
            "chunks": vector_records,
            "sources": vector_sources,
            "confidence": vector_records[0]["confidence"] if vector_records else 0.8
        }

    # 2. High-precision local guide fallback
    local_text = retrieve_local_guide_knowledge(query, destination=dest, k=k)
    if local_text:
        return {
            "text": local_text,
            "method": "local_keyword",
            "destination": dest,
            "chunks": [{"content": c, "source": CITY_GUIDE_FILES.get(dest_normalized, "guide_file")} for c in local_text.split("\n\n")],
            "sources": [CITY_GUIDE_FILES.get(dest_normalized, "guide_file")] if dest_normalized in CITY_GUIDE_FILES else [],
            "confidence": 0.75
        }

    return {
        "text": "",
        "method": "none",
        "destination": dest,
        "chunks": [],
        "sources": [],
        "confidence": 0.0
    }


def retrieve_travel_knowledge(
    query: str,
    destination: Optional[str] = None,
    k: int = 3,
    return_metadata: bool = False
) -> Any:
    """
    Search travel knowledge for documents relevant to the query.
    Backward-compatible interface: returns formatted string by default,
    or rich dictionary if return_metadata=True.
    """
    res = retrieve_travel_knowledge_with_metadata(query, destination=destination, k=k)
    if return_metadata:
        return res
    return res["text"]
