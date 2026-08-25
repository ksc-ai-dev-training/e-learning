# 開発用シードデータ投入スクリプト（T-01 users のみ。開発用ログインのアカウント選択に使う）
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

        for email, name, role in USERS:
            await conn.execute(
                "INSERT INTO users (email, name, role) VALUES ($1, $2, $3)",
                email, name, role)

        print(f"シードデータを投入しました（{len(USERS)}件）")
    await database.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
