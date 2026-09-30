import { apiFetch } from './api'

// A-48: AI組織レポートの生成をリクエストする（非同期、202）。「全社」スコープは廃止したため
// scope_typeは常に'project'（2026-09-17）。
export function requestOrgReport(scopeId: number): Promise<{ status: string; job_id: number }> {
  return apiFetch('/api/reports/org', {
    method: 'POST',
    body: JSON.stringify({ scope_type: 'project', scope_id: scopeId }),
  })
}
