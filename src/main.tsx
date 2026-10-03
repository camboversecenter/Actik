import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './lib/khmerFont'
import { LanguageProvider } from './lib/i18n'
import { purgeLegacySessionKey } from './lib/issuerKeyStore'

// Earlier builds kept the issuer's private key in sessionStorage as plain
// text. Remove any such copy before anything else runs.
purgeLegacySessionKey()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
)
