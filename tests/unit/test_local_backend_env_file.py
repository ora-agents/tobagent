from pathlib import Path

from desktop.local_backend.env_file import (
    parse_env_text,
    quote_env_value,
    read_env,
    update_env_file,
)


def test_parse_env_text_preserves_assignments_and_comments() -> None:
    parsed = parse_env_text('# header\nOPENAI_COMPATIBLE_DEFAULT_MODEL="gpt-4o"\nRAW LINE\n')

    assert parsed[0].kind == "comment"
    assert parsed[1].key == "OPENAI_COMPATIBLE_DEFAULT_MODEL"
    assert parsed[1].value == "gpt-4o"
    assert parsed[2].kind == "raw"


def test_update_env_file_updates_existing_and_appends_missing(tmp_path: Path) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text("# header\nFOO=old\n", encoding="utf-8")

    update_env_file(env_path, {"FOO": "new value", "BAR": "baz"})

    assert env_path.read_text(encoding="utf-8") == '# header\nFOO="new value"\n\nBAR=baz\n'
    assert read_env(env_path) == {"FOO": "new value", "BAR": "baz"}


def test_quote_env_value_quotes_ambiguous_values() -> None:
    assert quote_env_value("abc") == "abc"
    assert quote_env_value("") == '""'
    assert quote_env_value("hello world") == '"hello world"'
    assert quote_env_value("value#tag") == '"value#tag"'
