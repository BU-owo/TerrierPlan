// Must stay the first import: registers the startup error listeners before any
// other module evaluates.
import { setReactRoot } from './startupErrors'
// Must come next: pdfjs-dist touches the global Iterator (and its helpers) at
// module load, and Safari before 18.4 doesn't have it.
import 'core-js/actual/iterator'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const root = createRoot(document.getElementById('root'))
setReactRoot(root)
root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
