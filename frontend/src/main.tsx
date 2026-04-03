import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthSessionProvider } from './lib/authSession'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthSessionProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </AuthSessionProvider>
  </StrictMode>,
)
