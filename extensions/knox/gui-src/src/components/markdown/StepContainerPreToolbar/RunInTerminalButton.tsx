import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { lightGray, vscForeground } from "../..";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { TerminalIcon } from "../../../svg-icons";

interface RunInTerminalButtonProps {
  command: string;
}

export default function RunInTerminalButton({
  command,
}: RunInTerminalButtonProps) {
  const ideMessenger = useContext(IdeMessengerContext);
  const { t } = useTranslation();

  function runInTerminal() {
    void ideMessenger.post("runCommand", { command });
  }

  return (
    <div
      className={`flex items-center border-none bg-transparent text-xs text-knoxcyan text-[${vscForeground}] cursor-pointer outline-hidden hover:brightness-125`}
      onClick={runInTerminal}
    >
      <div
        className="max-2xs:hidden flex items-center gap-1 transition-colors duration-200 hover:brightness-125"
        style={{ color: lightGray }}
      >
        <>
          <TerminalIcon />
          <span className="text-knoxcyan max-sm:hidden">{t('run')}</span>
        </>
      </div>
    </div>
  );
}
