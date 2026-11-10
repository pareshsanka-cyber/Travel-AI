FROM python:3.10-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Copy ChromaDB storage if it exists (optional; will be rebuilt on first ingest)
COPY chromadb_storage/ ./chromadb_storage/

EXPOSE 8000

# --workers 1 required for reroute V2 in-memory state to work correctly
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
