"""Internal speaker embedding service backed by SpeechBrain."""

from __future__ import annotations

import base64
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

MODEL_SOURCE = os.environ.get(
    "VOICE_SPEAKER_PROFILE_MODEL_SOURCE",
    "speechbrain/spkrec-ecapa-voxceleb",
)
MODEL_DIR = os.environ.get(
    "VOICE_SPEAKER_PROFILE_MODEL_DIR",
    "/app/models/speechbrain-spkrec-ecapa-voxceleb",
)
MAX_SAMPLES = int(os.environ.get("SPEAKER_MAX_SAMPLES", str(16000 * 30)))

app = FastAPI(title="Tobagent Speaker Service")
_classifier: Any | None = None


class EmbedRequest(BaseModel):
    """Base64-encoded float32 mono PCM samples."""

    samples: str
    sample_rate: int = 16000


class EmbedResponse(BaseModel):
    """Normalized speaker embedding."""

    embedding: list[float]


def _device() -> str:
    """Return a SpeechBrain-compatible torch device string."""
    if torch.cuda.is_available():
        return f"cuda:{torch.cuda.current_device()}"
    return "cpu"


def _classifier_instance() -> Any:
    """Load SpeechBrain ECAPA-TDNN once and reuse it across requests."""
    global _classifier
    if _classifier is not None:
        return _classifier

    try:
        from speechbrain.inference.speaker import EncoderClassifier
    except ImportError:
        from speechbrain.pretrained import EncoderClassifier

    Path(MODEL_DIR).mkdir(parents=True, exist_ok=True)
    _classifier = EncoderClassifier.from_hparams(
        source=MODEL_SOURCE,
        savedir=MODEL_DIR,
        run_opts={"device": _device()},
    )
    return _classifier


def _decode_samples(value: str) -> np.ndarray:
    """Decode base64 float32 samples."""
    try:
        raw = base64.b64decode(value)
    except Exception as exc:
        raise ValueError(f"Invalid base64 samples: {exc}") from exc

    if len(raw) % 4 != 0:
        raise ValueError("Float32 sample payload length must be divisible by 4")

    samples = np.frombuffer(raw, dtype=np.float32)
    if len(samples) == 0:
        raise ValueError("Audio sample payload is empty")
    if len(samples) > MAX_SAMPLES:
        raise ValueError(f"Audio sample payload is too large: {len(samples)} samples")
    if not np.all(np.isfinite(samples)):
        raise ValueError("Audio sample payload contains invalid values")
    return samples


@app.get("/health")
def health() -> dict[str, str]:
    """Return service health without forcing model load."""
    return {"status": "ok"}


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest) -> EmbedResponse:
    """Return a normalized speaker embedding for mono float32 PCM audio."""
    if request.sample_rate != 16000:
        raise HTTPException(status_code=400, detail="Only 16kHz audio is supported")

    try:
        samples = _decode_samples(request.samples)
        waveform = torch.from_numpy(samples.copy()).float().unsqueeze(0)
        classifier = _classifier_instance()
        embedding = classifier.encode_batch(waveform, wav_lens=None)
        embedding = F.normalize(embedding.squeeze(), dim=0)
        values = embedding.detach().cpu().numpy().astype(np.float32)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to compute speaker embedding")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compute speaker embedding: {exc}",
        ) from exc

    return EmbedResponse(embedding=values.astype(float).tolist())
