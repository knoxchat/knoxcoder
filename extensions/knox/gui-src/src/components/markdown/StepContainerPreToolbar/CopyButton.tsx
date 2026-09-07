import { lightGray, vscForeground } from "../..";
import useCopy from "../../../hooks/useCopy";
import { useTranslation } from "react-i18next";

interface CopyButtonProps {
  text: string;
}

export default function CopyButton({ text }: CopyButtonProps) {
  const { copyText, copied } = useCopy(text);
  const { t } = useTranslation();

  return (
    <div
      className={`flex items-center border-none bg-transparent text-xs text-knoxcyan text-[${vscForeground}] cursor-pointer outline-hidden hover:brightness-125`}
      onClick={copyText}
    >
      <div
        className="max-2xs:hidden flex items-center gap-1 transition-colors duration-200 hover:brightness-125"
        style={{ color: lightGray }}
      >
        {copied ? (
          <>
            <span className="h-3.5 w-3.5 text-knoxcyan hover:brightness-125">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path
                  fill="#159994"
                  d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m-8.29 13.29a.996.996 0 0 1-1.41 0L5.71 12.7a.996.996 0 1 1 1.41-1.41L10 14.17l6.88-6.88a.996.996 0 1 1 1.41 1.41z"
                />
              </svg>
            </span>
            <span className="text-knoxcyan max-sm:hidden">{t('copied')}</span>
          </>
        ) : (
          <>
            <span className="h-3.5 w-3.5 hover:brightness-125">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path
                  fill="#159994"
                  d="M3.25 9A5.75 5.75 0 0 1 9 3.25h7.013a.75.75 0 0 1 0 1.5H9A4.25 4.25 0 0 0 4.75 9v7.107a.75.75 0 0 1-1.5 0z"
                />
                <path
                  fill="#159994"
                  d="M18.403 6.793a44.4 44.4 0 0 0-9.806 0a2.01 2.01 0 0 0-1.774 1.76a42.6 42.6 0 0 0 0 9.894a2.01 2.01 0 0 0 1.774 1.76c3.241.362 6.565.362 9.806 0a2.01 2.01 0 0 0 1.774-1.76a42.6 42.6 0 0 0 0-9.894a2.01 2.01 0 0 0-1.774-1.76"
                />
              </svg>
            </span>
            <span className="text-knoxcyan max-sm:hidden">{t('copyText')}</span>
          </>
        )}
      </div>
    </div>
  );
}
