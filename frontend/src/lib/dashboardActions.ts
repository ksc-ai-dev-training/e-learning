import { apiFetch } from './api'

// A-48: AI組織レポートの生成をリクエストする（非同期、202）
export function requestOrgReport(
  scopeType: 'company' | 'project',
  scopeId: number | null,
): Promise<{ status: string; job_id: number }> {
  return apiFetch('/api/reports/org', {
    method: 'POST',
    body: JSON.stringify({ scope_type: scopeType, scope_id: scopeId }),
  })
}
