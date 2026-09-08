# 受講状況ダッシュボードAPI（A-45/A-46。S-08、詳細設計書4.6節）。
# AI組織レポート（A-48/A-49、F-23）はreports.pyに置く（パスを/api/reports/org配下に揃えるため。
# 集計本体（_aggregate_dashboard_stats）はここからreports.pyがimportして再利用する）。
from fastapi import APIRouter, Depends, HTTPException

from auth_helpers import CurrentUser, require_auth
from database import get_pool
from routers.learning import _require_project_admin

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _parse_scope(scope: str) -> tuple[str, int | None]:
    """scopeクエリ（"company" または "project:{id}"）をパースする（A-45）。"""
    if scope == "company":
        return "company", None
    if scope.startswith("project:"):
        try:
            return "project", int(scope.removeprefix("project:"))
        except ValueError:
            pass
    raise HTTPException(422, detail="scopeが不正です")


async def require_dashboard_scope(scope_type: str, scope_id: int | None, user: CurrentUser) -> None:
    """S-08の閲覧権限（基本設計書4.10節）: 全社スコープはシステムadminのみ、プロジェクトスコープは
    そのプロジェクトの管理者またはシステムadmin（S-12と同じ_require_project_adminをそのまま使う。
    editorは対象外、2026-09-08ユーザー確認）。"""
    if scope_type == "company":
        if user.role != "admin":
            raise HTTPException(403, detail="この操作を行う権限がありません")
        return
    await _require_project_admin(scope_id, user)
    exists = await get_pool().fetchval("SELECT 1 FROM projects WHERE id = $1", scope_id)
    if not exists:
        raise HTTPException(404, detail="プロジェクトが見つかりません")


async def _aggregate_dashboard_stats(scope_type: str, scope_id: int | None) -> dict:
    """A-45の集計本体。プロジェクトスコープは対象プロジェクトの現役メンバー、全社スコープは
    全プロジェクト横断（教材ごとにその教材が属するプロジェクトのメンバーを対象にする）で集計する。
    個人名は一切含めない（F-23プロンプトにもそのまま渡せる粒度、基本設計書9.5節）。"""
    pool = get_pool()
    project_filter = "AND m.project_id = $1" if scope_type == "project" else ""
    args = [scope_id] if scope_type == "project" else []

    by_material_rows = await pool.fetch(
        f"""SELECT m.id AS material_id, m.title AS material_title, a.due_at,
                   COUNT(DISTINCT pm.user_id) AS member_count,
                   COUNT(DISTINCT pm.user_id) FILTER (
                       WHERE COALESCE(ep.status, 'not_started') = 'completed'
                   ) AS completed_count
            FROM materials m
            JOIN assignments a ON a.material_id = m.id AND a.required = true
                 AND a.scope_type = 'project' AND a.scope_id = m.project_id
            JOIN project_memberships pm ON pm.project_id = m.project_id
                 AND pm.status = 'active' AND pm.left_at IS NULL
            LEFT JOIN enrollment_progress ep ON ep.material_id = m.id AND ep.user_id = pm.user_id
            WHERE m.status = 'published' AND m.is_archived = false {project_filter}
            GROUP BY m.id, m.title, a.due_at
            ORDER BY m.title ASC""",
        *args,
    )
    by_material = [
        {
            "material_id": r["material_id"],
            "material_title": r["material_title"],
            "member_count": r["member_count"],
            "completed_count": r["completed_count"],
            "completion_rate": round(100 * r["completed_count"] / r["member_count"]) if r["member_count"] else 0,
        }
        for r in by_material_rows
    ]

    total_member_slots = sum(r["member_count"] for r in by_material)
    total_completed_slots = sum(r["completed_count"] for r in by_material)
    required_completion_rate = round(100 * total_completed_slots / total_member_slots) if total_member_slots else 0

    incomplete_count = await pool.fetchval(
        f"""SELECT COUNT(DISTINCT pm.user_id)
            FROM materials m
            JOIN assignments a ON a.material_id = m.id AND a.required = true
                 AND a.scope_type = 'project' AND a.scope_id = m.project_id
            JOIN project_memberships pm ON pm.project_id = m.project_id
                 AND pm.status = 'active' AND pm.left_at IS NULL
            LEFT JOIN enrollment_progress ep ON ep.material_id = m.id AND ep.user_id = pm.user_id
            WHERE m.status = 'published' AND m.is_archived = false {project_filter}
              AND COALESCE(ep.status, 'not_started') != 'completed'""",
        *args,
    )

    pass_counts = await pool.fetchrow(
        f"""SELECT COUNT(*) FILTER (WHERE latest.passed = true) AS passed_count, COUNT(*) AS attempted_count
            FROM (
                SELECT DISTINCT m.id AS material_id, pm.user_id
                FROM materials m
                JOIN assignments a ON a.material_id = m.id AND a.required = true
                     AND a.scope_type = 'project' AND a.scope_id = m.project_id
                JOIN project_memberships pm ON pm.project_id = m.project_id
                     AND pm.status = 'active' AND pm.left_at IS NULL
                WHERE m.status = 'published' AND m.is_archived = false {project_filter}
            ) pairs
            JOIN LATERAL (
                SELECT passed FROM quiz_attempts qa
                 WHERE qa.material_id = pairs.material_id AND qa.user_id = pairs.user_id
                   AND qa.mode = 'graded' AND qa.submitted_at IS NOT NULL
                   AND EXISTS (SELECT 1 FROM answers ans JOIN questions q ON q.id = ans.question_id
                                WHERE ans.attempt_id = qa.id AND q.type != 'score_log')
                 ORDER BY qa.submitted_at DESC LIMIT 1
            ) latest ON true""",
        *args,
    )
    pass_rate = (
        round(100 * pass_counts["passed_count"] / pass_counts["attempted_count"])
        if pass_counts["attempted_count"]
        else 0
    )

    return {
        "target_material_count": len(by_material),
        "required_completion_rate": required_completion_rate,
        "pass_rate": pass_rate,
        "incomplete_count": incomplete_count,
        "by_material": by_material,
    }


@router.get("")
async def get_dashboard(scope: str, user: CurrentUser = Depends(require_auth)):
    """A-45: 受講状況ダッシュボードの集計（S-08）。"""
    scope_type, scope_id = _parse_scope(scope)
    await require_dashboard_scope(scope_type, scope_id, user)
    return await _aggregate_dashboard_stats(scope_type, scope_id)


@router.get("/incomplete-users")
async def get_incomplete_users(scope: str, material_id: int | None = None, user: CurrentUser = Depends(require_auth)):
    """A-46: 未受講者一覧（S-08）。個人名を返すのはこのAPIのみで、Slack等の外部送信には使わない
    （未受講者一覧はManabi画面上の表示のみ。個別の催促は運用で管理者が直接連絡する方針、S-12と同じ。
    2026-09-08、モックアップの行ごとSlackボタンは実装しない方針に変更した）。"""
    scope_type, scope_id = _parse_scope(scope)
    await require_dashboard_scope(scope_type, scope_id, user)
    project_filter = "AND m.project_id = $1" if scope_type == "project" else ""
    args: list = [scope_id] if scope_type == "project" else []
    if material_id is not None:
        args.append(material_id)
        material_filter = f"AND m.id = ${len(args)}"
    else:
        material_filter = ""
    rows = await get_pool().fetch(
        f"""SELECT pm.user_id, u.name AS user_name, m.id AS material_id, m.title AS material_title, a.due_at
            FROM materials m
            JOIN assignments a ON a.material_id = m.id AND a.required = true
                 AND a.scope_type = 'project' AND a.scope_id = m.project_id
            JOIN project_memberships pm ON pm.project_id = m.project_id
                 AND pm.status = 'active' AND pm.left_at IS NULL
            JOIN users u ON u.id = pm.user_id
            LEFT JOIN enrollment_progress ep ON ep.material_id = m.id AND ep.user_id = pm.user_id
            WHERE m.status = 'published' AND m.is_archived = false {project_filter} {material_filter}
              AND COALESCE(ep.status, 'not_started') != 'completed'
            ORDER BY a.due_at ASC NULLS LAST, u.name ASC""",
        *args,
    )
    return {"items": [dict(r) for r in rows]}
