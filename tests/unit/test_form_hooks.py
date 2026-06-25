"""Tests for custom form hook triggering."""

import pytest

from src.utils import form_hooks
from src.utils.db import FormRecordTable, FormTable


class _FakeResponse:
    def raise_for_status(self) -> None:
        return None


class _FakeAsyncClient:
    calls: list[dict] = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def request(self, method, url, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        return _FakeResponse()


@pytest.mark.anyio
async def test_form_hook_triggers_when_changed_field_matches_regex(monkeypatch):
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(form_hooks.httpx, "AsyncClient", _FakeAsyncClient)
    form = FormTable(
        id="form-1",
        owner_user_id="user-1",
        name="Orders",
        category="CRM",
        fields=[],
        hooks=[{
            "id": "hook-1",
            "name": "VIP",
            "enabled": True,
            "fieldId": "customer",
            "matchType": "regex",
            "pattern": "^VIP-",
            "url": "https://example.test/webhook",
            "method": "POST",
            "headers": {"X-Test": "1"},
        }],
        created_at="now",
        updated_at="now",
    )
    record = FormRecordTable(
        id="record-1",
        form_id="form-1",
        owner_user_id="user-1",
        data={"customer": "VIP-001"},
        created_at="now",
        updated_at="now",
    )

    await form_hooks.trigger_form_hooks(form, record, {"customer": "old"}, record.data)

    assert len(_FakeAsyncClient.calls) == 1
    call = _FakeAsyncClient.calls[0]
    assert call["method"] == "POST"
    assert call["url"] == "https://example.test/webhook"
    assert call["headers"] == {"X-Test": "1"}
    assert call["json"]["field"] == {
        "id": "customer",
        "oldValue": "old",
        "newValue": "VIP-001",
    }


@pytest.mark.anyio
async def test_form_hook_triggers_when_select_value_matches(monkeypatch):
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(form_hooks.httpx, "AsyncClient", _FakeAsyncClient)
    form = FormTable(
        id="form-1",
        owner_user_id="user-1",
        name="Orders",
        category="CRM",
        fields=[],
        hooks=[{
            "id": "hook-1",
            "enabled": True,
            "fieldId": "status",
            "matchType": "value",
            "value": "approved",
            "url": "https://example.test/status",
            "method": "PATCH",
        }],
        created_at="now",
        updated_at="now",
    )
    record = FormRecordTable(
        id="record-1",
        form_id="form-1",
        owner_user_id="user-1",
        data={"status": "approved"},
        created_at="now",
        updated_at="now",
    )

    await form_hooks.trigger_form_hooks(form, record, {"status": "pending"}, record.data)

    assert len(_FakeAsyncClient.calls) == 1
    assert _FakeAsyncClient.calls[0]["method"] == "PATCH"


@pytest.mark.anyio
async def test_form_hook_ignores_unchanged_field(monkeypatch):
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(form_hooks.httpx, "AsyncClient", _FakeAsyncClient)
    form = FormTable(
        id="form-1",
        owner_user_id="user-1",
        name="Orders",
        category="CRM",
        fields=[],
        hooks=[{
            "id": "hook-1",
            "enabled": True,
            "fieldId": "status",
            "matchType": "value",
            "value": "approved",
            "url": "https://example.test/status",
            "method": "POST",
        }],
        created_at="now",
        updated_at="now",
    )
    record = FormRecordTable(
        id="record-1",
        form_id="form-1",
        owner_user_id="user-1",
        data={"status": "approved"},
        created_at="now",
        updated_at="now",
    )

    await form_hooks.trigger_form_hooks(form, record, {"status": "approved"}, record.data)

    assert _FakeAsyncClient.calls == []


@pytest.mark.anyio
async def test_form_hook_triggers_when_all_conditions_match(monkeypatch):
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(form_hooks.httpx, "AsyncClient", _FakeAsyncClient)
    form = FormTable(
        id="form-1",
        owner_user_id="user-1",
        name="Orders",
        category="CRM",
        fields=[],
        hooks=[{
            "id": "hook-1",
            "enabled": True,
            "conditionLogic": "all",
            "conditions": [
                {"fieldId": "status", "matchType": "value", "value": "approved"},
                {"fieldId": "customer", "matchType": "regex", "pattern": "^VIP-"},
            ],
            "url": "https://example.test/status",
            "method": "POST",
        }],
        created_at="now",
        updated_at="now",
    )
    record = FormRecordTable(
        id="record-1",
        form_id="form-1",
        owner_user_id="user-1",
        data={"status": "approved", "customer": "VIP-001"},
        created_at="now",
        updated_at="now",
    )

    await form_hooks.trigger_form_hooks(
        form,
        record,
        {"status": "pending", "customer": "VIP-001"},
        record.data,
    )

    assert len(_FakeAsyncClient.calls) == 1
    payload = _FakeAsyncClient.calls[0]["json"]
    assert payload["event"] == "form_record_field_changed"
    assert payload["conditionEvent"] == "form_record_conditions_matched"
    assert payload["hook"]["conditionLogic"] == "all"
    assert payload["conditions"] == [
        {
            "fieldId": "status",
            "matchType": "value",
            "oldValue": "pending",
            "newValue": "approved",
            "changed": True,
            "matched": True,
        },
        {
            "fieldId": "customer",
            "matchType": "regex",
            "oldValue": "VIP-001",
            "newValue": "VIP-001",
            "changed": False,
            "matched": True,
        },
    ]


@pytest.mark.anyio
async def test_form_hook_skips_when_all_condition_fails(monkeypatch):
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(form_hooks.httpx, "AsyncClient", _FakeAsyncClient)
    form = FormTable(
        id="form-1",
        owner_user_id="user-1",
        name="Orders",
        category="CRM",
        fields=[],
        hooks=[{
            "id": "hook-1",
            "enabled": True,
            "conditionLogic": "all",
            "conditions": [
                {"fieldId": "status", "matchType": "value", "value": "approved"},
                {"fieldId": "customer", "matchType": "regex", "pattern": "^VIP-"},
            ],
            "url": "https://example.test/status",
            "method": "POST",
        }],
        created_at="now",
        updated_at="now",
    )
    record = FormRecordTable(
        id="record-1",
        form_id="form-1",
        owner_user_id="user-1",
        data={"status": "approved", "customer": "REG-001"},
        created_at="now",
        updated_at="now",
    )

    await form_hooks.trigger_form_hooks(
        form,
        record,
        {"status": "pending", "customer": "REG-001"},
        record.data,
    )

    assert _FakeAsyncClient.calls == []


@pytest.mark.anyio
async def test_form_hook_triggers_when_any_condition_matches(monkeypatch):
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(form_hooks.httpx, "AsyncClient", _FakeAsyncClient)
    form = FormTable(
        id="form-1",
        owner_user_id="user-1",
        name="Orders",
        category="CRM",
        fields=[],
        hooks=[{
            "id": "hook-1",
            "enabled": True,
            "conditionLogic": "any",
            "conditions": [
                {"fieldId": "status", "matchType": "value", "value": "rejected"},
                {"fieldId": "customer", "matchType": "regex", "pattern": "^VIP-"},
            ],
            "url": "https://example.test/status",
            "method": "PUT",
        }],
        created_at="now",
        updated_at="now",
    )
    record = FormRecordTable(
        id="record-1",
        form_id="form-1",
        owner_user_id="user-1",
        data={"status": "approved", "customer": "VIP-001"},
        created_at="now",
        updated_at="now",
    )

    await form_hooks.trigger_form_hooks(
        form,
        record,
        {"status": "pending", "customer": "VIP-001"},
        record.data,
    )

    assert len(_FakeAsyncClient.calls) == 1
    assert _FakeAsyncClient.calls[0]["method"] == "PUT"


@pytest.mark.anyio
async def test_form_hook_ignores_matching_conditions_when_no_condition_field_changed(monkeypatch):
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(form_hooks.httpx, "AsyncClient", _FakeAsyncClient)
    form = FormTable(
        id="form-1",
        owner_user_id="user-1",
        name="Orders",
        category="CRM",
        fields=[],
        hooks=[{
            "id": "hook-1",
            "enabled": True,
            "conditionLogic": "all",
            "conditions": [
                {"fieldId": "status", "matchType": "value", "value": "approved"},
                {"fieldId": "customer", "matchType": "regex", "pattern": "^VIP-"},
            ],
            "url": "https://example.test/status",
            "method": "POST",
        }],
        created_at="now",
        updated_at="now",
    )
    record = FormRecordTable(
        id="record-1",
        form_id="form-1",
        owner_user_id="user-1",
        data={"status": "approved", "customer": "VIP-001", "note": "changed"},
        created_at="now",
        updated_at="now",
    )

    await form_hooks.trigger_form_hooks(
        form,
        record,
        {"status": "approved", "customer": "VIP-001", "note": "old"},
        record.data,
    )

    assert _FakeAsyncClient.calls == []
