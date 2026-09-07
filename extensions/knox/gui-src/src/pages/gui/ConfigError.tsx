import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import HeaderButtonWithToolTip from "../../components/gui/HeaderButtonWithToolTip";
import { useAppSelector } from "../../redux/hooks";
import { ExclamationTriangleIcon } from "../../svg-icons";
import { ROUTES } from "../../util/navigation";

const ConfigErrorIndicator = () => {
  const { t } = useTranslation();
  const configError = useAppSelector((store) => store.config.configError);

  const navigate = useNavigate();
  const { pathname } = useLocation();

  function onClickError() {
    navigate(pathname === ROUTES.CONFIG_ERROR ? "/" : ROUTES.CONFIG_ERROR);
  }

  if (!configError?.length) {
    return null;
  }

  // TODO: add a tooltip
  return (
    <HeaderButtonWithToolTip
      tooltipPlacement="top-end"
      text={t('configError')}
      onClick={onClickError}
    >
      <span className="w-4 h-4">
        <ExclamationTriangleIcon />
      </span>
    </HeaderButtonWithToolTip>
  );
};

export default ConfigErrorIndicator;
