
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
# ルート.envの値をプロセス環境変数へ反映する（既に実OS環境変数が設定されている場合はそちらを優先、
# setdefaultのため上書きしない）。これが無いと、database.py以外のモジュール（ai_client.pyの
# OPENAI_API_KEY、auth_helpers.pyのJWT_SECRET、google_auth.pyのGOOGLE_CLIENT_ID等）が素の
# os.environ.get()で読んでいるため、.envに値を書いても一切反映されない不具合になっていた
# （Google OAuth実装時に発見。start.bat未整備でこれまで顕在化していなかった）。
for _k, _v in ROOT_ENV.items():
    os.environ.setdefault(_k, _v)

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
-- F-12（Slack受講催促通知）: 当初は個人ごとのOAuth連携（本人宛てDM）を実装したが、社内Slack
-- ワークスペースのカスタムアプリ数上限により新規アプリを作成できず利用できなかった（検討資料/
-- 20260903_Slack連携方式比較.html参照）。既存のIncoming Webhook（新規アプリ作成不要）を使い、
-- プロジェクト単位でチャンネルへ通知する方式（下記 projects.slack_webhook_url）に置き換えた
-- ため、個人連携用のカラムは撤去する（2026-09-04）。
ALTER TABLE users DROP COLUMN IF EXISTS slack_user_id;
ALTER TABLE users DROP COLUMN IF EXISTS slack_access_token;
ALTER TABLE users DROP COLUMN IF EXISTS slack_connected_at;

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
-- F-12: このプロジェクトの必修教材リマインドを送信するIncoming Webhook URL（プロジェクト単位で
-- 1本。Slack側でチャンネルを指定して発行したURLを、S-12プロジェクト管理から貼り付けて使う）。
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;

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

-- T-11 assignments（配信設定）。S-06（配信設定画面、A-36〜A-38）で実際に作成・編集される他、
-- S-03「区分」バッジ・「未受講のみ」等のフィルタも参照する。
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

-- T-12 enrollment_progress（受講進捗）。S-16（受講API、A-39〜A-44）で実際に更新される他、
-- S-03「未受講のみ表示」フィルタ・一覧の受講状況表示も参照する
CREATE TABLE IF NOT EXISTS enrollment_progress (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES users(id),
    material_id         BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started', 'in_progress', 'completed')),
    current_node_id     BIGINT REFERENCES material_nodes(id) ON DELETE SET NULL,
    completed_node_ids  JSONB NOT NULL DEFAULT '[]',
    visited_node_ids    JSONB NOT NULL DEFAULT '[]',
    reset_at            TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, material_id)
);
ALTER TABLE enrollment_progress ENABLE ROW LEVEL SECURITY;
-- visited_node_ids: 目次の✓マーク用「閲覧済み」記録（合否判定用のcompleted_node_idsとは別物。
-- 「次のページへ」を押して読み進めた時点で追加され、合否・完了率の集計には使わない。2026-09-03追加）
ALTER TABLE enrollment_progress ADD COLUMN IF NOT EXISTS visited_node_ids JSONB NOT NULL DEFAULT '[]';
-- reset_at: A-95「未受講に戻す」が押された時刻。quiz_attempts/answersは消さない方針
-- （学習記録は失われない）のため、A-40が「合格済みスコープは閲覧専用で再利用する」際に
-- リセット前の古い合格記録を再利用してしまわないよう判定に使う（2026-09-03追加）。
ALTER TABLE enrollment_progress ADD COLUMN IF NOT EXISTS reset_at TIMESTAMPTZ;

-- T-30 my_learning_registrations（マイ学習登録、F-31）。全社Wiki所属の任意教材は、本人がここに
-- 登録しない限りA-39（マイ学習一覧）に表示しない（招待制プロジェクトの任意教材・必修教材は対象外）
CREATE TABLE IF NOT EXISTS my_learning_registrations (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    material_id  BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, material_id)
);
ALTER TABLE my_learning_registrations ENABLE ROW LEVEL SECURITY;

-- T-13 quiz_attempts（受験記録）。S-04/S-16（受講・受験API、A-39〜A-44）で実際に記録される他、
-- S-05「問題一覧」タブ・S-19・S-20も集計に参照する
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
    submitted_at              TIMESTAMPTZ,
    practice_kind             TEXT CHECK (practice_kind IN ('repeat', 'wrong_only'))
);
-- (user_id, material_id, mode, scope_node_id, practice_kind)の組でsubmitted_at IS NULLな行を
-- 高々1件に保つ。A-40がINSERT ... ON CONFLICTでこれを対象にし、「無ければ作る・あれば取得する」を
-- アトミックに行う（StrictModeのエフェクト二重発火・二重クリック等で同一スコープの未提出試行が
-- 2件作られる不具合の防止）。practice_kindは反復演習（'repeat'）と誤答のみ抽出（'wrong_only'）を
-- 区別するために追加した。両方ともmode='practice', scope_node_id=NULLで区別が付かず、
-- 一方が進行中にもう一方を開始しようとすると本インデックスに衝突していた不具合を発見・修正した
-- （A-44実装時、2026-08-31）。
DROP INDEX IF EXISTS uq_quiz_attempts_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_attempts_active
    ON quiz_attempts (user_id, material_id, mode, scope_node_id, practice_kind) NULLS NOT DISTINCT
    WHERE submitted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_material_id ON quiz_attempts (material_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON quiz_attempts (user_id);
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;

-- T-32 attempt_limit_resets（REQ-F-09/F-14: 再受験回数上限のリセット）。quiz_attemptsは
-- 学習記録として削除しないため（学習記録は失われない、という一貫方針）、上限に達した後に
-- 「あと何回まで解き直せるか」を回復させる手段として、このテーブルに記録した時刻より後の
-- 提出済み受験記録のみを回数カウントの対象にする。対象プロジェクトのadmin、またはシステムadmin
-- のみが操作できる（プロジェクト管理S-12「メンバー管理」タブから、2026-09-03検討）。
CREATE TABLE IF NOT EXISTS attempt_limit_resets (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    material_id   BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    scope_node_id BIGINT REFERENCES material_nodes(id) ON DELETE SET NULL,
    reset_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reset_by      BIGINT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_attempt_limit_resets_lookup
    ON attempt_limit_resets (user_id, material_id, scope_node_id);
ALTER TABLE attempt_limit_resets ENABLE ROW LEVEL SECURITY;

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
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_answers_attempt_id ON answers (attempt_id);
CREATE INDEX IF NOT EXISTS idx_answers_question_id ON answers (question_id);
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;

-- T-19 ai_usage_logs（AI利用ログ）。F-08/F-20〜F-23共通で`ai_client.py`が呼び出しのたびに1行書き込む。
-- 質問・回答の内容そのものは保存しない（Keireki T-09と同方針）
CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    feature        TEXT NOT NULL
                   CHECK (feature IN ('material_review', 'grading', 'insight_analysis', 'personal_feedback', 'org_report')),
    model          TEXT NOT NULL,
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    cost_estimate  NUMERIC(10, 6) NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at_feature ON ai_usage_logs (created_at, feature);
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- T-15 ai_material_reviews（AI教材レビュー結果、F-08）。追記専用（updated_atを持たない）
CREATE TABLE IF NOT EXISTS ai_material_reviews (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    material_id    BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    requested_by   BIGINT NOT NULL REFERENCES users(id),
    findings       JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_material_reviews_material_id ON ai_material_reviews (material_id, created_at DESC);
ALTER TABLE ai_material_reviews ENABLE ROW LEVEL SECURITY;

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

-- T-31 cli_token_revocations（A-63で失効させたCLIトークンのjtiを記録。JWT自体はステートレスな
-- ため、失効を表現するにはサーバー側にこの一覧を持つ必要がある。詳細設計書7.1節）
CREATE TABLE IF NOT EXISTS cli_token_revocations (
    jti         TEXT PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id),
    revoked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE cli_token_revocations ENABLE ROW LEVEL SECURITY;

-- T-22 material_project_shares（F-26 教材のプロジェクト間共有。複製モデル、基本設計書5.27節）。
-- statusが'accepted'になった時点で共有先プロジェクトへ教材の複製が新規作成される（この行自体は
-- 複製先教材への参照を持たない。複製後は独立した教材のため、以後この行は履歴として残るのみ）。
CREATE TABLE IF NOT EXISTS material_project_shares (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    material_id           BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    shared_to_project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    shared_by             BIGINT NOT NULL REFERENCES users(id),
    shared_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    responded_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    responded_at          TIMESTAMPTZ,
    UNIQUE (material_id, shared_to_project_id)
);
CREATE INDEX IF NOT EXISTS idx_material_project_shares_shared_to
    ON material_project_shares (shared_to_project_id);
ALTER TABLE material_project_shares ENABLE ROW LEVEL SECURITY;

-- T-21 app_settings（システム設定。S-10「システム設定」タブ、A-55〜A-57・A-80）。他の
-- テーブルと異なりidのIDENTITY列を持たず、設定キーそのものを主キーとする。行が無いキーは
-- API側で環境変数・固定値へフォールバックする（03_テーブル定義.html「キー一覧」参照）。
CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value_text  TEXT,
    updated_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- T-17 ai_personal_feedback（F-22 AI個人フィードバック。S-09個人学習レポート、A-51/A-52）。
-- 非同期ジョブ方式（8.2節）: requested_atのみのプレースホルダ行をまず同期的に作成し、contentは
-- ジョブ完了時に設定する。content未設定＝処理中／404、設定済み＝完了／200の判定に使う。
CREATE TABLE IF NOT EXISTS ai_personal_feedback (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    content       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_personal_feedback_user_id ON ai_personal_feedback (user_id, created_at DESC);
ALTER TABLE ai_personal_feedback ENABLE ROW LEVEL SECURITY;

-- T-18 ai_org_reports（F-23 AI組織レポート。S-08受講状況ダッシュボード、A-48/A-49）。
-- ai_personal_feedbackと同じ非同期ジョブ方式（8.2節）。scope_type='company'の全社スコープは
-- scope_id無し、'project'はscope_idにprojects.idを持つ（詳細設計書T-18）。
CREATE TABLE IF NOT EXISTS ai_org_reports (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scope_type    TEXT NOT NULL CHECK (scope_type IN ('company', 'project')),
    scope_id      BIGINT REFERENCES projects(id) ON DELETE CASCADE,
    requested_by  BIGINT NOT NULL REFERENCES users(id),
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    content       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (scope_type = 'company' OR scope_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ai_org_reports_scope ON ai_org_reports (scope_type, scope_id, created_at DESC);
ALTER TABLE ai_org_reports ENABLE ROW LEVEL SECURITY;
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
