# backend/tests

受験・採点まわり（`routers/learning.py`）の自動テスト。ローカル開発DB（`manabi`）とは別の
使い捨てDB（既定: `manabi_test`）に対して実行するため、開発中のデータには触れない。

## ローカルでの実行手順

1. 初回のみ、テスト用DBを作成する（ローカルのPostgresサーバーに対して1回だけ）:
   ```
   psql postgresql://manabi:manabi@localhost:55433/manabi -c "CREATE DATABASE manabi_test"
   ```
2. 開発用の依存関係を入れる:
   ```
   .venv/Scripts/pip install -r requirements-dev.txt
   ```
3. 実行:
   ```
   .venv/Scripts/pytest
   ```

`TEST_DATABASE_URL`環境変数で接続先を上書きできる（CIでは`ci.yml`がPostgresサービス
コンテナを別途起動し、この変数で向き先を渡している）。テーブルは`AUTO_MIGRATE=1`（既定）
により初回実行時に自動作成される。
