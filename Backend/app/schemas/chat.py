from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime

class ChatMessageRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str

class TrackedChatRequest(ChatMessageRequest):
    request_id: str = Field(min_length=16, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')
    message: str = Field(min_length=1, max_length=20000)

class MessagePayload(BaseModel):
    role: str
    content: str

class ChatMessageResponse(BaseModel):
    conversation_id: str
    message: MessagePayload
    intent: str
    travel_context: Dict[str, Any]
    data: Optional[Dict[str, Any]] = None

class ConversationSummaryResponse(BaseModel):
    conversation_id: str
    title: str
    status: str
    updated_at: datetime
    current_trip_id: Optional[str] = None

class ConversationDetailResponse(BaseModel):
    conversation_id: str
    title: str
    status: str
    travel_context: Dict[str, Any]
    current_trip_id: Optional[str] = None
    messages: List[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime
