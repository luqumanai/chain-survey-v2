import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './AuthGate.jsx';

createRoot(document.getElementById('root')).render(
  <AuthGate>
    <App />
  </AuthGate>
);
