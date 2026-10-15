import sys
import os
import hashlib

# Add the Backend root directory to the system path so we can import from app
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.ai.rag.chroma_client import vector_store

# Set path to the knowledge folder
KNOWLEDGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "knowledge")

def ingest_documents():
    # 1. Create the knowledge folder if it doesn't exist
    if not os.path.exists(KNOWLEDGE_DIR):
        os.makedirs(KNOWLEDGE_DIR)
        print(f"--- RAG INGESTION: Created knowledge folder at {KNOWLEDGE_DIR} ---")
        print("Please place your travel guide text files (.txt) inside this folder and run again.")
        return

    print("--- RAG INGESTION: Scanning knowledge directory... ---")
    
    # 2. Load all .txt files from the directory using UTF-8 encoding
    loader = DirectoryLoader(
        KNOWLEDGE_DIR, 
        glob="**/*.txt", 
        loader_cls=TextLoader, 
        loader_kwargs={"encoding": "utf-8"}
    )
    try:
        docs = loader.load()
    except Exception as e:
        print(f"Error loading files from knowledge directory: {e}")
        return
    
    if not docs:
        print("No .txt files found in the knowledge directory. Ingestion skipped.")
        return
        
    print(f"Loaded {len(docs)} document files.")
    
    # 3. Split the text into manageable chunks
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    chunks = text_splitter.split_documents(docs)
    print(f"Split documents into {len(chunks)} text chunks.")
    
    # 4. Embed and add to ChromaDB in batches of 100
    print("Embedding and adding chunks to ChromaDB in batches of 100...")
    try:
        batch_size = 100
        total_chunks = len(chunks)
        for i in range(0, total_chunks, batch_size):
            batch = chunks[i:i + batch_size]
            batch_num = (i // batch_size) + 1
            total_batches = (total_chunks + batch_size - 1) // batch_size
            print(f"Processing batch {batch_num}/{total_batches} (Chunks {i} to {min(i + batch_size, total_chunks)})...")
            identities = [hashlib.sha256((doc.metadata.get('source', '') + '\n' + doc.page_content).encode()).hexdigest() for doc in batch]
            vector_store.add_documents(batch, ids=identities)
        print("--- RAG INGESTION: Ingestion completed successfully! ---")
    except Exception as e:
        print(f"Error inserting documents into ChromaDB: {e}")

if __name__ == "__main__":
    ingest_documents()
