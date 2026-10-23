import os
from langchain_community.vectorstores import Chroma
from app.ai.rag.embedder import embeddings

# Define the local database directory path
DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), 
    "chromadb_storage"
)

_vector_store_instance = None

def get_vector_store(reinitialize: bool = False) -> Chroma:
    """
    Returns the singleton Chroma vector store instance.
    If reinitialize is True, refreshes the underlying Chroma connection.
    """
    global _vector_store_instance, vector_store
    if reinitialize or _vector_store_instance is None:
        _vector_store_instance = Chroma(
            collection_name="travel_knowledge",
            embedding_function=embeddings,
            persist_directory=DB_PATH
        )
        vector_store = _vector_store_instance
    return _vector_store_instance

# Initialize LangChain's Chroma wrapper singleton for backward compatibility
vector_store = get_vector_store()
