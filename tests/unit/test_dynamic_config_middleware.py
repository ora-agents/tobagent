import pytest
from unittest.mock import MagicMock, patch
from langchain_core.messages import SystemMessage
from src.middleware.dynamic_config_middleware import dynamic_config_middleware

@pytest.mark.anyio
async def test_dynamic_config_middleware_injects_skill_summary():
    # 1. Setup mock database session, agent profile, and skill
    mock_agent_profile = MagicMock()
    mock_agent_profile.id = "agent_123"
    mock_agent_profile.skill_ids = ["skill_abc"]

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
    mock_ctx.enabled_tools = ["rag_search"]
    mock_ctx.model = None
    mock_ctx.user_preferences = ""
    mock_ctx.safety_enabled = False

    mock_request = MagicMock()
    mock_request.runtime.context = mock_ctx
    mock_request.tools = []
    
    # We want to check the override parameters passed to override()
    mock_overridden_request = MagicMock()
    mock_request.override.return_value = mock_overridden_request

    async def mock_handler(req):
        return req

    # Patch SessionLocal and McpPoolManager in the dynamic_config_middleware module
    with patch("src.middleware.dynamic_config_middleware.SessionLocal", return_value=mock_db), \
         patch("src.middleware.dynamic_config_middleware.McpPoolManager.get_tools_for_agent", return_value=[]):
        
        result = await dynamic_config_middleware.awrap_model_call(mock_request, mock_handler)

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
