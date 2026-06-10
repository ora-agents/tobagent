"""Tests for VoiceAudioLogger."""

from pathlib import Path

from src.utils.voice_audio_logger import VoiceAudioLogger, _int16_bytes_to_wav


def test_voice_audio_logger_disabled(tmp_path: Path):
    """When disabled, VoiceAudioLogger methods should be no-ops."""
    logger = VoiceAudioLogger(
        base_dir=tmp_path,
        enabled=False,
        log_raw=True,
        log_vad=True,
        log_tts=True,
    )

    session_id = logger.new_session()
    assert session_id == ""

    # These should run without error and write nothing
    logger.log_raw_pcm(session_id, b"\x00\x00" * 100)
    logger.log_vad_segment(session_id, b"fake_wav")
    logger.start_tts_accumulation(session_id)
    logger.log_tts_chunk(session_id, "AAAA")  # base64 for zeroes
    logger.flush_tts(session_id)
    logger.end_session(session_id)

    # Base dir shouldn't even exist or should be empty
    assert not any(tmp_path.iterdir())


def test_voice_audio_logger_enabled(tmp_path: Path):
    """When enabled, VoiceAudioLogger should write WAV files to correct locations."""
    logger = VoiceAudioLogger(
        base_dir=tmp_path,
        enabled=True,
        log_raw=True,
        log_vad=True,
        log_tts=True,
    )

    session_id = logger.new_session()
    assert session_id != ""

    session_dir = tmp_path / session_id
    assert session_dir.exists()

    # 1. Log Raw PCM
    raw_pcm = b"\x01\x00\x02\x00" * 400
    logger.log_raw_pcm(session_id, raw_pcm)

    # 2. Log VAD segment
    fake_wav_bytes = _int16_bytes_to_wav(b"\x00\x00" * 100, 16000)
    logger.log_vad_segment(session_id, fake_wav_bytes)

    # 3. Log TTS
    logger.start_tts_accumulation(session_id)
    # base64 for two 16-bit integers (e.g. \x01\x00\x02\x00 is base64 'AQACAQAC')
    import base64
    logger.log_tts_chunk(session_id, base64.b64encode(b"\x01\x00\x02\x00").decode("utf-8"))
    logger.flush_tts(session_id)

    # 4. End Session (which flushes raw)
    logger.end_session(session_id)

    # Check raw file
    raw_path = session_dir / "raw_input.wav"
    assert raw_path.exists()
    assert len(raw_path.read_bytes()) > len(raw_pcm)

    # Check VAD file
    vad_path = session_dir / "vad_000.wav"
    assert vad_path.exists()
    assert vad_path.read_bytes() == fake_wav_bytes

    # Check TTS file
    tts_path = session_dir / "tts_000.wav"
    assert tts_path.exists()


def test_voice_audio_logger_from_env(monkeypatch, tmp_path: Path):
    """VoiceAudioLogger.from_env should correctly respect environment variables."""
    monkeypatch.setenv("VOICE_AUDIO_LOG_ENABLED", "true")
    monkeypatch.setenv("VOICE_AUDIO_LOG_DIR", str(tmp_path))
    monkeypatch.setenv("VOICE_AUDIO_LOG_RAW", "false")
    monkeypatch.setenv("VOICE_AUDIO_LOG_VAD", "true")
    monkeypatch.setenv("VOICE_AUDIO_LOG_TTS", "false")

    logger = VoiceAudioLogger.from_env()
    assert logger.enabled is True
    assert logger.base_dir == tmp_path
    assert logger.log_raw is False
    assert logger.log_vad is True
    assert logger.log_tts is False
