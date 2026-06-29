"""Tests for Langfuse trace browser helpers."""

from src.api.routes.traces import (
    _extract_observations,
    _may_read_trace,
    _normalize_observation,
    _trace_session_id,
    _trace_user_id,
)


def test_trace_field_helpers_accept_camel_case_langfuse_fields():
    trace = {"userId": "user-1", "sessionId": "thread-1"}

    assert _trace_user_id(trace) == "user-1"
    assert _trace_session_id(trace) == "thread-1"


def test_may_read_trace_accepts_camel_case_user_id():
    trace = {"userId": "user-1"}

    assert _may_read_trace(
        trace,
        current_user_id="user-1",
        owned_shared_thread_ids=set(),
        thread_metadata={},
    )


def test_may_read_trace_accepts_camel_case_visible_session_id():
    trace = {"sessionId": "thread-1"}

    assert _may_read_trace(
        trace,
        current_user_id="user-1",
        owned_shared_thread_ids=set(),
        thread_metadata={"thread-1": {"user_id": "user-1"}},
    )


def test_normalize_observation_accepts_langfuse_v4_camel_case_fields():
    observation = {
        "id": "obs-1",
        "traceId": "trace-1",
        "parentObservationId": "parent-1",
        "startTime": "2026-06-26T10:00:00Z",
        "endTime": "2026-06-26T10:00:01Z",
        "statusMessage": "ok",
        "providedModelName": "gpt-4o",
        "usageDetails": {"input": 1},
        "costDetails": {"total": 0.1},
        "totalCost": 0.1,
    }

    normalized = _normalize_observation(observation)

    assert normalized["trace_id"] == "trace-1"
    assert normalized["parent_observation_id"] == "parent-1"
    assert normalized["start_time"] == "2026-06-26T10:00:00Z"
    assert normalized["end_time"] == "2026-06-26T10:00:01Z"
    assert normalized["status_message"] == "ok"
    assert normalized["provided_model_name"] == "gpt-4o"
    assert normalized["usage_details"] == {"input": 1}
    assert normalized["cost_details"] == {"total": 0.1}
    assert normalized["total_cost"] == 0.1


def test_extract_observations_accepts_paginated_langfuse_response():
    response = {
        "data": [
            {"id": "obs-2", "traceId": "trace-1", "startTime": "2026-06-26T10:00:02Z"},
            {"id": "obs-1", "traceId": "trace-1", "startTime": "2026-06-26T10:00:01Z"},
        ],
        "meta": {"hasNextPage": False},
    }

    observations, meta = _extract_observations(response)

    assert [observation["id"] for observation in observations] == ["obs-1", "obs-2"]
    assert observations[0]["trace_id"] == "trace-1"
    assert meta == {"hasNextPage": False}


def test_extract_observations_accepts_trace_embedded_observations():
    trace = {
        "id": "trace-1",
        "observations": [
            {"id": "obs-1", "traceId": "trace-1", "startTime": "2026-06-26T10:00:01Z"}
        ],
    }

    observations, meta = _extract_observations(trace)

    assert len(observations) == 1
    assert observations[0]["trace_id"] == "trace-1"
    assert meta == {}
