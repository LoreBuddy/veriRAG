import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './assets/styles/main.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import Spinner from './views/spinner/Spinner'


createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Suspense fallback={<Spinner />}>
            <App />
        </Suspense>
    </StrictMode>
);
