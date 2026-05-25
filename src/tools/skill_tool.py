import logging
from typing import Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from src.utils.db import AgentProfileTable, SessionLocal, SkillTable

logger = logging.getLogger(__name__)

class ReadSkillInput(BaseModel):
    skill_name: str = Field(
        default="", 
        description="The name or ID of the skill to read. If left empty, lists all available skills in the database."
    )

class ReadSkillTool(BaseTool):
    """Tool for reading customized system skills.
    
    This tool allows agents to list or retrieve the full markdown content of
    skills saved by the user in the PostgreSQL management dashboard.
    """
    name: str = "read_skill"
    description: str = (
        "Read the full details and source code/markdown of a specific system skill, "
        "or list all available skills in the database. Use this to understand how to perform complex tasks "
        "or follow specific workflows defined in the skills."
    )
    args_schema: Type[BaseModel] = ReadSkillInput

    def _run(self, skill_name: str = "", **kwargs) -> str:
        db = SessionLocal()
        try:
            # 1. Try to get agent_id from ToolRuntime context
            agent_id = None
            try:
                from langgraph.config import get_config
                cfg = get_config()
                agent_id = cfg.get("configurable", {}).get("agent_id")
            except Exception:
                pass

            allowed_skill_ids = None
            if agent_id and agent_id != "default":
                agent_profile = db.query(AgentProfileTable).filter(AgentProfileTable.id == agent_id).first()
                if agent_profile:
                    allowed_skill_ids = agent_profile.skill_ids or []

            # 2. Check if the agent is restricted to certain skills
            if allowed_skill_ids is not None:
                if not allowed_skill_ids:
                    return "This agent has no custom skills linked. Please configure skills for this agent in the dashboard."

            if not skill_name:
                # List skills
                query = db.query(SkillTable)
                if allowed_skill_ids is not None:
                    query = query.filter(SkillTable.id.in_(allowed_skill_ids))
                skills = query.all()
                
                if not skills:
                    return "No custom skills found in the database for this agent. Please define or link skills in the dashboard first."
                
                lines = ["Available skills in the database:"]
                for s in skills:
                    lines.append(f"- ID: {s.id} | Name: {s.name} | Description: {s.description or 'No description'}")
                return "\n".join(lines)
            
            # Find by name or ID (filtering by allowed_skill_ids if restricted)
            query = db.query(SkillTable).filter(
                (SkillTable.name.ilike(f"%{skill_name}%")) | (SkillTable.id == skill_name)
            )
            if allowed_skill_ids is not None:
                query = query.filter(SkillTable.id.in_(allowed_skill_ids))
            
            skill = query.first()
            
            if not skill:
                return (
                    f"Skill '{skill_name}' not found or not linked to this agent. "
                    "Try listing your available skills by calling this tool with an empty parameter."
                )
            
            return (
                f"=== Skill: {skill.name} ===\n"
                f"ID: {skill.id}\n"
                f"Description: {skill.description or 'No description'}\n\n"
                f"--- CONTENT ---\n"
                f"{skill.content}\n"
                f"--- END OF CONTENT ---"
            )
        except Exception as e:
            logger.error(f"Error reading skill '{skill_name}': {e}")
            return f"Error occurred while reading skill: {str(e)}"
        finally:
            db.close()

    async def _arun(self, skill_name: str = "", **kwargs) -> str:
        # Fallback to synchronous run
        return self._run(skill_name, **kwargs)
