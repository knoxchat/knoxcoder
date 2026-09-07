import { useTranslation } from "react-i18next";
import useCopy from "../../hooks/useCopy";

import HeaderButtonWithToolTip from "./HeaderButtonWithToolTip";

interface CopyIconButtonProps {
  text: string | (() => string);
  tabIndex?: number;
  checkIconClassName?: string;
  clipboardIconClassName?: string;
  tooltipPlacement?: "top" | "bottom";
}

export function CopyIconButton({
  text,
  tabIndex,
  checkIconClassName = "h-4 w-4 text-knoxcyan",
  clipboardIconClassName = "h-4 w-4 text-knoxcyan",
  tooltipPlacement = "bottom",
}: CopyIconButtonProps) {
  const { t } = useTranslation();
  const { copyText, copied } = useCopy(text);

  return (
    <>
      <HeaderButtonWithToolTip
        tooltipPlacement={tooltipPlacement}
        tabIndex={tabIndex}
        text={copied ? t('copied') : t('copy')}
        onClick={copyText}
      >
        {copied ? (
          <span className={checkIconClassName}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path
                fill="#159994"
                d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m-8.29 13.29a.996.996 0 0 1-1.41 0L5.71 12.7a.996.996 0 1 1 1.41-1.41L10 14.17l6.88-6.88a.996.996 0 1 1 1.41 1.41z"
              />
            </svg>
          </span>
        ) : (
          <span className={clipboardIconClassName}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <g
                fill="none"
                stroke="#159994"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              >
                <path d="M7 9.667A2.667 2.667 0 0 1 9.667 7h8.666A2.667 2.667 0 0 1 21 9.667v8.666A2.667 2.667 0 0 1 18.333 21H9.667A2.667 2.667 0 0 1 7 18.333z" />
                <path d="M4.012 16.737A2 2 0 0 1 3 15V5c0-1.1.9-2 2-2h10c.75 0 1.158.385 1.5 1" />
              </g>
            </svg>
          </span>
        )}
      </HeaderButtonWithToolTip>
    </>
  );
}
