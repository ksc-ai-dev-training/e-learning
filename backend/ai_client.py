# OpenAI呼び出しの共通クライアント（F-08/F-20〜F-23共通、詳細設計書08_AI機能実装詳細.html）。
# 呼び出し元（learning.py等）はモデル選択・T-19ログ記録を直接扱わず、必ず本モジュール経由で呼ぶ。
#
# 2026-09-07: AnthropicからOpenAIへ切り替えた（ユーザー指示、最安モデルを使いたいとのこと。
# 当初は全機能共通でgpt-5-nanoを採用）。
# 2026-09-08: gpt-5-nano（推論系モデル）はF-23で「reasoningトークンだけでmax_output_tokensを
# 使い切り、function_callが1件も出力されない」実障害が発生した（推論量が入力内容によって
# 大きく変動するため）。調査の結果、Responses APIの`reasoning.effort`を"minimal"に指定すると
# reasoning_tokensが常に0になり、この障害クラス自体が起きなくなることを確認した。ただしF-20
# （AI採点）で"minimal"を検証したところ、意味は合っているが言い回しが異なる回答（「成功」という
# 単語を使わない言い換え）を誤って不正解と判定するケース（8件中1件）が見つかり、採点の正確性が
# 学習者の合否に直結することから、F-20だけはeffort調整では対応せずgpt-4o-mini（非推論系、
# 検証で8/8正解）に固定した。他機能（要約・所見系のタスクで、検証範囲では取りこぼしなし）は
# gpt-5-nano + reasoning effort="minimal"のまま、最安構成を維持する（ユーザー承認、2026-09-08。
# 検証の詳細は下記FEATURE_MODEL_CONFIGコメント参照）。
# ツール呼び出し（構造化出力）にはResponses API（client.responses.create）を使う。
import asyncio
import json
import logging
import os

import openai

from database import get_pool

logger = logging.getLogger("manabi.ai_client")

# 機能ごとのモデル・reasoning effort設定（2026-09-08。featureはT-19 ai_usage_logs.featureと
# 同じ値。S-10システム設定タブがこの辞書をそのまま表示する、routers/settings.py参照）。
#
# - grading（F-20 AI採点）: gpt-4o-mini。学習者の合否に直結するため正確性を優先。8件のテスト
#   ケース（明確な正解/不正解4件＋言い換え等の意味判定を要する4件）で8/8正解を確認した一方、
#   gpt-5-nano+reasoning="minimal"は同条件で7/8（意味は合っているが「成功」という単語を使わない
#   言い換え回答を誤って不正解と判定）だったため採用しなかった。
# - material_review（F-08）/ personal_feedback（F-22）/ org_report（F-23）: gpt-5-nano +
#   reasoning effort="minimal"。集計・要約が中心のタスクで、検証範囲では取りこぼしが無く、
#   4機能中最安（1回あたりの概算コストはgpt-4o-miniの半分以下）。reasoning="minimal"を指定しない
#   場合、reasoningトークンの消費量が入力内容によって大きく変動し（実測でreasoningだけ832〜1792
#   トークン）、max_output_tokensを使い切ってfunction_callが出力されない障害が起きていた。
FEATURE_MODEL_CONFIG: dict[str, dict] = {
    "material_review": {"model": "gpt-5-nano", "reasoning_effort": "minimal"},
    "grading": {"model": "gpt-4o-mini", "reasoning_effort": None},
    "personal_feedback": {"model": "gpt-5-nano", "reasoning_effort": "minimal"},
    "org_report": {"model": "gpt-5-nano", "reasoning_effort": "minimal"},
}
_FALLBACK_MODEL = "gpt-5-nano"

# 概算コスト計算用の単価（1トークンあたりのUSD単価、USD→JPYは固定150円で概算する。単価は
# 2024年の公表値を基にしており、本セッションの知識カットオフ（2026年1月）以降に値下げ・改定が
# あった場合は要確認・要更新）。
MODEL_COSTS = {
    "gpt-4o-mini": {"input": 0.00000015, "output": 0.0000006},
    "gpt-5-nano": {"input": 0.00000005, "output": 0.0000004},
}
USD_TO_JPY = 150

_client: openai.AsyncOpenAI | None = None


def _get_client() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEYが設定されていないためAI機能を利用できません")
        _client = openai.AsyncOpenAI(api_key=api_key, timeout=60.0)
    return _client


async def log_usage(user_id: int | None, feature: str, model: str, input_tokens: int, output_tokens: int) -> None:
    """T-19 ai_usage_logsへ1行記録する。呼び出しが成功した場合のみ呼ぶ（失敗はログしない、詳細設計書参照）。"""
    costs = MODEL_COSTS.get(model, MODEL_COSTS[_FALLBACK_MODEL])
    cost_estimate = (input_tokens * costs["input"] + output_tokens * costs["output"]) * USD_TO_JPY
    await get_pool().execute(
        """INSERT INTO ai_usage_logs (user_id, feature, model, input_tokens, output_tokens, cost_estimate)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        user_id, feature, model, input_tokens, output_tokens, cost_estimate,
    )


async def _call_tool(
    *, instructions: str, user_message: str, tool_schema: dict, tool_name: str,
    max_output_tokens: int, feature: str, user_id: int | None,
) -> dict:
    """Responses APIでツール（構造化出力）呼び出しを行う共通処理（F-08/F-20/F-22/F-23共通）。
    3回までリトライし（1s/2s/4s）、全て失敗した場合は例外を送出する。tool_schemaは
    {"description": ..., "input_schema": {...}}の形（Anthropic時代のツール定義をそのまま流用し、
    ここでResponses APIが要求するフラットな関数定義に組み替える）。モデル・reasoning effortは
    FEATURE_MODEL_CONFIGからfeature単位で解決する（2026-09-08、機能ごとに分離）。"""
    config = FEATURE_MODEL_CONFIG.get(feature, {"model": _FALLBACK_MODEL, "reasoning_effort": None})
    model = config["model"]
    reasoning_effort = config["reasoning_effort"]
    tool_def = {
        "type": "function",
        "name": tool_name,
        "description": tool_schema["description"],
        "parameters": tool_schema["input_schema"],
    }

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            client = _get_client()
            create_kwargs = dict(
                model=model,
                instructions=instructions,
                input=user_message,
                max_output_tokens=max_output_tokens,
                tools=[tool_def],
                tool_choice={"type": "function", "name": tool_name},
            )
            if reasoning_effort:
                create_kwargs["reasoning"] = {"effort": reasoning_effort}
            response = await client.responses.create(**create_kwargs)
            call_item = next((item for item in response.output if item.type == "function_call"), None)
            if call_item is None:
                # 推論トークンだけでmax_output_tokensを使い切り、function_callが1件も出力されない
                # ことがある（gpt-5-nanoの推論量は入力内容によって大きく変動する。2026-09-08、
                # F-23で確認）。次のリトライで直る場合もあるが、直らない場合は呼び出し元で
                # max_output_tokensを見直すこと。
                raise RuntimeError(
                    f"AIの応答にfunction_callが含まれていません（{feature}、status={response.status}、"
                    f"output_tokens={response.usage.output_tokens}）"
                )
            result = json.loads(call_item.arguments)
            await log_usage(
                user_id, feature, model, response.usage.input_tokens, response.usage.output_tokens
            )
            return result
        except Exception as exc:  # noqa: BLE001 — AI呼び出しの失敗要因は多岐にわたるため一括で捕捉しリトライする
            last_error = exc
            logger.exception("AI呼び出しに失敗しました（%s、%d回目）", feature, attempt + 1)
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
    raise last_error  # type: ignore[misc]


GRADING_TOOL = {
    "name": "submit_grading",
    "description": "記述式・コード記述式の回答に対する採点結果を提出する",
    "input_schema": {
        "type": "object",
        "properties": {
            "correct": {"type": "boolean", "description": "採点基準を満たしていれば true"},
            "score_pct": {"type": "number", "description": "0または100（部分点は付けない）"},
            "reasoning": {"type": "string", "description": "採点理由・講評"},
            "improvement_suggestions": {"type": ["string", "null"], "description": "改善提案（無ければnull）"},
        },
        "required": ["correct", "score_pct", "reasoning"],
    },
}

_FEEDBACK_STYLE_INSTRUCTIONS = {
    "show_answer": "模範解答例と、それに対する回答者の回答の良い点・改善点を具体的に講評してください。",
    "review_only": "模範解答そのものは提示せず、回答のどこに問題があるか（該当箇所）を指摘するに留めてください。",
    "hint_only": "正誤や模範解答は一切明かさず、次に何を考えるとよいかのヒントのみを短く伝えてください。",
}


def _build_system_prompt(scoring_criteria: str, feedback_style: str, ai_context: str | None, is_code: bool, code_language: str | None) -> str:
    parts = [
        "あなたは社内学習管理システムの採点担当AIです。受講者の回答を採点基準に照らして採点し、"
        "submit_gradingツールで結果を提出してください。部分点はありません（correctがtrueならscore_pctは100、"
        "falseなら0）。",
        f"採点基準: {scoring_criteria}",
        _FEEDBACK_STYLE_INSTRUCTIONS.get(feedback_style, _FEEDBACK_STYLE_INSTRUCTIONS["show_answer"]),
    ]
    if is_code:
        parts.append(
            f"これはコード記述式の設問です（言語: {code_language or '未指定'}）。コードは実行せず、読解して正誤・"
            "改善点を判定してください。無駄な処理や簡略化できる箇所があれば講評に含めてください。"
        )
    if ai_context:
        parts.append(f"教材作成者からの追加指示: {ai_context}")
    return "\n\n".join(parts)


REVIEW_TOOL = {
    "name": "submit_review",
    "description": "教材のAIレビュー結果（指摘事項一覧）を提出する",
    "input_schema": {
        "type": "object",
        "properties": {
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string", "description": "指摘箇所を示す章・ページ名"},
                        "severity": {"type": "string", "enum": ["info", "warning"]},
                        "issue": {"type": "string", "description": "指摘内容"},
                        "suggestion": {"type": "string", "description": "改善提案（無ければ省略可）"},
                    },
                    "required": ["location", "severity", "issue"],
                },
            }
        },
        "required": ["findings"],
    },
}

_REVIEW_SYSTEM_PROMPT = (
    "あなたは社内学習管理システムの教材レビュー担当AIです。教材の説明不足・記述の分かりにくさ・"
    "問題と教材内容の不整合を指摘するレビュアーとして振る舞ってください。指摘は具体的な章・ページ名で"
    "場所（location）を示してください。severityは、改善を推奨する指摘はwarning、軽微な気づき・提案は"
    "infoにしてください。改善提案が無い指摘はsuggestionを省略してください。submit_reviewツールで結果を"
    "提出してください。"
)


async def review_material(*, material_text: str, user_id: int | None) -> list[dict]:
    """教材本文・問題定義をAIレビューする（F-08）。"""
    result = await _call_tool(
        instructions=_REVIEW_SYSTEM_PROMPT,
        user_message=material_text,
        tool_schema=REVIEW_TOOL,
        tool_name="submit_review",
        max_output_tokens=4096,
        feature="material_review",
        user_id=user_id,
    )
    return list(result.get("findings", []))


async def grade_answer(
    *,
    prompt: str,
    response_text: str,
    scoring_criteria: str,
    feedback_style: str,
    ai_context: str | None,
    is_code: bool,
    code_language: str | None,
    user_id: int | None,
) -> dict:
    """記述式・コード記述式の回答をAIで採点する（F-20）。"""
    system_prompt = _build_system_prompt(scoring_criteria, feedback_style, ai_context, is_code, code_language)
    user_message = f"設問: {prompt}\n\n回答:\n{response_text}"
    return await _call_tool(
        instructions=system_prompt,
        user_message=user_message,
        tool_schema=GRADING_TOOL,
        tool_name="submit_grading",
        max_output_tokens=2048,
        feature="grading",
        user_id=user_id,
    )


PERSONAL_FEEDBACK_TOOL = {
    "name": "submit_personal_feedback",
    "description": "受講者本人へのAI個人フィードバックを提出する",
    "input_schema": {
        "type": "object",
        "properties": {
            "comment": {"type": "string", "description": "学習状況全体への講評コメント（人事評価目的ではない旨を前提とした励まし・アドバイス）"},
            "weak_areas": {
                "type": "array",
                "items": {"type": "string"},
                "description": "正答率が低い・要復習と考えられる分野タグ（教材タグから）",
            },
            "recommended_material_ids": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "候補一覧（candidate_materials。未受講の教材に加え、過去に不合格だった反復推奨の教材も含まれる）"
                "のIDから、弱点分野の克服に役立つものを最大3件まで選ぶ（無ければ空配列。無理に選ぶ必要はない）",
            },
        },
        "required": ["comment", "weak_areas", "recommended_material_ids"],
    },
}

_PERSONAL_FEEDBACK_SYSTEM_PROMPT = (
    "あなたは社内学習管理システムの個人学習アドバイザーAIです。受講者本人の学習状況の集計データを基に、"
    "本人が次に何をするとよいかを前向きに伝えるフィードバックを作成してください。この内容は人事評価には"
    "使われません。個人を特定できる情報（氏名・メールアドレス等）は与えられていないため、それらに触れる"
    "必要はありません。submit_personal_feedbackツールで結果を提出してください。weak_areasは分野別正答率が"
    "低いものを優先し、目立った弱点が無ければ空配列にしてください。recommended_material_idsは"
    "candidate_materials（未受講、または過去に不合格だった反復推奨の候補教材一覧）の中からのみ選び、"
    "弱点に合うものが無ければ無理に選ばず空配列にしてください。"
)


async def generate_personal_feedback(
    *,
    summary_stats: dict,
    tag_stats: list[dict],
    candidate_materials: list[dict],
    user_id: int,
) -> dict:
    """受講傾向データを基にAI個人フィードバックを生成する（F-22）。"""
    user_message = (
        "summary_stats:\n" + str(summary_stats) + "\n\n"
        "tag_stats（分野タグ別の正答率集計）:\n" + str(tag_stats) + "\n\n"
        "candidate_materials（未受講、または過去に不合格だった反復推奨の候補教材。id/title/tagsのみ）:\n"
        + str(candidate_materials)
    )
    return await _call_tool(
        instructions=_PERSONAL_FEEDBACK_SYSTEM_PROMPT,
        user_message=user_message,
        tool_schema=PERSONAL_FEEDBACK_TOOL,
        tool_name="submit_personal_feedback",
        max_output_tokens=2048,
        feature="personal_feedback",
        user_id=user_id,
    )


ORG_REPORT_TOOL = {
    "name": "submit_org_report",
    "description": "組織向けAI受講状況レポートを提出する",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "受講状況全体の要約・所見"},
            "insight_tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "注目すべき点を短いタグ形式で（最大5件、無ければ空配列）",
            },
        },
        "required": ["summary", "insight_tags"],
    },
}

_ORG_REPORT_SYSTEM_PROMPT = (
    "あなたは社内学習管理システムの受講状況分析AIです。プロジェクト・組織単位の受講状況の集計データを"
    "基に、管理者向けの所見をまとめてください。氏名・メールアドレス等の個人が特定できる情報は一切"
    "与えられていません（常に集計後の数値のみです）。特定の個人に言及したり、個人を推測したりしないで"
    "ください。insight_tagsは、受講率が低い教材や合格率が低い分野など、管理者が次にとるべきアクションに"
    "つながる短い気づきを優先し、目立った懸念点が無ければ空配列にしてください。summaryは前向きかつ具体的に、"
    "教材別の数値に触れながら記述してください。submit_org_reportツールで結果を提出してください。"
)


async def generate_org_report(
    *,
    scope_label: str,
    stats: dict,
    by_material: list[dict],
    user_id: int,
) -> dict:
    """プロジェクト・全社単位の受講状況集計データを基にAI組織レポートを生成する（F-23）。"""
    user_message = (
        f"scope: {scope_label}\n\n"
        "stats（対象教材数・必修受講率・合格率・未受講者数）:\n" + str(stats) + "\n\n"
        "by_material（教材別の受講率。氏名等は含まない）:\n" + str(by_material)
    )
    return await _call_tool(
        instructions=_ORG_REPORT_SYSTEM_PROMPT,
        user_message=user_message,
        tool_schema=ORG_REPORT_TOOL,
        tool_name="submit_org_report",
        # 集計データ全体（複数教材分）を渡した上で所見を書かせるため、grading/personal_feedback
        # （2048）より推論トークンの消費が大きく、2048では推論だけで使い切りfunction_callが
        # 出力されない（=StopIteration）ことが確認された（2026-09-08）。review_materialと同じ
        # 4096に引き上げる。
        max_output_tokens=4096,
        feature="org_report",
        user_id=user_id,
    )
