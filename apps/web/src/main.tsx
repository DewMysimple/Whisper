import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './styles.css';
import './components/diagnostic-text.css';
import './components/tasks/task-workspace.css';
import './components/tasks/task-monitor.css';
import './components/tasks/task-history.css';
import './components/tasks/task-date-filter.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
