# TOB Agent

TOB Agent 是一个面向业务场景的 LangGraph 智能体平台，包含可配置的智能体运行时、Next.js 聊天界面、管理后台、知识库 RAG、技能/表单/MCP 配置、语音交互和机器人控制集成。

后端基于 LangGraph/Aegra 与 FastAPI，前端基于 Next.js、React 和 Tailwind CSS。项目支持 OpenAI 兼容模型接口，可接入 OpenAI、Ollama、OpenRouter、vLLM 或其他兼容 `/v1` 协议的模型服务。

## 主要功能

- **可配置智能体**：通过智能体配置管理系统提示词、模型、启用工具、知识库、技能、表单、MCP 服务、唤醒词、TTS 声音和声纹绑定。
- **LangGraph 对话运行时**：内置 `generic_agent` 通用智能体和 `agent_builder` 平台配置智能体，支持线程、检查点、上下文摘要、模型重试和工具重试。
- **知识库 RAG**：支持上传文档、按智能体关联知识库、向量检索和默认资产导入，向量数据存储在 LanceDB。
- **技能系统**：用户可维护可复用的系统提示词技能，智能体通过 `read_skill` 工具读取。
- **结构化表单**：支持自定义表单、表单记录、权限配置，智能体可查询和维护业务数据。
- **MCP 服务配置**：支持用户级 MCP server 配置，并在智能体工具层动态接入。
- **语音交互**：提供 DashScope ASR/TTS 代理、KWS 唤醒词检测、VAD、语音打断、语音遥测和声纹验证。
- **机器人集成**：支持机器人点位管理、SSE 命令通道和智能体导航工具。
- **配置包导入导出**：可导出/导入智能体、技能、知识库、MCP 服务和表单配置。
- **账号与 API Key**：支持注册、登录、用户资料、用户 API Key 和外部 LangGraph SDK 调用。
- **管理后台**：前端内置聊天、智能体、知识库、技能、表单、MCP、用户设置和开发手册视图。

## 技术栈

- **后端**：Python 3.11+、LangGraph、LangChain、Aegra、FastAPI、SQLAlchemy、PostgreSQL、Redis、LanceDB
- **前端**：Next.js、React、TypeScript、Tailwind CSS、Radix UI、Bun
- **语音**：DashScope Realtime API、sherpa-onnx、Ten VAD、SpeechBrain ECAPA 声纹服务
- **观测**：Langfuse tracing，部分 LangSmith 分享辅助接口
- **部署**：Docker Compose，包含 PostgreSQL、Redis、后端、前端和 speaker 服务

## 目录结构

```text
.
├── src/
│   ├── agent/              # LangGraph 智能体图与模型配置
│   ├── api/                # FastAPI 路由、鉴权、语音代理和服务层
│   ├── middleware/         # 动态配置、模型重试、工具重试中间件
│   ├── prompts/            # 智能体提示词
│   ├── tools/              # RAG、fetch、技能、表单、MCP、机器人等工具
│   └── utils/              # 数据库、资产导入、追踪、运行时上下文等工具函数
├── frontend/
│   ├── app/                # Next.js 页面入口
│   ├── components/         # 聊天、管理后台和通用 UI 组件
│   ├── lib/                # API 客户端、hooks、类型和配置
│   └── public/             # 静态资源、字体、语音 worklet
├── services/speaker/       # 声纹验证服务
├── assets/                 # 默认业务文档资产
├── models/                 # 本地语音/唤醒/声纹模型
├── tests/                  # 单元测试和 eval 测试
├── docs/                   # 设计、配置导入导出、版本等文档
├── langgraph.json          # LangGraph/Aegra 配置
├── aegra.json              # Aegra 本地/部署配置
└── docker-compose.yml      # 本地基础设施与完整部署编排
```

## 环境要求

- Python 3.11+
- [uv](https://github.com/astral-sh/uv)
- [Bun](https://bun.sh/)
- Docker / Docker Compose
- 一个 OpenAI 兼容模型服务和 API Key
- 如需语音功能，需要 DashScope API Key

## 快速开始

### 1. 安装依赖

```bash
make install
```

等价命令：

```bash
uv sync
cd frontend && bun install
```

### 2. 配置环境变量

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

至少需要在 `.env` 中配置：

```env
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_API_KEY=sk-your_api_key_here
OPENAI_COMPATIBLE_DEFAULT_MODEL=gpt-4o
```

语音功能需要额外配置：

```env
DASHSCOPE_API_KEY=sk-xxx
```

前端默认读取：

```env
NEXT_PUBLIC_LANGGRAPH_API_URL=http://localhost:2025
NEXT_PUBLIC_OPENAI_DEFAULT_MODEL=gpt-4o
```

### 3. 启动本地开发环境

启动 PostgreSQL、Redis、speaker 服务，并同时启动后端和前端：

```bash
make dev-local
```

默认地址：

- 前端 UI：<http://localhost:3000>
- 后端 API：<http://localhost:2025>
- API 文档：<http://localhost:2025/docs>
- LangGraph Studio：<https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2025>

也可以分别启动：

```bash
make dev-backend
make dev-frontend
```

## 常用命令

```bash
# 安装前后端依赖
make install

# 启动完整本地开发环境
make dev-local

# 只启动后端
make dev-backend

# 只启动前端
make dev-frontend

# 构建前端
cd frontend && bun run build

# 运行后端测试
uv run pytest

# 运行 Python lint
uv run ruff check src tests

# 导入/刷新 assets 下的默认知识库资产
make update-assets

# Docker Compose 部署完整栈
make deploy-all

# 查看完整栈日志
make deploy-all-logs
```

## 后端接口概览

FastAPI 应用挂载在 Aegra/LangGraph HTTP 服务中，主要接口包括：

- `/health`：健康检查
- `/api/auth/*`：注册、登录、用户资料、API Key
- `/api/agent-profiles`：智能体配置 CRUD、版本恢复、分享导入
- `/api/knowledge-bases`：知识库管理、文档上传、RAG 状态
- `/api/skills`：技能管理
- `/api/forms`：表单和表单记录管理
- `/api/mcp-servers`：MCP 服务配置
- `/api/models`：OpenAI 兼容模型列表代理
- `/api/config-bundles/*`：配置包导入导出
- `/api/robot/*`：机器人点位、命令流和结果回调
- `/ws/voice/*`：ASR/TTS 语音 WebSocket
- `/langsmith/*`：LangSmith run 查询和分享辅助

交互式接口文档见 `/docs`，OpenAPI Schema 见 `/openapi.json`。

## 智能体运行方式

`generic_agent` 是主要业务智能体。前端会把当前智能体配置作为运行时上下文传给 LangGraph，包括：

- `system_prompt`
- `model`
- `enabled_tools`
- `agent_id`
- `user_id`
- `knowledge_base_ids`
- `skill_ids`
- `mcp_ids`
- `form_ids`
- 语音和机器人相关配置

后端通过 `dynamic_config_middleware` 将这些配置注入运行时，并按智能体/用户范围限制资源访问。内置工具包括：

- `rag_search`
- `fetch`
- `read_skill`
- `query_form_data`
- `manage_form_data`
- `navigate_robot_to_point`

## 语音与 Android WebView

Web 前端支持浏览器语音模式，也支持 Android WebView 原生桥接。Android 项目路径：

```text
/mnt/c/Users/wrsi/Documents/wsrtobandroid
```

涉及语音、唤醒词、ASR/VAD、TTS 播放、语音打断、声纹验证、WebView bridge、telemetry 或智能体配置语义时，需要同时检查 Android 侧 `TobNativeVoice` / `__TOB_NATIVE_VOICE__` 和前端 `nativeVoiceEvent` 消费逻辑，保持 `idle`、`kws`、`listening`、`transcribing`、`processing`、`speaking` 等状态一致。

## 测试与质量

后端：

```bash
uv run pytest
uv run pytest tests/unit
uv run ruff check src tests
```

前端：

```bash
cd frontend && bun run build
```

提交前建议至少运行与改动范围相关的测试。UI 改动建议执行 `bun run build`。

## 部署

完整 Docker Compose 栈包含：

- `postgres`：PostgreSQL + pgvector
- `redis`：LangGraph/运行时 broker
- `tobagent`：后端 Aegra/FastAPI/LangGraph 服务
- `speaker`：声纹验证服务
- `frontend`：Next.js 前端

启动：

```bash
make deploy-all
```

查看日志：

```bash
make deploy-all-logs
```

停止：

```bash
docker compose down
```

## 相关文档

- [设计规范](docs/design.md)
- [配置导入导出](docs/config-import-export.md)
- [版本管理](docs/versioning.md)
- [LangGraph SDK 外部调用](docs/langgraph-sdk-custom-agent.md)

## License

MIT
