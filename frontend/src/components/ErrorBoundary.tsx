import { Component, ReactNode } from 'react'

interface Props  { children: ReactNode; page?: string }
interface State  { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="max-w-2xl mx-auto py-16 space-y-4">
        <div className="card p-6 border-red-500/30 bg-red-500/5 space-y-3">
          <p className="text-sm font-semibold text-red-300">
            {this.props.page ?? 'Page'} crashed — runtime error
          </p>
          <pre className="text-xs text-red-400/70 bg-zinc-950 rounded-lg p-4 overflow-auto max-h-48 whitespace-pre-wrap">
            {error.message}
            {'\n\n'}
            {error.stack?.split('\n').slice(0, 8).join('\n')}
          </pre>
          <button
            className="btn-secondary text-xs"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}
