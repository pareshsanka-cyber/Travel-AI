import sys
sys.path.insert(0, "Backend")

from app.ai.rag.retriever import retrieve_travel_knowledge_with_metadata

queries = [
    ("Why is Hawa Mahal famous?", "Jaipur"),
    ("What is special about the Palace of Breeze?", "Jaipur"),
    ("Why did royal women observe street life from Hawa Mahal?", "Jaipur")
]

print("=" * 70)
print("RAG SEMANTIC VARIATION VERIFICATION")
print("=" * 70)

for q, dest in queries:
    res = retrieve_travel_knowledge_with_metadata(q, destination=dest, k=3)
    print(f"\nQUERY: '{q}'")
    print(f"  Method:       {res['method']}")
    print(f"  Destination:  {res['destination']}")
    print(f"  Confidence:   {res['confidence']}")
    print(f"  Sources:      {res['sources']}")
    print(f"  Total Chunks: {len(res['chunks'])}")
    for i, c in enumerate(res['chunks']):
        snippet = c['content'][:120].replace('\n', ' ')
        score = c.get('score', 'N/A')
        print(f"    Chunk {i+1} [Score {score}]: {snippet}...")
        if "zenana" in c['content'].lower() or "royal ladies" in c['content'].lower() or "breeze" in c['content'].lower():
            print(f"      -> FOUND KEY FACT: Zenana / Royal Ladies / Breeze mentioned in Chunk {i+1}!")
print("=" * 70)
