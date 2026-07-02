# 全量配置导入导出方案

## 1. 背景

当前系统主要支持智能体 TOML 导入导出，配置资产实际还包括知识库、技能、MCP 服务、表单和用户偏好等内容。

本方案将现有能力升级为统一的“配置包系统”，同时支持：

- 导出、导入全部配置。
- 按配置类型批量导出、导入。
- 对单个配置项独立导出、导入。
- 自动迁移资源依赖并重写资源 ID。
- 导入前预检，明确展示冲突、缺失依赖和安全风险。

## 2. 设计目标

1. 所有可迁移配置均有统一的导入导出入口。
2. 智能体、技能、知识库等资源可以单独迁移，不依赖完整账户备份。
3. 导入时不复用其他用户的资源 ID，避免资源冲突和越权引用。
4. 敏感信息默认不进入配置包。
5. 配置包格式支持后续增加新的资源类型。
6. 兼容现有智能体 TOML 文件。

## 3. 支持范围

| 配置类型 | 单项导入导出 | 分类批量导入导出 | 全量导入导出 | 特殊处理 |
| --- | --- | --- | --- | --- |
| 智能体 | 支持 | 支持 | 支持 | 自动处理资源引用和语音设置 |
| 知识库 | 支持 | 支持 | 支持 | 可选择是否包含原始文档 |
| 技能 | 支持 | 支持 | 支持 | 完整保留 Skill 内容 |
| MCP 服务 | 支持 | 支持 | 支持 | 敏感 Header 默认脱敏 |
| 表单 | 支持 | 支持 | 支持 | 可选择是否包含记录 |
| 用户偏好 | 整体导入导出 | 支持 | 支持 | 不包含账户认证信息 |

以下内容默认不导出：

- 用户密码和登录会话。
- API Key 原文。
- 声纹 embedding。
- 智能体分享链接。
- 智能体历史版本。
- MCP 中的 Authorization、Cookie、Token 等敏感 Header。

声纹相关配置只保留 `speakerVerificationEnabled` 状态，不迁移原声纹 ID。导入后由用户重新绑定本账户声纹。

## 4. 配置包格式

### 4.1 文件类型

新增 `.tobconfig` 文件格式，其本质为 ZIP 压缩包。

扩展名用于产品识别；用户可将其作为压缩包打开，编辑 `manifest.json`、各资源 JSON、技能 Markdown、表单 JSONL 和可选知识库文档后重新打包。

不建议继续使用单一 TOML 承载所有配置，因为知识库文档、表单批量记录和后续二进制资产不适合放入 TOML。

### 4.2 目录结构

```text
backup.tobconfig
├── manifest.json
├── agents/
│   └── agent-source-id.json
├── skills/
│   └── skill-source-id.md
├── mcp-servers/
│   └── mcp-source-id.json
├── forms/
│   ├── form-source-id.json
│   └── form-source-id.records.jsonl
├── knowledge-bases/
│   ├── kb-source-id.json
│   └── kb-source-id/
│       └── documents/
└── preferences/
    └── user.json
```

### 4.3 Manifest

```json
{
  "format": "tob-config-bundle",
  "version": 1,
  "exportedAt": "2026-06-24T10:00:00Z",
  "scope": "full",
  "resources": {
    "agents": ["agent-1"],
    "skills": ["skill-1"],
    "knowledgeBases": ["kb-1"],
    "mcpServers": [],
    "forms": []
  },
  "options": {
    "includeDependencies": true,
    "includeKnowledgeDocuments": false,
    "includeFormRecords": true
  },
  "security": {
    "secretsIncluded": false,
    "voiceprintsIncluded": false
  }
}
```

`version` 用于后续格式迁移。服务端应根据版本选择解析器，不应假设所有配置包都使用最新结构。

## 5. 导出方案

### 5.1 全局入口

在配置管理页面右上角增加：

- 导入配置
- 导出配置

点击“导出配置”后展示资源选择窗口：

```text
☑ 智能体
☑ 知识库
  ☑ 包含知识库文档
☑ 技能
☑ MCP
  ☐ 包含敏感请求头
☑ 表单
  ☑ 包含表单记录
☐ 用户偏好
```

支持以下导出范围：

- 全部配置。
- 当前配置分类。
- 用户勾选的多个配置项。

### 5.2 单项入口

每个配置项的操作菜单增加“导出”操作。

各分类页面增加“批量导入”入口。例如在技能页面导入完整配置包时，只展示和处理其中的技能资源。

### 5.3 依赖导出

导出智能体时提供“包含关联资源”选项。

开启后自动收集：

- 关联知识库。
- 关联技能。
- 关联 MCP 服务。
- 关联表单及可选记录。
- 关联的协同智能体。

系统知识库不作为可分享资源导出。智能体中对系统知识库的引用保留为外部引用；导入环境存在同 ID 系统知识库时继续可用于索引和检索，不存在时预检阶段标记为缺失依赖。

未开启时只导出智能体本身，导入预检阶段会将缺少的关联资源标记为未解析依赖。

## 6. 导入方案

### 6.1 导入流程

导入采用三阶段流程：

```text
上传配置包 → 服务端解析和预检 → 用户确认策略 → 事务写入
```

上传文件后不能立即修改数据库。

### 6.2 预检内容

预检结果至少包含：

- 配置包格式版本。
- 配置包导出时间。
- 各资源类型的数量。
- 新增、冲突、无效和跳过资源数量。
- 缺失依赖。
- 被脱敏的 MCP 字段。
- 需要重新绑定的声纹配置。
- 知识库文档数量和总大小。
- 不受当前版本支持的字段。

### 6.3 冲突策略

对同类同 ID 或同名资源提供以下策略：

1. 创建副本：默认策略，生成新的资源 ID。
2. 覆盖现有：覆盖当前用户拥有的对应资源。
3. 跳过冲突：保留已有资源，不导入冲突项。

“覆盖现有”必须满足：

- 目标资源属于当前用户。
- 用户在预检确认页面明确选择覆盖。
- 服务端再次验证资源所有权。

### 6.4 ID 映射

所有新导入资源生成新的内部 ID，并维护统一映射：

```json
{
  "knowledgeBaseIds": {
    "source-kb-1": "kb-new-1"
  },
  "skillIds": {
    "source-skill-1": "skill-new-1"
  },
  "mcpIds": {},
  "formIds": {},
  "agentIds": {}
}
```

导入顺序建议为：

1. 用户偏好。
2. 技能。
3. MCP 服务。
4. 表单及记录。
5. 知识库及文档。
6. 智能体。
7. 重写智能体之间的协同引用。

智能体最后导入，确保其依赖已经生成目标 ID。

### 6.5 原子性

元数据导入应在数据库事务中完成。

知识库文档解析和向量化耗时较长，建议采用：

1. 事务内创建知识库和导入任务。
2. 提交事务。
3. 后台任务解析文档并生成向量。
4. 知识库展示 `importing`、`ready` 或 `failed` 状态。

知识库异步失败不应回滚其他已经确认导入的配置，但必须提供失败原因和重试入口。

## 7. 知识库处理

知识库包含：

- PostgreSQL 中的知识库元数据。
- 文件元数据。
- 原始文档。
- LanceDB 向量数据。

提供两种导出模式。

### 7.1 轻量导出

只导出知识库定义和文件元数据，不携带原始文档。

导入后知识库标记为“需要重新上传文档”，不能将文件元数据误认为可检索内容。

### 7.2 完整导出

携带原始文档，导入后重新执行：

1. 文档解析。
2. 文本切分。
3. Embedding 生成。
4. LanceDB 写入。

不建议直接复制 LanceDB 表文件。向量模型、表结构或 LanceDB 版本变化后，直接复制可能产生不兼容数据。

## 8. 敏感信息处理

### 8.1 MCP Header

默认过滤以下 Header：

- `Authorization`
- `Proxy-Authorization`
- `Cookie`
- `Set-Cookie`
- 包含 `token`、`secret`、`key` 的自定义字段

导入后将缺失字段展示为“需要补充凭证”。

如果未来支持包含敏感信息的导出，应满足：

- 用户显式开启。
- 配置包使用密码加密。
- 页面明确提示文件包含敏感数据。
- 服务端日志不得记录明文内容。

第一阶段不实现敏感信息导出。

### 8.2 声纹

不得导出：

- 声纹 embedding。
- `userVoiceprintId`。
- 声纹样本音频。

可以导出：

- `speakerVerificationEnabled`。
- 提示用户重新绑定声纹所需的非敏感状态。   

### 8.3 API Key

API Key 原文创建后不可再次读取，因此不进入配置包。API Key 名称和前缀也没有迁移价值，默认全部排除。

## 9. API 设计

新增独立的配置包模块，不再继续扩大智能体路由。

### 9.1 预检

```http
POST /api/config-bundles/inspect
Content-Type: multipart/form-data
```

返回：

```json
{
  "inspectionId": "inspection-xxx",
  "formatVersion": 1,
  "resources": {
    "agents": 2,
    "skills": 4,
    "knowledgeBases": 1
  },
  "conflicts": [],
  "missingDependencies": [],
  "warnings": []
}
```

服务端保存短期预检结果，避免确认导入时重新信任客户端提交的解析内容。

### 9.2 执行导入

```http
POST /api/config-bundles/import
Content-Type: application/json
```

```json
{
  "inspectionId": "inspection-xxx",
  "selection": {
    "agents": ["agent-1"],
    "skills": ["skill-1"]
  },
  "conflictPolicy": "copy"
}
```

返回：

```json
{
  "resources": {
    "agents": [],
    "skills": []
  },
  "resourceIdMap": {},
  "warnings": [],
  "jobs": []
}
```

### 9.3 创建导出

```http
POST /api/config-bundles/export
Content-Type: application/json
```

```json
{
  "selection": {
    "agents": ["agent-1"],
    "skills": [],
    "knowledgeBases": []
  },
  "options": {
    "includeDependencies": true,
    "includeKnowledgeDocuments": false,
    "includeFormRecords": true
  }
}
```

小型配置包可以直接返回文件。包含大量知识库文档时返回导出任务 ID。

### 9.4 下载导出结果

```http
GET /api/config-bundles/export/{job_id}
```

任务未完成时返回状态，完成后返回 `.tobconfig` 文件或短期下载地址。

## 10. 后端结构

建议新增：

```text
src/config_bundle/
├── __init__.py
├── schemas.py
├── exporter.py
├── importer.py
├── validators.py
├── id_mapper.py
├── sanitizers.py
└── resource_handlers/
    ├── agents.py
    ├── skills.py
    ├── mcp_servers.py
    ├── forms.py
    ├── knowledge_bases.py
    └── preferences.py
```

每个资源 Handler 提供统一能力：

```python
class ResourceHandler:
    def export(self, context, resource_ids): ...
    def inspect(self, context, payload): ...
    def import_resources(self, context, payload, policy): ...
    def rewrite_references(self, context, id_map): ...
```

现有智能体分享中的资源复制和 ID 映射逻辑可以复用，但应从智能体分享服务中抽离为通用资源迁移能力。

## 11. 前端交互

### 11.1 全局导入窗口

导入窗口分为三步：

1. 选择文件。
2. 查看预检结果并选择资源及冲突策略。
3. 查看导入进度和结果报告。

结果报告应支持：

- 跳转到新导入的配置。
- 查看警告。
- 下载失败明细。
- 重试知识库索引。

### 11.2 分类页面

智能体、知识库、技能、MCP、表单等页面统一增加：

- 分类批量导入。
- 分类批量导出。
- 单项导出。

不要为每种配置重复实现独立文件解析逻辑。前端统一调用配置包 API，只传递当前分类过滤条件。

### 11.3 导入后的状态刷新

导入成功后：

- 重新请求受到影响的资源列表。
- 不直接把服务端响应拼入多个本地 State。
- 若导入并选中了智能体，更新当前智能体 ID。
- 触发智能体运行配置同步。

## 12. Android 协调

Android 当前通过 `TobNativeVoice` 和 `__TOB_NATIVE_VOICE__` 接收选中智能体的运行配置，包括：

- `wakeWords`
- `ttsVoice`
- `speakerVerification`
- `voiceInterruptionEnabled`

配置包不直接传递给 Android。导入后的智能体先写入后端，前端选择智能体时继续通过现有 `onAgentChanged` 桥接同步，因此第一阶段不需要修改 Android 桥协议。

必须保持以下约束：

- `voiceInterruptionEnabled` 缺失时默认 `true`。
- 导入配置不能携带其他账户的声纹 ID。
- 导入并选中智能体后，前端需要触发一次完整的 `onAgentChanged`。
- 禁用语音打断时，Android 仍须抑制回复期间采集的语音，不能在播放结束后发送延迟 ASR。

如果未来配置包增加或重解释原生语音字段，必须同步检查：

- Web：`frontend/lib/hooks/files/use-voice-agent.ts`
- Web：`frontend/lib/voice/protocol.ts`
- Android：`MainActivity.kt`
- Android：`CsjNativeVoiceBridge.kt`
- Android：`NativeAudioWebSocket.kt`

## 13. 兼容现有 TOML

保留以下旧接口和读取能力：

```text
GET  /api/agent-profiles/{id}/export.toml
POST /api/agent-profiles/import.toml
```

兼容策略：

1. 旧 TOML 文件仍可导入。
2. 前端将其标记为“旧版智能体配置”。
3. 服务端将 TOML 转换为统一内部配置包模型后再执行导入。
4. 新功能默认导出 `.tobconfig`。
5. 稳定运行一个版本周期后，再评估是否移除旧 TOML 导出入口。

## 14. 测试要求

### 14.1 单元测试

- 各资源序列化和反序列化。
- Manifest 版本校验。
- 路径穿越和非法 ZIP 文件防护。
- ID 重写。
- 跨资源依赖解析。
- MCP Header 脱敏。
- 声纹和 API Key 排除。
- 三种冲突策略。
- 事务回滚。
- 旧 TOML 转换。

### 14.2 API 测试

- 单项资源导出并重新导入。
- 分类批量导入导出。
- 全量导入导出。
- 非当前用户资源不能覆盖。
- 缺失依赖产生明确警告。
- 大文件和资源数量限制。
- 过期 `inspectionId` 不可执行。

### 14.3 前端测试

- 导入三步流程。
- 冲突策略选择。
- 分类过滤。
- 导入后列表刷新。
- 错误和部分成功状态展示。
- 知识库异步索引进度。

### 14.4 Android 联调

- 导入智能体后切换角色，唤醒词和 TTS 音色正确更新。
- `voiceInterruptionEnabled=false` 导入后仍正确生效。
- 启用声纹验证但未绑定声纹时，前端给出明确提示。

## 15. 安全与限制

- 限制压缩包文件大小、文件数量和解压后总大小。
- 防止 ZIP Bomb。
- 拒绝绝对路径和 `../` 路径。
- 不执行配置包中的脚本或可执行文件。
- 知识库文档沿用现有文件类型白名单。
- 所有资源查询和写入必须验证当前用户所有权。
- 预检结果设置短期有效期并绑定当前用户。
- 导入日志不记录密码、Token、声纹 embedding 或文档全文。

## 16. 实施阶段

### 第一阶段：统一基础能力

- 建立配置包 Schema。
- 实现预检、ID 映射和冲突策略。
- 支持智能体、技能、MCP、表单。
- 保留旧 TOML 兼容。

### 第二阶段：知识库

- 支持轻量知识库导入导出。
- 支持携带原始文档。
- 增加异步重新索引和任务状态。

### 第三阶段：补全配置类型

- 支持用户偏好。
- 增加分类批量操作。

### 第四阶段：体验和治理

- 增加导入历史与失败报告。
- 增加配置包格式迁移器。
- 增加可选加密配置包。
- 评估旧 TOML 导出入口下线。

## 17. 验收标准

1. 每种受支持配置都可以单独导出并导入为副本。
2. 用户可以选择任意多个配置项生成配置包。
3. 全量配置可以迁移到另一个账户，且不存在跨账户 ID 引用。
4. 导入前能够看到冲突、缺失依赖和安全警告。
5. MCP 密钥、API Key 和声纹 embedding 不会出现在默认配置包中。
6. 智能体关联的知识库、技能、MCP、表单和协同智能体能够正确重写 ID。
7. 导入后的语音配置可以通过现有 WebView 桥正确同步到 Android。
8. 旧版智能体 TOML 文件仍可正常导入。
