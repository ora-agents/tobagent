from types import SimpleNamespace

from src.tools.rag_tool import _RagInput, _selected_linked_kb_ids, _table_name
from src.utils.assets_import import (
    _asset_files_unchanged,
    _asset_kb_id,
    _remove_stale_kb_links,
    _should_delete_stale_asset_kb,
    _should_delete_stale_system_kb,
)


def test_asset_kb_id_uses_lancedb_safe_ascii_for_chinese_folder_name():
    kb_id = _asset_kb_id("产品信息")

    assert kb_id.startswith("asset_kb_")
    assert all(char.isascii() for char in kb_id)
    assert _table_name(kb_id).startswith("rag_asset_kb_")


def test_table_name_replaces_unicode_agent_id_with_stable_ascii_hash():
    table_name = _table_name("产品信息")

    assert table_name.startswith("rag_")
    assert all(char.isascii() for char in table_name)
    assert table_name != "rag_产品信息"


def test_table_name_preserves_supported_lancedb_characters():
    assert _table_name("agent-1.v2_docs") == "rag_agent-1.v2_docs"


def test_selected_linked_kb_ids_defaults_to_all_linked_kbs():
    selected, rejected = _selected_linked_kb_ids(["kb_a", "kb_b"], None)

    assert selected == ["kb_a", "kb_b"]
    assert rejected == []


def test_selected_linked_kb_ids_rejects_unlinked_kbs():
    selected, rejected = _selected_linked_kb_ids(
        ["kb_a", "kb_b"],
        ["kb_b", "kb_missing", "kb_b", " "],
    )

    assert selected == ["kb_b"]
    assert rejected == ["kb_missing"]


def test_rag_input_accepts_json_string_knowledge_base_ids():
    parsed = _RagInput.model_validate(
        {
            "query": "公司简介",
            "knowledge_base_ids": '["asset_kb_a367bbc4355a"]',
        }
    )

    assert parsed.knowledge_base_ids == ["asset_kb_a367bbc4355a"]


def test_stale_empty_system_kb_is_selected_for_cleanup():
    kb = SimpleNamespace(
        id="legacy_system_kb",
        owner_user_id=None,
        files=[],
    )

    assert _should_delete_stale_system_kb(kb, {_asset_kb_id("产品信息")})


def test_cleanup_selection_keeps_current_user_owned_and_nonempty_kbs():
    active_id = _asset_kb_id("产品信息")
    current_system = SimpleNamespace(id=active_id, owner_user_id=None, files=[])
    user_owned = SimpleNamespace(id="legacy_user_kb", owner_user_id="user_1", files=[])
    nonempty_system = SimpleNamespace(id="legacy_system_kb", owner_user_id=None, files=[{"name": "a.pdf"}])

    assert not _should_delete_stale_system_kb(current_system, {active_id})
    assert not _should_delete_stale_system_kb(user_owned, {active_id})
    assert not _should_delete_stale_system_kb(nonempty_system, {active_id})


def test_stale_asset_kb_is_selected_even_with_file_records():
    active_id = _asset_kb_id("产品信息")
    kb = SimpleNamespace(
        id="asset_kb_old_docs",
        owner_user_id=None,
        files=[{"name": "old.pdf"}],
    )

    assert _should_delete_stale_asset_kb(kb, {active_id})


def test_stale_asset_kb_selection_keeps_user_owned_records():
    kb = SimpleNamespace(
        id="asset_kb_old_docs",
        owner_user_id="user_1",
        files=[{"name": "old.pdf"}],
    )

    assert not _should_delete_stale_asset_kb(kb, set())


def test_remove_stale_kb_links_updates_profile():
    profile = SimpleNamespace(
        knowledge_base_ids=["keep", "legacy_system_kb"],
        updated_at="old",
    )

    changed = _remove_stale_kb_links(profile, {"legacy_system_kb"})

    assert changed
    assert profile.knowledge_base_ids == ["keep"]
    assert profile.updated_at != "old"


def test_asset_files_unchanged_accepts_matching_fingerprints():
    previous = [
        {
            "name": "威思瑞/问答.docx",
            "size": 100,
            "uploadedAt": "old",
            "mtimeNs": 123,
            "sha256": "abc",
        }
    ]
    current = [
        {
            "name": "威思瑞/问答.docx",
            "size": 100,
            "uploadedAt": "new",
            "mtimeNs": 123,
            "sha256": "abc",
        }
    ]

    assert _asset_files_unchanged(previous, current)


def test_asset_files_unchanged_ignores_mtime_when_hash_matches():
    previous = [
        {
            "name": "威思瑞/问答.docx",
            "size": 100,
            "uploadedAt": "old",
            "mtimeNs": 123,
            "sha256": "abc",
        }
    ]
    current = [
        {
            "name": "威思瑞/问答.docx",
            "size": 100,
            "uploadedAt": "new",
            "mtimeNs": 456,
            "sha256": "abc",
        }
    ]

    assert _asset_files_unchanged(previous, current)


def test_asset_files_unchanged_detects_replaced_same_name_file():
    previous = [
        {
            "name": "威思瑞/问答.docx",
            "size": 100,
            "uploadedAt": "old",
            "mtimeNs": 123,
            "sha256": "abc",
        }
    ]
    current = [
        {
            "name": "威思瑞/问答.docx",
            "size": 100,
            "uploadedAt": "new",
            "mtimeNs": 456,
            "sha256": "def",
        }
    ]

    assert not _asset_files_unchanged(previous, current)


def test_asset_files_unchanged_rebuilds_legacy_records_without_hash():
    previous = [{"name": "威思瑞/问答.docx", "size": 100, "uploadedAt": "old"}]
    current = [
        {
            "name": "威思瑞/问答.docx",
            "size": 100,
            "uploadedAt": "new",
            "mtimeNs": 123,
            "sha256": "abc",
        }
    ]

    assert not _asset_files_unchanged(previous, current)
