import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Contains a rendering failure of the language-server status chip, so it
 * cannot take the whole window down through `AppErrorBoundary`. The fallback
 * is an inert, muted label. Keyed by the active document, it retries on the
 * next document switch.
 */
export default class ChipBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[lsp] Status chip rendering failed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <span className="text-zinc-600" title="The language server status could not be shown">language server</span>;
  }
}
