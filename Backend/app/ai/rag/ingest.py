import sys
import os
import argparse
import hashlib
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

# Add the Backend root directory to the system path so we can import from app
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
import chromadb
from app.ai.rag.embedder import embeddings
from app.ai.rag.chroma_client import DB_PATH, get_vector_store

KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge"

# Historical Goa tips preserved from legacy ChromaDB store
HISTORICAL_GOA_TIPS = [
    "Goa flight advice: Flights to Dabolim Airport (GOI) are usually cheaper, but Mopa Airport (GOX) is closer to North Goa beach resorts.",
    "Goa hotel tip: North Goa (Calangute, Baga) offers lively beaches and budget-friendly hotels; South Goa (Varca, Cavelossim) is best for quiet luxury resorts.",
    "Goa dining advice: Beach shacks like Curlies or Britto's are famous for local Goan fish curry. Expect to spend $10-$15 per person.",
    "Goa transport tip: Renting a scooter is the cheapest way to travel ($5-$8/day). Local cabs do not use meters and are expensive.",
    "Goa weather note: High monsoon season runs from June to September. The ideal time to visit is between October and February."
]

def get_destination_from_filename(filename: str) -> str:
    name = filename.lower()
    if name.endswith("_guide.txt"):
        return name[:-10]
    return "general"

def prepare_documents(chunk_size: int = 500, chunk_overlap: int = 50) -> List[Document]:
    """
    Discovers all destination guide files in the knowledge directory,
    splits them into chunks with metadata, and includes historical Goa tips.
    """
    if not KNOWLEDGE_DIR.exists():
        os.makedirs(KNOWLEDGE_DIR, exist_ok=True)
        print(f"[RAG INGEST] Created knowledge directory at {KNOWLEDGE_DIR}")
        return []

    guide_files = sorted(list(KNOWLEDGE_DIR.glob("*_guide.txt")))
    if not guide_files:
        print(f"[RAG INGEST] No *_guide.txt files found in {KNOWLEDGE_DIR}")
        return []

    splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    all_docs: List[Document] = []
    dest_counts: Dict[str, int] = {}

    for file_path in guide_files:
        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            print(f"[RAG INGEST] Error reading {file_path.name}: {e}")
            continue

        destination = get_destination_from_filename(file_path.name)
        chunks = splitter.split_text(content)
        dest_counts[destination] = len(chunks)

        for idx, chunk in enumerate(chunks):
            chunk_clean = chunk.strip()
            if not chunk_clean:
                continue
            doc_id = hashlib.sha256(f"{destination}:{file_path.name}:{idx}:{chunk_clean[:80]}".encode("utf-8")).hexdigest()[:24]
            doc = Document(
                page_content=chunk_clean,
                metadata={
                    "doc_id": doc_id,
                    "destination": destination,
                    "source": file_path.name,
                    "chunk_index": idx,
                    "char_count": len(chunk_clean),
                    "is_historical": False
                }
            )
            all_docs.append(doc)

    # Incorporate the 5 historical Goa tips
    for idx, tip in enumerate(HISTORICAL_GOA_TIPS):
        tip_clean = tip.strip()
        doc_id = f"hist_goa_{idx}"
        doc = Document(
            page_content=tip_clean,
            metadata={
                "doc_id": doc_id,
                "destination": "goa",
                "source": "historical_goa_tips.txt",
                "chunk_index": idx,
                "char_count": len(tip_clean),
                "is_historical": True
            }
        )
        all_docs.append(doc)
    dest_counts["goa"] = dest_counts.get("goa", 0) + len(HISTORICAL_GOA_TIPS)

    print(f"[RAG INGEST] Prepared {len(all_docs)} total chunks across {len(guide_files)} guide files + 5 historical Goa tips.")
    for dest, count in sorted(dest_counts.items()):
        print(f"  - {dest}: {count} chunks")

    return all_docs

def ingest_documents(
    rebuild: bool = False,
    batch_size: int = 100,
    chunk_size: int = 500,
    chunk_overlap: int = 50
) -> Dict[str, Any]:
    start_time = time.time()
    print("--- RAG INGESTION PIPELINE STARTED ---")
    
    docs = prepare_documents(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    if not docs:
        print("[RAG INGEST] No documents to ingest.")
        return {"status": "empty", "total_indexed": 0}

    client = chromadb.PersistentClient(path=DB_PATH)
    collection_name = "travel_knowledge"
    
    # Check if existing collection exists and its dimension
    existing_collection = None
    try:
        existing_collection = client.get_collection(collection_name)
    except Exception:
        existing_collection = None

    needs_rebuild = rebuild
    if existing_collection is not None and not rebuild:
        try:
            # Test if existing collection matches current embedding dimension
            test_vec = embeddings.embed_query("test")
            existing_collection.query(query_embeddings=[test_vec], n_results=1)
        except Exception as e:
            print(f"[RAG INGEST] Dimension mismatch or collection schema change detected ({e}). Rebuilding collection...")
            needs_rebuild = True

    if needs_rebuild and existing_collection is not None:
        print(f"[RAG INGEST] Deleting existing collection '{collection_name}' for clean rebuild...")
        client.delete_collection(collection_name)
        existing_collection = None

    # Get fresh collection reference via get_vector_store
    vs = get_vector_store(reinitialize=True)
    col = vs._collection

    existing_ids = set()
    if not needs_rebuild:
        try:
            existing_data = col.get()
            if existing_data and "ids" in existing_data:
                existing_ids = set(existing_data["ids"])
            print(f"[RAG INGEST] Found {len(existing_ids)} existing records in ChromaDB.")
        except Exception as e:
            print(f"[RAG INGEST] Could not retrieve existing IDs: {e}")

    # Filter out already indexed documents for idempotency
    docs_to_insert = [d for d in docs if d.metadata["doc_id"] not in existing_ids]
    print(f"[RAG INGEST] Documents to insert: {len(docs_to_insert)} (skipped {len(docs) - len(docs_to_insert)} existing).")

    if not docs_to_insert:
        duration = round(time.time() - start_time, 2)
        print(f"--- RAG INGESTION COMPLETE: 0 new documents inserted (all up-to-date) in {duration}s ---")
        return {"status": "success", "total_indexed": col.count(), "new_indexed": 0, "duration": duration}

    # Batch insert into ChromaDB
    total_new = len(docs_to_insert)
    total_batches = (total_new + batch_size - 1) // batch_size
    print(f"[RAG INGEST] Inserting {total_new} chunks in {total_batches} batches of {batch_size}...")

    for i in range(0, total_new, batch_size):
        batch = docs_to_insert[i:i + batch_size]
        batch_ids = [d.metadata["doc_id"] for d in batch]
        batch_num = (i // batch_size) + 1
        print(f"  -> Batch {batch_num}/{total_batches} (chunks {i + 1} to {min(i + batch_size, total_new)})...")
        vs.add_documents(batch, ids=batch_ids)

    duration = round(time.time() - start_time, 2)
    final_count = col.count()
    print(f"--- RAG INGESTION COMPLETED SUCCESSFULLY: {total_new} chunks indexed in {duration}s. Total in ChromaDB: {final_count} ---")
    
    return {
        "status": "success",
        "total_indexed": final_count,
        "new_indexed": total_new,
        "duration": duration
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest travel knowledge into ChromaDB")
    parser.add_argument("--rebuild", action="store_true", help="Delete existing collection and rebuild from scratch")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size for embedding insertion")
    parser.add_argument("--chunk-size", type=int, default=500, help="Document chunk size in characters")
    parser.add_argument("--chunk-overlap", type=int, default=50, help="Document chunk overlap in characters")
    args = parser.parse_args()

    ingest_documents(
        rebuild=args.rebuild,
        batch_size=args.batch_size,
        chunk_size=args.chunk_size,
        chunk_overlap=args.chunk_overlap
    )
