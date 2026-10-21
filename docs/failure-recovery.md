# Planning failure recovery

Planning failures remain visible in chat until the traveler opens a saved trip, retries an eligible failure or returns to edit the request. Original preferences and the message remain associated with the owned request.

| Situation | Recovery |
|---|---|
| Connection lost while checking progress | Bounded backoff, then **Check status** and **API Settings**. Returning online or to the visible tab checks the existing request. |
| Temporary AI/provider failure | **Retry saved request**, subject to a server-side eligibility check. |
| Provider rate limit | Show the server-provided retry time and disable retry until it passes; the server enforces the wait too. |
| Invalid dates, budget or schedule | Show the validation explanation and **Return to planning** with the original message available for editing. |
| Provider credentials need attention | Explain that administrator action is needed; do not repeatedly retry the same configuration. |
| Itinerary saved before a later failure | Offer **View saved trip**. Do not generate another itinerary through retry. |
| Server restart or stale work | Preserve the interrupted request for review; do not automatically replay potentially unfinished work. |
| A previously observed request record disappears | Do not silently submit it again. Ask the traveler to review saved trips first. |

The recovery card includes a request reference. It stops the composer's planning indicator after a failure, while preventing another submission until the request is resolved. Returning to planning restores keyboard focus to the composer. If the traveler was following the latest messages, the recovery controls are brought into view; reading older messages is respected.

## Safe retry contract

`POST /api/chat/requests/{request_id}/retry` accepts only `{ "attempt_id": "a-stable-client-reference" }`.

- Authenticate the owner and re-read the saved request.
- Permit only terminal failures known to be safe to replay, with no already-saved itinerary.
- Reject unknown edit outcomes, active work, interrupted work, invalid constraints and configuration problems.
- Enforce provider cooldowns and a maximum of three explicit retries per request.
- Atomically claim the attempt. Duplicate clicks, lost acknowledgements and refresh use the same attempt ID and cannot run it twice.
- Reuse the original server-saved message, conversation and planning request key. The browser cannot substitute a new price, schedule or entitlement in the retry payload.
- Retain bounded failure history. Do not insert another copy of the original user message.
- Run planning again; this is not checkpoint-based resumption of individual agent stages. Existing saved-trip idempotency remains in force.

The frontend checks status before submitting a saved retry command. It never automatically chooses a fresh retry attempt ID on a connection-restored event. Terminal error responses with a message remain recovery states, rather than being treated as successful chat responses.

## Verification

- Backend request tests cover eligibility, ownership, tampering, repeated and concurrent retry clicks, cooldowns, retry limits, partial saves and conversation reuse.
- Frontend tests cover terminal errors, uncertain POST acknowledgements, observed missing requests, retry refresh and owner-scoped recovery storage.
- Desktop/mobile browser tests exercise persistent summaries, retry, refresh, constraint review, saved-trip opening, keyboard focus and online recovery.
- A manual live check used a temporary account and a controlled initial failure. The actual HTTP retry ran the configured planning pipeline, reused its conversation, kept one user message and saved one itinerary. Missing provider results remained warnings. Only that account's test records were removed afterward.

This feature does not add a distributed job queue, automatic payment retries, automatic schedule changes or automatic recovery of interrupted Python execution. Legacy synchronous chat remains available. Restart the backend to load the new retry route if development reload is disabled.
