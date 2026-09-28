// SPDX-License-Identifier: AGPL-3.0-only
// FEAT-02: a render crash used to leave #root empty with no way out (the whole
// audit point behind BUG-01). The boundary is keyed by the parent, so bumping
// the key remounts it fresh after a reset. It wraps the screens area of App —
// the realistic crash site; a crash in App itself still takes the page down.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Resets the app state (back to Home) and remounts the boundary. */
  onReset: () => void;
  title: string;
  body: string;
  action: string;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console only: storage/audio failures stay swallowed, but a render crash
    // is a bug we want to see when debugging.
    console.error("[aember-arena] render crash", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="error-screen" role="alert">
        <h1>{this.props.title}</h1>
        <p>{this.props.body}</p>
        <button
          type="button"
          className="cta-button"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onReset();
          }}
        >
          {this.props.action}
        </button>
      </div>
    );
  }
}
