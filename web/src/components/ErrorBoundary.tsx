import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4 py-12 text-slate-100">
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#152033] p-8 shadow-2xl shadow-black/40">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Vigil</p>
          <h1 className="mt-3 text-xl font-semibold text-white">Something went wrong</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            The page hit an unexpected error. Reload to try again. If it keeps happening, contact support.
          </p>
          {import.meta.env.DEV && (
            <pre className="mt-4 max-h-40 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs text-red-300">
              {this.state.error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.reload}
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#0f172a] transition hover:bg-slate-100"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
