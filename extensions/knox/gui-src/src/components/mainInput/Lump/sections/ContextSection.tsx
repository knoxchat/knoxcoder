import { useTranslation } from "react-i18next";

export function ContextSection() {
  const { t } = useTranslation();
  return <div>{t('contextContent')}</div>;
}
