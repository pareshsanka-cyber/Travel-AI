import os
import logging
from typing import List, Optional
from langchain_core.embeddings import Embeddings

logger = logging.getLogger("travelai.embedder")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "nomic-embed-text")
EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "local").lower().strip()


class LocalMiniLMEmbeddings(Embeddings):
    """
    High-performance, fully local embedding implementation using Chroma's
    bundled ONNX all-MiniLM-L6-v2 model (384 dimensions).
    Runs entirely in-process on CPU via ONNXRuntime with zero network dependencies.
    """
    def __init__(self):
        try:
            import chromadb.utils.embedding_functions as ef
            self._fn = ef.DefaultEmbeddingFunction()
        except Exception as e:
            logger.warning("Failed to initialize DefaultEmbeddingFunction: %s", e)
            self._fn = None

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        if not texts or not self._fn:
            return []
        cleaned = [str(t) if t is not None else "" for t in texts]
        raw_vecs = self._fn(cleaned)
        return [[float(x) for x in vec] for vec in raw_vecs]

    def embed_query(self, text: str) -> List[float]:
        if not text or not self._fn:
            return [0.0] * 384
        res = self._fn([str(text)])
        return [float(x) for x in res[0]]


def get_embeddings() -> Embeddings:
    """
    Factory resolving the active embedding model based on EMBEDDING_PROVIDER.
    Defaults to fast, self-contained local ONNX embeddings ('local').
    Can switch to 'ollama' via environment variable.
    """
    if EMBEDDING_PROVIDER == "ollama":
        try:
            from langchain_ollama import OllamaEmbeddings
            return OllamaEmbeddings(
                base_url=OLLAMA_BASE_URL,
                model=OLLAMA_MODEL
            )
        except Exception as e:
            logger.warning("Ollama embeddings unavailable (%s). Falling back to local ONNX embeddings.", e)
            return LocalMiniLMEmbeddings()
            
    return LocalMiniLMEmbeddings()


# Active singleton embedding instance
embeddings = get_embeddings()
