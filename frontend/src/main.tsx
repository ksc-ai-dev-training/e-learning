import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './index.css'
import App from './App.tsx'

// データルーター化（2026-09-09）。教材編集画面での「保存せず離脱」防止にreact-routerの
// useBlockerを使うため、それが要求するデータルーターのコンテキストを用意する必要があった
// （プレーンなBrowserRouterではuseBlockerが例外を投げる）。App.tsx自体は変更していない
// （splatルート"*"の要素としてAppをそのままマウントし、App内部の<Routes>によるページ振り分けは
// 従来どおり。react-routerの「descendant routes」パターンで、データルーターの子孫であれば
// 通常の<Routes>もuseBlockerも問題なく動く）。
const router = createBrowserRouter([{ path: '*', Component: App }])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
