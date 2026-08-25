# 開発用シードデータ投入スクリプト（T-01 users, T-03 projects, T-04 project_memberships）
# 使い方: python seed.py（users テーブルが空のときのみ投入する）
import asyncio

import database

USERS = [
    # (email, name, role)
    ("kimura@kogasoftware.com", "木村 拓也", "admin"),
    ("sato@kogasoftware.com", "佐藤 健一", "member"),
    ("suzuki@kogasoftware.com", "鈴木 一郎", "member"),
    ("tanaka@kogasoftware.com", "田中 美咲", "member"),
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

        # 「全社公開」プロジェクト（T-03.is_company_wide）。
        # 本来はA-02（Googleログイン、未実装）の初回登録時にDB起動時マイグレーションで用意される想定だが
        # created_byがNOT NULLのため、開発環境ではユーザー投入後のここで作成する（先頭ユーザーを作成者とする）。
        company_wide = await conn.fetchrow(
            "INSERT INTO projects (name, created_by, is_company_wide) VALUES ($1, $2, true) RETURNING id",
            "全社公開", user_ids[0])

        for user_id in user_ids:
            await conn.execute(
                """INSERT INTO project_memberships (project_id, user_id, role, status, joined_at)
                   VALUES ($1, $2, 'editor', 'active', now())""",
                company_wide["id"], user_id)

        print(f"シードデータを投入しました（ユーザー{len(USERS)}件、全社公開プロジェクト1件）")
    await database.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
