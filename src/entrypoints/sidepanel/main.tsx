/**
 * FILE: entrypoints/sidepanel/main.tsx
 * WHAT: Mounts the React side panel.
 * CALLED BY: sidepanel/index.html
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Side panel: #root element missing in index.html');
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
