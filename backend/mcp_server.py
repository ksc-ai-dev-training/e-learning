# ManabiのMCP（Model Context Protocol）サーバー。Claude Code等のMCPクライアントに、教材の
# 検索・作成・取得/保存・マイ学習登録/解除・Web編集画面への案内（get_material_edit_url）を
# 「道具（ツール）」として公開する。
#
# 認証は既存のF-05 CLIトークン（Bearer、auth_helpers.resolve_current_user_from_token）を
# そのまま流用する（OAuth化は今回のスコープ外。実装計画参照）。各ツールはFastAPIの依存性注入を
# 経由せず、既存のルーターハンドラ関数をプロセス内で直接呼び出す。ルート（/materials/{id}系）に
# require_material_role(min_role="editor")の権限チェックが掛かっているエンドポイント
# （get_material_source・put_material_source・get_material_edit_url）は、そのチェッカー関数を
# 明示的に呼んでから実処理関数を呼ぶ（direct callではDependsによる権限チェックが自動実行されないため）。
import os
from urllib.parse import urlsplit

from fastapi.encoders import jsonable_encoder
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import MCPServer

from auth_helpers import CurrentUser, require_material_role, resolve_current_user_from_token
from database import get_pool
from routers.learning import register_my_learning, unregister_my_learning
from routers.materials import (
    MaterialCreate,
    _put_material_source_impl,
    create_material,
    get_material_source,
    search_materials,
)


def _resolve_public_base_url() -> str:
    """AuthSettingsのissuer_url/resource_server_url用。FRONTEND_URLはローカル開発では
    フロントエンド（Vite）自身のポートを指しており、MCPサーバーは常にバックエンド側にあるため
    使えない（A-04 cli/token応答のmanabi_url修正時に判明したのと同じ理由）。GOOGLE_REDIRECT_URI
    （auth.pyの_redirect_uriと同じ値。バックエンド自身のコールバックURL）からオリジンだけを
    取り出して使う方が正確（本番は単一オリジン構成のためFRONTEND_URLでも一致するが、この方式なら
    ローカル・本番どちらでも正しい値になる。2026-09-14）。"""
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI")
    if redirect_uri:
        parts = urlsplit(redirect_uri)
        return f"{parts.scheme}://{parts.netloc}"
    return (os.environ.get("FRONTEND_URL") or "http://localhost:5177").rstrip("/")


_PUBLIC_BASE_URL = _resolve_public_base_url()


class _ManabiTokenVerifier(TokenVerifier):
    """既存のCLIトークン検証をそのまま流用する。検証済みユーザーの属性はAccessToken.claimsに
    詰めて、_current_user()でCurrentUserへ復元する（ツール呼び出しのたびにDBへ再問い合わせしない）。"""

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            user = await resolve_current_user_from_token(token)
        except Exception:
            return None
        return AccessToken(
            token=token,
            client_id=f"manabi-user-{user.id}",
            scopes=[],
            subject=str(user.id),
            claims={
                "id": user.id, "email": user.email, "name": user.name, "role": user.role,
                "picture_url": user.picture_url, "token_type": user.token_type, "jti": user.jti,
            },
        )


def _current_user() -> CurrentUser:
    access_token = get_access_token()
    if access_token is None or access_token.claims is None:
        raise RuntimeError("認証情報が見つかりません")
    c = access_token.claims
    return CurrentUser(
        id=c["id"], email=c["email"], name=c["name"], role=c["role"],
        picture_url=c.get("picture_url"), token_type=c.get("token_type", "cli"), jti=c.get("jti"),
    )


mcp = MCPServer(
    name="manabi",
    instructions=(
        "社内学習管理システムManabiの教材を検索・作成・編集し、マイ学習への登録/解除を行うための"
        "道具を提供します。公開/非公開の切り替え・アーカイブ・削除・配信設定の変更など、ここに無い"
        "操作を依頼された場合はget_material_edit_urlでWeb編集画面のURLを案内してください。"
    ),
    token_verifier=_ManabiTokenVerifier(),
    auth=AuthSettings(
        issuer_url=_PUBLIC_BASE_URL,
        resource_server_url=f"{_PUBLIC_BASE_URL}/mcp",
        # 既存のCLIトークンはMCP専用のresource/audienceクレームを持たないため、
        # resource_server_urlとの一致検証はしない（TokenVerifier側で失効・有効期限のみ確認する）。
        validate_token_resource=False,
    ),
)


@mcp.tool(
    name="search_materials",
    description=(
        "教材を検索する。キーワード・タグ・プロジェクトIDで絞り込める。利用者が「〜に関する教材を"
        "探して」のように依頼したときに使う。公開済み（下書きを除く）の教材のみが対象。"
    ),
)
async def search_materials_tool(
    q: str | None = None,
    tags: str | None = None,
    project_id: int | None = None,
    required: bool | None = None,
    incomplete_only: bool = False,
    my_assignments_only: bool = False,
    page: int = 1,
    per_page: int = 20,
) -> dict:
    result = await search_materials(
        q=q, tags=tags, project_id=project_id, required=required,
        incomplete_only=incomplete_only, my_assignments_only=my_assignments_only,
        page=page, per_page=per_page, user=_current_user(),
    )
    return jsonable_encoder(result)


@mcp.tool(
    name="create_material",
    description=(
        "教材を新規作成する。利用者が新しい教材の作成を依頼したときに使う。project_idを省略すると"
        "「全社Wiki」プロジェクトに作成される。作成直後は目次が空の下書き状態になり、章・ページ・"
        "設問はget_material_source/put_material_sourceで書き込む。"
    ),
)
async def create_material_tool(
    title: str,
    project_id: int | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
) -> dict:
    body = MaterialCreate(title=title, project_id=project_id, description=description, tags=tags or [])
    result = await create_material(body=body, user=_current_user())
    return jsonable_encoder(result)


_source_role_checker = require_material_role(min_role="editor")


@mcp.tool(
    name="get_material_source",
    description=(
        "教材の中身（章・ページ・説明文・設問）を、フロントマター付きMarkdownテキストとして取得する。"
        "教材の編集を依頼されたときは、まずこれで現在の内容を取得してから編集する。"
    ),
)
async def get_material_source_tool(material_id: int) -> str:
    verified_user = await _source_role_checker(id=material_id, user=_current_user())
    response = await get_material_source(id=material_id, user=verified_user)
    return response.body.decode("utf-8")


@mcp.tool(
    name="put_material_source",
    description=(
        "教材の中身（章・ページ・説明文・設問）を、フロントマター付きMarkdownテキストで全置換保存する。"
        "get_material_sourceで取得したテキストを編集してから渡す。既存の目次・設問のうち、送信テキストに"
        "含まれないものは削除される（全置換）ため、必ず取得済みの内容をもとに編集すること。"
    ),
)
async def put_material_source_tool(material_id: int, source: str) -> str:
    verified_user = await _source_role_checker(id=material_id, user=_current_user())
    response = await _put_material_source_impl(
        id=material_id, text=source, user=verified_user, expected_updated_at=None, changed_via="mcp",
    )
    return response.body.decode("utf-8")


@mcp.tool(
    name="get_material_edit_url",
    description=(
        "教材の公開/非公開の切り替え、アーカイブ、削除、配信設定（必修/任意・期限）の変更など、"
        "他の道具では対応していない操作を依頼されたときに使う。対象教材をブラウザで開いて編集する"
        "ためのURLを返す。実際の操作はこのURL先の画面で利用者自身が行う必要がある（この道具自体は"
        "何も変更しない）。"
    ),
)
async def get_material_edit_url_tool(material_id: int) -> dict:
    await _source_role_checker(id=material_id, user=_current_user())
    row = await get_pool().fetchrow("SELECT project_id, title FROM materials WHERE id = $1", material_id)
    if row is None:
        raise ValueError(f"教材ID {material_id} が見つかりません")
    url = f"{_PUBLIC_BASE_URL}/projects/{row['project_id']}/materials/{material_id}/edit"
    return {
        "message": (
            f"「{row['title']}」の公開/非公開・アーカイブ・削除・配信設定の変更は、"
            "このURLの編集画面から行ってください。"
        ),
        "url": url,
    }


@mcp.tool(
    name="register_my_learning",
    description=(
        "指定した教材を自分の「マイ学習」に登録する。利用者が「〜をマイ学習に登録して」のように"
        "依頼したときに使う。"
    ),
)
async def register_my_learning_tool(material_id: int) -> dict:
    return jsonable_encoder(await register_my_learning(id=material_id, user=_current_user()))


@mcp.tool(
    name="unregister_my_learning",
    description="指定した教材を自分の「マイ学習」から外す。",
)
async def unregister_my_learning_tool(material_id: int) -> dict:
    return jsonable_encoder(await unregister_my_learning(id=material_id, user=_current_user()))


# main.pyでapp.mount("/mcp", mcp_asgi_app)する。streamable_http_path="/"にすることで、
# マウント先のパス（/mcp）自体がエンドポイントになる（既定の"/mcp"のままだと/mcp/mcpになってしまう）。
mcp_asgi_app = mcp.streamable_http_app(streamable_http_path="/")
