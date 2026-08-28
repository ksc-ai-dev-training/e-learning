
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
    is_archived             BOOLEAN NOT NULL DEFAULT false,
    archived_at             TIMESTAMPTZ,
    archived_by             BIGINT REFERENCES users(id),
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

-- T-10 questions（問題）
CREATE TABLE IF NOT EXISTS questions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    material_id     BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    node_id         BIGINT NOT NULL REFERENCES material_nodes(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN ('single', 'multi', 'free_text', 'code', 'reorder', 'score_log')),
    prompt          TEXT NOT NULL,
    options         JSONB,
    correct_answer  JSONB,
    scoring_criteria TEXT,
    code_language   TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    required        BOOLEAN NOT NULL DEFAULT true,
    is_critical     BOOLEAN NOT NULL DEFAULT false,
    feedback_style  TEXT CHECK (feedback_style IS NULL OR feedback_style IN ('show_answer', 'review_only', 'hint_only')),
    pool_group_id   BIGINT REFERENCES questions(id) ON DELETE SET NULL,
    score_unit      TEXT,
    grading_mode    TEXT CHECK (grading_mode IS NULL OR grading_mode IN ('ai', 'manual')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questions_node_sort ON questions (node_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_questions_pool_group_id ON questions (pool_group_id);
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;

-- T-11 assignments（配信設定）。S-06（配信設定画面、A-36〜A-38）は本書の時点では未実装だが、
-- S-03「区分」バッジ・「未受講のみ」等のフィルタが参照する土台としてテーブルのみ先行して用意する。
-- scope_typeは当初'company'/'project'/'individual'の3種だったが、'company'（全社スコープ）はプロジェクト
-- 管理者が実質的な全社必修を作れてしまう抜け道があったため2026-08-28に廃止し、'project'/'individual'の
-- 2種に簡素化した（プロジェクトスコープは常にmaterials.project_idと同値に固定。基本設計書5.9節参照）。
CREATE TABLE IF NOT EXISTS assignments (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    material_id     BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    scope_type      TEXT NOT NULL CHECK (scope_type IN ('project', 'individual')),
    scope_id        BIGINT NOT NULL,
    required        BOOLEAN NOT NULL DEFAULT true,
    due_at          TIMESTAMPTZ,
    pass_score_pct  NUMERIC(5, 2),
    retake_allowed  BOOLEAN NOT NULL DEFAULT true,
    retake_limit    INTEGER,
    created_by      BIGINT NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assignments_material_id ON assignments (material_id);
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

-- T-12 enrollment_progress（受講進捗）。S-16（受講API、A-39〜A-44）は本書の時点では未実装だが、
-- S-03「未受講のみ表示」フィルタ・一覧の受講状況表示が参照する土台としてテーブルのみ先行して用意する
CREATE TABLE IF NOT EXISTS enrollment_progress (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES users(id),
    material_id         BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started', 'in_progress', 'completed')),
    current_node_id     BIGINT REFERENCES material_nodes(id) ON DELETE SET NULL,
    completed_node_ids  JSONB NOT NULL DEFAULT '[]',
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, material_id)
);
ALTER TABLE enrollment_progress ENABLE ROW LEVEL SECURITY;

-- T-13 quiz_attempts（受験記録）。S-04/S-16（受講・受験API、A-39〜A-44）は本書の時点では未実装だが、
-- S-05「問題一覧」タブ・S-19・S-20が参照する集計の土台としてテーブルのみ先行して用意する
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id                   BIGINT NOT NULL REFERENCES users(id),
    material_id               BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    scope_node_id             BIGINT REFERENCES material_nodes(id) ON DELETE CASCADE,
    mode                      TEXT NOT NULL CHECK (mode IN ('graded', 'practice')),
    attempt_no                INTEGER NOT NULL DEFAULT 1,
    score_pct                 NUMERIC,
    passed                    BOOLEAN,
    fail_reason               TEXT,
    question_order            JSONB,
    carried_over_question_ids JSONB,
    started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_material_id ON quiz_attempts (material_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON quiz_attempts (user_id);
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;

-- T-14 answers（回答）。grading_mode='manual'の設問はis_correct・ai_score_pct・ai_feedbackが
-- reviewed_by設定（S-20の採点操作）まで常にNULLのまま（「未採点」、5.20節）
CREATE TABLE IF NOT EXISTS answers (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attempt_id     BIGINT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id    BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    response       JSONB,
    is_correct     BOOLEAN,
    ai_score_pct   NUMERIC,
    ai_feedback    TEXT,
    reviewed_by    BIGINT REFERENCES users(id),
    reviewed_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_answers_attempt_id ON answers (attempt_id);
CREATE INDEX IF NOT EXISTS idx_answers_question_id ON answers (question_id);
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;

-- T-09 material_attachments（添付ファイル・リンク）
CREATE TABLE IF NOT EXISTS material_attachments (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    material_id   BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    node_id       BIGINT REFERENCES material_nodes(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('file', 'link')),
    storage_key   TEXT,
    external_url  TEXT,
    filename      TEXT NOT NULL,
    mime_type     TEXT,
    size_bytes    BIGINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((kind = 'file' AND storage_key IS NOT NULL AND external_url IS NULL)
        OR (kind = 'link' AND external_url IS NOT NULL AND storage_key IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_material_attachments_material_id
    ON material_attachments (material_id, node_id);
ALTER TABLE material_attachments ENABLE ROW LEVEL SECURITY;

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

-- T-26 surveys（受験後アンケート。node_id=NULLは教材全体、設定時は対象の章）
CREATE TABLE IF NOT EXISTS surveys (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    material_id   BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    node_id       BIGINT REFERENCES material_nodes(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    repeat_mode   TEXT NOT NULL DEFAULT 'once' CHECK (repeat_mode IN ('once', 'every_time')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (material_id, node_id)
);
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;

-- T-27 survey_questions（アンケート設問。T-10と異なりcorrect_answerを持たない）
CREATE TABLE IF NOT EXISTS survey_questions (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    survey_id   BIGINT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('rating_5', 'single_choice', 'free_text')),
    prompt      TEXT NOT NULL,
    options     JSONB,
    sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_survey_questions_survey_id ON survey_questions (survey_id, sort_order);
ALTER TABLE survey_questions ENABLE ROW LEVEL SECURITY;

-- T-28 survey_responses（アンケート回答ヘッダー。匿名運用も想定しuser_idはnullable）
CREATE TABLE IF NOT EXISTS survey_responses (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    survey_id     BIGINT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    user_id       BIGINT REFERENCES users(id),
    submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey_id ON survey_responses (survey_id);
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

-- T-29 survey_answers（アンケート回答：設問ごと）
CREATE TABLE IF NOT EXISTS survey_answers (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    response_id         BIGINT NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
    survey_question_id  BIGINT NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
    value               JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_survey_answers_response_id ON survey_answers (response_id);
ALTER TABLE survey_answers ENABLE ROW LEVEL SECURITY;
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
