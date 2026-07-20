import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n/config'
import { installPermissionToastGuard } from './utils/toastGuard'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App.tsx'

installPermissionToastGuard()

const rootEl = document.getElementById('root')
if (!rootEl) {
  // eslint-disable-next-line no-console
  console.error('[BidSphere] #root element missing — cannot mount React app.')
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 text-sm text-neutral-600">
              Loading…
            </div>
          }
        >
          <App />
        </Suspense>
      </ErrorBoundary>
    </StrictMode>,
  )
}
