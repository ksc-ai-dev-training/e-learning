# 開発用シードデータ投入スクリプト（T-01 users, T-03 projects, T-04 project_memberships）
# 使い方: python seed.py（users テーブルが空のときのみ投入する）
import asyncio

import database

USERS = [
    # (email, name, role) — 実在の社員と紛らわしくならないよう、開発用の架空アカウントにする
    ("admin@example.com", "テスト管理者", "admin"),
    ("member1@example.com", "テストメンバー1", "member"),
    ("member2@example.com", "テストメンバー2", "member"),
    ("member3@example.com", "テストメンバー3", "member"),
]


async def main():
    pool = await database.init_pool()
    async with pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM users")
        if count > 0:
            print("users にデータが存在するためスキップしました")
            return

        user_ids = []
        for email, name, role in USERS:
            row = await conn.fetchrow(
                "INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id",
                email, name, role)
            user_ids.append(row["id"])

        # 全社公開プロジェクト（T-03.is_company_wide）。表示名は「全社Wiki」（v1.42、社内ナレッジベースと
        # しての位置づけを明確にするため改名。全社員が自動editorになる全社公開の仕組み自体は変更なし）。
        # 本番ではA-02（Googleログイン）の初回登録時に用意される想定だが、created_byがNOT NULLのため、
        # 開発環境ではユーザー投入後のここで作成する（先頭ユーザーを作成者とする）。
        company_wide = await conn.fetchrow(
            "INSERT INTO projects (name, created_by, is_company_wide) VALUES ($1, $2, true) RETURNING id",
            "全社Wiki", user_ids[0])

        for user_id in user_ids:
            await conn.execute(
                """INSERT INTO project_memberships (project_id, user_id, role, status, joined_at)
                   VALUES ($1, $2, 'editor', 'active', now())""",
                company_wide["id"], user_id)

        print(f"シードデータを投入しました（ユーザー{len(USERS)}件、全社公開プロジェクト1件）")
    await database.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
