"""Default skills used by built-in role templates."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from src.utils.db import SkillTable

DEFAULT_SKILL_ID_PREFIX = "default_skill_"


@dataclass(frozen=True)
class DefaultSkill:
    """Define a bundled skill template."""

    slug: str
    name: str
    description: str
    category: str
    body: str

    @property
    def content(self) -> str:
        """Return markdown content with frontmatter for the skill editor."""
        return f"""---
name: {self.name}
description: {self.description}
license: Apache-2.0
compatibility: 内置业务角色模板
metadata:
  author: system
  version: "1.0.0"
  category: {self.category}
allowed-tools: read_skill rag_search fetch
---

{self.body.strip()}
"""


def _skill_body(purpose: str, workflow: list[str], output: list[str]) -> str:
    workflow_lines = "\n".join(f"{idx}. {item}" for idx, item in enumerate(workflow, 1))
    output_lines = "\n".join(f"- {item}" for item in output)
    return f"""# 目的

{purpose}

# 使用时机

当用户意图、当前角色任务或工单流程需要该能力时使用。优先基于已知业务资料、知识库和用户已确认信息执行；信息不足时先追问，不要编造。

# 工作流程

{workflow_lines}

# 输出要求

{output_lines}

# 约束

- 保持简洁，适合客服或语音场景。
- 不承诺系统、人员或知识库无法确认的结果。
- 涉及价格、政策、服务范围、维修结论时，必须以可检索资料或用户确认信息为依据。
- 发现缺失字段时，按优先级逐项追问。"""


DEFAULT_SKILLS: tuple[DefaultSkill, ...] = (
    DefaultSkill(
        slug="phone_reception",
        name="电话接待",
        description="用于来电开场、身份确认、来意分类、联系方式采集和结束语。",
        category="phone",
        body=_skill_body(
            "帮助电话接待角色快速建立上下文，确认来电目的并收集后续处理所需的最低信息。",
            [
                "用一句自然问候开场，确认对方称呼和联系方式。",
                "询问来电目的，并归类为咨询、报修、投诉、预约、售后或其他。",
                "确认紧急程度、期望处理方式和是否需要转人工。",
                "复述已确认信息，并说明下一步。",
            ],
            [
                "给出简短口语化回复。",
                "列出已确认字段和缺失字段。",
                "明确下一步动作或需要人工确认的事项。",
            ],
        ),
    ),
    DefaultSkill(
        slug="information_collection",
        name="信息采集",
        description="按业务优先级追问姓名、电话、地址、问题类型、紧急程度和期望时间。",
        category="workflow",
        body=_skill_body(
            "把零散对话补齐为可处理的业务信息，避免一次性追问过多字段。",
            [
                "先识别当前任务类型和已经提供的信息。",
                "按姓名、联系方式、位置、问题类型、影响范围、时间要求的顺序补齐字段。",
                "每轮最多追问两个关键字段。",
                "信息足够时停止追问，进入记录或派单步骤。",
            ],
            [
                "输出字段清单。",
                "标记 missing、confirmed、uncertain 三类状态。",
                "给出下一轮最重要的问题。",
            ],
        ),
    ),
    DefaultSkill(
        slug="customer_registration",
        name="客户登记",
        description="把对话整理为客户登记表，记录身份、联系方式、需求和跟进动作。",
        category="crm",
        body=_skill_body(
            "将客户来访或来电信息转为可保存、可交接的登记记录。",
            [
                "抽取客户姓名、电话、公司或地址等身份信息。",
                "归纳客户需求、来源渠道、优先级和备注。",
                "检查必要字段是否缺失。",
                "生成跟进动作和负责人建议。",
            ],
            [
                "使用结构化字段输出。",
                "不要把未经确认的信息写成事实。",
                "缺失字段单独列出。",
            ],
        ),
    ),
    DefaultSkill(
        slug="record_organization",
        name="记录整理",
        description="把自由对话整理成背景、诉求、已确认信息、缺失信息、风险点和下一步。",
        category="operations",
        body=_skill_body(
            "把聊天内容整理为团队可读、可执行的业务记录。",
            [
                "先提炼用户主要诉求。",
                "拆分事实、判断、待确认信息。",
                "标出风险点和依赖项。",
                "给出下一步处理建议。",
            ],
            [
                "包含背景、诉求、已确认信息、缺失信息、风险点、下一步。",
                "用短句表达，避免长段落。",
                "保留关键原始数值和时间。",
            ],
        ),
    ),
    DefaultSkill(
        slug="summary_generation",
        name="摘要生成",
        description="生成对话摘要、工单摘要、转人工摘要和后续跟进摘要。",
        category="operations",
        body=_skill_body(
            "为客服、销售或派单交接生成短摘要，让接手人员快速理解上下文。",
            [
                "识别本轮对话的目标和结果。",
                "保留客户身份、问题、时间、地点、承诺事项。",
                "压缩重复内容。",
                "根据用途生成一句话摘要或字段化摘要。",
            ],
            [
                "摘要不超过必要长度。",
                "突出未解决问题和下一步。",
                "不添加对话中不存在的信息。",
            ],
        ),
    ),
    DefaultSkill(
        slug="workflow_orchestration",
        name="流程编排",
        description="根据当前角色和资料判断下一步：追问、查知识库、转人工或生成工单。",
        category="workflow",
        body=_skill_body(
            "在复杂业务对话中选择合适的下一步动作，保持流程推进。",
            [
                "判断当前阶段：理解需求、补齐信息、查询资料、生成记录、交接处理。",
                "检查是否满足进入下一阶段的最低字段。",
                "优先选择最小可行下一步。",
                "无法自动处理时说明需要人工确认的原因。",
            ],
            [
                "输出下一步动作。",
                "说明选择该动作的依据。",
                "列出阻塞项。",
            ],
        ),
    ),
    DefaultSkill(
        slug="dispatch_rules",
        name="派单规则",
        description="采集派单字段并按业务规则输出派单建议。",
        category="dispatch",
        body=_skill_body(
            "帮助派单角色判断任务类型、派单条件和处理建议。",
            [
                "确认地点、联系人、问题类型、影响范围、期望时间。",
                "检查是否具备派单最低信息。",
                "根据知识库或业务规则判断处理组、服务类型和优先级。",
                "规则缺失时转人工确认。",
            ],
            [
                "输出派单建议。",
                "列出派单依据。",
                "列出仍需补齐的字段。",
            ],
        ),
    ),
    DefaultSkill(
        slug="priority_assessment",
        name="优先级判断",
        description="根据影响范围、紧急程度、安全风险和客户等级判断处理优先级。",
        category="dispatch",
        body=_skill_body(
            "对工单或服务请求进行一致的优先级判断。",
            [
                "识别是否存在人身、安全、停机、多人影响等高风险信号。",
                "结合客户期望时间和业务影响范围判断优先级。",
                "缺少关键规则时使用保守判断并请求人工确认。",
                "给出升级或普通处理建议。",
            ],
            [
                "输出高、中、低或需人工确认。",
                "给出判断依据。",
                "不要虚构客户等级或 SLA。",
            ],
        ),
    ),
    DefaultSkill(
        slug="ticket_creation",
        name="工单创建",
        description="生成标准工单字段，明确联系人、问题、地点、优先级和缺失信息。",
        category="dispatch",
        body=_skill_body(
            "把对话转成可提交给业务系统或人工团队的工单草稿。",
            [
                "抽取工单标题、客户信息、问题描述、位置、时间要求。",
                "根据已知规则补充任务类型和优先级。",
                "检查必填字段完整性。",
                "生成可复制的工单内容。",
            ],
            [
                "字段命名清晰。",
                "缺失字段单独列出。",
                "未经确认的内容标记为待确认。",
            ],
        ),
    ),
    DefaultSkill(
        slug="sales_qa",
        name="销售问答",
        description="只基于资料回答产品、价格、方案、交付、售后和购买问题。",
        category="sales",
        body=_skill_body(
            "帮助销售问答角色准确回答售前问题，同时避免夸大承诺。",
            [
                "识别问题涉及产品、价格、方案、交付、售后或购买流程。",
                "优先检索知识库或可用资料。",
                "用客户能理解的语言回答。",
                "资料不足时说明未知，并建议补充资料或转人工。",
            ],
            [
                "回答必须可追溯到资料或已知上下文。",
                "不要承诺未确认折扣、交付周期或服务范围。",
                "可附带一个下一步引导问题。",
            ],
        ),
    ),
    DefaultSkill(
        slug="lead_qualification",
        name="线索识别",
        description="识别预算、需求、时间、决策人、联系方式和跟进动作。",
        category="sales",
        body=_skill_body(
            "从销售对话中判断客户意向和下一步跟进价值。",
            [
                "提取客户需求、预算范围、采购时间、决策角色和联系方式。",
                "判断意向强度和阻碍因素。",
                "识别是否需要销售跟进或资料发送。",
                "缺少关键信息时自然追问。",
            ],
            [
                "输出线索等级和理由。",
                "列出建议跟进动作。",
                "避免给客户贴不确定标签。",
            ],
        ),
    ),
    DefaultSkill(
        slug="product_intro",
        name="产品介绍",
        description="把知识库内容转成简短、准确、适合口语的产品说明。",
        category="sales",
        body=_skill_body(
            "根据资料向客户介绍产品价值、适用场景和限制。",
            [
                "确认客户关注点。",
                "从资料中提取相关卖点、适用场景和限制。",
                "用两到四句话介绍，不堆砌术语。",
                "邀请客户补充场景以便推荐方案。",
            ],
            [
                "保持准确，不夸张。",
                "优先讲客户关心的点。",
                "资料缺失时明确说明。",
            ],
        ),
    ),
    DefaultSkill(
        slug="repair_dispatch",
        name="维修派单",
        description="面向维修场景采集设备、故障、地址、联系人和可上门时间。",
        category="repair",
        body=_skill_body(
            "为维修服务收集足够信息并准备派单。",
            [
                "确认设备类型、品牌型号、故障现象和发生时间。",
                "确认地址、联系人、联系电话和可上门时间。",
                "询问是否存在漏电、漏水、异响、烟味等安全风险。",
                "生成维修派单草稿或补充追问。",
            ],
            [
                "突出安全风险。",
                "列出设备与故障字段。",
                "不承诺具体维修结果。",
            ],
        ),
    ),
    DefaultSkill(
        slug="fault_diagnosis",
        name="故障诊断",
        description="做轻量故障现象归类和基础排查提示，但不承诺复杂远程维修。",
        category="repair",
        body=_skill_body(
            "根据用户描述做初步故障归类，并判断是否需要专业人员处理。",
            [
                "询问故障现象、发生条件、持续时间和是否复现。",
                "识别明显安全风险并优先提醒停止使用或等待专业人员。",
                "只提供低风险、基础检查建议。",
                "无法确认时建议派单或转人工。",
            ],
            [
                "输出可能类别而非确定结论。",
                "安全风险优先。",
                "不指导高风险拆机或带电操作。",
            ],
        ),
    ),
    DefaultSkill(
        slug="onsite_service",
        name="上门服务",
        description="确认上门条件、时间窗口、安全事项、备件照片和补充材料。",
        category="repair",
        body=_skill_body(
            "为上门服务准备条件，降低无效上门和沟通成本。",
            [
                "确认服务地址、联系人、电话和可上门时间段。",
                "确认现场是否具备进入、停车、电梯、设备可接触等条件。",
                "提醒用户准备照片、型号、购买凭证或故障视频。",
                "确认费用、保修和服务范围需以业务资料或人工确认为准。",
            ],
            [
                "输出上门准备清单。",
                "列出客户需补充材料。",
                "避免承诺未确认费用和时效。",
            ],
        ),
    ),
)


def default_skill_id(owner_user_id: str, slug: str) -> str:
    """Return a stable id for a user's bundled default skill."""
    owner_hash = hashlib.sha1(owner_user_id.encode("utf-8")).hexdigest()[:12]
    clean_slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", slug).strip("_").lower()
    return f"{DEFAULT_SKILL_ID_PREFIX}{clean_slug}_{owner_hash}"


def ensure_default_skills(db: Session, owner_user_id: str) -> list[SkillTable]:
    """Create bundled default skills for a user when they have not been seeded."""
    existing_default = db.query(SkillTable.id).filter(
        SkillTable.owner_user_id == owner_user_id,
        SkillTable.id.like(f"{DEFAULT_SKILL_ID_PREFIX}%"),
    ).first()
    if existing_default:
        return db.query(SkillTable).filter(
            SkillTable.owner_user_id == owner_user_id,
            SkillTable.id.like(f"{DEFAULT_SKILL_ID_PREFIX}%"),
        ).all()

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    rows = [
        SkillTable(
            id=default_skill_id(owner_user_id, skill.slug),
            owner_user_id=owner_user_id,
            name=skill.name,
            description=skill.description,
            content=skill.content,
            created_at=now,
            updated_at=now,
        )
        for skill in DEFAULT_SKILLS
    ]
    db.add_all(rows)
    return rows
