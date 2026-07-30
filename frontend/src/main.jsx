import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { initLang } from './i18n.jsx';
import { initTheme } from './theme.js';
import './styles.css';

// Both run before the first render: the stored theme and language are applied straight away, so a
// dark-theme user does not get a light first frame and `<html lang>` is never briefly wrong.
initTheme();
initLang();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
