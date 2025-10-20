import React from 'react'

type Props = { children: React.ReactNode }
type State = { error: any }

export class AppErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { error: null }
    }
    static getDerivedStateFromError(error: any) {
        return { error }
    }
    componentDidCatch(error: any, info: any) {
        console.error('[uGov] ErrorBoundary caught', error, info)
    }
    render() {
        const { error } = this.state
        if (error) {
            return (
                <div className="max-w-3xl mx-auto p-4 m-4 border rounded bg-red-50 text-red-800 text-sm">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h1 className="font-semibold">Something went wrong</h1>
                            <p className="mt-1">The UI crashed. See details below and check console for stack trace.</p>
                        </div>
                        <button
                            className="btn"
                            onClick={() => this.setState({ error: null })}
                            aria-label="Dismiss error"
                        >
                            Dismiss
                        </button>
                    </div>
                    <pre className="mt-3 whitespace-pre-wrap break-words">
                        {String(error?.message || error)}
                    </pre>
                </div>
            )
        }
        return this.props.children
    }
}
