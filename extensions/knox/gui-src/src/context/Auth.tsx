import { ProfileDescription } from "core/config/ProfileLifecycleManager";
import React, { createContext, useContext, useEffect } from "react";

import { useWebviewListener } from "../hooks/useWebviewListener";
import { updateProfilesThunk } from "../redux";
import { selectSelectedProfile } from "../redux/";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import i18n from "../i18n";

import { IdeMessengerContext } from "./IdeMessenger";

interface AuthContextType {
  selectedProfile: ProfileDescription | null;
  profiles: ProfileDescription[] | null;
  refreshProfiles: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);

  const profiles = useAppSelector((store) => store.profiles.availableProfiles);
  const selectedProfile = useAppSelector(selectSelectedProfile);

  useEffect(() => {
    ideMessenger.request("config/listProfiles", undefined).then((result) => {
      if (result.status === "success") {
        dispatch(
          updateProfilesThunk({
            profiles: result.content.profiles,
            selectedProfileId: result.content.selectedProfileId,
          }),
        );
      }
    });
  }, []);

  const refreshProfiles = async () => {
    try {
      await ideMessenger.request("config/refreshProfiles", undefined);
      ideMessenger.post("showToast", ["info", i18n.t("configRefreshed")]);
    } catch (e) {
      console.error("Failed to refresh profiles", e);
      ideMessenger.post("showToast", [
        "error",
        i18n.t("failedToRefreshConfig"),
      ]);
    }
  };

  useWebviewListener(
    "didChangeAvailableProfiles",
    async (data) => {
      dispatch(
        updateProfilesThunk({
          profiles: data.profiles,
          selectedProfileId: data.selectedProfileId,
        }),
      );
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{
        selectedProfile,
        profiles,
        refreshProfiles,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
