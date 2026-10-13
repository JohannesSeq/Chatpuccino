import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { DialogProvider } from './dialogs.jsx';
import { DataProvider } from './data.jsx';
import { I18nProvider } from './i18n.jsx';
import { applyAppearance, loadCachedAppearance } from './theme.js';
import './styles.css';

// Antes de pintar: aplica la última apariencia conocida (también en la pantalla de login).
applyAppearance(loadCachedAppearance());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <DialogProvider>
            <DataProvider>
              <App />
            </DataProvider>
          </DialogProvider>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
