# Anthropic Claude呼び出しの共通クライアント（F-08/F-20〜F-23共通、詳細設計書08_AI機能実装詳細.html）。
# 呼び出し元（learning.py等）はモデル選択・T-19ログ記録を直接扱わず、必ず本モジュール経由で呼ぶ。
import asyncio
import logging
import os

import anthropic

from database import get_pool
from settings_store import get_ai_model

logger = logging.getLogger("manabi.ai_client")

# モデル解決: S-10システム設定（app_settings.value_text WHERE key='ai_model'） → 環境変数
# ANTHROPIC_MODEL → 既定claude-sonnet-5（settings_store.get_ai_model参照）。
DEFAULT_MODEL = "claude-sonnet-5"
ALLOWED_MODELS = {"claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"}


async def resolve_model() -> str:
    model = (await get_ai_model()).strip()
    if model and model in ALLOWED_MODELS:
        return model
    if model:
        logger.warning("未知のAIモデル=%sを無視し既定値を使用します", model)
    return DEFAULT_MODEL


# 概算コスト計算用の単価（プレースホルダー。Anthropicの実際の料金表と照合してから本番運用すること）。
# 1トークンあたりのUSD単価、USD→JPYは固定150円で概算する。
MODEL_COSTS = {
    "claude-sonnet-5": {"input": 0.000003, "output": 0.000015},
    "claude-opus-5": {"input": 0.000015, "output": 0.000075},
    "claude-haiku-4-5": {"input": 0.0000008, "output": 0.000004},
}
USD_TO_JPY = 150

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEYが設定されていないためAI機能を利用できません")
        _client = anthropic.AsyncAnthropic(api_key=api_key, timeout=60.0)
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
    """教材本文・問題定義をAIレビューする（F-08）。3回までリトライし（1s/2s/4s）、全て失敗した場合は
    例外を送出する（同期呼び出しのため、呼び出し元のA-32はこれを502として利用者に返す）。"""
    model = await resolve_model()

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            client = _get_client()
            message = await client.messages.create(
                model=model,
                max_tokens=4096,
                system=_REVIEW_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": material_text}],
                tools=[REVIEW_TOOL],
                tool_choice={"type": "tool", "name": "submit_review"},
            )
            tool_use = next(block for block in message.content if block.type == "tool_use")
            findings = list(tool_use.input.get("findings", []))
            await log_usage(
                user_id, "material_review", model, message.usage.input_tokens, message.usage.output_tokens
            )
            return findings
        except Exception as exc:  # noqa: BLE001 — AI呼び出しの失敗要因は多岐にわたるため一括で捕捉しリトライする
            last_error = exc
            logger.exception("AI教材レビュー呼び出しに失敗しました（%d回目）", attempt + 1)
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
    raise last_error  # type: ignore[misc]


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
    """記述式・コード記述式の回答をAIで採点する（F-20）。3回までリトライ（1s/2s/4s）し、
    全て失敗した場合は例外を送出する（呼び出し元でDBをNULLのまま残しログを記録する）。"""
    model = await resolve_model()
    system_prompt = _build_system_prompt(scoring_criteria, feedback_style, ai_context, is_code, code_language)
    user_message = f"設問: {prompt}\n\n回答:\n{response_text}"

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            client = _get_client()
            message = await client.messages.create(
                model=model,
                max_tokens=1024,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
                tools=[GRADING_TOOL],
                tool_choice={"type": "tool", "name": "submit_grading"},
            )
            tool_use = next(block for block in message.content if block.type == "tool_use")
            result = dict(tool_use.input)
            await log_usage(user_id, "grading", model, message.usage.input_tokens, message.usage.output_tokens)
            return result
        except Exception as exc:  # noqa: BLE001 — AI呼び出しの失敗要因は多岐にわたるため一括で捕捉しリトライする
            last_error = exc
            logger.exception("AI採点呼び出しに失敗しました（%d回目）", attempt + 1)
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
    raise last_error  # type: ignore[misc]


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
    """受講傾向データを基にAI個人フィードバックを生成する（F-22）。3回までリトライ（1s/2s/4s）し、
    全て失敗した場合は例外を送出する（呼び出し元の非同期ジョブがcontentをNULLのまま残す）。"""
    model = await resolve_model()
    user_message = (
        "summary_stats:\n" + str(summary_stats) + "\n\n"
        "tag_stats（分野タグ別の正答率集計）:\n" + str(tag_stats) + "\n\n"
        "candidate_materials（未受講、または過去に不合格だった反復推奨の候補教材。id/title/tagsのみ）:\n"
        + str(candidate_materials)
    )

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            client = _get_client()
            message = await client.messages.create(
                model=model,
                max_tokens=1024,
                system=_PERSONAL_FEEDBACK_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_message}],
                tools=[PERSONAL_FEEDBACK_TOOL],
                tool_choice={"type": "tool", "name": "submit_personal_feedback"},
            )
            tool_use = next(block for block in message.content if block.type == "tool_use")
            result = dict(tool_use.input)
            await log_usage(
                user_id, "personal_feedback", model, message.usage.input_tokens, message.usage.output_tokens
            )
            return result
        except Exception as exc:  # noqa: BLE001 — AI呼び出しの失敗要因は多岐にわたるため一括で捕捉しリトライする
            last_error = exc
            logger.exception("AI個人フィードバック呼び出しに失敗しました（%d回目）", attempt + 1)
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
    raise last_error  # type: ignore[misc]
