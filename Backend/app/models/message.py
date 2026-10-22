from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime, timezone

def _utcnow():
    return datetime.now(timezone.utc)

class MessageModel(BaseModel):
    message_id: str
    conversation_id: str
    role: str  # user, assistant, system
    content: str
    intent: Optional[str] = None
    structured_data: Optional[Dict[str, Any]] = None
    created_at: datetime = Field(default_factory=_utcnow)
