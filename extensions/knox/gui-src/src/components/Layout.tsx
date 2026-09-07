import { useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import { AuthProvider } from "../context/Auth";
import { LocalStorageProvider } from "../context/LocalStorage";
import { useWebviewListener } from "../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { focusEdit, setEditStatus } from "../redux/slices/editModeState";
import {
  addCodeToEdit,
  newSession,
  selectIsInEditMode,
  setMode,
  updateApplyState,
} from "../redux/slices/sessionSlice";
import {
  setSelectedBlockSettingsSection,
  setShowDialog,
} from "../redux/slices/uiSlice";
import { exitEditMode } from "../redux/thunks";
import { loadLastSession, saveCurrentSession } from "../redux/thunks/session";
import { setSessionMode } from "../redux/thunks/setSessionMode";
import { fontSize, isMetaEquivalentKeyPressed } from "../util";
import { ROUTES } from "../util/navigation";

import TextDialog from "./dialogs";
import OSRContextMenu from "./OSRContextMenu";

import { CustomScrollbarDiv } from ".";

const Layout = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const { pathname } = useLocation();

  const configError = useAppSelector((state) => state.config.configError);

  const hasFatalErrors = useMemo(() => {
    return configError?.some((error) => error.fatal);
  }, [configError]);

  const dialogMessage = useAppSelector((state) => state.ui.dialogMessage);

  const showDialog = useAppSelector((state) => state.ui.showDialog);
  const selectedBlockSettingsSection = useAppSelector(
    (state) => state.ui.selectedBlockSettingsSection,
  );

  useWebviewListener(
    "newSession",
    async () => {
      navigate(ROUTES.HOME);
      await dispatch(
        saveCurrentSession({
          openNewSession: true,
          generateTitle: true,
        }),
      );
      dispatch(exitEditMode());
    },
    [],
  );

  useWebviewListener(
    "isKnoxInputFocused",
    async () => {
      return false;
    },
    [location.pathname],
    location.pathname === ROUTES.HOME,
  );

  useWebviewListener(
    "focusKnoxInputWithNewSession",
    async () => {
      navigate(ROUTES.HOME);
      await dispatch(
        saveCurrentSession({
          openNewSession: true,
          generateTitle: true,
        }),
      );
      dispatch(exitEditMode());
    },
    [location.pathname],
    location.pathname === ROUTES.HOME,
  );

  useWebviewListener(
    "addModel",
    async () => {
      navigate("/models");
    },
    [navigate],
  );

  useWebviewListener(
    "navigateTo",
    async (data) => {
      // Open History / Checkpoints as in-chat overlays instead of leaving chat.
      if (data.path === "/history" || data.path === "/restore") {
        const section = data.path === "/history" ? "history" : "checkpoints";
        navigate(ROUTES.HOME);
        if (data.toggle && selectedBlockSettingsSection === section) {
          dispatch(setSelectedBlockSettingsSection(null));
        } else {
          dispatch(setSelectedBlockSettingsSection(section));
        }
        return;
      }

      if (data.toggle && location.pathname === data.path) {
        navigate("/");
      } else {
        navigate(data.path);
      }
    },
    [location, navigate, selectedBlockSettingsSection, dispatch],
  );

  useWebviewListener(
    "updateApplyState",
    async (state) => {
      dispatch(updateApplyState(state));
    },
    [],
  );

  useWebviewListener(
    "focusEdit",
    async () => {
      await dispatch(
        saveCurrentSession({
          openNewSession: false,
          generateTitle: false,
        }),
      );
      dispatch(newSession());
      dispatch(focusEdit());
      dispatch(setMode("edit"));
    },
    [],
  );

  useWebviewListener(
    "focusEditWithoutClear",
    async () => {
      await dispatch(
        saveCurrentSession({
          openNewSession: true,
          generateTitle: true,
        }),
      );
      dispatch(focusEdit());
      dispatch(setMode("edit"));
    },
    [],
  );

  useWebviewListener(
    "addCodeToEdit",
    async (payload) => {
      dispatch(addCodeToEdit(payload));
    },
    [navigate],
  );

  useWebviewListener(
    "setEditStatus",
    async ({ status, fileAfterEdit }) => {
      dispatch(setEditStatus({ status, fileAfterEdit }));
    },
    [],
  );

  const isInEditMode = useAppSelector(selectIsInEditMode);
  const currentMode = useAppSelector((state) => state.session.mode);
  useWebviewListener(
    "agentModeChanged",
    async ({ active }) => {
      if (active && currentMode !== "agent") {
        await dispatch(setSessionMode("agent"));
      } else if (!active && currentMode === "agent") {
        await dispatch(setSessionMode("chat"));
      }
    },
    [currentMode, dispatch],
  );
  useWebviewListener(
    "exitEditMode",
    async () => {
      if (!isInEditMode) {
        return;
      }
      dispatch(
        loadLastSession({
          saveCurrentSession: false,
        }),
      );
      dispatch(exitEditMode());
    },
    [isInEditMode],
  );

  useEffect(() => {
    const handleKeyDown = (event: any) => {
      if (isMetaEquivalentKeyPressed(event) && event.code === "KeyC") {
        const selection = window.getSelection()?.toString();
        if (selection) {
          setTimeout(() => {
            navigator.clipboard.writeText(selection);
          }, 100);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <LocalStorageProvider>
      <AuthProvider>
        <CustomScrollbarDiv className="h-full rounded relative overflow-x-hidden">
          <OSRContextMenu />
          <div
            style={{
              scrollbarGutter: "stable both-edges",
              minHeight: "100%",
              display: "grid",
              gridTemplateRows: "1fr auto",
            }}
          >
            <TextDialog
              showDialog={showDialog}
              onEnter={() => {
                dispatch(setShowDialog(false));
              }}
              onClose={() => {
                dispatch(setShowDialog(false));
              }}
              message={dialogMessage}
            />

            <div className="grid grid-rows-[1fr_auto] h-screen overflow-x-visible">
              <Outlet />

              {hasFatalErrors && pathname !== ROUTES.CONFIG_ERROR && (
                <div
                  className="z-50 cursor-pointer bg-red-600 p-4 text-center text-white"
                  role="alert"
                  onClick={() => navigate(ROUTES.CONFIG_ERROR)}
                >
                  <strong className="font-bold">{t('errorExclamation')}</strong>{" "}
                  <span className="block sm:inline">{t('failedToLoadConfiguration')}</span>
                  <div className="mt-2 underline">{t('learnMore')}</div>
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: fontSize(-4) }} id="tooltip-portal-div" />
        </CustomScrollbarDiv>
      </AuthProvider>
    </LocalStorageProvider>
  );
};

export default Layout;
