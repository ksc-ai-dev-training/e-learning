
# asyncpg接続プール管理、SCHEMA定義（詳細設計書 3章 T-01〜）
import os
from pathlib import Path

import asyncpg


def load_root_env() -> dict[str, str]:
    """リポジトリルートの .env（DB_PORT / BACKEND_PORT 等）を読む。環境変数が優先"""
    env: dict[str, str] = {}
    path = Path(__file__).resolve().parent.parent / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip()
    return env


ROOT_ENV = load_root_env()

_db_port = os.environ.get("DB_PORT") or ROOT_ENV.get("DB_PORT", "55433")
DATABASE_URL = (
    os.environ.get("DATABASE_URL")
    or ROOT_ENV.get("DATABASE_URL")
    or f"postgresql://manabi:manabi@localhost:{_db_port}/manabi"
)

# 本番（Supabase）は自動マイグレーションを行わず、SCHEMA は手動適用する。
# 起動のたびに CREATE TABLE を流さないよう APP_ENV=production では抑止する
APP_ENV = os.environ.get("APP_ENV") or ROOT_ENV.get("APP_ENV", "development")
AUTO_MIGRATE = (
    os.environ.get("AUTO_MIGRATE") or ROOT_ENV.get("AUTO_MIGRATE") or ("0" if APP_ENV == "production" else "1")
) == "1"

_pool: asyncpg.Pool | None = None

# 詳細設計書 3章。画面ごとに必要なテーブルを追加していく（現状 T-01, T-03, T-04, T-06）
SCHEMA = """
-- T-01 users
CREATE TABLE IF NOT EXISTS users (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email               TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    role                TEXT NOT NULL DEFAULT 'member'
                        CHECK (role IN ('member', 'admin')),
    picture_url         TEXT,
    custom_picture_key  TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- T-03 projects
CREATE TABLE IF NOT EXISTS projects (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT,
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed')),
    pm_user_id          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_by          BIGINT NOT NULL REFERENCES users(id),
    is_company_wide     BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- T-04 project_memberships
CREATE TABLE IF NOT EXISTS project_memberships (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    user_id             BIGINT NOT NULL REFERENCES users(id),
    role                TEXT NOT NULL DEFAULT 'learner'
                        CHECK (role IN ('admin', 'editor', 'learner')),
    assigned_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status              TEXT NOT NULL DEFAULT 'invited'
                        CHECK (status IN ('invited', 'active', 'declined')),
    joined_at           TIMESTAMPTZ,
    left_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_memberships_user_id ON project_memberships(user_id);
ALTER TABLE project_memberships ENABLE ROW LEVEL SECURITY;

-- T-06 materials（教材）
CREATE TABLE IF NOT EXISTS materials (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id              BIGINT NOT NULL REFERENCES projects(id),
    title                   TEXT NOT NULL,
    description             TEXT,
    tags                    JSONB NOT NULL DEFAULT '[]',
    created_by              BIGINT NOT NULL REFERENCES users(id),
    status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'published')),
    sort_order              INTEGER NOT NULL DEFAULT 0,
    attempt_scope           TEXT NOT NULL DEFAULT 'material'
                            CHECK (attempt_scope IN ('material', 'chapter', 'section', 'page')),
    retake_scope            TEXT NOT NULL DEFAULT 'all'
                            CHECK (retake_scope IN ('all', 'wrong_only')),
    default_feedback_style  TEXT NOT NULL DEFAULT 'show_answer'
                            CHECK (default_feedback_style IN ('show_answer', 'review_only', 'hint_only')),
    ai_context              TEXT,
    grading_mode            TEXT NOT NULL DEFAULT 'ai'
                            CHECK (grading_mode IN ('ai', 'manual')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_materials_project_id ON materials(project_id);
CREATE INDEX IF NOT EXISTS idx_materials_tags ON materials USING GIN (tags jsonb_path_ops);
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;

-- T-23 material_nodes（教材の目次ノード: 章・小見出し・ページの自己参照ツリー）
CREATE TABLE IF NOT EXISTS material_nodes (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    material_id     BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    parent_node_id  BIGINT REFERENCES material_nodes(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('chapter', 'section', 'page')),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    content_kind    TEXT CHECK (content_kind IS NULL OR content_kind IN ('explanation', 'quiz', 'mixed')),
    format          TEXT CHECK (format IS NULL OR format IN ('markdown', 'html')),
    body            TEXT,
    quiz_mode       TEXT NOT NULL DEFAULT 'all' CHECK (quiz_mode IN ('all', 'pool')),
    pool_draw_count INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (kind <> 'chapter' OR parent_node_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_material_nodes_tree
    ON material_nodes (material_id, parent_node_id, sort_order);
ALTER TABLE material_nodes ENABLE ROW LEVEL SECURITY;

-- T-08 material_revisions（教材改訂履歴。追記専用）
CREATE TABLE IF NOT EXISTS material_revisions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    material_id     BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    source_snapshot TEXT NOT NULL,
    changed_by      BIGINT NOT NULL REFERENCES users(id),
    changed_via     TEXT NOT NULL CHECK (changed_via IN ('web', 'claude_code')),
    change_summary  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_material_revisions_material_id
    ON material_revisions (material_id, created_at DESC);
ALTER TABLE material_revisions ENABLE ROW LEVEL SECURITY;
"""


def _pool_kwargs() -> dict:
    """接続先に応じた asyncpg のオプションを組み立てる。

    Supabase の Transaction pooler（Supavisor / port 6543）は接続がトランザクション単位で
    使い回されるため、asyncpg のプリペアドステートメントのキャッシュが機能しない
    （`prepared statement "__asyncpg_stmt_x__" already exists` になる）。
    その場合は statement_cache_size=0 でキャッシュを無効化する。
    Session pooler（5432）と直接接続ではキャッシュを有効なままにしてよい。
    """
    kwargs: dict = {"min_size": 1, "max_size": int(os.environ.get("DB_POOL_MAX", "10"))}
    is_transaction_pooler = ":6543" in DATABASE_URL or "pgbouncer=true" in DATABASE_URL
    if os.environ.get("DB_DISABLE_STATEMENT_CACHE", "1" if is_transaction_pooler else "0") == "1":
        kwargs["statement_cache_size"] = 0
    return kwargs


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, **_pool_kwargs())
        if AUTO_MIGRATE:
            async with _pool.acquire() as conn:
                await conn.execute(SCHEMA)
    return _pool


def get_pool() -> asyncpg.Pool:
    assert _pool is not None, "init_pool() が呼ばれていません"
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
