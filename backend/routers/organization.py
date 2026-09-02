# A-09〜A-13, A-67, A-81, A-90〜A-93 プロジェクト・メンバー管理API（S-11, S-12）。
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from auth_helpers import ROLE_RANK, CurrentUser, check_project_role, require_auth
from database import get_pool

router = APIRouter(prefix="/api/projects", tags=["organization"])
memberships_router = APIRouter(prefix="/api/project-memberships", tags=["organization"])


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)


@router.post("", status_code=201)
async def create_project(body: ProjectCreate, user: CurrentUser = Depends(require_auth)):
    """A-09: プロジェクト作成（S-11）。誰でも作成でき、作成者は自動的にそのプロジェクトの
    ローカル管理者（project_memberships.role='admin'）になる。is_company_wideは常にfalseで
    作成する（is_company_wide=trueの行は全社Wiki1件のみで、マイグレーションでのみ投入する。
    基本設計書5.26節）。"""
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            project = await conn.fetchrow(
                """INSERT INTO projects (name, description, created_by)
                   VALUES ($1, $2, $3)
                   RETURNING id, name, description, status, is_company_wide, created_by,
                             created_at, updated_at""",
                body.name, body.description, user.id,
            )
            await conn.execute(
                """INSERT INTO project_memberships (project_id, user_id, role, status, joined_at)
                   VALUES ($1, $2, 'admin', 'active', now())""",
                project["id"], user.id,
            )
    return dict(project)


@router.get("")
async def list_projects(min_role: str = "editor", user: CurrentUser = Depends(require_auth)):
    """A-81: 自分がmin_role以上のプロジェクト一覧（教材件数・メンバー数つき）。全社公開を先頭固定。
    既定はeditor（S-13教材編集：プロジェクト選択と同じ、従来どおり）。S-03（教材一覧・検索）は
    min_role='learner'を指定し、学習者としてのみ参加しているプロジェクトも含める（新規、2026-08-28）。"""
    if min_role not in ROLE_RANK:
        raise HTTPException(422, detail="min_roleが不正です")
    allowed_roles = [r for r, rank in ROLE_RANK.items() if rank >= ROLE_RANK[min_role]]
    rows = await get_pool().fetch(
        """
        SELECT
            p.id,
            p.name,
            p.is_company_wide,
            pm.role,
            COALESCE(mc.published_count, 0) AS material_published_count,
            COALESCE(mc.draft_count, 0) AS material_draft_count,
            COALESCE(memc.member_count, 0) AS member_count
        FROM projects p
        JOIN project_memberships pm
            ON pm.project_id = p.id AND pm.user_id = $1
            AND pm.status = 'active' AND pm.role = ANY($2::text[])
        LEFT JOIN (
            SELECT project_id,
                COUNT(*) FILTER (WHERE status = 'published') AS published_count,
                COUNT(*) FILTER (WHERE status = 'draft') AS draft_count
            FROM materials
            WHERE is_archived = false
            GROUP BY project_id
        ) mc ON mc.project_id = p.id
        LEFT JOIN (
            SELECT project_id, COUNT(*) AS member_count
            FROM project_memberships
            WHERE status = 'active' AND left_at IS NULL
            GROUP BY project_id
        ) memc ON memc.project_id = p.id
        WHERE p.status = 'active'
        ORDER BY p.is_company_wide DESC, p.name ASC
        """,
        user.id, allowed_roles,
    )
    return {"items": [dict(r) for r in rows]}


async def _delete_blocked_reason(pool, project_id: int, is_company_wide: bool, requester_user_id: int) -> str | None:
    """プロジェクトの完全削除（A-93）を拒否すべき理由を1つ返す（無ければNone）。全社Wikiは常に
    不可。自分以外の現役メンバーがいる場合も不可（先にメンバーを外してもらう運用を想定）。A-91の
    can_delete算出とA-93本体の両方から呼ぶ共通ロジック（判定基準を1箇所にまとめるため）。

    教材の受講記録判定は、実際にquiz_attempts・enrollment_progress・survey_responsesの行が
    存在するかを直接確認する（2026-09-02、実データ判定に変更）。当初は「公開済み・アーカイブ済みの
    教材が1件でもあれば、実データの有無を見ずに一律で拒否する」という`materials.status != 'draft'`
    のみの粗い判定だった（F-30と同じ理由づけを流用したもの）。これはF-32設計当時、S-16（受講画面）が
    未実装で実データを作る手段自体が無かったための簡略化だったが、S-16実装後は「一度も受講されて
    いない公開済み教材を含むだけのプロジェクト」でも削除できてしまう誤検知が起きるようになった
    （ユーザー報告により発見。公開済みだが受験記録0件のテスト用プロジェクトが「受講記録が残っている」
    という誤った理由で削除できなかった）。実データの存在を直接見ることで、より正確に判定する。"""
    if is_company_wide:
        return "全社Wikiは全社員が利用するプロジェクトのため削除できません。停止のみ可能です。"
    has_learning_records = await pool.fetchval(
        """SELECT EXISTS(
               SELECT 1 FROM materials m
               WHERE m.project_id = $1
                 AND (
                   EXISTS(SELECT 1 FROM quiz_attempts qa WHERE qa.material_id = m.id)
                   OR EXISTS(SELECT 1 FROM enrollment_progress ep WHERE ep.material_id = m.id)
                   OR EXISTS(
                       SELECT 1 FROM survey_responses sr
                       JOIN surveys s ON s.id = sr.survey_id
                       WHERE s.material_id = m.id
                   )
                 )
           )""",
        project_id,
    )
    if has_learning_records:
        return "このプロジェクトの教材には受講記録が残っているため削除できません。停止のみ可能です。"
    has_other_members = await pool.fetchval(
        """SELECT EXISTS(
               SELECT 1 FROM project_memberships
               WHERE project_id = $1 AND status = 'active' AND left_at IS NULL AND user_id != $2
           )""",
        project_id, requester_user_id,
    )
    if has_other_members:
        return "自分以外のメンバーが参加しているため削除できません。停止のみ可能です。"
    return None


@router.get("/{id}")
async def get_project(id: int, user: CurrentUser = Depends(require_auth)):
    """A-91: プロジェクト詳細（S-12プロジェクト情報タブ）。A-81（一覧）は名称・件数の
    要約のみでdescription/created_by/created_atを含まないため、A-10（更新）と対になる単体取得
    APIとして新設した。権限はA-10と同じ（対象プロジェクトの管理者, admin）。can_delete・
    cannot_delete_reasonを追加した（2026-09-01。S-12の削除ボタンを、押してからエラーになる
    のではなく最初から無効化＋理由表示できるようにするため、A-93と同じ判定を事前に返す）。"""
    pool = get_pool()
    await check_project_role(user, id, min_role="admin")
    row = await pool.fetchrow(
        """SELECT p.id, p.name, p.description, p.status, p.is_company_wide,
                  p.created_by, u.name AS created_by_name, p.created_at, p.updated_at
           FROM projects p JOIN users u ON u.id = p.created_by
           WHERE p.id = $1""",
        id,
    )
    if row is None:
        raise HTTPException(404, detail="プロジェクトが見つかりません")
    reason = await _delete_blocked_reason(pool, id, row["is_company_wide"], user.id)
    result = dict(row)
    result["can_delete"] = reason is None
    result["cannot_delete_reason"] = reason
    return result


@router.delete("/{id}", status_code=204)
async def delete_project(id: int, user: CurrentUser = Depends(require_auth)):
    """A-93（新規）: プロジェクトの完全削除。判定基準は_delete_blocked_reason参照（全社Wiki不可・
    実際の受講記録〔quiz_attempts・enrollment_progress・survey_responses〕が無いこと・自分以外の
    現役メンバーがいないこと）。判定を通過した時点で対象教材に実データが存在しないことは保証されて
    いるため、DELETE FROM materialsだけで目次・設問・添付・改訂履歴・（空の）受験記録・受講進捗・
    アンケート回答までCASCADEで消える（各テーブルのmaterial_id系FKがすべてON DELETE CASCADE済み）。"""
    pool = get_pool()
    await check_project_role(user, id, min_role="admin")
    row = await pool.fetchrow("SELECT is_company_wide FROM projects WHERE id = $1", id)
    if row is None:
        raise HTTPException(404, detail="プロジェクトが見つかりません")
    reason = await _delete_blocked_reason(pool, id, row["is_company_wide"], user.id)
    if reason is not None:
        raise HTTPException(400, detail=reason)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM materials WHERE project_id = $1", id)
            await conn.execute("DELETE FROM project_memberships WHERE project_id = $1", id)
            await conn.execute("DELETE FROM projects WHERE id = $1", id)


class ProjectUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    status: Literal["active", "completed"]


@router.put("/{id}")
async def update_project(id: int, body: ProjectUpdate, user: CurrentUser = Depends(require_auth)):
    """A-10: プロジェクト情報（名称・説明・状態）更新。

    全社Wiki（is_company_wide=true）の名称・説明も変更を許可する。基本設計書5.26節の当初案は
    「全社Wikiはstatusのみ変更可、name/descriptionは400で拒否」だったが、S-12実装時にユーザーと
    再検討した結果、この案から撤回した。理由: 全社Wikiの管理者はシステム管理者のみであり
    （A-12/A-13が全社Wikiに対するrole='admin'の付与・変更を拒否することで担保する。5.26節の
    本来の防御対象は「システムadminでない人物が全社Wikiの管理者になり名称等を操作できてしまう
    こと」であり、name/description自体の変更操作を一律禁止する必要は無いと判断した）、
    その防御さえ機能していれば、システム管理者本人による名称・説明の変更を禁止する積極的な理由は
    無い（2026-09-01）。"""
    pool = get_pool()
    await check_project_role(user, id, min_role="admin")
    row = await pool.fetchrow("SELECT is_company_wide, name, description FROM projects WHERE id = $1", id)
    if row is None:
        raise HTTPException(404, detail="プロジェクトが見つかりません")
    updated = await pool.fetchrow(
        """UPDATE projects SET name = $1, description = $2, status = $3, updated_at = now()
           WHERE id = $4
           RETURNING id, name, description, status, is_company_wide, created_by, created_at, updated_at""",
        body.name, body.description, body.status, id,
    )
    return dict(updated)


class ProjectStatusUpdate(BaseModel):
    status: Literal["active", "completed"]


@router.put("/{id}/status")
async def update_project_status(id: int, body: ProjectStatusUpdate, user: CurrentUser = Depends(require_auth)):
    """A-92（新規）: プロジェクトの状態のみを変更する軽量API。S-12新設の「自分の全プロジェクト
    一覧」パネルから、名称・説明を読み込まずその場で状態（進行中/停止）を切り替えられるように
    するため新設した（A-10は名称・説明も必須のフル更新のため、一覧上のワンクリック切り替えには
    冗長）。停止済みプロジェクトをactiveへ戻す（再開）操作もこのAPIで行う。"""
    pool = get_pool()
    await check_project_role(user, id, min_role="admin")
    row = await pool.fetchrow(
        "UPDATE projects SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, status",
        body.status, id,
    )
    if row is None:
        raise HTTPException(404, detail="プロジェクトが見つかりません")
    return dict(row)


@router.get("/{id}/member-candidates")
async def list_member_candidates(id: int, q: str | None = None, user: CurrentUser = Depends(require_auth)):
    """A-90（新規）: S-12メンバー管理タブの招待先検索。対象プロジェクトの現役メンバー・招待中の
    ユーザーは候補から除外する。A-53（GET /api/users）はシステムadmin専用のユーザー管理（S-10）用の
    ため、プロジェクトのローカル管理者が使う招待候補検索には別途軽量なAPIが必要と判断し新設した。"""
    await check_project_role(user, id, min_role="admin")
    conditions = [
        "u.is_active = true",
        """NOT EXISTS (
             SELECT 1 FROM project_memberships pm
              WHERE pm.project_id = $1 AND pm.user_id = u.id
                AND pm.status IN ('invited', 'active') AND pm.left_at IS NULL
           )""",
    ]
    params: list = [id]
    if q:
        params.append(f"%{q}%")
        conditions.append(f"(u.name ILIKE ${len(params)} OR u.email ILIKE ${len(params)})")
    rows = await get_pool().fetch(
        f"""SELECT u.id, u.name, u.email, u.role FROM users u
            WHERE {' AND '.join(conditions)}
            ORDER BY u.name LIMIT 50""",
        *params,
    )
    return {"items": [dict(r) for r in rows]}


async def _reject_admin_role_for_company_wide(pool, project_id: int, role: str | None) -> None:
    """全社Wikiの管理者はシステム管理者のみとし、通常のメンバー管理API（A-12/A-13）では
    新たに作成・変更できない（基本設計書5.26節）。A-12（招待）・A-13（ロール変更）の両方から
    呼ぶ共通ガード。role以外（削除等）を扱う呼び出しではrole=Noneで呼び、常に素通りさせる。"""
    if role != "admin":
        return
    is_company_wide = await pool.fetchval("SELECT is_company_wide FROM projects WHERE id = $1", project_id)
    if is_company_wide:
        raise HTTPException(
            400, detail="全社Wikiの管理者はシステム管理者のみです。編集者・受講者のみ指定できます"
        )


class MemberInvite(BaseModel):
    user_id: int
    role: Literal["admin", "editor", "learner"]


@router.post("/{id}/members", status_code=201)
async def invite_member(id: int, body: MemberInvite, user: CurrentUser = Depends(require_auth)):
    """A-12: メンバーを招待する（status='invited'で作成）。招待した時点では権限は発生せず、
    招待された本人がA-67で承諾して初めてメンバーとして有効になる。"""
    pool = get_pool()
    await check_project_role(user, id, min_role="admin")
    await _reject_admin_role_for_company_wide(pool, id, body.role)
    existing = await pool.fetchval(
        """SELECT 1 FROM project_memberships
            WHERE project_id = $1 AND user_id = $2
              AND status IN ('invited', 'active') AND left_at IS NULL""",
        id, body.user_id,
    )
    if existing:
        raise HTTPException(400, detail="既に招待済み、または参加済みのメンバーです")
    row = await pool.fetchrow(
        """INSERT INTO project_memberships (project_id, user_id, role, status, assigned_by)
           VALUES ($1, $2, $3, 'invited', $4)
           RETURNING id, user_id, project_id, role, status, joined_at, left_at""",
        id, body.user_id, body.role, user.id,
    )
    return dict(row)


class MemberUpdate(BaseModel):
    role: Literal["admin", "editor", "learner"] | None = None
    action: Literal["remove"] | None = None

    @model_validator(mode="after")
    def _validate(self):
        if (self.role is None) == (self.action is None):
            raise ValueError("roleまたはactionのいずれか一方を指定してください")
        return self


@router.put("/{id}/members/{user_id}")
async def update_member(
    id: int, user_id: int, body: MemberUpdate, user: CurrentUser = Depends(require_auth)
):
    """A-13: メンバーのロール変更、またはプロジェクトからの削除（left_at=now()を設定する論理削除。
    招待中のまま削除も可）。唯一の管理者の削除・降格は400（基本設計書4.2節callout参照）。"""
    pool = get_pool()
    await check_project_role(user, id, min_role="admin")
    await _reject_admin_role_for_company_wide(pool, id, body.role)
    row = await pool.fetchrow(
        "SELECT role, status, left_at FROM project_memberships WHERE project_id = $1 AND user_id = $2",
        id, user_id,
    )
    if row is None:
        raise HTTPException(404, detail="メンバーが見つかりません")

    is_active_admin = row["role"] == "admin" and row["status"] == "active" and row["left_at"] is None
    demoting_or_removing = body.action == "remove" or (body.role is not None and body.role != "admin")
    if is_active_admin and demoting_or_removing:
        admin_count = await pool.fetchval(
            """SELECT COUNT(*) FROM project_memberships
                WHERE project_id = $1 AND role = 'admin' AND status = 'active' AND left_at IS NULL""",
            id,
        )
        if admin_count <= 1:
            raise HTTPException(400, detail="プロジェクトの管理者が不在になるため、この操作はできません")

    if body.action == "remove":
        updated = await pool.fetchrow(
            """UPDATE project_memberships SET left_at = now(), updated_at = now()
               WHERE project_id = $1 AND user_id = $2
               RETURNING id, user_id, project_id, role, status, joined_at, left_at""",
            id, user_id,
        )
    else:
        updated = await pool.fetchrow(
            """UPDATE project_memberships SET role = $1, updated_at = now()
               WHERE project_id = $2 AND user_id = $3
               RETURNING id, user_id, project_id, role, status, joined_at, left_at""",
            body.role, id, user_id,
        )
    return dict(updated)


class MembershipRespond(BaseModel):
    status: Literal["active", "declined"]


@memberships_router.put("/{id}/respond")
async def respond_membership(id: int, body: MembershipRespond, user: CurrentUser = Depends(require_auth)):
    """A-67: 招待への応答。本人のみ実行できる。承諾時はjoined_atを設定する。
    現時点ではS-15（プロフィール編集、招待一覧・承諾UI）は未実装のため、この応答APIを呼ぶ
    フロントエンドの導線はまだ無い（S-15着手時に追加する）。"""
    pool = get_pool()
    row = await pool.fetchrow("SELECT user_id FROM project_memberships WHERE id = $1", id)
    if row is None:
        raise HTTPException(404, detail="招待が見つかりません")
    if row["user_id"] != user.id:
        raise HTTPException(403, detail="この操作を行う権限がありません")
    if body.status == "active":
        updated = await pool.fetchrow(
            """UPDATE project_memberships SET status = 'active', joined_at = now(), updated_at = now()
               WHERE id = $1
               RETURNING id, user_id, project_id, role, status, joined_at, left_at""",
            id,
        )
    else:
        updated = await pool.fetchrow(
            """UPDATE project_memberships SET status = 'declined', updated_at = now()
               WHERE id = $1
               RETURNING id, user_id, project_id, role, status, joined_at, left_at""",
            id,
        )
    return dict(updated)


@memberships_router.get("")
async def list_project_memberships(
    project_id: int | None = None,
    user_id: int | None = None,
    status: str | None = None,
    user: CurrentUser = Depends(require_auth),
):
    """A-11: プロジェクトメンバー一覧。project_id指定時は対象プロジェクトの編集者以上（S-05の
    プロジェクトメンバータブが参照専用で編集者にも見せる仕様のため、4.2節の「管理者のみ」から緩和した）。
    user_id指定時は本人またはadminのみ。project_status（プロジェクト自体のstatus）を追加した
    （S-12新設の「自分の全プロジェクト一覧」パネルが、状態で行を絞り込む・表示するために必要。
    2026-09-01）。"""
    if project_id is None and user_id is None:
        raise HTTPException(400, detail="project_id または user_id のいずれかが必要です")
    if project_id is not None:
        await check_project_role(user, project_id, min_role="editor")
    elif user_id != user.id and user.role != "admin":
        raise HTTPException(403, detail="この操作を行う権限がありません")

    conditions = []
    params: list = []
    if project_id is not None:
        params.append(project_id)
        conditions.append(f"pm.project_id = ${len(params)}")
    if user_id is not None:
        params.append(user_id)
        conditions.append(f"pm.user_id = ${len(params)}")
    if status is not None:
        params.append(status)
        conditions.append(f"pm.status = ${len(params)}")

    rows = await get_pool().fetch(
        f"""SELECT pm.id, pm.user_id, u.name AS user_name, u.role AS global_role,
                   pm.project_id, p.name AS project_name, p.status AS project_status,
                   pm.role, pm.status, pm.joined_at, pm.left_at
            FROM project_memberships pm
            JOIN users u ON u.id = pm.user_id
            JOIN projects p ON p.id = pm.project_id
            WHERE {' AND '.join(conditions)}
            ORDER BY pm.joined_at ASC""",
        *params,
    )
    return {"items": [dict(r) for r in rows]}


@router.get("/{id}/incoming-shares")
async def list_incoming_shares(id: int, status: str = "pending", user: CurrentUser = Depends(require_auth)):
    """A-66: 自プロジェクト宛ての教材共有申請一覧（F-26、基本設計書5.27節）。対象プロジェクトの
    管理者・システムadminのみ閲覧できる。statusは既定でpending（承認待ち）のみを返す。"""
    await check_project_role(user, id, min_role="admin")
    rows = await get_pool().fetch(
        """SELECT s.id, s.material_id, m.title AS material_title,
                  m.project_id AS shared_by_project_id, p.name AS shared_by_project_name,
                  s.shared_at, s.status
           FROM material_project_shares s
           JOIN materials m ON m.id = s.material_id
           JOIN projects p ON p.id = m.project_id
           WHERE s.shared_to_project_id = $1 AND s.status = $2
           ORDER BY s.shared_at DESC""",
        id, status,
    )
    return {"items": [dict(r) for r in rows]}
