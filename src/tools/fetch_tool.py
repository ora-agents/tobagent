"""HTTP fetch tool for generic agent."""
import logging

import httpx
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

_TIMEOUT = 15
_MAX_CONTENT = 20_000  # chars to return


@tool
def fetch(url: str) -> str:
    """Fetch the content of a URL.

    Args:
        url: URL to fetch (http or https).

    Returns:
        The text content of the response (truncated to 20 000 chars).
    """
    try:
        with httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as client:
            resp = client.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; AgentBot/1.0)"})
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            text = resp.text
            if len(text) > _MAX_CONTENT:
                text = text[:_MAX_CONTENT] + "\n...[truncated]"
            return f"URL: {url}\nContent-Type: {content_type}\n\n{text}"
    except httpx.HTTPStatusError as e:
        return f"HTTP {e.response.status_code} error fetching {url}"
    except Exception as e:
        logger.error(f"Fetch failed for {url}: {e}")
        return f"Failed to fetch {url}: {e}"
