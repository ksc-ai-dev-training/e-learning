# OpenAI呼び出しの共通クライアント（F-08/F-20〜F-23共通、詳細設計書08_AI機能実装詳細.html）。
# 呼び出し元（learning.py等）はモデル選択・T-19ログ記録を直接扱わず、必ず本モジュール経由で呼ぶ。
#
# 2026-09-07: AnthropicからOpenAIへ切り替えた（ユーザー指示、最安モデルを使いたいとのこと）。
# ツール呼び出し（構造化出力）には、推論系モデル（GPT-5系）向けにOpenAIが推奨するResponses API
# （client.responses.create）を使う。Chat Completions APIは推論系モデルとの組み合わせでツール
# 呼び出しが不安定になる場合があるとされているため採用しなかった。
import asyncio
import json
import logging
import os

import openai

from database import get_pool

logger = logging.getLogger("manabi.ai_client")

# モデル解決: コスト管理のため、常に最も低コストなモデルに固定する（ユーザー指示、2026-09-07。
# gpt-5-nanoは本書作成時点でOpenAIの汎用モデルの中で最安〔入力$0.05/出力$0.40 per 1M tokens〕。
# S-10のシステム設定UIは廃止済みで、選択の余地自体を持たせない）。
DEFAULT_MODEL = "gpt-5-nano"
ALLOWED_MODELS = {"gpt-5-nano"}


async def resolve_model() -> str:
    return DEFAULT_MODEL


# 概算コスト計算用の単価（1トークンあたりのUSD単価、USD→JPYは固定150円で概算する。
# 料金はOpenAIの公表単価と照合済み〔2026-09-07時点〕だが、値下げ等があれば見直すこと）。
MODEL_COSTS = {
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
    costs = MODEL_COSTS.get(model, MODEL_COSTS[DEFAULT_MODEL])
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
    """Responses APIでツール（構造化出力）呼び出しを行う共通処理（F-08/F-20/F-22共通）。
    3回までリトライし（1s/2s/4s）、全て失敗した場合は例外を送出する。tool_schemaは
    {"description": ..., "input_schema": {...}}の形（Anthropic時代のツール定義をそのまま流用し、
    ここでResponses APIが要求するフラットな関数定義に組み替える）。"""
    model = await resolve_model()
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
            response = await client.responses.create(
                model=model,
                instructions=instructions,
                input=user_message,
                max_output_tokens=max_output_tokens,
                tools=[tool_def],
                tool_choice={"type": "function", "name": tool_name},
            )
            call_item = next(item for item in response.output if item.type == "function_call")
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
