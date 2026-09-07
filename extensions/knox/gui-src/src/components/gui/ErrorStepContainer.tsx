import { KnoxError } from "core";
import { useTranslation } from "react-i18next";

import { MinusCircleIcon, XMarkIcon } from "../../svg-icons";

import HeaderButtonWithToolTip from "./HeaderButtonWithToolTip";

interface ErrorStepContainerProps {
  error: KnoxError;
  onClose: () => void;
  onDelete: () => void;
}

function ErrorStepContainer(props: ErrorStepContainerProps) {
  const { t } = useTranslation();
  return (
    <div className="relative" style={{ backgroundColor: 'var(--vscode-background)' }}>
      <div className="absolute right-3 top-3 flex">
        <HeaderButtonWithToolTip
          text={t('collapse')}
          onClick={() => props.onClose()}
        >
          <MinusCircleIcon />
        </HeaderButtonWithToolTip>
        <HeaderButtonWithToolTip text={t('delete')} onClick={() => props.onDelete()}>
          <XMarkIcon />
        </HeaderButtonWithToolTip>
      </div>
      <div className="p-2 bg-[#ff000011] rounded border border-[#cc0000] m-2">
        <pre style={{ whiteSpace: "pre-wrap", wordWrap: "break-word" }}>
          {props.error.message as string}
        </pre>
      </div>
    </div>
  );
}

export default ErrorStepContainer;
