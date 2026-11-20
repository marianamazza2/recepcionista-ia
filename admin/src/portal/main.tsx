// =============================================================================
// Portal del cliente (Fase 9 · 9.4): punto de entrada
// =============================================================================

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import '../estilos.css';

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
