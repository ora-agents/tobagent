from src.utils.db import FormTable, SkillTable
from src.utils.resource_categories import resolve_form_ids, resolve_skill_ids


def test_resolve_skill_ids_includes_current_category_members():
    skills = [
        SkillTable(id="skill-a", content="---\nname: A\ndescription: A\ncategory: sales\n---\n# A"),
        SkillTable(
            id="skill-b",
            content="---\nname: B\ndescription: B\nmetadata:\n  category: Sales\n---\n# B",
        ),
        SkillTable(id="skill-c", content="---\nname: C\ndescription: C\ncategory: support\n---\n# C"),
    ]

    assert resolve_skill_ids(skills, ["skill-c"], ["sales"]) == [
        "skill-c",
        "skill-a",
        "skill-b",
    ]


def test_resolve_form_ids_includes_current_category_members():
    forms = [
        FormTable(id="form-a", category="orders"),
        FormTable(id="form-b", category="Orders"),
        FormTable(id="form-c", category="customers"),
    ]

    assert resolve_form_ids(forms, ["form-c"], ["orders"]) == [
        "form-c",
        "form-a",
        "form-b",
    ]
