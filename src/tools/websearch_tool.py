"""Tavily web search tool for generic agent."""
import os
import logging

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


@tool
def websearch(query: str) -> str:
    """Search the web for current information using Tavily.

    Args:
        query: Search query string.

    Returns:
        Search results as formatted text.
    """
    api_key = os.getenv("TAVILY_API_KEY", "")
    if not api_key:
        return "Web search unavailable: TAVILY_API_KEY not configured."

    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=api_key)
        response = client.search(query=query, max_results=5)
        results = response.get("results", [])
        if not results:
            return "No results found."

        lines = []
        for r in results:
            title = r.get("title", "")
            url = r.get("url", "")
            content = r.get("content", "")
            lines.append(f"**{title}**\n{url}\n{content}\n")
        return "\n---\n".join(lines)
    except Exception as e:
        logger.error(f"Web search failed: {e}")
        return f"Web search failed: {e}"
