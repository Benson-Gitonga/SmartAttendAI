import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerServiceWorker } from './sw/register'
import { startSyncOnReconnect } from './services/syncService'
import { startRosterSyncOnReconnect } from './services/rosterSyncService'
import { requestPersistentStorage } from './lib/persistentStorage'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Registered after render so precaching never competes with first paint.
registerServiceWorker()

startSyncOnReconnect()

startRosterSyncOnReconnect()

// Keep registers that have not been sent yet if the phone runs low on space.
requestPersistentStorage()
