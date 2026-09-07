import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { HoverDiv, HoverTextDiv } from "./StyledComponents";

interface DragOverlayProps {
  show: boolean;
  setShow: (show: boolean) => void;
}

export const DragOverlay: React.FC<DragOverlayProps> = ({ show, setShow }) => {
  const { t } = useTranslation();
  useEffect(() => {
    const overListener = () => {
      setShow(true);
    };
    window.addEventListener("dragover", overListener);

    const leaveListener = () => {
      setTimeout(() => setShow(false), 2000);
    };
    window.addEventListener("dragleave", leaveListener);

    return () => {
      window.removeEventListener("dragover", overListener);
      window.removeEventListener("dragleave", leaveListener);
    };
  }, []);

  if (!show) {return null;}

  return (
    <>
      <HoverDiv />
      <HoverTextDiv>{t('dragAndDropImages')}</HoverTextDiv>
    </>
  );
};
