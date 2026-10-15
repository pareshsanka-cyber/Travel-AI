import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './motion/motion.css';

import { ThemeProvider } from './context/ThemeContext.tsx';
import { MotionProvider } from './motion/MotionProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider>
    <ThemeProvider>
      <App />
    </ThemeProvider>
    </MotionProvider>
  </StrictMode>,
);
