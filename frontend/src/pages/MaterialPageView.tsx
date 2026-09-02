import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import AnswerQuestionCard from '../components/material/AnswerQuestionCard'
import PageBody from '../components/material/PageBody'
import SurveyModal from '../components/material/SurveyModal'
import Button from '../components/ui/Button'
import MyLearningToggle from '../components/ui/MyLearningToggle'
import { useMaterial } from '../hooks/useMaterial'
import { useSurveys } from '../hooks/useSurveys'
import { getAttempt, saveAnswer, startAttempt, submitAttempt } from '../lib/attemptActions'
import { ApiError } from '../lib/api'
import { flattenPages, findPageIndex, resolveScopeNodeId, type FlatPage } from '../lib/pageNav'
import { andFromQuery, backTarget, fromQuery } from '../lib/backLink'
import type { Answer, QuizAttempt, Survey } from '../types'

type PageMode = 'graded' | 'practice' | 'wrong_only'

interface WrongOnlyQueueItem {
  materialId: number
  attemptId: number
}
interface WrongOnlyQueue {
  queue: WrongOnlyQueueItem[]
  returnTo: string
}

const WRONG_ONLY_QUEUE_KEY = 'wrongOnlyQueue'

// S-16 教材受講：ページ（詳細設計書10.15節）。1ページ分の本文＋設問を表示し、回答して次のページへ進む。
// 3つのモードを扱う（?modeクエリ）:
// - graded（既定）: attempt_scope（教材/章/小見出し/ページ）ごとに独立した受験記録を扱う。ページ
//   遷移のたびにA-40を呼び、現在のスコープの試行を再開または新規開始する（「続きから受講」の実体）。
// - practice（反復演習）: scope_node_idは常にnull。教材の全ページを通しで解き、最後のページでのみ提出する。
// - wrong_only（誤答のみ抽出）: A-44が作成済みの特定attemptを対象にする。A-40は呼ばずA-43
//   （getAttempt）で状態取得する。対象ページはこのattemptのquestion_orderに含まれるものだけに絞る。
export default function MaterialPageView() {
  const { materialId, nodeId } = useParams<{ materialId: string; nodeId: string }>()
  const [searchParams] = useSearchParams()
  const mode = (searchParams.get('mode') as PageMode | null) ?? 'graded'
  const attemptIdParam = searchParams.get('attemptId')
  const from = searchParams.get('from')
  const id = Number(materialId)
  const pageNodeId = Number(nodeId)
  const navigate = useNavigate()

  const { material, error: materialError, isLoading: materialLoading, mutate: mutateMaterial } = useMaterial(id)
  const { surveys } = useSurveys(mode === 'graded' ? id : null)

  const [attempt, setAttempt] = useState<QuizAttempt | null>(null)
  const [answers, setAnswers] = useState<Record<number, Answer>>({})
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState(false)
  const [submittedResult, setSubmittedResult] = useState<QuizAttempt | null>(null)
  const [surveyToShow, setSurveyToShow] = useState<Survey | null>(null)
  // 章をまたぐページ遷移時の区切りモーダル（次の章へ進む前に一拍置く）。
  // 「第1章から第2章へ」のように無音で遷移していたところにアクションを挟んでほしいという
  // フィードバックを受け追加した（2026-09-02）。
  const [chapterTransition, setChapterTransition] = useState<{
    nextNodeId: number
    completedChapterNumber: number
    completedChapterTitle: string
    nextChapterNumber: number
    nextChapterTitle: string
  } | null>(null)

  const allPages = material ? flattenPages(material.toc ?? []) : []
  const allPageIndex = findPageIndex(allPages, pageNodeId)
  const flatPage = allPageIndex >= 0 ? allPages[allPageIndex] : null
  const node = flatPage?.node ?? null

  const sequencePages: FlatPage[] =
    mode === 'wrong_only' && attempt
      ? allPages.filter((p) => Object.prototype.hasOwnProperty.call(attempt.question_order, String(p.node.id)))
      : allPages
  const sequenceIndex = findPageIndex(sequencePages, pageNodeId)

  const scopeNodeId =
    mode === 'graded' && material && allPages.length > 0
      ? resolveScopeNodeId(allPages, material.attempt_scope, pageNodeId)
      : null

  useEffect(() => {
    if (!material || !node) return
    let cancelled = false
    setAttempt(null)
    setAnswers({})
    setSkipped(new Set())
    setLoadError(null)
    setSubmittedResult(null)

    const applyResult = (res: { attempt: QuizAttempt } | (QuizAttempt & { answers: Answer[] })) => {
      const nextAttempt: QuizAttempt = 'attempt' in res ? res.attempt : res
      const nextAnswers: Answer[] = 'attempt' in res ? (res as { answers: Answer[] }).answers : res.answers
      if (cancelled) return
      setAttempt(nextAttempt)
      const byId: Record<number, Answer> = {}
      for (const a of nextAnswers) byId[a.question_id] = a
      setAnswers(byId)
    }

    const load = async () => {
      try {
        if (mode === 'wrong_only') {
          if (!attemptIdParam) throw new ApiError(400, 'attemptIdが指定されていません')
          const res = await getAttempt(Number(attemptIdParam))
          applyResult(res)
        } else if (mode === 'practice') {
          const res = await startAttempt(id, { mode: 'practice' })
          applyResult(res)
        } else {
          const res = await startAttempt(id, { mode: 'graded', scope_node_id: scopeNodeId, viewing_node_id: pageNodeId })
          applyResult(res)
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof ApiError ? e.message : '受験記録の取得に失敗しました')
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, pageNodeId, mode, attemptIdParam, material?.attempt_scope])

  if (materialLoading || (material && !loadError && attempt === null && !materialError)) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  if (materialError || !material) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="教材受講" />
        <div className="px-8 py-6">
          <Link to={backTarget(from).to} className="text-blue-800 hover:underline">
            {backTarget(from).label}
          </Link>
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            教材を取得できませんでした。
          </p>
        </div>
      </div>
    )
  }

  if (!flatPage || !node) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="教材受講" actions={<BackToTocLink materialId={id} from={from} />} />
        <div className="px-8 py-6 text-sm text-red-700">指定されたページが見つかりません。</div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title={node.title} actions={<BackToTocLink materialId={id} from={from} />} />
        <div className="px-8 py-6 text-sm text-red-700">{loadError}</div>
      </div>
    )
  }

  if (!attempt) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  const questionIds = attempt.question_order[String(pageNodeId)] ?? []
  const questions = questionIds
    .map((qid) => node.questions.find((q) => q.id === qid))
    .filter((q): q is NonNullable<typeof q> => q !== undefined)

  const isResolved = (index: number) => {
    const q = questions[index]
    if (answers[q.id as number] !== undefined) return true
    return !q.required && skipped.has(q.id as number)
  }
  const firstUnresolvedIndex = questions.findIndex((_, i) => !isResolved(i))
  const allResolved = firstUnresolvedIndex === -1

  const chapterNumber = material.toc?.filter((n) => n.kind === 'chapter').findIndex((c) => c.id === flatPage.chapterId) ?? -1
  const progressPct = sequencePages.length > 0 ? Math.round(((sequenceIndex + 1) / sequencePages.length) * 100) : 0

  const handleSave = async (questionId: number, response: unknown) => {
    const saved = await saveAnswer(attempt.id, questionId, response)
    setAnswers((prev) => ({ ...prev, [questionId]: saved }))
    if (mode === 'graded') await mutateMaterial()
  }

  const handleSkip = (questionId: number) => {
    setSkipped((prev) => new Set(prev).add(questionId))
  }

  const goToPage = (targetNodeId: number) => {
    const suffix =
      mode === 'graded'
        ? fromQuery(from)
        : mode === 'practice'
          ? `?mode=practice${andFromQuery(from)}`
          : `?mode=wrong_only&attemptId=${attemptIdParam}${andFromQuery(from)}`
    navigate(`/materials/${id}/pages/${targetNodeId}${suffix}`)
  }

  const handleNext = async () => {
    const nextFlat = sequencePages[sequenceIndex + 1] ?? null
    const isLastOfScope =
      mode === 'graded'
        ? !nextFlat || resolveScopeNodeId(allPages, material.attempt_scope, nextFlat.node.id) !== scopeNodeId
        : !nextFlat

    if (!isLastOfScope) {
      if (nextFlat!.chapterId !== flatPage.chapterId) {
        const chapters = material.toc?.filter((n) => n.kind === 'chapter') ?? []
        setChapterTransition({
          nextNodeId: nextFlat!.node.id,
          completedChapterNumber: chapterNumber + 1,
          completedChapterTitle: flatPage.chapterTitle,
          nextChapterNumber: chapters.findIndex((c) => c.id === nextFlat!.chapterId) + 1,
          nextChapterTitle: nextFlat!.chapterTitle,
        })
        return
      }
      goToPage(nextFlat!.node.id)
      return
    }

    setAdvancing(true)
    try {
      const result = await submitAttempt(attempt.id)
      if (mode === 'graded') {
        await mutateMaterial()
        if (result.passed) {
          const survey = surveys.find(
            (s) => s.node_id === scopeNodeId && s.is_active && (s.repeat_mode === 'every_time' || !s.answered_by_me),
          )
          if (survey) setSurveyToShow(survey)
        }
      }
      setSubmittedResult(result)
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : '提出に失敗しました')
    } finally {
      setAdvancing(false)
    }
  }

  const hasMoreInWrongOnlyQueue = () => {
    if (mode !== 'wrong_only') return false
    try {
      const raw = sessionStorage.getItem(WRONG_ONLY_QUEUE_KEY)
      if (!raw) return false
      return (JSON.parse(raw) as WrongOnlyQueue).queue.length > 0
    } catch {
      return false
    }
  }

  const handleContinueAfterResult = async () => {
    if (mode === 'wrong_only') {
      const raw = sessionStorage.getItem(WRONG_ONLY_QUEUE_KEY)
      if (raw) {
        const q = JSON.parse(raw) as WrongOnlyQueue
        if (q.queue.length > 0) {
          const [nextItem, ...rest] = q.queue
          sessionStorage.setItem(WRONG_ONLY_QUEUE_KEY, JSON.stringify({ ...q, queue: rest }))
          try {
            const nextAttempt = await getAttempt(nextItem.attemptId)
            const firstNodeId = Number(Object.keys(nextAttempt.question_order)[0])
            navigate(
              `/materials/${nextItem.materialId}/pages/${firstNodeId}?mode=wrong_only&attemptId=${nextItem.attemptId}${andFromQuery(from)}`,
            )
            return
          } catch {
            // 次のattemptの取得に失敗した場合はreturnToへフォールバックする
          }
        }
        sessionStorage.removeItem(WRONG_ONLY_QUEUE_KEY)
        navigate(q.returnTo)
        return
      }
      navigate(backTarget(from).to)
      return
    }

    const nextFlat = sequencePages[sequenceIndex + 1] ?? null
    if (nextFlat) {
      goToPage(nextFlat.node.id)
    } else {
      navigate(`/materials/${id}${fromQuery(from)}`)
    }
  }

  const alreadySubmitted = attempt.submitted_at !== null
  const modeLabel = mode === 'practice' ? '（反復演習）' : mode === 'wrong_only' ? '（誤答のみ抽出）' : ''

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={`${node.title}${modeLabel}`}
        actions={
          <>
            {material.is_company_wide && !material.required && (
              <MyLearningToggle
                materialId={id}
                registered={material.registered ?? false}
                onToggled={() => mutateMaterial()}
              />
            )}
            <BackToTocLink materialId={id} from={from} />
          </>
        }
      />
      <div className="px-8 py-6">
        <div className="mb-3 text-xs text-slate-400">
          {material.title}
          {chapterNumber >= 0 && ` ／ 第${chapterNumber + 1}章 ${flatPage.chapterTitle}`}
          {flatPage.sectionTitle && ` ／ ${flatPage.sectionTitle}`}
        </div>

        <div className="mb-5 flex items-center gap-3">
          <span className="text-xs text-slate-500">
            ページ {sequenceIndex + 1}/{sequencePages.length}
          </span>
          <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-blue-700" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="text-xs text-slate-500">{progressPct}%</span>
        </div>

        {node.body && <PageBody materialId={id} body={node.body} format={node.format ?? 'markdown'} />}

        {submittedResult ? (
          <>
            <AttemptResultPanel attempt={submittedResult} mode={mode} />
            <div className="mt-4">
              <Button onClick={handleContinueAfterResult}>
                {mode === 'wrong_only'
                  ? hasMoreInWrongOnlyQueue()
                    ? '次の教材へ進む'
                    : '目次へ戻る'
                  : sequencePages[sequenceIndex + 1]
                    ? '次のページへ進む'
                    : '目次へ戻る'}
              </Button>
            </div>
          </>
        ) : alreadySubmitted ? (
          <AttemptResultPanel attempt={attempt} mode={mode} />
        ) : (
          <>
            {questions.map((q, i) => (
              <AnswerQuestionCard
                key={q.id}
                question={q}
                index={i}
                answer={answers[q.id as number]}
                locked={i > firstUnresolvedIndex && firstUnresolvedIndex !== -1}
                skipped={skipped.has(q.id as number)}
                onSave={(response) => handleSave(q.id as number, response)}
                onSkip={() => handleSkip(q.id as number)}
              />
            ))}

            <div className="mt-6 flex items-center gap-3 border-t border-slate-200 pt-5">
              <Link
                to={`/materials/${id}${fromQuery(from)}`}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                目次へ戻る
              </Link>
              <Button onClick={handleNext} disabled={!allResolved || advancing}>
                {advancing ? '送信中…' : '回答して次のページへ'}
              </Button>
              {mode === 'graded' && (
                <span className="text-xs text-slate-400">
                  中断しても回答内容は保存され、次回この続きから再開できます
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {surveyToShow && (
        <SurveyModal
          survey={surveyToShow}
          onClose={() => setSurveyToShow(null)}
          onSubmitted={() => setSurveyToShow(null)}
        />
      )}

      {chapterTransition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-md bg-white p-5 shadow-lg">
            <p className="mb-1 text-sm font-semibold text-green-700">
              第{chapterTransition.completedChapterNumber}章「{chapterTransition.completedChapterTitle}」を完了しました
            </p>
            <p className="mb-4 text-sm text-slate-600">
              次は第{chapterTransition.nextChapterNumber}章「{chapterTransition.nextChapterTitle}」です。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setChapterTransition(null)}>
                このページに戻る
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const nextNodeId = chapterTransition.nextNodeId
                  setChapterTransition(null)
                  goToPage(nextNodeId)
                }}
              >
                次の章へ進む
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BackToTocLink({ materialId, from }: { materialId: number; from: string | null }) {
  return (
    <Link
      to={`/materials/${materialId}${fromQuery(from)}`}
      className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
    >
      目次へ戻る
    </Link>
  )
}

function AttemptResultPanel({ attempt, mode }: { attempt: QuizAttempt; mode: PageMode }) {
  if (mode !== 'graded') {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
        <div className="mb-1 font-semibold">
          提出済み{attempt.score_pct !== null && ` ／ 正答率${Math.round(attempt.score_pct)}%`}
        </div>
        <p className="text-xs text-slate-500">
          {mode === 'practice' ? '反復演習' : '誤答のみ抽出'}は合否に影響しません。習熟のための記録として保存されました。
        </p>
      </div>
    )
  }
  return (
    <div
      className={`rounded-md border p-4 text-sm ${attempt.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
    >
      <div className="mb-1 font-semibold">
        {attempt.passed === null ? '提出済み' : attempt.passed ? '合格' : '不合格'}
        {attempt.score_pct !== null && ` ／ 正答率${Math.round(attempt.score_pct)}%`}
      </div>
      {attempt.fail_reason && (
        <p className="text-red-700">
          ⚠ ドボン設問「{attempt.fail_reason}」に正解しなかったため、この範囲は不合格と判定されました。
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">このページを含む範囲は提出済みです。目次から他のページへ進んでください。</p>
    </div>
  )
}
