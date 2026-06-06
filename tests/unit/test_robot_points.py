from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api.fastapi_app import app
from src.utils.db import Base, RobotPointTable, get_db


def test_upsert_robot_point():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        payload = {
            "pointName": "front-desk",
            "introduction": "Front desk point",
            "x": 1.0,
            "y": 2.0,
            "z": 0.0,
            "rotation": 90.0,
            "positionJson": {"x": 1.0, "y": 2.0, "z": 0.0, "rotation": 90.0},
            "robotSn": "robot-1",
        }

        response = client.post("/api/robot-points", json=payload)

        assert response.status_code == 200
        point_id = response.json()["id"]
        assert point_id == 1

        payload["introduction"] = "Updated front desk point"
        payload["x"] = 3.0
        response = client.post("/api/robot-points", json=payload)

        assert response.status_code == 200
        assert response.json()["id"] == point_id

        response = client.get("/api/robot-points")

        assert response.status_code == 200
        assert response.json() == [
            {
                "id": point_id,
                "pointName": "front-desk",
                "introduction": "Updated front desk point",
                "x": 3.0,
                "y": 2.0,
                "z": 0.0,
                "rotation": 90.0,
                "positionJson": {"x": 1.0, "y": 2.0, "z": 0.0, "rotation": 90.0},
                "robotSn": "robot-1",
            }
        ]

        update_payload = {
            "pointName": "front-desk-renamed",
            "introduction": "Renamed front desk point",
            "x": 4.0,
            "y": 5.0,
            "z": 0.0,
            "rotation": 180.0,
            "positionJson": {"x": 4.0, "y": 5.0, "z": 0.0, "rotation": 180.0},
            "robotSn": "robot-2",
        }
        response = client.put(f"/api/robot-points/{point_id}", json=update_payload)

        assert response.status_code == 200
        assert response.json()["id"] == point_id
        assert response.json()["pointName"] == "front-desk-renamed"

        duplicate_payload = {
            "pointName": "meeting-room",
            "introduction": "Meeting room point",
            "x": 6.0,
            "y": 7.0,
            "z": 0.0,
            "rotation": 45.0,
            "positionJson": {"x": 6.0, "y": 7.0, "z": 0.0, "rotation": 45.0},
            "robotSn": "robot-2",
        }
        response = client.post("/api/robot-points", json=duplicate_payload)

        assert response.status_code == 200
        duplicate_id = response.json()["id"]

        duplicate_payload["pointName"] = "front-desk-renamed"
        response = client.put(f"/api/robot-points/{duplicate_id}", json=duplicate_payload)

        assert response.status_code == 409

        response = client.delete(f"/api/robot-points/{point_id}")

        assert response.status_code == 200

        response = client.get("/api/robot-points")

        assert response.status_code == 200
        assert [point["id"] for point in response.json()] == [duplicate_id]

        response = client.delete(f"/api/robot-points/{point_id}")

        assert response.status_code == 404

        db = TestingSessionLocal()
        try:
            rows = db.query(RobotPointTable).all()
            assert len(rows) == 1
            assert rows[0].point_name == "meeting-room"
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()
