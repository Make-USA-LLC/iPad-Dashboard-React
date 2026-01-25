import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom' // Import the Router
import './index.css'
import App from './App.jsx'

// STRICT MODE REMOVED (Keep this removed for Drag-and-Drop)
// Wrapped in BrowserRouter so App.jsx can use 'useNavigate'
createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)