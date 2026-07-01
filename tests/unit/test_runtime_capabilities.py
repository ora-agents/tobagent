from fastapi.testclient import TestClient

from src.api.fastapi_app import app


def test_runtime_capabilities_disable_missing_env(monkeypatch):
    for name in (
        "ALIYUN_ACCESS_KEY_ID",
        "ALIYUN_ACCESS_KEY_SECRET",
        "ALIYUN_SMS_SIGN_NAME",
        "ALIYUN_SMS_TEMPLATE_CODE",
        "SMS_DEV_LOG_CODE",
        "LANGFUSE_PUBLIC_KEY",
        "LANGFUSE_SECRET_KEY",
    ):
        monkeypatch.delenv(name, raising=False)

    with TestClient(app) as client:
        response = client.get("/api/capabilities")

    assert response.status_code == 200
    assert response.json() == {"smsAuth": False, "langfuseTracing": False}


def test_runtime_capabilities_enable_configured_modules(monkeypatch):
    monkeypatch.setenv("ALIYUN_ACCESS_KEY_ID", "ak")
    monkeypatch.setenv("ALIYUN_ACCESS_KEY_SECRET", "secret")
    monkeypatch.setenv("ALIYUN_SMS_SIGN_NAME", "sign")
    monkeypatch.setenv("ALIYUN_SMS_TEMPLATE_CODE", "SMS_TEST")
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-lf-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-lf-test")

    with TestClient(app) as client:
        response = client.get("/api/capabilities")

    assert response.status_code == 200
    assert response.json() == {"smsAuth": True, "langfuseTracing": True}
