from app.ai.rag.chroma_client import vector_store

# Mock travel knowledge base to seed the database if it is empty
MOCK_TRAVEL_DATA = [
    "Goa flight advice: Flights to Dabolim Airport (GOI) are usually cheaper, but Mopa Airport (GOX) is closer to North Goa beach resorts.",
    "Goa hotel tip: North Goa (Calangute, Baga) offers lively beaches and budget-friendly hotels; South Goa (Varca, Cavelossim) is best for quiet luxury resorts.",
    "Goa dining advice: Beach shacks like Curlies or Britto's are famous for local Goan fish curry. Expect to spend $10-$15 per person.",
    "Goa transport tip: Renting a scooter is the cheapest way to travel ($5-$8/day). Local cabs do not use meters and are expensive.",
    "Goa weather note: High monsoon season runs from June to September. The ideal time to visit is between October and February."
]

def seed_database_if_empty():
    try:
        # Check if any documents exist in the collection
        count = vector_store._collection.count()
        if count == 0:
            print("--- RAG SYSTEM: ChromaDB is empty. Seeding travel knowledge data... ---")
            vector_store.add_texts(MOCK_TRAVEL_DATA)
            print(f"--- RAG SYSTEM: Successfully seeded {len(MOCK_TRAVEL_DATA)} travel facts! ---")
        else:
            print(f"--- RAG SYSTEM: ChromaDB contains {count} travel facts. Ready. ---")
    except Exception as e:
        print(f"--- RAG SYSTEM: Warning: Could not seed database: {e} ---")

# Ingest regional guides explicitly; retrieval does not write demo knowledge on import.

def retrieve_travel_knowledge(query: str, k: int = 2) -> str:
    """
    Search the ChromaDB vector database for documents similar to the query.
    Returns a single string containing the retrieved facts.
    """
    try:
        print(f"--- RAG SYSTEM: Searching database for: '{query}' ---")
        results = vector_store.similarity_search(query, k=k)
        
        # Combine the content of the retrieved documents
        retrieved_facts = "\n".join([doc.page_content for doc in results])
        return retrieved_facts
    except Exception as e:
        print(f"Error retrieving from ChromaDB: {e}")
        return ""
