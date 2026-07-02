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
        "DASHSCOPE_API_KEY",
        "VOICE_SPEAKER_VERIFICATION_ENABLED",
    ):
        monkeypatch.delenv(name, raising=False)

    with TestClient(app) as client:
        response = client.get("/api/capabilities")

    assert response.status_code == 200
    data = response.json()
    assert data["smsAuth"] is False
    assert data["langfuseTracing"] is False
    assert data["modules"]["auth.sms"]["enabled"] is False
    assert data["modules"]["observability.langfuse"]["enabled"] is False
    assert data["modules"]["voice.asr"]["enabled"] is False
    assert data["modules"]["voice.tts"]["enabled"] is False
    assert data["modules"]["voice.speakerVerification"]["enabled"] is False
    assert data["modules"]["core.database"]["enabled"] is True
    assert data["modules"]["agent.mcp"]["enabled"] is True


def test_runtime_capabilities_enable_configured_modules(monkeypatch):
    monkeypatch.setenv("ALIYUN_ACCESS_KEY_ID", "ak")
    monkeypatch.setenv("ALIYUN_ACCESS_KEY_SECRET", "secret")
    monkeypatch.setenv("ALIYUN_SMS_SIGN_NAME", "sign")
    monkeypatch.setenv("ALIYUN_SMS_TEMPLATE_CODE", "SMS_TEST")
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-lf-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-lf-test")
    monkeypatch.setenv("OPENAI_COMPATIBLE_BASE_URL", "https://models.example/v1")
    monkeypatch.setenv("OPENAI_COMPATIBLE_API_KEY", "sk-test")
    monkeypatch.setenv("DASHSCOPE_API_KEY", "dashscope-test")
    monkeypatch.setenv("VOICE_SPEAKER_VERIFICATION_ENABLED", "true")

    with TestClient(app) as client:
        response = client.get("/api/capabilities")

    assert response.status_code == 200
    data = response.json()
    assert data["smsAuth"] is True
    assert data["langfuseTracing"] is True
    assert data["modules"]["auth.sms"]["enabled"] is True
    assert data["modules"]["observability.langfuse"]["enabled"] is True
    assert data["modules"]["core.model"]["enabled"] is True
    assert data["modules"]["models.proxy"]["enabled"] is True
    assert data["modules"]["knowledge.rag"]["enabled"] is True
    assert data["modules"]["voice.asr"]["enabled"] is True
    assert data["modules"]["voice.tts"]["enabled"] is True
    assert data["modules"]["voice.speakerVerification"]["enabled"] is True
    assert "OPENAI_COMPATIBLE_API_KEY" in data["modules"]["core.model"]["requiredEnv"]
