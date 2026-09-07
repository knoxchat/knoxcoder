import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch } from "react-redux";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppSelector } from "../../redux/hooks";
import {
  addCodeToEdit,
  removeCodeToEdit,
} from "../../redux/slices/sessionSlice";
import { AddIcon, XMarkIcon } from "../../svg-icons";

import AddFileButton from "./AddFileButton";
import AddFileCombobox from "./AddFileCombobox";
import CodeToEditListItem from "./CodeToEditListItem";

import type { CodeToEdit } from "core";

export default function CodeToEditCard() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const [showAddFileCombobox, setShowAddFileCombobox] = useState(false);
  const codeToEdit = useAppSelector((state) => state.session.codeToEdit);

  const title =
    codeToEdit.length === 0
      ? t('editCode')
      : codeToEdit.length === 1
        ? t('editCodeItems', { count: 1 })
        : t('editCodeItems', { count: codeToEdit.length });

  function onDelete(rif: CodeToEdit) {
    dispatch(removeCodeToEdit(rif));
  }

  async function onClickFilename(code: CodeToEdit) {
    if ("range" in code) {
      await ideMessenger.ide.showLines(
        code.filepath,
        code.range.start.line,
        code.range.end.line,
      );
    } else {
      await ideMessenger.ide.openFile(code.filepath);
    }
  }

  async function onSelectFilesToAdd(uris: string[]) {
    const filePromises = uris.map(async (uri) => {
      const contents = await ideMessenger.ide.readFile(uri);
      return { contents, filepath: uri };
    });

    const fileResults = await Promise.all(filePromises);

    for (const file of fileResults) {
      dispatch(addCodeToEdit(file));
    }
  }

  return (
    <div className="bg-vsc-editor-background mx-3 flex flex-col rounded-t-lg p-1">
      <div className="text-knoxcyan flex items-center justify-between gap-1.5 py-1.5 pl-3 pr-2 text-xs">
        <span>{title}</span>
        <AddFileButton onClick={() => setShowAddFileCombobox(true)} />
      </div>

      {codeToEdit.length > 0 ? (
        <ul className="no-scrollbar my-0 mb-1.5 max-h-[50vh] list-outside list-none overflow-y-auto pl-0">
          {codeToEdit.map((code, i) => (
            <CodeToEditListItem
              key={code.filepath + i}
              code={code}
              onDelete={onDelete}
              onClickFilename={onClickFilename}
            />
          ))}
        </ul>
      ) : (
        !showAddFileCombobox && (
          <div
            className="text-lightgray hover:text-knoxcyan/50 -mt-0.5 flex cursor-pointer items-center justify-center gap-1 rounded-sm py-1 text-center text-xs transition-colors hover:bg-opacity-20"
            onClick={() => setShowAddFileCombobox(true)}
          >
            <span className="h-3.5 w-3.5 mb-1">
              <AddIcon />
            </span>
            <span className="text-knoxcyan">{t('addFileToEdit')}</span>
          </div>
        )
      )}

      {showAddFileCombobox && (
        <div className="mr-2 flex items-center py-1">
          <div className="grow">
            <AddFileCombobox
              onSelect={onSelectFilesToAdd}
              onEscape={() => setShowAddFileCombobox(false)}
            />
          </div>
          <span
            onClick={() => {
              setShowAddFileCombobox(false);
            }}
            className="text-lightgray hover:bg-red/65 hover:text-vsc-foreground mb-2 h-5 w-5 cursor-pointer rounded-xs p-0.5 hover:bg-opacity-20"
          ><XMarkIcon /></span>
        </div>
      )}
    </div>
  );
}
