from fastapi.testclient import TestClient

from src.api.fastapi_app import app


def _payload(user_phone: str = "13800138000") -> dict:
    return {
        "hook": {
            "id": "hook_1782368896641_1",
            "name": "字段 Hook 1",
            "matchType": "value",
            "fieldId": "order_status",
            "conditionLogic": "all",
        },
        "form": {
            "id": "form_id",
            "name": "form_name",
            "category": "category",
        },
        "record": {
            "id": "record_id",
            "formId": "form_id",
            "data": {
                "order_type": "报警",
                "user_name": "用户姓名",
                "user_phone": user_phone,
                "address": "服务地址",
                "order_status": "待接单",
            },
            "fieldValues": {
                "user_phone": user_phone,
            },
            "createdAt": "2026-06-26T00:00:00.000Z",
            "updatedAt": "2026-06-26T00:00:00.000Z",
        },
        "field": {
            "id": "order_status",
            "oldValue": "",
            "newValue": "待接单",
        },
        "conditions": [
            {
                "fieldId": "order_status",
                "matchType": "value",
                "oldValue": "",
                "newValue": "待接单",
                "changed": True,
                "matched": True,
            },
        ],
        "conditionEvent": "form_record_conditions_matched",
        "event": "form_record_field_changed",
    }


def test_form_sms_hook_requires_matching_key(monkeypatch):
    monkeypatch.setenv("SMS_HOOK_KEY", "secret")
    monkeypatch.setenv("ALIYUN_SMS_FORM_HOOK_TEMPLATE_CODE", "SMS_FORM_TEST")
    calls: list[tuple[str, str, dict | None]] = []
    monkeypatch.setattr(
        "src.api.routes.sms_hooks._send_aliyun_template_sms",
        lambda phone, template_code, template_param=None: calls.append((phone, template_code, template_param)),
    )

    with TestClient(app) as client:
        missing = client.post("/api/hooks/form-sms", json=_payload())
        wrong = client.post(
            "/api/hooks/form-sms",
            json=_payload(),
            headers={"SMS-HOOK-KEY": "wrong"},
        )

    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert calls == []


def test_form_sms_hook_sends_template_to_user_phone(monkeypatch):
    monkeypatch.setenv("SMS_HOOK_KEY", "secret")
    monkeypatch.setenv("ALIYUN_SMS_FORM_HOOK_TEMPLATE_CODE", "SMS_FORM_TEST")
    calls: list[tuple[str, str, dict | None]] = []
    monkeypatch.setattr(
        "src.api.routes.sms_hooks._send_aliyun_template_sms",
        lambda phone, template_code, template_param=None: calls.append((phone, template_code, template_param)),
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/hooks/form-sms",
            json=_payload("138 0013-8000"),
            headers={"SMS-HOOK-KEY": "secret"},
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert calls == [("13800138000", "SMS_FORM_TEST", None)]


def test_form_sms_hook_requires_valid_user_phone(monkeypatch):
    monkeypatch.setenv("SMS_HOOK_KEY", "secret")
    monkeypatch.setenv("ALIYUN_SMS_FORM_HOOK_TEMPLATE_CODE", "SMS_FORM_TEST")
    monkeypatch.setattr(
        "src.api.routes.sms_hooks._send_aliyun_template_sms",
        lambda phone, template_code, template_param=None: None,
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/hooks/form-sms",
            json=_payload("not-a-phone"),
            headers={"SMS-HOOK-KEY": "secret"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Valid user_phone is required"
