import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import { ErrorBoundary } from './components/ErrorBoundary'
import Home from './pages/Home'
import Registry from './pages/Registry'
import Launchpad from './pages/Launchpad'
import Vesting from './pages/Vesting'
import Discover from './pages/Discover'
import Agents from './pages/Agents'
import { ToastProvider } from './components/Toast'

export default function App() {
  return (
    <ToastProvider>
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-10 pb-28 md:pb-12">
        <Routes>
          <Route path="/"          element={<ErrorBoundary page="Home"><Home /></ErrorBoundary>} />
          <Route path="/discover"  element={<ErrorBoundary page="Discover"><Discover /></ErrorBoundary>} />
          <Route path="/launchpad" element={<ErrorBoundary page="Launchpad"><Launchpad /></ErrorBoundary>} />
          <Route path="/registry"  element={<ErrorBoundary page="Registry"><Registry /></ErrorBoundary>} />
          <Route path="/vesting"   element={<ErrorBoundary page="Vesting"><Vesting /></ErrorBoundary>} />
          <Route path="/agents"    element={<ErrorBoundary page="Agents"><Agents /></ErrorBoundary>} />
        </Routes>
      </main>
    </div>
    </ToastProvider>
  )
}
