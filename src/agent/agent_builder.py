"""System agent-builder graph for conversational configuration management."""

import logging

from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware
from pydantic import BaseModel, Field

from src.agent.config import (
    DEFAULT_MODEL,
    chat_model,
    model_retry_middleware,
    tool_retry_middleware,
)
from src.middleware.dynamic_config_middleware import dynamic_config_middleware
from src.prompts.context_summary_prompt import context_summary_prompt
from src.tools.agent_builder_tool import agent_builder_tools

logger = logging.getLogger(__name__)


class AgentBuilderContext(BaseModel):
    """Runtime context for the system agent-builder graph."""

    agent_id: str = Field(default="default", description="Builder profile ID.")
    user_id: str = Field(default="", description="Authenticated account ID.")
    model: str = Field(default="", description="Model name override.")
    system_prompt: str = Field(default="", description="Optional builder prompt override.")
    enabled_tools: list[str] = Field(default_factory=list, description="Optional builder tool allow-list.")
    user_preferences: str = Field(default="", description="User preference text.")
    safety_enabled: bool = Field(default=False, description="Confirm sensitive actions when true.")


agent_builder_prompt = """你是系统自带的平台智能体。

职责：
- 通过对话帮助用户创建、修改、检查和关联所有 Agent 配置。
- 覆盖角色/Agent Profile、技能、知识库、表单、MCP 服务端，以及这些资源之间的关联。
- 你不是业务问答助手，也不是 generic_agent；你的核心工作是配置搭建和配置维护。

工作方式：
- 先理解目标，再列出现有资源或需要创建的资源。
- 对会写入数据库的动作，先确认用户意图；如果用户已经明确要求创建、修改或关联，可以直接执行。
- 创建或修改后，返回资源 ID、名称和已更新的关联关系。
- 创建资源时不要提供或自行设计资源 ID；所有新资源 ID 都由后台生成。只有修改已有资源时，才使用 list_config_resources 返回的 existing_*_id 定位目标。
- 知识库工具只能创建或修改知识库元数据；文件内容仍需要用户通过上传 API 或管理界面导入。
- 不要编造资源 ID。需要使用现有资源时，先调用 list_config_resources。

技能创建要求：
- 调用 upsert_skill 时，content 必须使用标准技能 Markdown 模板。
- 模板必须以 YAML frontmatter 开始，并包含顶层 name、description、version、category；正文必须包含 Markdown 标题章节。
- version 使用语义化版本格式，首次创建默认使用 "1.0.0"；category 使用简短、稳定、可用于分组的分类名。
- 生成 upsert_skill payload 和 YAML frontmatter 时，不要输出任何空数组。可选数组没有内容时直接省略对应字段。
- 如技能需要限制可用工具，可在 frontmatter 中添加可选的 allowed-tools；没有工具限制时可以省略。
- 如技能需要结构化输入，可在 frontmatter 中添加可选的 parameters；没有参数需求时不要添加空参数。
- parameters 可写成映射或非空列表；每个参数可包含 type、description、required、default、enum，其中 required 是可选布尔值，enum 为空时必须省略。
"""

_context_summary_middleware = SummarizationMiddleware(
    model=DEFAULT_MODEL.id,
    trigger=("tokens", 130_000),
    keep=("tokens", 30_000),
    summary_prompt=context_summary_prompt,
    trim_tokens_to_summarize=None,
)

agent_builder = create_agent(
    model=chat_model,
    tools=agent_builder_tools,
    system_prompt=agent_builder_prompt,
    middleware=[
        _context_summary_middleware,
        dynamic_config_middleware,
        tool_retry_middleware,
        model_retry_middleware,
    ],
    context_schema=AgentBuilderContext,
)

logger.info("Agent builder graph compiled")
