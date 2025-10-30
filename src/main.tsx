import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom'
import './index.css'
import TopBar from './components/TopBar'
import MobileDrawer from './components/MobileDrawer'
import Footer from './components/Footer'
import Overview from './pages/Overview'
import Proposals from './pages/Proposals'
import NewProposal from './pages/NewProposal'
import Treasury from './pages/Treasury'
import ProposalDetail from './pages/ProposalDetail'
// ⬇️ use SDK AuthProvider instead of your local one
import { AuthProvider } from 'amvault-connect'
import { ToastProvider } from './components/Toast'
import { DAOProvider } from './lib/dao'
import NewDAO from './pages/NewDAO'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import LoadingGate from './components/LoadingGate'

function Layout() {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <TopBar onMenu={() => setOpen(true)} />
      <MobileDrawer open={open} onClose={() => setOpen(false)} />

      <main className="max-w-6xl mx-auto px-4 py-6">
        <LoadingGate>
          <Outlet />
        </LoadingGate>
      </main>

      <Footer />
    </>
  )
}

function App() {
  const chainId =
    import.meta.env.VITE_CHAIN_ID
      ? Number(import.meta.env.VITE_CHAIN_ID)
      : 237422 // your default

  return (
    <AppErrorBoundary>
      {/* ⬇️ SDK AuthProvider wraps the whole app */}
      <AuthProvider
        config={{
          appName: 'uGov',
          chainId,
          amvaultUrl: import.meta.env.VITE_AMVAULT_URL, // e.g. https://amvault.your-domain.com/router
          debug: !!import.meta.env.VITE_AUTH_DEBUG,
          // optional: wire membership/AIN lookups if you have them
          registry: {
            isRegistered: async (_addr: string) => true,
            getAin: async (_addr: string) => null,
          },
        }}
      >
        <DAOProvider>
          <ToastProvider>
            <BrowserRouter basename={import.meta.env.BASE_URL}>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Overview />} />
                  <Route path="proposals" element={<Proposals />} />
                  <Route path="proposals/new" element={<NewProposal />} />
                  <Route path="proposals/:id" element={<ProposalDetail />} />
                  <Route path="treasury" element={<Treasury />} />
                  <Route path="daos/new" element={<NewDAO />} />
                  {/* <Route path="*" element={<AppFallback />} /> */}
                </Route>
              </Routes>
            </BrowserRouter>
          </ToastProvider>
        </DAOProvider>
      </AuthProvider>
    </AppErrorBoundary>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
