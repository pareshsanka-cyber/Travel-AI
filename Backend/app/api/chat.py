from fastapi import APIRouter, HTTPException, Header, Depends
from typing import List, Optional
from app.schemas.chat import (
    ChatMessageRequest,
    ChatMessageResponse,
    ConversationSummaryResponse,
    ConversationDetailResponse
)
from app.services.chat_service import process_chat_message
from app.services.conversation_service import (
    get_conversation,
    get_conversation_messages,
    list_conversations,
    delete_conversation
)

from app.utils.auth_utils import require_user_id

router = APIRouter(prefix="/api/chat", tags=["Chat"])

from app.schemas.chat import TrackedChatRequest, RetryChatRequest
from app.services import planning_progress

@router.post('/requests', status_code=202)
def start_tracked_request(request: TrackedChatRequest, owner: str = Depends(require_user_id)):
    if not request.message.strip():
        raise HTTPException(status_code=400, detail='Message content cannot be empty.')
    return planning_progress.create_request(owner, request.request_id, request.message.strip(), request.conversation_id)

@router.get('/requests/{request_id}')
def tracked_request_status(request_id: str, owner: str = Depends(require_user_id)):
    return planning_progress.get_request(owner, request_id)

@router.post('/requests/{request_id}/retry', status_code=202)
def retry_tracked_request(request_id: str, request: RetryChatRequest, owner: str = Depends(require_user_id)):
    return planning_progress.retry_request(owner, request_id, request.attempt_id)

@router.post("/message", response_model=ChatMessageResponse)
def send_chat_message(request: ChatMessageRequest, x_user_id: str = Depends(require_user_id)):
    if not request.message or not request.message.strip():
        raise HTTPException(status_code=400, detail="Message content cannot be empty.")
    
    try:
        response_data = process_chat_message(
            conversation_id=request.conversation_id,
            user_message=request.message.strip(),
            user_id=x_user_id
        )
        return response_data
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error processing chat message: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process chat message: {str(e)}")

@router.get("/conversations", response_model=List[ConversationSummaryResponse])
def get_conversations_list(x_user_id: str = Depends(require_user_id)):
    try:
        convs = list_conversations(user_id=x_user_id)
        return convs
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list conversations: {str(e)}")

@router.get("/conversations/{id}", response_model=ConversationDetailResponse)
def get_conversation_detail(id: str, user_id: str = Depends(require_user_id)):
    conv = get_conversation(id, user_id=user_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    messages = get_conversation_messages(id)
    return {
        "conversation_id": conv.conversation_id,
        "title": conv.title,
        "status": conv.status,
        "travel_context": conv.travel_context.model_dump(),
        "current_trip_id": conv.current_trip_id,
        "messages": messages,
        "created_at": conv.created_at,
        "updated_at": conv.updated_at
    }

@router.delete("/conversations/{id}")
def remove_conversation(id: str, user_id: str = Depends(require_user_id)):
    success = delete_conversation(id, user_id=user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted", "conversation_id": id}
