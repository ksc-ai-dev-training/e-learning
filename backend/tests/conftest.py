# 受験・採点まわり（backend/routers/learning.py）の自動テスト用フィクスチャ。
#
# 開発中のDB（manabi、ローカルサーバーが使っている実データ）には一切触れず、必ず別DB
# （既定: manabi_test）に対して実行する。TEST_DATABASE_URL環境変数で上書きできる
# （CI・backend/tests/README.md参照）。この設定は他のどのモジュールをimportするより前に
# 行う必要があるため、このファイルの先頭で行う（database.pyはimport時に一度だけ
# DATABASE_URLを解決するため）。
import os

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://manabi:manabi@localhost:55433/manabi_test"
)
os.environ.setdefault("APP_ENV", "development")  # AUTO_MIGRATEを有効にする（本番判定を避ける）
os.environ.setdefault("AUTO_MIGRATE", "1")

import uuid

import pytest

import database
from auth_helpers import CurrentUser


@pytest.fixture(scope="session")
async def pool():
    p = await database.init_pool()
    yield p


@pytest.fixture
def make_user(pool):
    """テスト用ユーザーを作成し、そのままrouterへ渡せるCurrentUserを返す。"""

    async def _make(role: str = "member") -> CurrentUser:
        email = f"test-{uuid.uuid4().hex}@example.com"
        row = await pool.fetchrow(
            "INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id",
            email, f"Test {email}", role,
        )
        return CurrentUser(id=row["id"], email=email, name="Test User", role=role, picture_url=None)

    return _make


@pytest.fixture
def make_project(pool, make_user):
    """テスト用プロジェクトを作成し、指定ユーザーをそのロールでメンバー登録する
    （既定はadmin。_require_view_access等の判定はプロジェクトロール基準のため、
    受験系のテストではadminにしておけば下書き・公開いずれの教材も問題なく扱える）。"""

    async def _make(owner: CurrentUser, member_role: str = "admin") -> int:
        row = await pool.fetchrow(
            "INSERT INTO projects (name, created_by) VALUES ($1, $2) RETURNING id",
            f"Test Project {uuid.uuid4().hex[:8]}", owner.id,
        )
        project_id = row["id"]
        await pool.execute(
            """INSERT INTO project_memberships (project_id, user_id, role, status, joined_at)
               VALUES ($1, $2, $3, 'active', now())""",
            project_id, owner.id, member_role,
        )
        return project_id

    return _make


@pytest.fixture
def make_material(pool):
    """教材1件＋章1件＋ページ1件を作成し、material_idとpage_node_idを返す。
    設問は make_question で後から個別に追加する。"""

    async def _make(
        project_id: int,
        owner_id: int,
        *,
        attempt_scope: str = "material",
        retake_scope: str = "all",
        pass_score_pct: float | None = 70.0,
        retake_allowed: bool = True,
        retake_limit: int | None = None,
        status: str = "published",
    ) -> dict:
        material_row = await pool.fetchrow(
            """INSERT INTO materials
                   (project_id, title, created_by, status, attempt_scope, retake_scope,
                    pass_score_pct, retake_allowed, retake_limit)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING id""",
            project_id, f"Test Material {uuid.uuid4().hex[:8]}", owner_id, status,
            attempt_scope, retake_scope, pass_score_pct, retake_allowed, retake_limit,
        )
        material_id = material_row["id"]
        chapter_row = await pool.fetchrow(
            """INSERT INTO material_nodes (material_id, kind, title, sort_order)
               VALUES ($1, 'chapter', '第1章', 0) RETURNING id""",
            material_id,
        )
        page_row = await pool.fetchrow(
            """INSERT INTO material_nodes (material_id, parent_node_id, kind, title, sort_order)
               VALUES ($1, $2, 'page', 'ページ1', 0) RETURNING id""",
            material_id, chapter_row["id"],
        )
        return {"material_id": material_id, "chapter_node_id": chapter_row["id"], "page_node_id": page_row["id"]}

    return _make


@pytest.fixture
def make_question(pool):
    """単一選択の設問を1件追加する（正解は選択肢のうち"correct"固定）。"""

    async def _make(
        material_id: int,
        node_id: int,
        *,
        sort_order: int = 0,
        is_critical: bool = False,
        required: bool = True,
        counted: bool = True,
    ) -> int:
        row = await pool.fetchrow(
            """INSERT INTO questions
                   (material_id, node_id, type, prompt, options, correct_answer, sort_order,
                    is_critical, required, counted)
               VALUES ($1, $2, 'single', $3, $4, $5, $6, $7, $8, $9)
               RETURNING id""",
            material_id, node_id, f"設問{sort_order}", '["correct", "wrong"]', '"correct"',
            sort_order, is_critical, required, counted,
        )
        return row["id"]

    return _make
