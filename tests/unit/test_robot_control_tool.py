import asyncio

from src.tools import robot_control_tool
from src.tools.robot_control_tool import register_robot_client


def test_register_robot_client_yields_heartbeat_when_idle(monkeypatch):
    monkeypatch.setattr(
        robot_control_tool,
        "ROBOT_SSE_HEARTBEAT_INTERVAL_SECONDS",
        0.01,
    )

    async def collect_events():
        stream = register_robot_client("robot-test")
        try:
            ready = await anext(stream)
            heartbeat = await asyncio.wait_for(anext(stream), timeout=1.0)
            return ready, heartbeat
        finally:
            await stream.aclose()

    ready, heartbeat = asyncio.run(collect_events())

    assert ready["type"] == "ready"
    assert ready["clientId"] == "robot-test"
    assert heartbeat["type"] == "heartbeat"
    assert heartbeat["clientId"] == "robot-test"
