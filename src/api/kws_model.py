"""KWS (Keyword Spotting) model management using sherpa-onnx.

Downloads the KWS model on first startup, creates a KeywordSpotter singleton,
and provides keyword text-to-phoneme conversion for dynamic keyword streams.

Model: sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20 (Chinese + English)
"""

import logging
import os
import re
import tarfile
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

MODEL_NAME = "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20"
MODEL_URL = (
    f"https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    f"kws-models/{MODEL_NAME}.tar.bz2"
)

# Model variant: chunk-16-left-64 (320ms context, int8 encoder/joiner, fp32 decoder)
ENCODER_NAME = "encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx"
DECODER_NAME = "decoder-epoch-13-avg-2-chunk-16-left-64.onnx"
JOINER_NAME = "joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx"
DEFAULT_KEYWORDS_THRESHOLD = 0.15
DEFAULT_KEYWORDS_SCORE = 1.0


def _get_model_dir() -> Path:
    """Get the model directory from env or default."""
    base = os.getenv("KWS_MODEL_DIR", "./models/kws")
    return Path(base) / MODEL_NAME


def ensure_kws_model() -> Path:
    """Download and extract the KWS model if not already present.

    Returns:
        Path to the extracted model directory.
    """
    model_dir = _get_model_dir()

    # Check if model is already downloaded
    tokens_file = model_dir / "tokens.txt"
    encoder_file = model_dir / ENCODER_NAME
    if tokens_file.exists() and encoder_file.exists():
        logger.info("KWS model already present at %s", model_dir)
        return model_dir

    model_dir.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading KWS model from %s ...", MODEL_URL)

    try:
        with httpx.stream("GET", MODEL_URL, follow_redirects=True, timeout=300) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            downloaded = 0
            chunk_data = bytearray()

            for chunk in resp.iter_bytes(chunk_size=65536):
                chunk_data.extend(chunk)
                downloaded += len(chunk)
                if total > 0:
                    pct = downloaded * 100 // total
                    if downloaded % (1024 * 1024) < 65536:  # log every ~1MB
                        logger.info("KWS model download: %d%%", pct)

        logger.info("Extracting KWS model (%d bytes) ...", len(chunk_data))
        import io

        with tarfile.open(fileobj=io.BytesIO(bytes(chunk_data)), mode="r:bz2") as tar:
            tar.extractall(model_dir.parent)

        if not tokens_file.exists():
            raise RuntimeError(
                f"KWS model extraction failed: tokens.txt not found in {model_dir}"
            )

        logger.info("KWS model ready at %s", model_dir)
        return model_dir

    except Exception:
        logger.exception("Failed to download KWS model")
        raise


def create_kws_spotter(model_dir: Path):
    """Create a KeywordSpotter instance (singleton per process).

    The spotter is thread-safe for creating streams; each stream is
    per-connection and NOT thread-safe.

    Args:
        model_dir: Path to the extracted model directory.

    Returns:
        sherpa_onnx.KeywordSpotter instance.
    """
    import sherpa_onnx

    tokens_file = str(model_dir / "tokens.txt")
    encoder_file = str(model_dir / ENCODER_NAME)
    decoder_file = str(model_dir / DECODER_NAME)
    joiner_file = str(model_dir / JOINER_NAME)

    # Use a minimal keywords_file so the spotter can be created.
    # Actual keywords are passed dynamically per-stream via create_stream().
    # Create a temporary placeholder keywords file with a valid token from
    # the model's vocabulary (AA0 is a standard ARPAbet phoneme token).
    placeholder_kw = model_dir / "_placeholder_keywords.txt"
    if not placeholder_kw.exists():
        placeholder_kw.write_text("AA0 @placeholder\n")

    num_threads = int(os.getenv("KWS_NUM_THREADS", "2"))
    keywords_threshold = float(
        os.getenv("KWS_KEYWORDS_THRESHOLD", str(DEFAULT_KEYWORDS_THRESHOLD))
    )
    keywords_score = float(os.getenv("KWS_KEYWORDS_SCORE", str(DEFAULT_KEYWORDS_SCORE)))

    logger.info(
        "Creating KeywordSpotter (encoder=%s, threads=%d, threshold=%.2f, score=%.2f)",
        ENCODER_NAME,
        num_threads,
        keywords_threshold,
        keywords_score,
    )

    spotter = sherpa_onnx.KeywordSpotter(
        tokens=tokens_file,
        encoder=encoder_file,
        decoder=decoder_file,
        joiner=joiner_file,
        num_threads=num_threads,
        keywords_score=keywords_score,
        keywords_threshold=keywords_threshold,
        keywords_file=str(placeholder_kw),
        provider="cpu",
    )

    return spotter


# ---------------------------------------------------------------------------
# Keyword text-to-phoneme conversion
# ---------------------------------------------------------------------------


class KeywordProcessor:
    """Converts raw keyword text to sherpa-onnx KWS phoneme format.

    Uses the official sherpa_onnx.text2token() function which handles:
    - Chinese text: converted to pinyin using pypinyin (with strict=False)
    - English text: phoneme lookup from the model's en.phone lexicon
    - Mixed text: processed word by word

    The create_stream() method expects keywords in the format:
        "p i n y i n @label/p i n y i n2 @label2"
    """

    def __init__(self, model_dir: Path):
        """Initialize with model directory for lexicon loading."""
        self.model_dir = model_dir
        self.tokens_file = str(model_dir / "tokens.txt")
        self.lexicon_file = str(model_dir / "en.phone")

    @staticmethod
    def _preprocess_keyword(text: str) -> str:
        """Preprocess keyword: convert English words to uppercase, keep Chinese as-is.

        The en.phone lexicon uses uppercase keys (HELLO, HEY, etc.), so English
        words must be uppercase to match. Chinese characters are unchanged.

        Args:
            text: Raw keyword text, e.g., "hey assistant" or "你好 world"

        Returns:
            Preprocessed text, e.g., "HEY ASSISTANT" or "你好 WORLD"
        """
        # CJK(China Japan Korea) unicode range is [U+4E00, U+9FFF]
        pattern = re.compile(r"^[一-鿿]+$")

        words = text.strip().split()
        processed = []
        for word in words:
            # If it's all CJK characters, keep as-is
            if pattern.match(word):
                processed.append(word)
            else:
                # Convert to uppercase for English lexicon lookup
                processed.append(word.upper())

        return " ".join(processed)

    def format_keywords(self, keywords: list[str]) -> str | None:
        """Convert a list of raw keywords to the sherpa-onnx format string.

        Args:
            keywords: List of wake word strings, e.g., ["小梯小梯", "hey assistant"]

        Returns:
            Formatted keywords string for create_stream(), or None if all
            keywords fail to convert.
        """
        if not keywords:
            return None

        try:
            from sherpa_onnx import text2token
        except ImportError:
            logger.error("sherpa_onnx.text2token not available")
            return None

        parts: list[str] = []
        for kw in keywords:
            kw = kw.strip()
            if not kw:
                continue

            # Replace spaces with underscores in the display label
            label = kw.replace(" ", "_")

            try:
                # Preprocess: convert English words to uppercase for lexicon lookup
                processed_kw = self._preprocess_keyword(kw)

                # Use official text2token with phone+ppinyin for mixed Chinese+English
                result = text2token(
                    texts=[processed_kw],
                    tokens=self.tokens_file,
                    tokens_type="phone+ppinyin",
                    lexicon=self.lexicon_file,
                    output_ids=False,
                )

                if result and len(result) > 0:
                    # result is a list of lists of tokens
                    phonemes = " ".join(result[0])
                    parts.append(f"{phonemes} @{label}")
                else:
                    logger.warning("text2token returned empty for keyword '%s', skipping", kw)
            except Exception:
                logger.warning("Failed to convert keyword '%s', skipping", kw, exc_info=True)

        if not parts:
            return None

        return "/".join(parts)
