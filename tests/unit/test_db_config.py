from src.utils import db


def test_normalize_postgresql_url_uses_psycopg_driver():
    url = "postgresql://user:pass@localhost:5432/tobagent"

    assert db._normalize_database_url(url) == "postgresql+psycopg://user:pass@localhost:5432/tobagent"


def test_database_url_from_postgres_env(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("POSTGRES_USER", "tobagent")
    monkeypatch.setenv("POSTGRES_PASSWORD", "secret value")
    monkeypatch.setenv("POSTGRES_DB", "tobagent")
    monkeypatch.setenv("POSTGRES_HOST", "localhost")
    monkeypatch.setenv("POSTGRES_PORT", "5433")

    assert (
        db._database_url_from_postgres_env()
        == "postgresql+psycopg://tobagent:secret+value@localhost:5433/tobagent"
    )


def test_database_url_from_postgres_env_requires_core_settings(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("POSTGRES_USER", "tobagent")
    monkeypatch.setenv("POSTGRES_PASSWORD", "tobagent_secret")
    monkeypatch.setenv("POSTGRES_DB", "tobagent")
    monkeypatch.delenv("POSTGRES_HOST", raising=False)

    assert db._database_url_from_postgres_env() is None
