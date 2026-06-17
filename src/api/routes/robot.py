"""Robot point and command routes."""
# ruff: noqa: D103

import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from src.api.schemas import (
    RobotCommandResultRequest,
    RobotPointListItem,
    RobotPointRequest,
    RobotPointResponse,
)
from src.tools.robot_control_tool import receive_robot_result, register_robot_client
from src.utils.db import RobotPointTable, get_db

router = APIRouter()


@router.post("/api/robot-points", response_model=RobotPointResponse)
async def upsert_robot_point(
    point_data: RobotPointRequest,
    db: Session = Depends(get_db),
):
    point_name = point_data.point_name.strip()
    introduction = point_data.introduction.strip()
    if not point_name:
        raise HTTPException(status_code=400, detail="pointName is required")
    if not introduction:
        raise HTTPException(status_code=400, detail="introduction is required")

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    point = db.query(RobotPointTable).filter(
        RobotPointTable.point_name == point_name,
    ).first()
    if point:
        point.introduction = introduction
        point.x = point_data.x
        point.y = point_data.y
        point.z = point_data.z
        point.rotation = point_data.rotation
        point.position_json = point_data.position_json
        point.robot_sn = point_data.robot_sn
        point.updated_at = now
    else:
        point = RobotPointTable(
            point_name=point_name,
            introduction=introduction,
            x=point_data.x,
            y=point_data.y,
            z=point_data.z,
            rotation=point_data.rotation,
            position_json=point_data.position_json,
            robot_sn=point_data.robot_sn,
            created_at=now,
            updated_at=now,
        )
        db.add(point)

    db.commit()
    db.refresh(point)
    return RobotPointResponse(
        id=point.id,
        pointName=point.point_name,
        createdAt=point.created_at,
        updatedAt=point.updated_at,
    )


@router.get("/api/robot-points", response_model=list[RobotPointListItem])
async def list_robot_points(db: Session = Depends(get_db)):
    points = db.query(RobotPointTable).order_by(RobotPointTable.id.asc()).all()
    return [
        RobotPointListItem(
            id=point.id,
            pointName=point.point_name,
            introduction=point.introduction,
            x=point.x,
            y=point.y,
            z=point.z,
            rotation=point.rotation,
            positionJson=point.position_json,
            robotSn=point.robot_sn,
        )
        for point in points
    ]


@router.put("/api/robot-points/{point_id}", response_model=RobotPointResponse)
async def update_robot_point(
    point_id: int,
    point_data: RobotPointRequest,
    db: Session = Depends(get_db),
):
    point_name = point_data.point_name.strip()
    introduction = point_data.introduction.strip()
    if not point_name:
        raise HTTPException(status_code=400, detail="pointName is required")
    if not introduction:
        raise HTTPException(status_code=400, detail="introduction is required")

    point = db.query(RobotPointTable).filter(RobotPointTable.id == point_id).first()
    if not point:
        raise HTTPException(status_code=404, detail="robot point not found")

    duplicate = db.query(RobotPointTable).filter(
        RobotPointTable.point_name == point_name,
        RobotPointTable.id != point_id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="pointName already exists")

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    point.point_name = point_name
    point.introduction = introduction
    point.x = point_data.x
    point.y = point_data.y
    point.z = point_data.z
    point.rotation = point_data.rotation
    point.position_json = point_data.position_json
    point.robot_sn = point_data.robot_sn
    point.updated_at = now

    db.commit()
    db.refresh(point)
    return RobotPointResponse(
        id=point.id,
        pointName=point.point_name,
        createdAt=point.created_at,
        updatedAt=point.updated_at,
    )


@router.delete("/api/robot-points/{point_id}")
async def delete_robot_point(
    point_id: int,
    db: Session = Depends(get_db),
):
    point = db.query(RobotPointTable).filter(RobotPointTable.id == point_id).first()
    if not point:
        raise HTTPException(status_code=404, detail="robot point not found")

    db.delete(point)
    db.commit()
    return {"status": "success", "message": f"Robot point {point_id} deleted"}


@router.get("/api/robot/sse")
async def robot_sse(clientId: str = "robot-display"):
    async def event_stream():
        async for event in register_robot_client(clientId.strip() or "robot-display"):
            if event.get("type") == "heartbeat":
                yield f": heartbeat {event.get('timestamp')}\n\n"
                continue
            yield f"event: {event.get('type', 'message')}\n"
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/robot/commands/{command_id}/result")
async def robot_command_result(
    command_id: str,
    result_data: RobotCommandResultRequest,
):
    if result_data.command_id != command_id:
        raise HTTPException(status_code=400, detail="commandId mismatch")

    accepted = await receive_robot_result(
        command_id,
        {
            "ok": result_data.ok,
            "message": result_data.message,
            "result": result_data.result or {},
            "error": result_data.error,
            "commandId": command_id,
        },
    )
    return {"ok": accepted}

