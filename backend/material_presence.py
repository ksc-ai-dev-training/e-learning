# S-05/S-17編集画面の在席確認・更新検知（advisory presence）。悲観ロックは取らない
# （ロックのライフサイクル管理コストが実際の衝突頻度に見合わないという判断、2026-09検討）。
# 本番はFly.io単一マシン・単一uvicornワーカーのため、プロセス内メモリで完結させる。
# asyncioは単一スレッドのイベントループのため、touch()内にawaitが無く、
# 複数コルーチンが辞書操作の途中に割り込むことはない（=ロック不要）。
# ただし将来複数ワーカー/複数マシンに水平スケールする場合は各プロセスが別々の辞書を
# 持つため在席情報がプロセス間で共有されず機能が実質的に働かなくなる（クラッシュはしない）。
# その場合はRedis等の外部ストアへの置き換えが必要。
import time

_PRESENCE_TTL_SECONDS = 90  # これより古いエントリは読み取り時に間引く（能動的なsweepジョブは持たない）

# material_id -> {user_id: (name, last_seen_monotonic)}
_presence: dict[int, dict[int, tuple[str, float]]] = {}


def touch(material_id: int, user_id: int, name: str) -> list[dict]:
    """呼び出したuser_idの在席を更新し、他の在席者（自分を除く、TTL以内）を返す。"""
    now = time.monotonic()
    bucket = _presence.setdefault(material_id, {})
    bucket[user_id] = (name, now)

    others: list[dict] = []
    stale: list[int] = []
    for uid, (uname, last_seen) in bucket.items():
        if uid == user_id:
            continue
        age = now - last_seen
        if age > _PRESENCE_TTL_SECONDS:
            stale.append(uid)
            continue
        others.append({"user_id": uid, "name": uname, "seconds_ago": int(age)})
    for uid in stale:
        del bucket[uid]
    return others
