---
name: manabi-material
description: Manabi（社内学習管理システム）の教材をAPI経由で作成・編集する。「Manabi教材を作って/直して」「教材○○を編集して」のような依頼で使う。
---

# Manabi教材編集（F-05, A-19/A-20連携）

ManabiのAPIを直接呼び出し、教材の目次構造（章・小見出し・ページ）と問題をプレーンテキストとして
読み書きする。Manabi自体はこの経路でAnthropic APIを呼ばない（Claude Code＝自分がユーザー自身の
契約でAPIを呼んでいるだけ）。認証は`cli/manabi_login.py`で取得したCLIトークン（有効期限90日）。

## 事前準備（初回のみ）

`~/.config/Manabi/credentials` が無ければ、まずログインが必要なことをユーザーに伝えて実行してもらう
（ブラウザでのGoogle認証が必要なため、Claude Code自身では完結できない）:

```
python cli/manabi_login.py
```

成功すると `~/.config/Manabi/credentials`（JSON: `{"manabi_url": "...", "token": "..."}`）が保存される。
以後はこのファイルからトークンを読んで使う。ファイルが無い場合や失効している場合（401）はユーザーに
再ログインを依頼する。

## 教材の新規作成（A-16）

白紙から新しい教材を作る場合は、まずこのAPIでIDを発行してから、下記のA-19/A-20で内容を書き込む
（A-20は既存教材のid必須で、これ単体では新規作成できない）。

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"project_id": 1, "title": "教材タイトル"}' \
  "$URL/api/materials"
```

- `project_id`は必須ではない（省略すると全社Wikiになる）が、通常はユーザーに確認して指定する。
  所属プロジェクトが分からない場合は `curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/projects"` で
  一覧を確認できる（`min_role`省略時は編集者以上に絞り込まれる）。
- 呼び出したユーザーがそのプロジェクトの編集者以上（またはシステムadmin）でないと403になる。
- レスポンスの`id`が新規教材のIDになる。以降はこのIDに対してA-19取得→編集→A-20保存を行う
  （新規作成直後は目次が空の状態なので、A-19で取得したフロントマターのみのテキストに章・ページを
  追記して保存する）。
- `description`・`tags`（配列）も同時に指定できる（任意）。

## 教材ソースの取得（A-19）

```bash
TOKEN=$(python -c "import json;print(json.load(open('$HOME/.config/Manabi/credentials'))['token'])")
URL=$(python -c "import json;print(json.load(open('$HOME/.config/Manabi/credentials'))['manabi_url'])")
curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/materials/{id}/source"
```

教材IDが分からない場合は一覧から探す: `curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/materials"`

## 教材ソースの書き戻し（A-20）

取得したテキストを編集し、そのままPUTで全置換保存する（部分更新ではなく、目次構造全体を毎回
送り直す設計）:

```bash
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/plain" \
  --data-binary @material.md "$URL/api/materials/{id}/source"
```

422が返る場合は`detail`にパースエラー内容が入っている（フロントマター不備・見出し順序違反・
問題ブロックの必須項目不足など）。修正して再送する。

## ソースの書式

### フロントマター（YAML、必須）

```yaml
---
title: 教材タイトル
description: 説明文（省略可）
tags: ["タグ1", "タグ2"]
status: draft  # draft | published
attempt_scope: material  # material | chapter | section | page（受験の単位）
retake_scope: all  # all | wrong_only（再受験時に全問か誤答のみか）
default_feedback_style: show_answer  # show_answer | review_only | hint_only
grading_mode: ai  # 記述式/コード記述式のAI採点を使うかどうかの既定値
---
```

`project_id`は既存教材の所属プロジェクトと一致している必要がある（変更したい場合はA-20ではなく
Manabi画面のA-17を使う）。省略した場合は元のプロジェクトのまま。

### 目次構造（見出し階層）

- `#` 見出し = 章（chapter）
- `##` 見出し = 小見出し（section、省略可。章の直下にページを置いてもよい）
- `###` 見出し = ページ（page）

章タイトルに「第1章」のような番号を含めないこと。画面側（目次・プレビュー）が章の並び順から
自動的に「第N章 」を付けて表示するため、タイトル自体にも書くと「第1章 第1章 はじめに」のように
二重表示になる。章タイトルは番号を除いた見出し文言のみ（例: `# はじめに`）にする。

既存ノードを更新する場合は見出し行の直後に `<!-- node:123 -->` を付ける（無ければ新規ノードとして
作成される）。ページには任意で `<!-- format:markdown -->` または `<!-- format:html -->`（省略時は
フロントマターの既定値）、問題プールを使う場合は `<!-- quiz_mode:pool -->` と
`<!-- pool_draw_count:N -->` を付けられる。

ページの本文は説明文（Markdown/HTML）と、それに続く```question```フェンスブロック（0個以上）を
自由に組み合わせられる。**本文中に`#`〜`###`で始まる行（コードブロック内のシェルコメント`# ...`
なども含む）を書く場合は、行頭に`\`を付けてエスケープすること**（例: `\# コメント`）。エスケープせず
そのまま書くと、その行が実際の章・小見出し・ページの区切りと誤認識され、意図しない場所で
ページが分割されてしまう（A-19で既存教材を取得した場合の本文には、システムが書き出し時に
自動でこのエスケープを済ませてあるため気にする必要はないが、新規に本文を書き起こす場合は
自分でエスケープが必要）。

例:

```
### 変数と型
<!-- node:501 -->

Pythonの変数には型宣言が不要です。

​```question
type: single
prompt: 次のうち、Pythonの変数として正しいものはどれか
options:
  - "1abc = 1"
  - "abc_1 = 1"
  - "abc-1 = 1"
correct_answer: "abc_1 = 1"
​```
```

### 問題ブロック（```question```フェンス内、YAML）

種別（`type`）ごとの必須項目:

| type | 用途 | 必須項目 |
|---|---|---|
| `single` | 単一選択 | `options`（配列）, `correct_answer`（optionsの中の1つの文字列） |
| `multi` | 複数選択 | `options`（配列）, `correct_answer`（配列） |
| `reorder` | 並び替え | `correct_answer`（2件以上の配列、正しい順序） |
| `free_text` | 記述式 | `scoring_criteria`（AI採点の基準文） |
| `code` | コード記述式 | `scoring_criteria`, `code_language`（例: `python`） |
| `score_log` | 記録型（自己申告の数値記録、正誤判定なし） | `score_unit`（例: "点", "秒"）。`is_critical`は設定不可 |

共通の任意項目: `id`（既存問題を更新する場合の問題ID）, `prompt`（必須, 問題文）, `required`
（既定true、falseにすると回答必須にしない。**falseの設問は、回答してもスコア・合否判定には
一切反映されない**。AIによる採点・フィードバック自体は行われるが、算入されないだけなので、
「参考として答えてもらうが合否には関係ない設問」を作りたい場合はrequired: falseにする。
設問文に「採点対象外」等と書くだけでは何も変わらないので注意）, `is_critical`（既定false、trueで
正誤に関わらず不正解だと以降のページに進めない「ドボン問題」。required: falseの設問では
ドボン判定自体が発生しないため、両方同時に指定しても意味がない）, `feedback_style`（省略時は
ページ・教材の既定値を継承）, `pool_group`（quiz_mode:poolのページでの出題グループ番号）,
`grading_mode`（`free_text`/`code`のみ、`ai`または`manual`）。

## 画像の埋め込み

本文に画像を貼りたい場合は、`![説明](attachment:123)`という記法を使う（123は下記手順で
アップロードした添付ファイルのID）。表示のたびにその時点で有効なURLへ自動的に解決されるため、
Base64化して直接貼り付ける必要はない。

1. アップロード先URLを発行する（A-27。`{id}`は教材ID）:
   ```bash
   curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"filename": "screenshot.png", "mime_type": "image/png", "size_bytes": 12345}' \
     "$URL/api/materials/{id}/attachments/upload-url"
   ```
   レスポンスの`upload_url`・`storage_key`を控える。
2. 発行されたURLへ画像本体をアップロードする:
   ```bash
   curl -s -X PUT --data-binary @screenshot.png "$UPLOAD_URL"
   ```
   （本番はSupabase StorageのURLがそのまま返るため`$URL`を付けず`$UPLOAD_URL`だけで叩く。
   ローカル開発では`$URL`＋`upload_url`〔`/api/uploads/...`〕の組み合わせになる）
3. 添付として登録し、IDを取得する（A-29。`node_id`は画像を貼りたいページのノードID）:
   ```bash
   curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"node_id": 456, "kind": "file", "storage_key": "'"$STORAGE_KEY"'", "filename": "screenshot.png", "mime_type": "image/png", "size_bytes": 12345}' \
     "$URL/api/materials/{id}/attachments"
   ```
   レスポンスの`id`を使い、本文に`![説明](attachment:{id})`と書いてA-20で保存する。

外部サイトへのリンクを貼りたいだけの場合（画像でなく参照用リンク）は、この手順は不要で、通常の
Markdownリンク`[表示文言](https://...)`をそのまま本文に書けばよい。

## 注意

- A-20は**目次構造全体の全置換**。取得したソースの一部だけを変更して送り返すこと（章やページを
  勝手に削除しないよう、必要な変更以外はA-19で取得した内容のまま維持する）。
- 白紙からの新規作成はA-16→A-19→A-20の順（上記「教材の新規作成」参照）。Manabi画面を開かなくても
  このスキルだけで完結する。
