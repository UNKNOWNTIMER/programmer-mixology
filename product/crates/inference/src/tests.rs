use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
};
fn candidates() -> Vec<CandidateSummary> {
    vec![CandidateSummary {
        candidate_id: "abcdef123456".into(),
        family: "sour".into(),
        ingredient_ids: vec!["gin".into(), "lime".into(), "simple_syrup".into()],
    }]
}
fn valid() -> String {
    r#"{"candidate_id":"abcdef123456","name_zh":"像素青柠","name_en":"Pixel Lime"}"#.into()
}
#[test]
fn valid_names_preserve_candidate() {
    assert_eq!(
        validate_choice(&valid(), &candidates())
            .unwrap()
            .candidate_id,
        "abcdef123456"
    );
}
#[test]
fn doses_permissions_and_calories_are_rejected() {
    for extra in [
        "\"dose\":300",
        "\"kcal\":0",
        "\"approved\":true",
        "\"tools\":[\"shell\"]",
    ] {
        let raw = valid().replace("}", &format!(",{extra}}}"));
        assert!(validate_choice(&raw, &candidates()).is_err());
    }
}
#[test]
fn malformed_unknown_duplicate_and_marked_up_choice_fail() {
    for raw in [
        "{}".to_string(),
        valid().replace("abcdef123456", "000000000000"),
        valid().replace("像素青柠", "<img src=x>"),
        valid().replace("Pixel Lime", "Pixel\\u001bLime"),
        valid().replace("Pixel Lime", "\\u202eLime"),
        valid().replace("Pixel Lime", &"x".repeat(81)),
        valid().replace("\"name_en\":", "\"name_en\":\"duplicate\",\"name_en\":"),
    ] {
        assert!(validate_choice(&raw, &candidates()).is_err(), "{raw}");
    }
}
#[test]
fn oversized_empty_and_unknown_fields_rejected() {
    assert!(validate_choice(&"x".repeat(8193), &candidates()).is_err());
    assert!(validate_choice(&valid().replace("Pixel Lime", "   "), &candidates()).is_err());
    assert!(validate_choice(&valid(), &[]).is_err());
}
#[test]
fn duplicate_or_malicious_candidate_list_is_rejected() {
    let mut list = candidates();
    list.push(list[0].clone());
    assert!(rule_fallback(&list, None).is_err());
    let mut list = candidates();
    list[0].ingredient_ids[0] = "<script>".into();
    assert!(rule_fallback(&list, None).is_err());
}
#[test]
fn fallback_is_deterministic_unreviewed_and_without_fabricated_metrics() {
    let a = rule_fallback(&candidates(), None).unwrap();
    let b = rule_fallback(&candidates(), None).unwrap();
    assert_eq!(a.choice, b.choice);
    assert_eq!(a.candidate_set_sha256, b.candidate_set_sha256);
    assert!(!a.model_used);
    assert!(!a.guest_orderable);
    assert_eq!(a.review_status, "requires_bartender_review");
    assert_eq!(a.attempts, 0);
}
fn config() -> LocalModelConfig {
    LocalModelConfig {
        executable: PathBuf::from("C:/missing/llama-server.exe"),
        gguf: PathBuf::from("C:/missing/model.gguf"),
        executable_sha256: "0".repeat(64),
        gguf_sha256: "0".repeat(64),
        model_id: "reviewed-local".into(),
        reviewed_build: "pinned-test".into(),
        model_license: "test-fixture-only".into(),
        explicit_user_approval: false,
        context_tokens: 4096,
        gpu_layers: 0,
        threads: 2,
        startup_timeout_seconds: 2,
        request_timeout_seconds: 2,
    }
}
#[test]
fn no_approval_never_attempts_file_or_process_operations() {
    assert!(matches!(
        ManagedModel::start(config()),
        Err(InferenceError::NotApproved)
    ));
}
#[test]
fn startup_can_be_cancelled_before_any_file_or_process_operations() {
    assert!(matches!(
        ManagedModel::start_cancellable(config(), Arc::new(AtomicBool::new(true))),
        Err(InferenceError::Cancelled)
    ));
}
#[test]
fn checksum_work_observes_cancellation() {
    let file = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(file.path(), vec![1u8; 1024 * 1024]).unwrap();
    assert!(matches!(
        sha256_file_cancellable(file.path(), Some(&AtomicBool::new(true))),
        Err(InferenceError::Cancelled)
    ));
}
#[test]
fn checked_local_files_require_correct_hashes_and_gguf_header() {
    let d = tempfile::tempdir().unwrap();
    let exe = d.path().join("llama-server.exe");
    let model = d.path().join("model.gguf");
    std::fs::write(&exe, b"not executed fixture").unwrap();
    std::fs::write(&model, b"GGUF-test fixture not a model").unwrap();
    let mut c = config();
    c.explicit_user_approval = true;
    c.executable = exe.clone();
    c.gguf = model.clone();
    assert!(matches!(
        validate_config(&c),
        Err(InferenceError::HashMismatch)
    ));
    c.executable_sha256 = sha256_file(&exe).unwrap();
    c.gguf_sha256 = sha256_file(&model).unwrap();
    assert!(validate_config(&c).is_ok());
    std::fs::write(&model, b"BAD!").unwrap();
    assert!(matches!(
        validate_config(&c),
        Err(InferenceError::InvalidConfiguration("GGUF magic"))
    ));
}
#[test]
fn arbitrary_executable_and_relative_path_are_rejected() {
    let mut c = config();
    c.explicit_user_approval = true;
    c.executable = PathBuf::from("powershell.exe");
    assert!(matches!(
        validate_config(&c),
        Err(InferenceError::InvalidConfiguration(_))
    ));
}
#[test]
fn structured_request_contains_only_allowed_ids_and_no_tools() {
    let p = payload(&candidates(), "test");
    assert_eq!(
        p["response_format"]["json_schema"]["schema"]["properties"]["candidate_id"]["enum"],
        json!(["abcdef123456"])
    );
    assert!(p.get("tools").is_none());
    assert_eq!(p["max_tokens"], 256);
}
fn server(response: String) -> (String, thread::JoinHandle<String>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let join = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut all = Vec::new();
        let mut part = [0u8; 8192];
        loop {
            let n = socket.read(&mut part).unwrap();
            if n == 0 {
                break;
            }
            all.extend_from_slice(&part[..n]);
            if let Some(pos) = all.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&all[..pos]);
                let size = headers
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if all.len() >= pos + 4 + size {
                    break;
                }
            }
        }
        socket.write_all(response.as_bytes()).unwrap();
        String::from_utf8_lossy(&all).into_owned()
    });
    (url, join)
}
#[test]
fn real_loopback_http_contract_uses_bearer_and_validates_response() {
    let body = json!({"choices":[{"message":{"content":valid()}}]}).to_string();
    let(url,join)=server(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body));
    let result = request_choice(
        &url,
        "test-only-token",
        &payload(&candidates(), "test"),
        &candidates(),
        Duration::from_secs(2),
    )
    .unwrap();
    assert_eq!(result.name_zh, "像素青柠");
    let request = join.join().unwrap();
    assert!(request
        .to_ascii_lowercase()
        .contains("authorization: bearer test-only-token"));
    assert!(request.starts_with("POST /v1/chat/completions"));
}
#[test]
fn redirect_does_not_trigger_a_second_endpoint_request() {
    let(url,join)=server("HTTP/1.1 302 Found\r\nLocation: http://192.0.2.1/forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into());
    assert!(matches!(
        request_choice(
            &url,
            "test",
            &payload(&candidates(), "test"),
            &candidates(),
            Duration::from_secs(2)
        ),
        Err(InferenceError::HttpStatus)
    ));
    join.join().unwrap();
}
#[test]
fn oversized_response_rejected_before_body_read() {
    let (url, join) =
        server("HTTP/1.1 200 OK\r\nContent-Length: 9999999\r\nConnection: close\r\n\r\n".into());
    assert!(matches!(
        request_choice(
            &url,
            "test",
            &payload(&candidates(), "test"),
            &candidates(),
            Duration::from_secs(2)
        ),
        Err(InferenceError::InvalidOutput("response too large"))
    ));
    join.join().unwrap();
}
#[test]
fn tool_call_envelope_is_rejected() {
    let body = json!({"choices":[{"message":{"content":valid(),"tool_calls":[{"name":"exec"}]}}]})
        .to_string();
    let (url, join) = server(format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    ));
    assert!(matches!(
        request_choice(
            &url,
            "test",
            &payload(&candidates(), "test"),
            &candidates(),
            Duration::from_secs(2)
        ),
        Err(InferenceError::InvalidOutput("model tool calls forbidden"))
    ));
    join.join().unwrap();
}
#[test]
fn slow_local_endpoint_is_bounded_by_request_timeout() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = thread::spawn(move || {
        let (_socket, _) = listener.accept().unwrap();
        thread::sleep(Duration::from_millis(200));
    });
    let start = Instant::now();
    assert!(matches!(
        request_choice(
            &url,
            "test",
            &payload(&candidates(), "test"),
            &candidates(),
            Duration::from_millis(50)
        ),
        Err(InferenceError::Timeout)
    ));
    assert!(start.elapsed() < Duration::from_secs(1));
    task.join().unwrap();
}
