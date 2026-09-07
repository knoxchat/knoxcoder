import { useTranslation } from "react-i18next";

export interface GeneratingCodeLoaderProps {
  showLineCount: boolean;
  codeBlockContent: string;
}

export default function GeneratingCodeLoader({
  showLineCount,
  codeBlockContent,
}: GeneratingCodeLoaderProps) {
  const { t } = useTranslation();
  const numLinesCodeBlock = codeBlockContent.split("\n").length;
  const linesGeneratedText = t('generatedLines', { count: numLinesCodeBlock === 1 ? 1 : numLinesCodeBlock - 1 });

  return (
    <span className="inline-flex items-center gap-2 text-knoxcyan font-medium animate-pulse">
      {showLineCount ? (
        <div className="flex items-center overflow-hidden relative">
          <span className="overflow-hidden whitespace-nowrap tracking-wide">{linesGeneratedText}</span>
        </div>
      ) : (
        <span className="overflow-hidden whitespace-nowrap tracking-wide">{t('generating')}</span>
      )}
    </span>
  );
}
