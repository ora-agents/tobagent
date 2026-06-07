import asyncio

from src.api import fastapi_app


class _FakeModelResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeAsyncClient:
    calls = 0

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return None

    async def get(self, url, headers):
        type(self).calls += 1
        return _FakeModelResponse(
            {
                "data": [
                    {"id": f"model-{type(self).calls}"},
                ]
            }
        )


def test_list_models_reuses_cached_upstream_response(monkeypatch):
    fastapi_app.clear_model_list_cache()
    _FakeAsyncClient.calls = 0
    monkeypatch.setenv("OPENAI_COMPATIBLE_BASE_URL", "https://models.example/v1")
    monkeypatch.setenv("OPENAI_COMPATIBLE_API_KEY", "test-key")
    monkeypatch.setenv("MODEL_LIST_CACHE_TTL_SECONDS", "300")
    monkeypatch.setattr(fastapi_app.httpx, "AsyncClient", _FakeAsyncClient)

    try:
        first = asyncio.run(fastapi_app.list_models())
        second = asyncio.run(fastapi_app.list_models())
    finally:
        fastapi_app.clear_model_list_cache()

    assert _FakeAsyncClient.calls == 1
    assert first == {"data": [{"id": "model-1"}]}
    assert second == first


def test_clear_model_list_cache_forces_refetch(monkeypatch):
    fastapi_app.clear_model_list_cache()
    _FakeAsyncClient.calls = 0
    monkeypatch.setenv("OPENAI_COMPATIBLE_BASE_URL", "https://models.example/v1")
    monkeypatch.setenv("OPENAI_COMPATIBLE_API_KEY", "test-key")
    monkeypatch.setenv("MODEL_LIST_CACHE_TTL_SECONDS", "300")
    monkeypatch.setattr(fastapi_app.httpx, "AsyncClient", _FakeAsyncClient)

    try:
        first = asyncio.run(fastapi_app.list_models())
        fastapi_app.clear_model_list_cache()
        second = asyncio.run(fastapi_app.list_models())
    finally:
        fastapi_app.clear_model_list_cache()

    assert _FakeAsyncClient.calls == 2
    assert first == {"data": [{"id": "model-1"}]}
    assert second == {"data": [{"id": "model-2"}]}
