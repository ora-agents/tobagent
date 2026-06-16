from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import SystemMessage

from src.middleware.dynamic_config_middleware import (
    _role_behavior_instructions,
    dynamic_config_middleware,
)


def test_role_behavior_instructions_can_disable_persona_and_boundary():
    instructions = _role_behavior_instructions(
        {
            "role_template_id": "sales_qa",
            "persona_style": "off",
            "boundary_mode": "off",
        }
    )

    assert instructions == ""


def test_role_behavior_instructions_can_disable_only_persona():
    instructions = _role_behavior_instructions(
        {
            "role_template_id": "sales_qa",
            "persona_style": "off",
            "boundary_mode": "knowledge_only",
        }
    )

    assert "Persona:" not in instructions
    assert "Boundary:" in instructions
    assert "Role template: sales_qa." in instructions


@pytest.mark.anyio
async def test_dynamic_config_middleware_injects_skill_summary():
    # 1. Setup mock database session, agent profile, and skill
    mock_agent_profile = MagicMock()
    mock_agent_profile.id = "agent_123"
    mock_agent_profile.name = "Test Agent"
    mock_agent_profile.description = "Agent used in dynamic config tests"
    mock_agent_profile.system_prompt = "You are a helpful assistant."
    mock_agent_profile.enabled_tools = []
    mock_agent_profile.skill_ids = ["skill_abc"]
    mock_agent_profile.agent_ids = []
    mock_agent_profile.updated_at = ""

    mock_skill = MagicMock()
    mock_skill.id = "skill_abc"
    mock_skill.name = "Test Skill"
    mock_skill.description = "A skill to test full content injection"
    mock_skill.content = "Step 1: Do something.\nStep 2: Done."

    mock_db = MagicMock()
    # Chain filtering for agent profile
    mock_db.query.return_value.filter.return_value.first.side_effect = [mock_agent_profile, mock_skill]
    # Chain filtering for skills list query
    mock_db.query.return_value.filter.return_value.all.return_value = [mock_skill]

    # 2. Mock request and handler
    mock_ctx = MagicMock()
    mock_ctx.system_prompt = "You are a helpful assistant."
    mock_ctx.agent_id = "agent_123"
    mock_ctx.user_id = "user_123"
    mock_ctx.enabled_tools = ["rag_search"]
    mock_ctx.model = None
    mock_ctx.user_preferences = ""
    mock_ctx.safety_enabled = False

    rag_tool = SimpleNamespace(name="rag_search")
    read_skill_tool = SimpleNamespace(name="read_skill")

    mock_request = MagicMock()
    mock_request.runtime.context = mock_ctx
    mock_request.tools = [rag_tool, read_skill_tool]
    
    # We want to check the override parameters passed to override()
    mock_overridden_request = MagicMock()
    mock_request.override.return_value = mock_overridden_request

    async def mock_handler(req):
        return req

    # Patch SessionLocal and McpPoolManager in the dynamic_config_middleware module
    with patch("src.middleware.dynamic_config_middleware.SessionLocal", return_value=mock_db), \
         patch("src.middleware.dynamic_config_middleware.McpPoolManager.get_tools_for_agent", return_value=[]):
        
        await dynamic_config_middleware.awrap_model_call(mock_request, mock_handler)

        # Ensure request.override was called with updated system_message
        mock_request.override.assert_called_once()
        kwargs = mock_request.override.call_args[1]
        
        assert "system_message" in kwargs
        system_msg = kwargs["system_message"]
        assert isinstance(system_msg, SystemMessage)
        
        content = system_msg.content
        # Assertions to ensure linked skills are advertised without inlining full content.
        assert "You are a helpful assistant." in content
        assert "- **Test Skill**: A skill to test full content injection" in content
        assert 'Use `read_skill(skill_name="<name>")`' in content
        assert "Step 1: Do something.\nStep 2: Done." not in content
        assert kwargs["tools"] == [read_skill_tool]


@pytest.mark.anyio
async def test_dynamic_config_middleware_removes_read_skill_without_linked_skills():
    mock_agent_profile = MagicMock()
    mock_agent_profile.id = "agent_without_skills"
    mock_agent_profile.name = "Support Agent"
    mock_agent_profile.description = "Support questions"
    mock_agent_profile.system_prompt = "Profile prompt"
    mock_agent_profile.enabled_tools = ["rag_search", "read_skill"]
    mock_agent_profile.skill_ids = []
    mock_agent_profile.agent_ids = []

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_agent_profile

    rag_tool = SimpleNamespace(name="rag_search")
    read_skill_tool = SimpleNamespace(name="read_skill")

    mock_ctx = SimpleNamespace(
        agent_id="agent_without_skills",
        user_id="user_123",
        system_prompt="Runtime default prompt",
        enabled_tools=["rag_search", "read_skill"],
        model=None,
        user_preferences="",
        safety_enabled=False,
        model_fields_set={"agent_id"},
    )

    mock_request = MagicMock()
    mock_request.runtime.context = mock_ctx
    mock_request.tools = [rag_tool, read_skill_tool]
    mock_request.override.return_value = mock_request

    async def mock_handler(req):
        return req

    with patch("src.middleware.dynamic_config_middleware.SessionLocal", return_value=mock_db), \
         patch("src.middleware.dynamic_config_middleware.McpPoolManager.get_tools_for_agent", return_value=[]):
        await dynamic_config_middleware.awrap_model_call(mock_request, mock_handler)

    kwargs = mock_request.override.call_args[1]
    assert kwargs["tools"] == [rag_tool]


@pytest.mark.anyio
async def test_dynamic_config_middleware_loads_profile_defaults_from_agent_id():
    mock_agent_profile = MagicMock()
    mock_agent_profile.id = "agent_123"
    mock_agent_profile.name = "Support Agent"
    mock_agent_profile.description = "Support questions"
    mock_agent_profile.system_prompt = "Profile prompt"
    mock_agent_profile.enabled_tools = ["rag_search"]
    mock_agent_profile.skill_ids = []
    mock_agent_profile.agent_ids = []

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_agent_profile

    rag_tool = SimpleNamespace(name="rag_search")
    fetch_tool = SimpleNamespace(name="fetch")

    mock_ctx = SimpleNamespace(
        agent_id="agent_123",
        user_id="user_123",
        system_prompt="Runtime default prompt",
        enabled_tools=["fetch"],
        model=None,
        user_preferences="",
        safety_enabled=False,
        model_fields_set={"agent_id"},
    )

    mock_request = MagicMock()
    mock_request.runtime.context = mock_ctx
    mock_request.tools = [rag_tool, fetch_tool]
    mock_request.override.return_value = mock_request

    async def mock_handler(req):
        return req

    with patch("src.middleware.dynamic_config_middleware.SessionLocal", return_value=mock_db), \
         patch("src.middleware.dynamic_config_middleware.McpPoolManager.get_tools_for_agent", return_value=[]):
        await dynamic_config_middleware.awrap_model_call(mock_request, mock_handler)

    kwargs = mock_request.override.call_args[1]
    assert kwargs["system_message"].content == "Profile prompt"
    assert kwargs["tools"] == [rag_tool]


@pytest.mark.anyio
async def test_dynamic_config_middleware_falls_back_to_config_user_id():
    """Aegra injects auth user_id into config.configurable, not run context."""
    mock_agent_profile = MagicMock()
    mock_agent_profile.id = "agent_123"
    mock_agent_profile.name = "Support Agent"
    mock_agent_profile.description = "Support questions"
    mock_agent_profile.system_prompt = "Profile prompt"
    mock_agent_profile.enabled_tools = ["rag_search"]
    mock_agent_profile.skill_ids = []
    mock_agent_profile.agent_ids = []

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_agent_profile

    rag_tool = SimpleNamespace(name="rag_search")
    fetch_tool = SimpleNamespace(name="fetch")

    mock_ctx = SimpleNamespace(
        agent_id="agent_123",
        user_id="",
        system_prompt="Runtime default prompt",
        enabled_tools=["fetch"],
        model=None,
        user_preferences="",
        safety_enabled=False,
        model_fields_set={"agent_id"},
    )

    mock_request = MagicMock()
    mock_request.runtime.context = mock_ctx
    mock_request.tools = [rag_tool, fetch_tool]
    mock_request.override.return_value = mock_request

    async def mock_handler(req):
        return req

    with patch("src.middleware.dynamic_config_middleware.SessionLocal", return_value=mock_db), \
         patch("src.middleware.dynamic_config_middleware.McpPoolManager.get_tools_for_agent", return_value=[]), \
         patch("src.middleware.dynamic_config_middleware.get_runtime_context_value", return_value="user_123"):
        await dynamic_config_middleware.awrap_model_call(mock_request, mock_handler)

    kwargs = mock_request.override.call_args[1]
    assert kwargs["system_message"].content == "Profile prompt"
    assert kwargs["tools"] == [rag_tool]


@pytest.mark.anyio
async def test_dynamic_config_middleware_falls_back_to_thread_owner():
    mock_agent_profile = MagicMock()
    mock_agent_profile.id = "agent_123"
    mock_agent_profile.name = "Support Agent"
    mock_agent_profile.description = "Support questions"
    mock_agent_profile.system_prompt = "Profile prompt"
    mock_agent_profile.enabled_tools = ["rag_search"]
    mock_agent_profile.skill_ids = []
    mock_agent_profile.agent_ids = []

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_agent_profile

    rag_tool = SimpleNamespace(name="rag_search")
    fetch_tool = SimpleNamespace(name="fetch")

    mock_ctx = SimpleNamespace(
        agent_id="agent_123",
        user_id="",
        system_prompt="Runtime default prompt",
        enabled_tools=["fetch"],
        model=None,
        user_preferences="",
        safety_enabled=False,
        model_fields_set={"agent_id"},
    )

    mock_request = MagicMock()
    mock_request.runtime.context = mock_ctx
    mock_request.tools = [rag_tool, fetch_tool]
    mock_request.override.return_value = mock_request

    async def mock_handler(req):
        return req

    with patch("src.middleware.dynamic_config_middleware.SessionLocal", return_value=mock_db), \
         patch("src.middleware.dynamic_config_middleware.McpPoolManager.get_tools_for_agent", return_value=[]), \
         patch("src.middleware.dynamic_config_middleware.get_runtime_context_value", return_value=""), \
         patch("src.middleware.dynamic_config_middleware._get_current_config_metadata", return_value={"thread_id": "thread_123"}), \
         patch("src.middleware.dynamic_config_middleware._load_thread_owner_user_id", return_value="user_123"):
        await dynamic_config_middleware.awrap_model_call(mock_request, mock_handler)

    kwargs = mock_request.override.call_args[1]
    assert kwargs["system_message"].content == "Profile prompt"
    assert kwargs["tools"] == [rag_tool]


@pytest.mark.anyio
async def test_dynamic_config_middleware_request_config_overrides_profile_defaults():
    mock_agent_profile = MagicMock()
    mock_agent_profile.id = "agent_123"
    mock_agent_profile.name = "Support Agent"
    mock_agent_profile.description = "Support questions"
    mock_agent_profile.system_prompt = "Profile prompt"
    mock_agent_profile.enabled_tools = ["rag_search"]
    mock_agent_profile.skill_ids = []
    mock_agent_profile.agent_ids = []

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_agent_profile

    rag_tool = SimpleNamespace(name="rag_search")
    fetch_tool = SimpleNamespace(name="fetch")

    mock_ctx = SimpleNamespace(
        agent_id="agent_123",
        user_id="user_123",
        system_prompt="Request prompt",
        enabled_tools=["fetch"],
        model=None,
        user_preferences="",
        safety_enabled=False,
        model_fields_set={"agent_id", "system_prompt", "enabled_tools"},
    )

    mock_request = MagicMock()
    mock_request.runtime.context = mock_ctx
    mock_request.tools = [rag_tool, fetch_tool]
    mock_request.override.return_value = mock_request

    async def mock_handler(req):
        return req

    with patch("src.middleware.dynamic_config_middleware.SessionLocal", return_value=mock_db), \
         patch("src.middleware.dynamic_config_middleware.McpPoolManager.get_tools_for_agent", return_value=[]):
        await dynamic_config_middleware.awrap_model_call(mock_request, mock_handler)

    kwargs = mock_request.override.call_args[1]
    assert kwargs["system_message"].content == "Request prompt"
    assert kwargs["tools"] == [fetch_tool]


@pytest.mark.anyio
async def test_dynamic_config_middleware_uses_profile_model_when_request_omits_model():
    mock_agent_profile = MagicMock()
    mock_agent_profile.id = "agent_123"
    mock_agent_profile.name = "Support Agent"
    mock_agent_profile.description = "Support questions"
    mock_agent_profile.system_prompt = "Profile prompt"
    mock_agent_profile.model = "qwen-plus"
    mock_agent_profile.enabled_tools = ["rag_search"]
    mock_agent_profile.skill_ids = []
    mock_agent_profile.agent_ids = []

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_agent_profile

    mock_ctx = SimpleNamespace(
        agent_id="agent_123",
        user_id="user_123",
        system_prompt="Runtime default prompt",
        enabled_tools=["fetch"],
        model="",
        user_preferences="",
        safety_enabled=False,
        model_fields_set={"agent_id"},
    )

    mock_request = MagicMock()
    mock_request.runtime.context = mock_ctx
    mock_request.tools = [SimpleNamespace(name="rag_search")]
    mock_request.override.return_value = mock_request

    async def mock_handler(req):
        return req

    with patch("src.middleware.dynamic_config_middleware.SessionLocal", return_value=mock_db), \
         patch("src.middleware.dynamic_config_middleware.McpPoolManager.get_tools_for_agent", return_value=[]), \
         patch("src.middleware.dynamic_config_middleware.ChatOpenAI") as chat_openai:
        await dynamic_config_middleware.awrap_model_call(mock_request, mock_handler)

    chat_openai.assert_called_once()
    assert chat_openai.call_args.kwargs["model"] == "qwen-plus"
    assert mock_request.override.call_args.kwargs["model"] == chat_openai.return_value


@pytest.mark.anyio
async def test_dynamic_config_middleware_request_model_overrides_profile_model():
    mock_agent_profile = MagicMock()
    mock_agent_profile.id = "agent_123"
    mock_agent_profile.name = "Support Agent"
    mock_agent_profile.description = "Support questions"
    mock_agent_profile.system_prompt = "Profile prompt"
    mock_agent_profile.model = "qwen-plus"
    mock_agent_profile.enabled_tools = ["rag_search"]
    mock_agent_profile.skill_ids = []
    mock_agent_profile.agent_ids = []

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_agent_profile

    mock_ctx = SimpleNamespace(
        agent_id="agent_123",
        user_id="user_123",
        system_prompt="Runtime default prompt",
        enabled_tools=["fetch"],
        model="gpt-4o-mini",
        user_preferences="",
        safety_enabled=False,
        model_fields_set={"agent_id", "model"},
    )

    mock_request = MagicMock()
    mock_request.runtime.context = mock_ctx
    mock_request.tools = [SimpleNamespace(name="rag_search")]
    mock_request.override.return_value = mock_request

    async def mock_handler(req):
        return req

    with patch("src.middleware.dynamic_config_middleware.SessionLocal", return_value=mock_db), \
         patch("src.middleware.dynamic_config_middleware.McpPoolManager.get_tools_for_agent", return_value=[]), \
         patch("src.middleware.dynamic_config_middleware.ChatOpenAI") as chat_openai:
        await dynamic_config_middleware.awrap_model_call(mock_request, mock_handler)

    chat_openai.assert_called_once()
    assert chat_openai.call_args.kwargs["model"] == "gpt-4o-mini"


@pytest.mark.anyio
async def test_dynamic_config_middleware_resolves_mcp_tool_call_by_name():
    mcp_tool = SimpleNamespace(name="create_order")

    mock_ctx = SimpleNamespace(
        agent_id="agent_123",
        user_id="user_123",
    )

    mock_request = MagicMock()
    mock_request.runtime.context = mock_ctx
    mock_request.tool_call = {"name": "create_order"}

    mock_overridden_request = MagicMock()
    mock_request.override.return_value = mock_overridden_request

    async def mock_handler(req):
        return req

    with patch(
        "src.middleware.dynamic_config_middleware.McpPoolManager.get_tools_for_agent",
        return_value=[mcp_tool],
    ):
        result = await dynamic_config_middleware.awrap_tool_call(
            mock_request,
            mock_handler,
        )

    mock_request.override.assert_called_once_with(tool=mcp_tool)
    assert result == mock_overridden_request


@pytest.mark.anyio
async def test_dynamic_config_middleware_resolves_mcp_tool_call_from_thread_owner():
    """SDK tool execution may not preserve context.user_id; recover it from the thread."""
    mcp_tool = SimpleNamespace(name="create_order")

    mock_ctx = SimpleNamespace(
        agent_id="agent_123",
        user_id="",
    )

    mock_request = MagicMock()
    mock_request.runtime.context = mock_ctx
    mock_request.tool_call = {"name": "create_order"}

    mock_overridden_request = MagicMock()
    mock_request.override.return_value = mock_overridden_request

    async def mock_handler(req):
        return req

    with patch(
        "src.middleware.dynamic_config_middleware.McpPoolManager.get_tools_for_agent",
        return_value=[mcp_tool],
    ) as get_tools, \
        patch(
            "src.middleware.dynamic_config_middleware.get_runtime_context_value",
            return_value="",
        ), \
        patch(
            "src.middleware.dynamic_config_middleware._get_current_config_metadata",
            return_value={"thread_id": "thread_123"},
        ), \
        patch(
            "src.middleware.dynamic_config_middleware._load_thread_owner_user_id",
            return_value="user_123",
        ):
        result = await dynamic_config_middleware.awrap_tool_call(
            mock_request,
            mock_handler,
        )

    get_tools.assert_called_once_with("agent_123", "user_123")
    mock_request.override.assert_called_once_with(tool=mcp_tool)
    assert result == mock_overridden_request
