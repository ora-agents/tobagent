"""Tests for keyword spotting audio helpers."""

from src.api import kws_router


class _FakeSpotter:
    def is_ready(self, _stream):
        return False

    def get_result(self, _stream):
        return None


class _FakeStream:
    def __init__(self):
        self.accepted = []

    def accept_waveform(self, sample_rate, samples):
        self.accepted.append((sample_rate, samples))


def test_process_audio_chunk_rejects_malformed_pcm(monkeypatch):
    """KWS should reject malformed PCM before feeding sherpa streams."""
    spotter = _FakeSpotter()
    stream = _FakeStream()

    assert kws_router._process_audio_chunk(spotter, stream, b"\x00") is None
    assert stream.accepted == []

    monkeypatch.setattr(kws_router, "MAX_PCM_CHUNK_BYTES", 4)
    assert (
        kws_router._process_audio_chunk(
            spotter,
            stream,
            b"\x00\x00\x00\x00\x00\x00",
        )
        is None
    )
    assert stream.accepted == []


def test_process_audio_chunk_accepts_valid_pcm():
    """Valid PCM should still be forwarded as normalized float32 samples."""
    spotter = _FakeSpotter()
    stream = _FakeStream()

    assert kws_router._process_audio_chunk(spotter, stream, b"\x00\x40") is None

    assert len(stream.accepted) == 1
    sample_rate, samples = stream.accepted[0]
    assert sample_rate == kws_router.KWS_SAMPLE_RATE
    assert samples.tolist() == [0.5]
