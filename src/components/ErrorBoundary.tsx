import { Component, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'

// Global error boundary.  When any component below this throws during render or in a
// lifecycle method, instead of blanking the entire app we render this 404-style page
// with the actual error message + a way out.  Without it a single uncaught exception
// (a bad map() over undefined, a missing key in a JSON column, etc.) leaves the user
// staring at a white page with nothing to do.
type State = { error: Error | null; info: any }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null }
  static getDerivedStateFromError(error: Error): State { return { error, info: null } }
  componentDidCatch(error: Error, info: any) {
    // eslint-disable-next-line no-console
    console.error('App error boundary caught:', error, info)
    this.setState({ error, info })
  }
  reset = () => this.setState({ error: null, info: null })
  render() {
    if (!this.state.error) return this.props.children
    const err = this.state.error
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
        <div className="max-w-lg w-full text-center bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-rose-50 text-rose-600 mb-4">
            <AlertTriangle size={28}/>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Something broke on this page</h1>
          <p className="text-sm text-gray-500 mt-2">
            The page hit an unexpected error.  Reloading usually fixes it; if it keeps happening, share the message below with support.
          </p>
          <pre className="mt-4 text-left bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono text-rose-700 overflow-x-auto max-h-40">
{err.name}: {err.message}
          </pre>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button onClick={() => { this.reset(); window.location.reload() }} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
              <RotateCcw size={14}/>Reload page
            </button>
            <Link to="/" onClick={this.reset} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700">
              <Home size={14}/>Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }
}
