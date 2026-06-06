from fastapi.testclient import TestClient

from src.api.fastapi_app import app


def test_agent_profiles_preflight_allows_deployed_frontend_origin():
    client = TestClient(app)

    response = client.options(
        "/api/agent-profiles",
        headers={
            "Origin": "https://wsrtob.s.odn.cc",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://wsrtob.s.odn.cc"
    assert response.headers["access-control-allow-credentials"] == "true"
