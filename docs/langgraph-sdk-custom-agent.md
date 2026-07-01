# 通过 LangGraph SDK 调用用户自定义 Agent

本文说明外部调用方如何通过 LangGraph SDK 请求本项目部署地址上的用户自定义 agent。参考脚本为 `scripts/langgraph_sdk_external_call.py`。

## 核心概念

本项目只有一个 LangGraph 图 assistant：

```json
{
  "graphs": {
    "generic_agent": "./src/agent/generic_agent.py:generic_agent"
  }
}
```

因此 SDK 调用时：

- `assistant_id` 固定使用 `generic_agent`。
- 用户自己创建的 agent 不是 LangGraph assistant，而是数据库里的 `AgentProfileTable` 记录。
- 自定义 agent 的 ID 通过 `context.agent_id` 传入，例如 `c63c8408-a1e7-4e9a-b636-e549f4343300`。
- 后端会根据认证用户校验该 `agent_id` 是否属于当前用户，并把用户 ID 注入到 `context.user_id`。

也就是说，请求自定义 agent 的关键不是换 `assistant_id`，而是调用 `generic_agent` 时传入正确的 `context.agent_id`。

## 调用前准备

1. 启动或确认 LangGraph 服务地址。

   本地开发默认地址：

   ```bash
   make dev-backend
   ```

   或：

   ```bash
   uv run aegra dev --host 0.0.0.0 --port 2025
   ```

   对应 SDK 地址为 `http://localhost:2025`。

2. 准备用户 API Key。

   外部调用推荐使用用户 API Key，并放在：

   ```bash
   export USER_API_KEY="用户 API Key"
   ```

   SDK 会发送：

   ```http
   Authorization: Bearer <USER_API_KEY>
   ```

   后端会先尝试把这个 key 解析为用户，再校验该用户是否拥有目标 agent。

3. 如果部署环境设置了 `LANGGRAPH_AUTH_SECRET`，还需要传入同一个值。

   ```bash
   export LANGGRAPH_AUTH_SECRET="部署侧配置的 auth secret"
   ```

   SDK 会额外发送：

   ```http
   X-Auth-Key: <LANGGRAPH_AUTH_SECRET>
   ```

4. 获取用户自定义 agent 的 ID。

   可以从前端管理页复制，也可以用用户设置里创建的 API Key 查询管理接口：

   ```bash
   curl -H "Authorization: Bearer <USER_API_KEY>" \
     "$LANGGRAPH_API_URL/api/agent-profiles"
   ```

   返回结果里的 `id` 就是 SDK 调用时的 `context.agent_id`。

## 使用现有脚本调用

本地地址调用：

```bash
export LANGGRAPH_API_URL="http://localhost:2025"
export USER_API_KEY="用户 API Key"
export TOB_AGENT_ID="用户自定义 agent id"

uv run python scripts/langgraph_sdk_external_call.py \
  --message "你是什么智能体？"
```

远程地址调用：

```bash
uv run python scripts/langgraph_sdk_external_call.py \
  --api-url "https://你的-langgraph-部署地址" \
  --api-key "用户 API Key" \
  --auth-secret "可选：LANGGRAPH_AUTH_SECRET" \
  --assistant-id "generic_agent" \
  --agent-id "用户自定义 agent id" \
  --message "请介绍一下你的能力"
```

如果服务没有配置 `LANGGRAPH_AUTH_SECRET`，可以省略 `--auth-secret`。

可选参数：

```bash
# 指定模型
--model "gpt-4o"

# 追加本次调用的系统提示词，不覆盖已保存 agent 提示词
--additional-system-prompt "本次回答请只返回 JSON。"

# 注入用户偏好
--user-preferences "回答尽量简洁，使用中文。"

# 开启安全确认提示
--safety-enabled

# 复用已有 thread，继续同一段对话
--thread-id "<thread_id>"

# 追加 context 字段
--context-json '{"robot_environment": true}'

# 追加 run metadata
--metadata-json '{"request_id": "external-001"}'

# 打印非 token 流事件
--verbose
```

脚本默认会把调试事件写到 `logs/test-agent-sdk.log`。可以用环境变量覆盖：

```bash
export TOB_AGENT_SDK_LOG_FILE="logs/my-sdk-call.jsonl"
```

## 直接用 HTTP 请求

LangGraph SDK 底层就是普通 HTTP API。调用本项目自定义 agent 时，最常用的是两步：

1. `POST /threads` 创建 thread。
2. `POST /threads/{thread_id}/runs/stream` 在该 thread 上启动流式 run。

先设置变量：

```bash
export LANGGRAPH_API_URL="http://localhost:2025"
export USER_API_KEY="用户 API Key"
export TOB_AGENT_ID="用户自定义 agent id"

# 如果服务端配置了 LANGGRAPH_AUTH_SECRET，再设置：
export LANGGRAPH_AUTH_SECRET="部署侧配置的 auth secret"
```

创建 thread：

```bash
curl -sS -X POST "$LANGGRAPH_API_URL/threads" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_API_KEY" \
  ${LANGGRAPH_AUTH_SECRET:+-H "X-Auth-Key: $LANGGRAPH_AUTH_SECRET"} \
  -d '{
    "metadata": {
      "agent_id": "'"$TOB_AGENT_ID"'",
      "source_type": "external-http"
    }
  }'
```

返回里会有：

```json
{
  "thread_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

把 `thread_id` 存起来：

```bash
export THREAD_ID="上一步返回的 thread_id"
```

发起流式请求：

```bash
curl -N -X POST "$LANGGRAPH_API_URL/threads/$THREAD_ID/runs/stream" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer $USER_API_KEY" \
  ${LANGGRAPH_AUTH_SECRET:+-H "X-Auth-Key: $LANGGRAPH_AUTH_SECRET"} \
  -d '{
    "assistant_id": "generic_agent",
    "input": {
      "messages": [
        {
          "role": "user",
          "content": "你是什么智能体？"
        }
      ]
    },
    "context": {
      "agent_id": "'"$TOB_AGENT_ID"'"
    },
    "config": {
      "metadata": {
        "agent_id": "'"$TOB_AGENT_ID"'",
        "source_type": "external-http"
      },
      "recursion_limit": 100
    },
    "metadata": {
      "agent_id": "'"$TOB_AGENT_ID"'",
      "source_type": "external-http"
    },
    "stream_mode": ["messages", "updates", "values"]
  }'
```

`/runs/stream` 返回的是 SSE，终端里会看到类似：

```text
event: metadata
data: {"run_id":"..."}

event: messages
data: [...]

event: values
data: {...}
```

如果调用方不想解析流，可以用同步等待接口：

```bash
curl -sS -X POST "$LANGGRAPH_API_URL/threads/$THREAD_ID/runs/wait" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_API_KEY" \
  ${LANGGRAPH_AUTH_SECRET:+-H "X-Auth-Key: $LANGGRAPH_AUTH_SECRET"} \
  -d '{
    "assistant_id": "generic_agent",
    "input": {
      "messages": [
        {
          "role": "user",
          "content": "你是什么智能体？"
        }
      ]
    },
    "context": {
      "agent_id": "'"$TOB_AGENT_ID"'"
    },
    "config": {
      "metadata": {
        "agent_id": "'"$TOB_AGENT_ID"'",
        "source_type": "external-http"
      },
      "recursion_limit": 100
    },
    "metadata": {
      "agent_id": "'"$TOB_AGENT_ID"'",
      "source_type": "external-http"
    }
  }'
```

`/runs/wait` 会在 run 结束后返回最终 state，一般从返回 JSON 的 `messages` 数组中取最后一条 `type` 为 `ai` 或 `role` 为 `assistant` 的消息。

也可以不创建 thread，直接做无状态调用：

```bash
curl -N -X POST "$LANGGRAPH_API_URL/runs/stream" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer $USER_API_KEY" \
  ${LANGGRAPH_AUTH_SECRET:+-H "X-Auth-Key: $LANGGRAPH_AUTH_SECRET"} \
  -d '{
    "assistant_id": "generic_agent",
    "input": {
      "messages": [
        {
          "role": "user",
          "content": "你是什么智能体？"
        }
      ]
    },
    "context": {
      "agent_id": "'"$TOB_AGENT_ID"'"
    },
    "metadata": {
      "agent_id": "'"$TOB_AGENT_ID"'",
      "source_type": "external-http"
    },
    "stream_mode": ["messages", "values"]
  }'
```

有多轮对话需求时优先使用 thread 方式；无状态调用不会保留对话上下文。

## 最小 Python 调用模板

```python
import asyncio
from langgraph_sdk import get_client


async def main():
    api_url = "https://你的-langgraph-部署地址"
    user_api_key = "用户 API Key"
    auth_secret = ""  # 如果部署设置了 LANGGRAPH_AUTH_SECRET，则填写
    assistant_id = "generic_agent"
    agent_id = "用户自定义 agent id"

    headers = {"Authorization": f"Bearer {user_api_key}"}
    if auth_secret:
        headers["X-Auth-Key"] = auth_secret

    client = get_client(url=api_url, headers=headers)

    metadata = {
        "agent_id": agent_id,
        "source_type": "external-sdk",
    }
    thread = await client.threads.create(metadata=metadata)
    thread_id = thread["thread_id"]

    stream = client.runs.stream(
        thread_id,
        assistant_id,
        input={
            "messages": [
                {"role": "user", "content": "你是什么智能体？"}
            ]
        },
        context={
            "agent_id": agent_id,
            # 可选字段：
            # "model": "gpt-4o",
            # "user_preferences": "使用中文，回答简洁。",
            # "safety_enabled": True,
        },
        config={
            "metadata": metadata,
            "recursion_limit": 100,
        },
        metadata=metadata,
        stream_mode=["messages", "updates", "values"],
    )

    async for chunk in stream:
        event = getattr(chunk, "event", None)
        data = getattr(chunk, "data", None)

        if event == "messages":
            # token 流，具体结构见 scripts/langgraph_sdk_external_call.py
            print(data)
        elif event == "values":
            # 最终 state，通常从 data["messages"] 里取最后一条 assistant 消息
            pass


asyncio.run(main())
```

生产代码建议直接复用 `scripts/langgraph_sdk_external_call.py` 里的这些辅助函数：

- `_text_from_message_event()`：从 `messages` 流事件里提取增量文本。
- `_text_from_messages()`：从 `values` 最终 state 里提取最后一条 assistant 文本。
- `_stream_response()`：统一处理 run id、token 输出、最终文本和日志。

## 请求进入后端后的执行路径

1. SDK 创建 client。

   ```python
   client = get_client(url=api_url, headers=headers)
   ```

2. SDK 创建 thread。

   ```python
   await client.threads.create(metadata={"agent_id": agent_id})
   ```

   认证层会给 thread 绑定当前用户。

3. SDK 对 `generic_agent` 创建 run。

   ```python
   client.runs.stream(
       thread_id,
       "generic_agent",
       input={"messages": [...]},
       context={"agent_id": agent_id},
   )
   ```

4. `src/api/auth.py` 处理认证和授权。

   - 校验 `X-Auth-Key`，如果服务配置了 `LANGGRAPH_AUTH_SECRET`。
   - 解析 `Authorization: Bearer ...`。
   - 如果 bearer 是用户 API Key，则查表得到真正的 `owner_user_id`。
   - 要求普通外部调用必须提供 `context.agent_id`。
   - 校验该 agent 是否属于当前用户。
   - 把 `context.user_id` 注入为当前用户 ID。

5. `src/agent/generic_agent.py` 用 `GenericAgentContext` 接收 runtime context。

   主要字段包括：

   - `agent_id`：用户自定义 agent ID。
   - `user_id`：后端认证层注入的用户 ID。
   - `model`：可选模型覆盖。
   - `user_preferences`：用户偏好。
   - `safety_enabled`：是否开启危险操作确认。
   - `robot_environment`：机器人 WebView 场景开关。

6. `src/middleware/dynamic_config_middleware.py` 根据 `agent_id` 和 `user_id` 加载用户 agent 配置。

   它会动态应用：

   - agent 的 `system_prompt`。
   - agent 的 `enabled_tools`。
   - 关联 skills。
   - 关联 subagents。
   - 关联 MCP tools。
   - agent 级 RAG 知识库。
   - 可选模型覆盖。

## 推荐 payload 结构

```python
input_payload = {
    "messages": [
        {"role": "user", "content": "用户问题"}
    ]
}

context = {
    "agent_id": "用户自定义 agent id",
    "model": "可选模型名",
    "additional_system_prompt": "可选，本次调用追加到 agent 系统提示词后的额外系统指令",
    "user_preferences": "可选用户偏好",
    "safety_enabled": True,
}

metadata = {
    "agent_id": "用户自定义 agent id",
    "source_type": "external-sdk",
}

config = {
    "metadata": metadata,
    "recursion_limit": 100,
}
```

注意：

- 业务字段放 `context`，不要依赖 `config.configurable`。
- `metadata.agent_id` 主要用于观测、thread 归类和兼容兜底；真正驱动自定义 agent 的是 `context.agent_id`。
- 最后一条 message 必须是 `user` 或 `human`。
- 普通外部调用必须传 `context.agent_id`。
- 如需本次调用追加系统指令，使用 `context.additional_system_prompt`；它会追加到已保存 agent profile 的系统提示词后面，不会覆盖原提示词。

## 临时覆盖 agent 配置

常规场景直接使用用户保存的 agent profile 即可。如果确实需要本次调用临时覆盖部分配置，推荐放到 `context.overrides`：

```bash
uv run python scripts/langgraph_sdk_external_call.py \
  --agent-id "用户自定义 agent id" \
  --context-json '{
    "overrides": {
      "model": "gpt-4o",
      "enabled_tools": ["rag_search", "fetch"]
    }
  }'
```

后端白名单允许覆盖：

- `system_prompt`
- `enabled_tools`
- `agent_ids`
- `model`

`enabled_tools` 只能使用内置工具名：

- `rag_search`
- `fetch`
- `read_skill`
- `navigate_robot_to_point`

## 常见错误

| 错误 | 原因 | 处理方式 |
| --- | --- | --- |
| `Missing API key` | 脚本没有拿到 `USER_API_KEY` 或 `--api-key` | 设置 `USER_API_KEY` 或传 `--api-key` |
| `401 Authentication required` | 服务配置了 `LANGGRAPH_AUTH_SECRET`，但请求没有 `X-Auth-Key` | 设置 `LANGGRAPH_AUTH_SECRET` 或传 `--auth-secret` |
| `401 Invalid auth key` | `X-Auth-Key` 和服务端 secret 不一致 | 使用部署环境里的正确 secret |
| `400 context.agent_id is required` | 外部调用没有传自定义 agent ID | 在 `context` 或脚本 `--agent-id` 中传入 agent profile id |
| `403 Agent is not available for this API key` | API Key 对应用户不拥有该 agent | 换成该 agent 所属用户的 API Key，或确认 agent id 是否正确 |
| `422 Messages are required` | `input.messages` 缺失或为空 | 传 `{"messages": [{"role": "user", "content": "..."}]}` |
| `422 Last message must be from user` | 最后一条消息不是用户消息 | 确保最后一条 message role 是 `user` 或 `human` |
| 没有输出正文 | 流事件里没有 assistant 文本，或解析方式不匹配 | 查看 `logs/test-agent-sdk.log`，并参考脚本的 `_stream_response()` |

## 与前端调用的关系

前端在 `frontend/lib/hooks/chat/use-stream-handler.ts` 中也调用同一个 assistant：

```ts
client.runs.stream(targetThreadId, "generic_agent", {
  input,
  context: {
    model,
    user_id: userId,
    agent_id: agentProfile.id,
  },
})
```

外部 SDK 调用和前端调用的本质一致：

- 都请求 `generic_agent`。
- 都把用户自定义 agent ID 放进 `context.agent_id`。
- 都依赖后端认证层限制用户只能访问自己的 agent。

区别是前端使用登录态用户 ID，而第三方外部调用推荐使用用户 API Key。
