"""Robot control tool backed by saved robot navigation points and SSE clients."""

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from langchain_core.tools import tool

from src.utils.db import RobotPointTable, SessionLocal


@dataclass
class PendingRobotCommand:
    """In-flight robot command waiting for the Android client result."""

    command_id: str
    payload: dict[str, Any]
    future: asyncio.Future[dict[str, Any]]
    created_at: float = field(default_factory=time.monotonic)


_robot_clients: dict[str, asyncio.Queue[dict[str, Any]]] = {}
_pending_commands: dict[str, PendingRobotCommand] = {}
_lock = asyncio.Lock()
ROBOT_SSE_HEARTBEAT_INTERVAL_SECONDS = 25.0


def _format_point(point: RobotPointTable) -> str:
    return (
        f"- id={point.id}, name={point.point_name}, intro={point.introduction}, "
        f"x={point.x}, y={point.y}, rotation={point.rotation}"
    )


def list_robot_points_for_prompt() -> str:
    """Return saved robot points as compact prompt context."""
    db = SessionLocal()
    try:
        points = db.query(RobotPointTable).order_by(RobotPointTable.id.asc()).all()
        if not points:
            return "No robot navigation points are currently saved."
        return "\n".join(_format_point(point) for point in points)
    finally:
        db.close()


async def register_robot_client(client_id: str) -> AsyncIterator[dict[str, Any]]:
    """Register an Android robot client and yield commands for SSE streaming."""
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    async with _lock:
        _robot_clients[client_id] = queue
    try:
        yield {
            "type": "ready",
            "clientId": client_id,
            "timestamp": int(time.time() * 1000),
        }
        while True:
            try:
                yield await asyncio.wait_for(
                    queue.get(),
                    timeout=ROBOT_SSE_HEARTBEAT_INTERVAL_SECONDS,
                )
            except TimeoutError:
                yield {
                    "type": "heartbeat",
                    "clientId": client_id,
                    "timestamp": int(time.time() * 1000),
                }
    finally:
        async with _lock:
            if _robot_clients.get(client_id) is queue:
                _robot_clients.pop(client_id, None)


async def receive_robot_result(command_id: str, result: dict[str, Any]) -> bool:
    """Resolve a pending command from the Android robot result callback."""
    async with _lock:
        pending = _pending_commands.pop(command_id, None)
    if not pending or pending.future.done():
        return False
    pending.future.set_result(result)
    return True


async def _send_robot_command(payload: dict[str, Any], timeout_seconds: float = 60.0) -> dict[str, Any]:
    async with _lock:
        queues = list(_robot_clients.values())
        if not queues:
            return {
                "ok": False,
                "error": "No robot client is connected.",
                "payload": payload,
            }
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        _pending_commands[payload["commandId"]] = PendingRobotCommand(
            command_id=payload["commandId"],
            payload=payload,
            future=future,
        )
        for queue in queues:
            queue.put_nowait(payload)

    try:
        return await asyncio.wait_for(future, timeout=timeout_seconds)
    except TimeoutError:
        async with _lock:
            _pending_commands.pop(payload["commandId"], None)
        return {
            "ok": False,
            "error": f"Robot command timed out after {int(timeout_seconds)} seconds.",
            "payload": payload,
        }


@tool
async def navigate_robot_to_point(point_id: int) -> str:
    """Control the robot to navigate to a saved point by point id."""
    db = SessionLocal()
    try:
        point = db.query(RobotPointTable).filter(RobotPointTable.id == point_id).first()
        if not point:
            return json.dumps(
                {
                    "ok": False,
                    "error": f"Robot point id {point_id} was not found.",
                    "availablePoints": list_robot_points_for_prompt(),
                },
                ensure_ascii=False,
            )

        command = {
            "type": "navigate_to_point",
            "commandId": str(uuid.uuid4()),
            "point": {
                "id": point.id,
                "pointName": point.point_name,
                "introduction": point.introduction,
                "x": point.x,
                "y": point.y,
                "z": point.z,
                "rotation": point.rotation,
                "positionJson": point.position_json,
                "robotSn": point.robot_sn,
            },
            "timestamp": int(time.time() * 1000),
        }
    finally:
        db.close()

    result = await _send_robot_command(command)
    return json.dumps(result, ensure_ascii=False)
