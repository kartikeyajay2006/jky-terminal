use crate::types::StreamEvent;

/// Incremental Server-Sent Events decoder for the Anthropic Messages stream.
///
/// Holds a buffer because network chunks do not align to frame boundaries —
/// a chunk routinely ends in the middle of a JSON object.
#[derive(Default)]
pub struct SseDecoder {
    buffer: String,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed a chunk, get back every event that completed within it.
    pub fn push(&mut self, chunk: &str) -> Vec<StreamEvent> {
        // Normalise line endings once so frame splitting has a single shape
        // to look for rather than three.
        self.buffer.push_str(&chunk.replace("\r\n", "\n"));

        let mut events = Vec::new();
        while let Some(idx) = self.buffer.find("\n\n") {
            let frame: String = self.buffer.drain(..idx + 2).collect();
            if let Some(event) = decode_frame(&frame) {
                events.push(event);
            }
        }
        events
    }
}

fn decode_frame(frame: &str) -> Option<StreamEvent> {
    // The `event:` line duplicates the `type` field inside the payload, so the
    // payload alone is enough and there is one place to get it wrong.
    let data = frame
        .lines()
        .find_map(|line| line.strip_prefix("data:"))?
        .trim();

    if data.is_empty() || data == "[DONE]" {
        return None;
    }

    let value: serde_json::Value = serde_json::from_str(data).ok()?;

    match value.get("type")?.as_str()? {
        "content_block_start" => {
            let block = value.get("content_block")?;
            if block.get("type")?.as_str()? != "tool_use" {
                return None;
            }
            Some(StreamEvent::ToolUseStart {
                id: block.get("id")?.as_str()?.to_string(),
                name: block.get("name")?.as_str()?.to_string(),
            })
        }
        "content_block_delta" => {
            let delta = value.get("delta")?;
            match delta.get("type")?.as_str()? {
                "text_delta" => Some(StreamEvent::TextDelta(
                    delta.get("text")?.as_str()?.to_string(),
                )),
                "input_json_delta" => Some(StreamEvent::ToolInputDelta(
                    delta.get("partial_json")?.as_str()?.to_string(),
                )),
                _ => None,
            }
        }
        "content_block_stop" => Some(StreamEvent::BlockStop),
        "message_delta" => Some(StreamEvent::Done {
            stop_reason: value
                .get("delta")?
                .get("stop_reason")?
                .as_str()
                .unwrap_or("end_turn")
                .to_string(),
        }),
        "error" => Some(StreamEvent::Error(
            value
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown provider error")
                .to_string(),
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::StreamEvent;

    fn decode(input: &str) -> Vec<StreamEvent> {
        SseDecoder::new().push(input)
    }

    #[test]
    fn a_text_delta_becomes_a_text_event() {
        let events = decode(
            "event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\n",
        );
        assert_eq!(events, vec![StreamEvent::TextDelta("Hi".into())]);
    }

    #[test]
    fn a_frame_split_across_chunks_is_reassembled() {
        // Network chunks do not respect frame boundaries. Splitting mid-JSON
        // is the normal case, not an edge case.
        let mut d = SseDecoder::new();
        assert!(d.push("event: content_block_delta\ndata: {\"type\":\"content_bl").is_empty());
        let events = d.push(
            "ock_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"ok\"}}\n\n",
        );
        assert_eq!(events, vec![StreamEvent::TextDelta("ok".into())]);
    }

    #[test]
    fn several_frames_in_one_chunk_all_decode() {
        let events = decode(
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"a\"}}\n\n\
             data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"b\"}}\n\n",
        );
        assert_eq!(
            events,
            vec![StreamEvent::TextDelta("a".into()), StreamEvent::TextDelta("b".into())]
        );
    }

    #[test]
    fn a_tool_use_block_start_is_reported_with_its_id_and_name() {
        let events = decode(
            "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_7\",\"name\":\"read_file\",\"input\":{}}}\n\n",
        );
        assert_eq!(
            events,
            vec![StreamEvent::ToolUseStart { id: "toolu_7".into(), name: "read_file".into() }]
        );
    }

    #[test]
    fn tool_argument_fragments_are_surfaced_for_accumulation() {
        let events = decode(
            "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"pa\"}}\n\n",
        );
        assert_eq!(events, vec![StreamEvent::ToolInputDelta("{\"pa".into())]);
    }

    #[test]
    fn a_text_block_start_emits_nothing() {
        // Only tool blocks need announcing; a text block start carries no
        // information the caller does not already have.
        assert!(decode(
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n"
        )
        .is_empty());
    }

    #[test]
    fn block_stop_is_reported_so_tool_arguments_can_be_parsed() {
        assert_eq!(
            decode("data: {\"type\":\"content_block_stop\",\"index\":1}\n\n"),
            vec![StreamEvent::BlockStop]
        );
    }

    #[test]
    fn the_stop_reason_arrives_with_message_delta() {
        assert_eq!(
            decode("data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"}}\n\n"),
            vec![StreamEvent::Done { stop_reason: "tool_use".into() }]
        );
    }

    #[test]
    fn a_ping_is_ignored() {
        assert!(decode("event: ping\ndata: {\"type\":\"ping\"}\n\n").is_empty());
    }

    #[test]
    fn a_stream_error_frame_becomes_an_error_event() {
        let events = decode(
            "data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n",
        );
        assert_eq!(events, vec![StreamEvent::Error("Overloaded".into())]);
    }

    #[test]
    fn the_done_sentinel_is_ignored() {
        assert!(decode("data: [DONE]\n\n").is_empty());
    }

    #[test]
    fn malformed_json_is_skipped_rather_than_aborting_the_stream() {
        // One bad frame must not kill a response that is otherwise fine.
        let events = decode(
            "data: {not json\n\n\
             data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"ok\"}}\n\n",
        );
        assert_eq!(events, vec![StreamEvent::TextDelta("ok".into())]);
    }

    #[test]
    fn crlf_line_endings_decode_the_same_as_lf() {
        let events = decode(
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"x\"}}\r\n\r\n",
        );
        assert_eq!(events, vec![StreamEvent::TextDelta("x".into())]);
    }
}
