import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

export function mountApp(App: ComponentType) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
