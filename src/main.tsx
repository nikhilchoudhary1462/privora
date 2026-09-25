import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Mark the native web app context to prevent the Privora browser extension from running on itself
if (typeof window !== 'undefined') {
  (window as any).__IS_PRIVORA_APP__ = true;
  (window as any).__privoraIsNativeApp = true;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
