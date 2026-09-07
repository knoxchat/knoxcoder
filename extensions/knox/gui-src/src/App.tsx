import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { useEffect } from "react";

import Layout from "./components/Layout";
import { SubmenuContextProvidersProvider } from "./context/SubmenuContextProviders";
import { VscThemeProvider } from "./context/VscTheme";
import { ScrollProvider } from "./contexts/ScrollContext";
import useSetup from "./hooks/useSetup";
import { AddNewModel, ConfigureProvider } from "./pages/AddNewModel";
import ConfigPage from "./pages/config";
import ConfigErrorPage from "./pages/config-error";
import ErrorPage from "./pages/error";
import Chat from "./pages/gui";
import History from "./pages/history";
import Restore from "./pages/restore";
import TokenDashboard from "./pages/stats/TokenDashboard";
import MemoryPage from "./pages/memory";
import { BatchDiffPanel } from "./components/BatchDiffPanel/BatchDiffPanel";
import { ROUTES } from "./util/navigation";
import { applyUserLanguage } from "./i18n";

const router = createMemoryRouter([
  {
    path: ROUTES.HOME,
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: "/index.html",
        element: <Chat />,
      },
      {
        path: ROUTES.HOME,
        element: <Chat />,
      },
      {
        path: "/history",
        element: <History />,
      },
      {
        path: "/restore",
        element: <Restore />,
      },
      {
        path: "/stats",
        element: <TokenDashboard />,
      },
      {
        path: "/memory",
        element: <MemoryPage />,
      },
      {
        path: "/batch-diff",
        element: <BatchDiffPanel />,
      },
      {
        path: "/addModel",
        element: <AddNewModel />,
      },
      {
        path: "/addModel/provider/:providerName",
        element: <ConfigureProvider />,
      },
      {
        path: ROUTES.CONFIG_ERROR,
        element: <ConfigErrorPage />,
      },
      {
        path: ROUTES.CONFIG,
        element: <ConfigPage />,
      },
    ],
  },
]);

/*
  Prevents entire app from rerendering continuously with useSetup in App
  TODO - look into a more redux-esque way to do this
*/
function SetupListeners() {
  useSetup();
  
  // Apply user's language preference on mount
  useEffect(() => {
    applyUserLanguage();
  }, []);
  
  return <></>;
}

function App() {
  return (
    <VscThemeProvider>
      <ScrollProvider>
        <SubmenuContextProvidersProvider>
          <RouterProvider router={router} />
        </SubmenuContextProvidersProvider>
        <SetupListeners />
      </ScrollProvider>
    </VscThemeProvider>
  );
}

export default App;
