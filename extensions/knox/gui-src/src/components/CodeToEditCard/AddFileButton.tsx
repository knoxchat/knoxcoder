import { useContext, useRef } from "react";
import { useTranslation } from "react-i18next";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch } from "../../redux/hooks";
import { addCodeToEdit } from "../../redux/slices/sessionSlice";
import { AddIcon, ArrowDownIcon } from "../../svg-icons";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "../ui/Listbox";

export interface AddFileButtonProps {
  onClick: () => void;
}

export default function AddFileButton({ onClick }: AddFileButtonProps) {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();

  async function handleAddAllOpenFiles() {
    const openFiles = await ideMessenger.ide.getOpenFiles();
    const filesData = await Promise.all(
      openFiles.map(async (filepath) => {
        const contents = await ideMessenger.ide.readFile(filepath);
        return { filepath, contents };
      }),
    );

    dispatch(addCodeToEdit(filesData));
  }

  return (
    <Listbox onChange={handleAddAllOpenFiles}>
      <div className="relative">
        <ListboxButton
          ref={buttonRef}
          className="bg-vsc-editor-background m-0 rounded-md p-0"
        >
          <div
            className="flex h-5 w-14 items-center justify-center gap-1 hover:brightness-125"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClick();
            }}
          >
            <span className="inline mb-1 h-3 w-3 brightness-75">
              <AddIcon />
            </span>
            <span className="text-knoxcyan text-[10px] brightness-75">
              {t('addFile')}
            </span>
          </div>

          <div className="border-knoxcyan/50 h-4 w-[1px] border-y-0 border-l-0 border-r border-solid" />

          <span className="cursor-pointer px-1 brightness-75 hover:brightness-125">
            <ArrowDownIcon />
          </span>
        </ListboxButton>

        <ListboxOptions className="bg-vsc-editor-background" anchor="top end">
          <ListboxOption
            value="addAllFiles"
            className="text-knoxcyan/60"
          >
            {t('addAllOpenFiles')}
          </ListboxOption>
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
