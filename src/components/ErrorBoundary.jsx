import { Component } from 'react';
import {
  CRASH_RELOAD_LABEL,
  CRASH_RESET_LABEL,
  CRASH_TITLE,
  ensureCrashStyles,
  formatErrorDetails,
  markCrashShown,
  reloadPage,
  resetDraftAndReload,
} from '../startupErrors';

// Top-level boundary: a render, lifecycle, or effect error anywhere in the app
// shows the same crash screen startupErrors.js draws for non-React failures,
// instead of an empty page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, componentStack: '' };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[TerrierPlan] Render error caught by ErrorBoundary:', error, info?.componentStack);
    markCrashShown();
    this.setState({ componentStack: info?.componentStack || '' });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    ensureCrashStyles();
    return (
      <div className="tp-crash" role="alert">
        <div className="tp-crash-inner">
          <h1 className="tp-crash-title">{CRASH_TITLE}</h1>
          <pre className="tp-crash-details">{formatErrorDetails(error, componentStack)}</pre>
          <div className="tp-crash-actions">
            <button type="button" className="tp-crash-btn tp-crash-btn-primary" onClick={reloadPage}>
              {CRASH_RELOAD_LABEL}
            </button>
            <button type="button" className="tp-crash-btn tp-crash-btn-secondary" onClick={resetDraftAndReload}>
              {CRASH_RESET_LABEL}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
