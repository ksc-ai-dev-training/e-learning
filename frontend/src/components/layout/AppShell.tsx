import type { ReactNode } from 'react'
import Sidebar from './Sidebar'
import type { Me } from '../../types'

// Sidebar + メインコンテンツ領域のラッパー（詳細設計書2.1.1節）。全認証後画面で共通。
export default function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar me={me} />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white">{children}</div>
    </div>
  )
}
