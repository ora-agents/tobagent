"""OpenTelemetry helpers for voice latency observability."""

from __future__ import annotations

import logging
import os
import time
from base64 import b64encode
from typing import Any

logger = logging.getLogger(__name__)

_INITIALIZED = False


def _langfuse_base_url() -> str | None:
    base_url = os.environ.get("LANGFUSE_BASE_URL", "").strip()
    return base_url.rstrip("/") if base_url else None


def _traces_endpoint() -> str | None:
    endpoint = (
        os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
        or os.environ.get("LANGFUSE_OTEL_ENDPOINT")
        or os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
    )
    if not endpoint:
        base_url = _langfuse_base_url()
        if base_url:
            endpoint = f"{base_url}/api/public/otel"
    if not endpoint:
        return None

    endpoint = endpoint.rstrip("/")
    if endpoint.endswith("/v1/traces"):
        return endpoint
    return f"{endpoint}/v1/traces"


def _langfuse_headers() -> dict[str, str] | None:
    if (
        os.environ.get("OTEL_EXPORTER_OTLP_HEADERS")
        or os.environ.get("OTEL_EXPORTER_OTLP_TRACES_HEADERS")
    ):
        return None

    public_key = os.environ.get("LANGFUSE_PUBLIC_KEY", "").strip()
    secret_key = os.environ.get("LANGFUSE_SECRET_KEY", "").strip()
    if not public_key or not secret_key:
        return None

    auth = b64encode(f"{public_key}:{secret_key}".encode("utf-8")).decode("ascii")
    return {
        "Authorization": f"Basic {auth}",
        "x-langfuse-ingestion-version": "4",
    }


def _otel_available() -> bool:
    try:
        import opentelemetry.trace  # noqa: F401

        return True
    except Exception:
        return False


def init_voice_telemetry() -> None:
    """Initialize OTLP tracing when configured.

    Set ``OTEL_EXPORTER_OTLP_ENDPOINT`` to a collector, or use the existing
    ``LANGFUSE_BASE_URL``/``LANGFUSE_PUBLIC_KEY``/``LANGFUSE_SECRET_KEY`` vars.
    """
    global _INITIALIZED
    if _INITIALIZED:
        return
    _INITIALIZED = True

    if not _otel_available():
        logger.info("Voice telemetry disabled: OpenTelemetry packages are not installed")
        return

    endpoint = _traces_endpoint()
    if not endpoint:
        logger.info("Voice telemetry disabled: no OTLP endpoint configured")
        return

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        service_name = os.environ.get("OTEL_SERVICE_NAME", "tobagent-backend")
        provider = TracerProvider(
            resource=Resource.create({"service.name": service_name})
        )
        headers = _langfuse_headers()
        exporter = OTLPSpanExporter(endpoint=endpoint, headers=headers)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
        logger.info("Voice telemetry enabled: endpoint=%s service=%s", endpoint, service_name)
    except Exception as exc:
        logger.warning("Voice telemetry initialization failed: %s", exc, exc_info=True)


def get_voice_tracer():
    """Return the voice tracer, or a no-op tracer when OTEL is unavailable."""
    if not _otel_available():
        return None
    from opentelemetry import trace

    return trace.get_tracer("tobagent.voice")


def context_from_traceparent(traceparent: str | None):
    """Extract an OpenTelemetry context from a W3C traceparent string."""
    if not traceparent or not _otel_available():
        return None

    try:
        from opentelemetry.propagate import extract

        return extract({"traceparent": traceparent})
    except Exception:
        return None


def event_time_ns(timestamp_ms: float | int | None) -> int:
    """Convert an epoch-millisecond timestamp to nanoseconds."""
    if timestamp_ms is None:
        return time.time_ns()
    try:
        return int(float(timestamp_ms) * 1_000_000)
    except (TypeError, ValueError):
        return time.time_ns()


def flatten_attributes(prefix: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Build primitive span attributes from a nested event payload."""
    attrs: dict[str, Any] = {}
    for key, value in payload.items():
        if isinstance(value, str | int | float | bool):
            attrs[f"{prefix}.{key}"] = value
    return attrs


def record_voice_event(
    *,
    name: str,
    voice_session_id: str | None = None,
    traceparent: str | None = None,
    timestamp_ms: float | int | None = None,
    attributes: dict[str, Any] | None = None,
) -> bool:
    """Record one short voice event span."""
    tracer = get_voice_tracer()
    if tracer is None:
        return False

    context = context_from_traceparent(traceparent)
    start_time = event_time_ns(timestamp_ms)
    end_time = max(start_time + 1_000_000, time.time_ns())
    attrs = attributes.copy() if attributes else {}
    if voice_session_id:
        attrs["voice.session_id"] = voice_session_id
        attrs["langfuse.session.id"] = voice_session_id

    try:
        span = tracer.start_span(name, context=context, start_time=start_time)
        for key, value in attrs.items():
            if isinstance(value, str | int | float | bool):
                span.set_attribute(key, value)
        span.end(end_time=end_time)
        return True
    except Exception as exc:
        logger.debug("Failed to record voice telemetry event: %s", exc)
        return False
