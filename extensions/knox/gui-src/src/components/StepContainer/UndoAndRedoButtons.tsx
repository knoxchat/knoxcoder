import { Undo2, Redo2 } from "lucide-react";
import { useContext } from "react";
import { useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppSelector } from "../../redux/hooks";
import { setCurCheckpointIndex } from "../../redux/slices/sessionSlice";

export default function UndoAndRedoButtons() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const ideMessenger = useContext(IdeMessengerContext);

  const history = useAppSelector((store) => store.session.history);

  const curCheckpointIndex = useAppSelector(
    (store) => store.session.curCheckpointIndex,
  );

  const shouldRenderRedo = false; // curCheckpointIndex !== checkpoints.length - 1;

  async function handleUndoOrRedo(type: "undo" | "redo") {
    const checkpointIndex = Math.max(
      0,
      type === "undo" ? curCheckpointIndex - 1 : curCheckpointIndex + 1,
    );

    const checkpoint = history[checkpointIndex]?.checkpoint ?? {};

    for (const [filepath, cachedFileContent] of Object.entries(checkpoint)) {
      ideMessenger.post("overwriteFile", {
        filepath,
        prevFileContent: cachedFileContent,
      });
    }

    dispatch(setCurCheckpointIndex(checkpointIndex));
  }

  return (
    <div className="flex justify-center gap-2 border-b border-gray-200/25 p-1 px-3">
      <button
        className="flex cursor-pointer items-center border-none bg-transparent px-2 py-1 text-xs text-gray-300 opacity-80 hover:opacity-100 hover:brightness-125"
        onClick={() => handleUndoOrRedo("undo")}
      >
        <Undo2 className="text-knoxcyan mr-2 h-3.5 w-3.5" />
        {t('undo')}
      </button>

      {shouldRenderRedo && (
        <button
          className="flex cursor-pointer items-center border-none bg-transparent px-2 py-1 text-xs text-gray-300 opacity-80 hover:opacity-100 hover:brightness-125"
          onClick={() => handleUndoOrRedo("redo")}
        >
          <Redo2 className="text-knoxcyan mr-2 h-3.5 w-3.5" />
          {t('redo')}
        </button>
      )}
    </div>
  );
}
