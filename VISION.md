# Spatial workspace and Vision integration

Vision is available in the existing interface through VISION or the OpenAI tools
`activate_vision`, `analyze_vision`, and `stop_vision`. Activation opens a consent
panel; Enable camera grants capture consent. A visual question captures one JPEG
(up to 768 pixels wide) and sends it to the FastAPI snapshot endpoint. The returned
analysis is supplied to the existing OpenAI Realtime tool response for spoken output
and displayed in the Vision panel. No frame is persisted by the application.

The camera manager leases cloned tracks to Vision and MediaPipe from one physical
stream. Closing the Vision panel, stopping capture, or disabling hand tracking
releases that consumer; the final lease stops the physical stream. Stop hand
control before selecting a different camera. Requests have a 28 second browser
limit, a 25 second backend limit, one in-flight request per browser and a three
second sampling interval. The backend bounds encoded input and concurrent calls.

Voice tools also support focus_panel, move_panel, and resize_panel with validated
finite viewport percentages. Existing YouTube, knowledge, model controls, and the
central scene remain in place. Failed model retrieval reports a limitation instead
of synthesizing an unrelated fallback. Ask OpenAI to search for a model based on
the visual description; generic models are not verified digital twins.

## Setup

No new packages. OPENAI_API_KEY stays server-side. Optional
OPENAI_TEXT_MODEL defaults to gpt-4.1-mini; OPENAI_REALTIME_MODEL selects the voice model.
Run npm run dev with the existing Python requirements installed. Camera permission
requires localhost or HTTPS. Enable voice, say activate vision, grant camera
consent, and ask a visual question. Stop vision to release its lease.

## Verification and limitations

Automated backend tests mock OpenAI; they verify request validation and the
multimodal request, not recognition accuracy. Physical camera permission,
disconnection, combined hand tracking, spoken answers, API availability, and
recognition accuracy require manual testing on the target laptop. Network and
regional availability affect OpenAI. Camera images are sent to OpenAI's API
only on requested analysis. ROOH does not persist them; provider policies apply.
The spatial state still uses one panel per content kind. Research and image-viewer
panel types, full collision avoidance, and benchmarking remain future work.
