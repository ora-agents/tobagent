"""Short-lived inspection and import-job registries."""
# ruff: noqa: D101,D103

import time
from dataclasses import dataclass, field
from threading import Lock

INSPECTION_TTL_SECONDS = 15 * 60


@dataclass
class InspectionEntry:
    owner_user_id: str
    payload: dict
    documents: dict[str, bytes]
    created_at: float = field(default_factory=time.monotonic)


@dataclass
class ImportJob:
    id: str
    owner_user_id: str
    resource_type: str
    resource_id: str
    status: str = "pending"
    processed_documents: int = 0
    total_documents: int = 0
    error: str | None = None


_inspections: dict[str, InspectionEntry] = {}
_jobs: dict[str, ImportJob] = {}
_lock = Lock()


def put_inspection(inspection_id: str, entry: InspectionEntry) -> None:
    with _lock:
        _inspections[inspection_id] = entry


def get_inspection(inspection_id: str, owner_user_id: str) -> InspectionEntry | None:
    with _lock:
        entry = _inspections.get(inspection_id)
        if not entry or entry.owner_user_id != owner_user_id:
            return None
        if time.monotonic() - entry.created_at > INSPECTION_TTL_SECONDS:
            _inspections.pop(inspection_id, None)
            return None
        return entry


def delete_inspection(inspection_id: str) -> None:
    with _lock:
        _inspections.pop(inspection_id, None)


def put_job(job: ImportJob) -> None:
    with _lock:
        _jobs[job.id] = job


def get_job(job_id: str, owner_user_id: str) -> ImportJob | None:
    with _lock:
        job = _jobs.get(job_id)
        return job if job and job.owner_user_id == owner_user_id else None
