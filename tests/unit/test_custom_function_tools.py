import asyncio

from src.middleware.dynamic_config_middleware import (
    _custom_function_tool_name,
    _make_custom_function_tool,
)
from src.tools.form_tool import ManageFormDataTool


def test_custom_function_tool_name_is_stable():
    tool_name = _custom_function_tool_name(
        {
            "id": "welcome-flow",
            "name": "Welcome Customer",
        }
    )

    assert tool_name == "macro_welcome_customer_welcome_flow"


def test_custom_function_tool_resolves_arguments_into_form_steps(monkeypatch):
    calls = []

    async def fake_arun(self, **kwargs):
        calls.append(kwargs)
        return "created"

    monkeypatch.setattr(ManageFormDataTool, "_arun", fake_arun)
    dynamic_tool = _make_custom_function_tool(
        {
            "id": "create-customer",
            "name": "Create Customer",
            "description": "Create a customer record.",
            "enabled": True,
            "parameters": [
                {
                    "name": "customerName",
                    "description": "Customer name",
                    "type": "string",
                    "required": True,
                },
                {
                    "name": "priority",
                    "description": "Priority",
                    "type": "number",
                    "required": False,
                },
            ],
            "steps": [
                {
                    "action": "create",
                    "formId": "form_customers",
                    "data": {
                        "name": "{{customerName}}",
                        "summary": "New customer: {{customerName}}",
                        "priority": "{{priority}}",
                    },
                },
            ],
        }
    )

    result = asyncio.run(dynamic_tool.ainvoke({"customerName": "Acme", "priority": 3}))

    assert "Step 1 (create): created" in result
    assert calls == [
        {
            "action": "create",
            "form_id": "form_customers",
            "record_id": "",
            "data": {
                "name": "Acme",
                "summary": "New customer: Acme",
                "priority": 3,
            },
        }
    ]
