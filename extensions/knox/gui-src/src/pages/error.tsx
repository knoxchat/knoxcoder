import { RotateCw, Flag } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate, useRouteError } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Button } from "../components";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { newSession } from "../redux/slices/sessionSlice";
import { indexedDBManager } from "../util/indexedDB";

const ErrorPage: React.FC = () => {
  const { t } = useTranslation();
  const error: any = useRouteError();
  console.error(error);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const messenger = useContext(IdeMessengerContext);
  const openUrl = (url: string) => {
    if (messenger) {
      messenger.post("openUrl", url);
    }
  };

  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    setTimeout(() => {
      setInitialLoad(false);
    }, 500);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center px-2 py-4 text-center sm:px-8">
      <h4 className="mb-4 text-3xl font-bold">{t('oopsSomethingWentWrong')}</h4>

      <code className="whitespace-wrap mx-2 mb-4 max-w-full wrap-break-word py-2">
        {error.statusText || error.message}
      </code>

      <Button
        className="flex flex-row items-center gap-2"
        onClick={async () => {
          dispatch(newSession());
          
          // Clear both localStorage and IndexedDB
          localStorage.removeItem("persist:root");
          localStorage.removeItem("inputHistory_chat");
          
          try {
            await indexedDBManager.removeReduxPersist("persist:root");
            await indexedDBManager.removeItem("inputHistory_chat" as any);
            console.log("[OK] Cleared IndexedDB data");
          } catch (error) {
            console.error("Failed to clear IndexedDB data:", error);
          }
          
          navigate("/");
        }}
      >
        {initialLoad ? (
          <Flag className="h-5 w-5 text-red" />
        ) : (
          <RotateCw className="h-5 w-5 text-knoxcyan" />
        )}
        Knox
      </Button>
    </div>
  );
};

export default ErrorPage;
