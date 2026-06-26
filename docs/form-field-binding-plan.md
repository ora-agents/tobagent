# 表记录字段绑定方案

## 背景

当前系统已经有一套轻量的“表单即表、记录即行”的数据能力：

- 表定义存储在 `forms.fields`，后端模型为 `FormTable.fields`。
- 表记录存储在 `form_records.data`，后端模型为 `FormRecordTable.data`。
- 字段类型目前包括 `text`、`number`、`date`、`boolean`、`select`。
- 表记录查询支持关键词、单字段过滤、字段投影和分页。
- Agent 通过 `query_form_data` 和 `manage_form_data` 工具读写已授权表单。
- Agent 绑定表单时已有 `create`、`read`、`update`、`delete` 权限粒度。
- 表单配置和表记录已经纳入配置包导入导出。

这套模型适合快速创建结构化数据，但字段之间没有正式的关联语义。要实现类似数据库的关联、引用、反向引用、删除保护和跨表查询，需要在当前 JSON 表单模型上增加一层“关系元数据”和“应用层完整性约束”。

## 目标

字段绑定用于描述一个表单字段和另一个表单记录之间的引用关系，让自定义表具备类数据库能力。

第一阶段目标：

- 支持单字段引用其他表单记录。
- 支持记录详情中查看被引用记录摘要。
- 支持目标记录详情中查看反向关联记录。
- 支持创建、更新、删除记录时做引用完整性校验。
- 支持 Agent 工具读取关联字段的可理解信息。
- 保持现有 `forms`、`form_records` 数据结构可兼容升级。

非第一阶段目标：

- 不做完整 SQL 引擎。
- 不直接把每个表单迁移成独立物理表。
- 不优先做复杂多表 JOIN、事务级外键、跨用户共享关联。
- 不在第一阶段实现多对多中间表 UI。

## 当前现状约束

### 数据模型

当前数据库结构是：

```text
forms
- id
- owner_user_id
- name
- description
- category
- fields JSON
- hooks JSON
- created_at
- updated_at

form_records
- id
- form_id
- owner_user_id
- data JSON
- created_at
- updated_at
```

优势：

- 升级成本低，字段定义和记录数据都可动态变化。
- 配置包导入导出天然可携带表定义和记录。
- Agent 工具可以用统一逻辑处理所有表单。

限制：

- 数据库无法直接建立真实外键。
- 查询目前在应用层加载记录后过滤，大数据量下性能有限。
- 记录数据没有后端字段级校验，主要由前端做必填校验。
- 字段删除、字段改名、记录删除不会检查跨表影响。

## 核心设计

### 字段类型扩展

在现有 `FormFieldSchema` / `CustomFormField` 上新增 `reference` 类型：

```ts
type CustomFormFieldType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "select"
  | "reference"
```

新增字段关系配置：

```ts
interface CustomFormFieldBinding {
  targetFormId: string
  targetDisplayFieldId?: string
  relation: "many_to_one" | "one_to_one"
  required?: boolean
  unique?: boolean
  onTargetDelete: "restrict" | "set_null"
  reverseLabel?: string
}

interface CustomFormField {
  id: string
  label: string
  type: CustomFormFieldType
  required: boolean
  options: string[]
  binding?: CustomFormFieldBinding
}
```

第一阶段只落地：

- `many_to_one`：当前记录引用目标表的一条记录，例如订单引用客户。
- `one_to_one`：当前字段最多只能被一条记录使用，例如员工引用唯一工位。
- `restrict`：目标记录被引用时禁止删除。
- `set_null`：目标记录删除时清空引用字段。

### 记录存储格式

引用字段在 `form_records.data` 中仍存储目标记录 ID：

```json
{
  "customer": "record-123",
  "amount": 5600
}
```

接口响应可选择返回展开后的关联摘要：

```json
{
  "id": "record-456",
  "formId": "orders",
  "data": {
    "customer": "record-123",
    "amount": 5600
  },
  "references": {
    "customer": {
      "recordId": "record-123",
      "formId": "customers",
      "label": "上海某客户",
      "exists": true
    }
  }
}
```

这样可以保持写入格式简单，同时让前端和 Agent 不需要额外查询才能显示人类可读信息。

### 关系语义

字段绑定不是字段值转换，而是表结构的一部分：

- 源表：当前字段所在 `form_id`。
- 源字段：当前字段 `field.id`。
- 目标表：`binding.targetFormId`。
- 目标记录：当前记录 `data[field.id]` 中保存的记录 ID。
- 目标展示字段：`binding.targetDisplayFieldId`，用于列表和选择器展示。
- 反向关联：由目标表和目标记录 ID 动态查询源表记录，不重复存储。

## 后端方案

### Schema 扩展

修改 `src/api/schemas.py`：

- `FormFieldSchema.type` 支持 `reference`。
- 新增 `FormFieldBindingSchema`。
- `FormFieldSchema` 增加 `binding: FormFieldBindingSchema | None = None`。
- `FormRecordSchema` 可增加 `references: dict = Field(default_factory=dict)`。

建议后端不要只信任前端，创建和更新记录时应执行字段级校验。

### 校验逻辑

新增共享校验模块，例如：

```text
src/utils/form_relations.py
```

职责：

- 从 `form.fields` 中提取 reference 字段。
- 校验目标表是否存在且属于当前用户。
- 校验目标记录是否存在且属于当前用户。
- 校验 required reference 不为空。
- 校验 one_to_one / unique 约束。
- 校验删除目标记录时是否被引用。
- 构造引用摘要和反向引用列表。

建议提供这些函数：

```python
def get_reference_fields(form: FormTable) -> list[dict]: ...

def validate_form_definition_relations(
    db: Session,
    owner_user_id: str,
    form: FormTable | None,
    fields: list[dict],
) -> None: ...

def validate_record_relations(
    db: Session,
    owner_user_id: str,
    form: FormTable,
    data: dict,
    record_id: str | None = None,
) -> None: ...

def resolve_record_references(
    db: Session,
    owner_user_id: str,
    form: FormTable,
    record: FormRecordTable,
) -> dict: ...

def find_inbound_references(
    db: Session,
    owner_user_id: str,
    target_form_id: str,
    target_record_id: str,
) -> list[dict]: ...

def apply_target_delete_policy(
    db: Session,
    owner_user_id: str,
    target_form_id: str,
    target_record_id: str,
) -> None: ...
```

### API 改造

#### 表定义创建/更新

涉及接口：

- `POST /api/forms`
- `PUT /api/forms/{id}`

新增校验：

- `reference` 字段必须有 `binding.targetFormId`。
- 目标表必须属于当前用户。
- 目标表不能是不存在的表。
- `targetDisplayFieldId` 如果存在，必须是目标表已有字段。
- 禁止字段 ID 重复。
- 字段类型从非 `reference` 改为 `reference` 时，需要检查现有记录值是否都是合法目标记录 ID。
- 字段类型从 `reference` 改为其他类型时，需要提示或允许保留原始字符串值，第一阶段建议允许但不再按引用解析。

#### 记录创建/更新

涉及接口：

- `POST /api/forms/{id}/records`
- `PUT /api/forms/{form_id}/records/{record_id}`

新增校验：

- 必填字段不能为空。
- `reference` 字段值为空时，按 `required` 处理。
- `reference` 字段值非空时，目标记录必须存在。
- `one_to_one` / `unique` 字段不能引用已经被其他记录引用的目标记录。

建议错误格式保持 FastAPI 默认 `HTTPException(400, detail="...")`，后续再升级为字段级错误数组。

#### 记录查询

涉及接口：

- `GET /api/forms/{id}/records`

新增参数：

```text
expandReferences=false
includeInbound=false
```

第一阶段建议只实现 `expandReferences`：

- 默认 `false`，保持现有响应体轻量。
- 为 `true` 时，返回每条记录的 `references`。

#### 记录删除

涉及接口：

- `DELETE /api/forms/{form_id}/records/{record_id}`

删除前检查所有表单的 reference 字段：

- 如果存在 `restrict` 引用，返回 409。
- 如果只有 `set_null` 引用，批量清空对应记录中的字段值。

建议第一阶段默认删除策略为 `restrict`，避免误删导致隐式数据丢失。

### 查询能力

现有查询只支持单字段过滤。第一阶段可扩展：

```text
filterField=customer
filterOp=eq
filterValue=record-123
```

这已经能查询“某客户的所有订单”。反向关联接口可基于它封装：

```text
GET /api/forms/{form_id}/records/{record_id}/references/inbound
```

返回：

```json
{
  "references": [
    {
      "sourceFormId": "orders",
      "sourceFormName": "订单",
      "sourceFieldId": "customer",
      "sourceFieldLabel": "客户",
      "recordId": "record-456",
      "label": "订单 2026-001"
    }
  ]
}
```

## 前端方案

### 字段设计器

在 `frontend/components/layout/management-dashboard/forms.tsx` 中扩展字段类型：

- 新增 `reference` 类型按钮，图标可用 `Link2` 或 `Database`.
- 选择 `reference` 后显示绑定配置：
  - 目标表单。
  - 目标展示字段。
  - 关系类型：多对一 / 一对一。
  - 删除策略：禁止删除 / 删除后置空。
  - 反向关联名称。

字段设计器需要禁用不合法配置：

- 没有其他表单时，允许创建 reference 字段但显示未配置状态，保存时后端拒绝或前端提示。
- 目标表不能选择不存在的表。
- 展示字段只允许选择目标表已有字段和系统字段。

### 记录表格

引用字段单元格不应使用普通文本输入，而应使用记录选择器：

- 支持搜索目标表记录。
- 显示目标记录摘要。
- 可清空。
- 可跳转到目标记录。
- 可在同一弹窗快速新建目标记录，第一阶段可暂不做。

记录表格中显示引用字段时：

- 有 `references[fieldId].label` 时显示 label。
- 目标记录不存在时显示“记录不存在”，并保留原始 ID。
- 未展开引用时可显示 record ID，但管理页建议默认请求 `expandReferences=true`。

### 记录详情

如果后续从纯表格扩展到记录详情页，建议增加两个区域：

- 出站关联：当前记录引用了哪些记录。
- 入站关联：哪些记录引用了当前记录。

第一阶段可以先在表格行操作中提供“查看关联”弹窗。

## Agent 工具方案

### 查询工具

修改 `QueryFormDataTool`：

- 返回表单字段时包含 `binding`。
- 查询记录时可默认解析 reference 字段摘要，或者新增参数 `expand_references`。
- 当用户问“这个客户的订单”时，Agent 可先查询客户表得到记录 ID，再查询订单表 `filter_field=customer`。

建议工具输出中增加：

```json
{
  "records": [
    {
      "id": "record-456",
      "data": {
        "customer": "record-123"
      },
      "references": {
        "customer": {
          "label": "上海某客户",
          "formId": "customers",
          "recordId": "record-123"
        }
      }
    }
  ]
}
```

### 写入工具

修改 `ManageFormDataTool`：

- 创建和更新记录时复用后端关系校验逻辑。
- 引用字段如果传入的是目标记录 ID，直接写入。
- 第一阶段不建议让工具通过展示名称自动模糊绑定目标记录，避免误关联。

后续可增加单独工具：

```text
resolve_form_reference
```

用于根据目标表、展示字段、关键词查找候选记录，让 Agent 在写入前明确选择。

## 配置包导入导出

字段绑定会被保存在 `forms/{id}.json` 的 `fields[].binding` 中，因此表结构可以自然导出。

需要补充导入校验：

- 如果导入时目标表也被复制，`binding.targetFormId` 必须重写为新 ID。
- 如果目标表被跳过，保留绑定会指向不存在的表，应产生 warning，并将该字段标记为未解析绑定。
- 如果导入记录包含引用 ID，且目标记录也被复制，应重写记录中的引用值。
- 如果只导入表结构不导入记录，引用字段配置仍保留。

建议在 `resourceIdMap` 中继续使用 `formIds`，新增记录 ID 映射只在导入表记录时内部使用，不一定暴露给前端。

## 数据完整性策略

### 字段删除

删除 reference 字段时：

- 表定义移除字段。
- 现有记录中的该字段值建议保留还是清理需要产品决定。
- 第一阶段建议保持当前行为：记录 JSON 不做批量清理，只是不再显示该字段。

### 表删除

删除表前检查是否被其他表的 reference 字段绑定：

- 如果有其他表字段引用该表，禁止删除表定义，返回引用来源。
- 如果用户确认强制删除，后续可支持批量移除绑定配置。

第一阶段建议只做禁止删除。

### 记录删除

按字段级 `onTargetDelete` 执行：

- `restrict`：存在引用时禁止删除。
- `set_null`：清空所有引用该记录的字段值。

不建议第一阶段支持 cascade delete。表单数据通常由用户手工维护，级联删除风险大。

## 性能方案

第一阶段保持 JSON 存储和应用层过滤，适合小到中等规模数据。

当单用户单表记录数超过几千时，需要优化：

- 将 `_record_matches` 从应用层过滤逐步下推到数据库 JSON 查询。
- 为 `form_records` 增加复合索引：
  - `(owner_user_id, form_id)`
  - `(owner_user_id, form_id, updated_at)`
- 对 PostgreSQL 可考虑 `data` 的 GIN 索引。
- 如果引用查询成为热点，可增加物化关系表：

```text
form_record_relations
- id
- owner_user_id
- source_form_id
- source_record_id
- source_field_id
- target_form_id
- target_record_id
- created_at
- updated_at
```

第一阶段不建议直接引入该表，除非已经确认记录规模和查询频率需要。

## 分阶段实施

### Phase 1：引用字段最小闭环

后端：

- 扩展 `FormFieldSchema` 支持 `binding`。
- 新增 `src/utils/form_relations.py`。
- 创建/更新表定义时校验 reference 配置。
- 创建/更新记录时校验 reference 值。
- 删除记录时实现 `restrict` 和 `set_null`。
- 查询记录支持 `expandReferences=true`。

前端：

- 字段设计器新增 reference 类型和绑定配置。
- 记录表格中 reference 字段使用目标记录选择器。
- 保存记录前保留前端必填校验，后端作为最终校验。

Agent：

- `query_form_data` 返回 binding 和 reference 摘要。
- `manage_form_data` 复用后端关系校验。

测试：

- reference 字段绑定不存在表时报错。
- reference 值指向不存在记录时报错。
- required reference 为空时报错。
- one_to_one 重复引用时报错。
- restrict 目标记录删除时报 409。
- set_null 删除后清空源记录字段。
- 查询 expandReferences 返回目标摘要。

### Phase 2：反向关联和详情体验

- 新增入站关联 API。
- 管理页支持查看“引用了当前记录的记录”。
- 支持从引用字段跳转到目标记录。
- 支持 Agent 查询入站关联。
- 表删除前检查是否被字段绑定引用。

### Phase 3：高级关系能力

- 多对多字段，值存储为目标记录 ID 数组。
- 聚合字段，例如关联记录数量、金额求和、最近更新时间。
- 关系查询 DSL，支持多个条件和跨表路径。
- 可选的 `form_record_relations` 物化关系表。

## 推荐 API 形态

### 表定义示例

```json
{
  "id": "orders",
  "name": "订单",
  "fields": [
    {
      "id": "customer",
      "label": "客户",
      "type": "reference",
      "required": true,
      "options": [],
      "binding": {
        "targetFormId": "customers",
        "targetDisplayFieldId": "name",
        "relation": "many_to_one",
        "unique": false,
        "onTargetDelete": "restrict",
        "reverseLabel": "订单"
      }
    },
    {
      "id": "amount",
      "label": "金额",
      "type": "number",
      "required": false,
      "options": []
    }
  ]
}
```

### 查询记录示例

```text
GET /api/forms/orders/records?expandReferences=true&filterField=customer&filterOp=eq&filterValue=record-123
```

### 删除冲突示例

```json
{
  "detail": {
    "code": "record_referenced",
    "message": "Record is referenced by other form records.",
    "references": [
      {
        "sourceFormId": "orders",
        "sourceFieldId": "customer",
        "recordId": "record-456"
      }
    ]
  }
}
```

## 关键取舍

- 继续使用 JSON 存储，优先保留动态表单的灵活性。
- 第一阶段只做单值引用，避免多对多和聚合把模型复杂度拉高。
- 完整性约束放在应用层实现，因为当前动态表单无法直接使用数据库外键。
- 删除策略默认 `restrict`，减少误删数据。
- Agent 不自动用名称写入引用，优先要求明确记录 ID，降低误绑定风险。

## 验收标准

- 用户可以在字段设计器中创建引用字段，并绑定到另一个表单。
- 用户可以在记录表格中选择目标表记录作为字段值。
- 用户保存非法引用时会收到明确错误。
- 用户删除被引用记录时会按配置被阻止或自动清空引用。
- 查询记录时可以看到引用字段的人类可读摘要。
- Agent 查询表单时能理解字段绑定关系，并返回关联摘要。
- 配置包导入导出后，表单绑定关系仍然正确或产生明确 warning。
