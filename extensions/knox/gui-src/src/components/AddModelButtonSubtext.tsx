import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { IdeMessengerContext } from "../context/IdeMessenger";

import { ButtonSubtext } from ".";

function AddModelButtonSubtext() {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);

  return (
    <ButtonSubtext>
      {t('thisSettingWillUpdate')}{" "}
      <span
        className="cursor-pointer underline"
        onClick={() =>
          ideMessenger.post("config/openProfile", {
            profileId: undefined,
          })
        }
      >
        {t('configs')}
      </span>
    </ButtonSubtext>
  );
}

export default AddModelButtonSubtext;
