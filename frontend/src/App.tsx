import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import { ErrorBoundary } from './components/ErrorBoundary'
import Home from './pages/Home'
import Registry from './pages/Registry'
import Launchpad from './pages/Launchpad'
import Vesting from './pages/Vesting'
import Discover from './pages/Discover'
import Agents from './pages/Agents'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
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
  )
}
