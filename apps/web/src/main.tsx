import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import { Layout } from './app/Layout';
import { AuthProvider } from './state/auth';
import { DataScope } from './state/DataScope';
import { LandingPage } from './pages/LandingPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { MethodPage } from './pages/MethodPage';
import { StatusPage } from './pages/StatusPage';
import { LimitsPage } from './pages/LimitsPage';
import { AuthPage } from './pages/AuthPage';
import { SharedPage } from './pages/SharedPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { PreferencesProvider } from './state/preferences';

// le pagine con mappa caricano MapLibre solo quando servono
const AreaPage = lazy(() => import('./pages/AreaPage'));
const UrbanLabPage = lazy(() => import('./pages/UrbanLabPage'));
const AgriLabPage = lazy(() => import('./pages/AgriLabPage'));
const ComparePage = lazy(() => import('./pages/ComparePage'));
const VerifyPage = lazy(() => import('./pages/VerifyPage'));
const MediaPage = lazy(() => import('./pages/MediaPage'));

const wrap = (el: React.ReactNode) => <Suspense fallback={<p className="p-4">Caricamento…</p>}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/progetti', element: <ProjectsPage /> },
      { path: '/progetti/:id/area', element: wrap(<AreaPage />) },
      { path: '/progetti/:id/urbano', element: wrap(<UrbanLabPage />) },
      { path: '/progetti/:id/agricolo', element: wrap(<AgriLabPage />) },
      { path: '/progetti/:id/confronto', element: wrap(<ComparePage />) },
      { path: '/progetti/:id/verifica', element: wrap(<VerifyPage />) },
      { path: '/progetti/:id/documenti', element: wrap(<MediaPage />) },
      { path: '/metodo', element: <MethodPage /> },
      { path: '/stato', element: <StatusPage /> },
      { path: '/limiti', element: <LimitsPage /> },
      { path: '/accesso', element: <AuthPage /> },
      { path: '/benvenuto', element: <OnboardingPage /> },
      { path: '/condiviso/:token', element: <SharedPage /> },
      { path: '*', element: <p className="card">Pagina non trovata.</p> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <PreferencesProvider>
        <DataScope>
          <RouterProvider router={router} />
        </DataScope>
      </PreferencesProvider>
    </AuthProvider>
  </StrictMode>,
);
