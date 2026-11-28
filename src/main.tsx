import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
} else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      if (registrations.length === 0) return;
      return Promise.all(registrations.map((reg) => reg.unregister())).then(() => {
        if (typeof caches !== 'undefined') {
          return caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
        }
      });
    })
    .catch(() => {
      // Ignore cleanup errors in restricted webviews
    });
}

createRoot(document.getElementById('root')!).render(<App />);
