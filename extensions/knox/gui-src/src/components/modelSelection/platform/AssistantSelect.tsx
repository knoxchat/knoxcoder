import { ChevronDown } from "lucide-react";
import { ProfileDescription } from "core/config/ConfigHandler";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { vscCommandCenterInactiveBorder } from "../..";
import { useAuth } from "../../../context/Auth";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { cycleProfile, selectProfileThunk } from "../../../redux";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import {
  AddIcon,
  ArrowRightStartOnRectangleIcon,
  ExclamationTriangleIcon,
  SettingsIcon,
} from "../../../svg-icons";
import {
  fontSize,
  isLocalProfile,
  isMetaEquivalentKeyPressed,
} from "../../../util";
import { ROUTES } from "../../../util/navigation";
import { ToolTip } from "../../gui/Tooltip";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Transition,
} from "../../ui";
import { useFontSize } from "../../ui/font";

import AssistantIcon from "./AssistantIcon";

interface AssistantSelectOptionProps {
  profile: ProfileDescription;
  onClick: () => void;
}
const AssistantSelectOption = ({
  profile,
  onClick,
}: AssistantSelectOptionProps) => {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);

  const hasFatalErrors = useMemo(() => {
    return !!profile.errors?.find((error) => error.fatal);
  }, [profile.errors]);

  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);

  function handleOptionClick() {
    dispatch(selectProfileThunk(profile.id));
    onClick();
  }

  function handleConfigure() {
    ideMessenger.post("config/openProfile", { profileId: profile.id });
    onClick();
  }

  function handleClickError() {
    if (profile.id === "local") {
      navigate(ROUTES.CONFIG_ERROR);
    } else {
      ideMessenger.post("config/openProfile", { profileId: profile.id });
    }
    onClick();
  }

  return (
    <ListboxOption
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      value={profile.id}
      disabled={hasFatalErrors}
      onClick={!hasFatalErrors ? handleOptionClick : undefined}
      fontSizeModifier={-2}
    >
      <div className="flex w-full flex-col gap-0.5">
        <div className="flex w-full items-center justify-between">
          <div className="flex w-full items-center">
            <div className="mr-2 h-4 w-4 shrink-0">
              <AssistantIcon assistant={profile} />
            </div>
            <span className="line-clamp-1 flex-1">{profile.title}</span>
          </div>
          <div className="ml-2 flex items-center">
            {!profile.errors?.length ? (
              isLocalProfile(profile) ? (
                <span
                  className="h-3 w-3 shrink-0 cursor-pointer"
                  style={{
                    opacity: hovered ? 1 : 0,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    handleConfigure();
                  }}
                >
                  <SettingsIcon />
                </span>
              ) : (
                <span
                  style={{
                    opacity: hovered ? 1 : 0,
                  }}
                  className="h-3 w-3 shrink-0 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    handleConfigure();
                  }}
                >
                  <ArrowRightStartOnRectangleIcon />
                </span>
              )
            ) : (
              <>
                <span
                  data-tooltip-id={`${profile.id}-errors-tooltip`}
                  className="text-red h-3 w-3 shrink-0 cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleClickError();
                  }}
                >
                  <ExclamationTriangleIcon />
                </span>
                <ToolTip id={`${profile.id}-errors-tooltip`}>
                  <div className="font-semibold">error</div>
                  {JSON.stringify(profile.errors, null, 2)}
                </ToolTip>
              </>
            )}
          </div>
        </div>
      </div>
    </ListboxOption>
  );
};

export default function AssistantSelect() {
  const dispatch = useAppDispatch();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { selectedProfile } = useAuth();
  const ideMessenger = useContext(IdeMessengerContext);
  const isLumpToolbarExpanded = useAppSelector(
    (state) => state.ui.isBlockSettingsToolbarExpanded,
  );

  const { profiles } = useAuth();
  const navigate = useNavigate();

  function close() {
    if (buttonRef.current) {
      buttonRef.current.click();
    }
  }

  useEffect(() => {
    let lastToggleTime = 0;
    const DEBOUNCE_MS = 500;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "'" &&
        isMetaEquivalentKeyPressed(event as any) &&
        event.shiftKey
      ) {
        const now = Date.now();

        if (now - lastToggleTime >= DEBOUNCE_MS) {
          dispatch(cycleProfile());
          lastToggleTime = now;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const smallFont = useFontSize(-3);

  if (!selectedProfile) {
    return (
      <div
        className="text-knoxcyan flex cursor-pointer items-center gap-1 select-none"
        style={{ fontSize: smallFont }}
      >
        <span className="h-3 w-3 shrink-0 select-none">
          <AddIcon />
        </span>
        <span
          className={`line-clamp-1 select-none ${isLumpToolbarExpanded ? "xs:hidden sm:line-clamp-1" : ""}`}
        >
          Create your agent
        </span>
      </div>
    );
  }

  return (
    <Listbox>
      <div className="relative flex sm:max-w-4/5">
        <ListboxButton
          data-testid="assistant-select-button"
          ref={buttonRef}
          className="text-knoxcyan border-none bg-transparent hover:brightness-125"
          style={{ fontSize: fontSize(-3) }}
        >
          <div className="flex flex-row items-center gap-1.5">
            <div className="h-3 w-3 shrink-0 select-none">
              <AssistantIcon size={3} assistant={selectedProfile} />
            </div>
            <span
              className={`line-clamp-1 select-none ${isLumpToolbarExpanded ? "xs:hidden sm:line-clamp-1" : ""}`}
            >
              {selectedProfile.title}
            </span>
          </div>
          <ChevronDown
            className="text-knoxcyan h-2 w-2 shrink-0 select-none"
            aria-hidden="true"
          />
        </ListboxButton>

        <Transition>
          <ListboxOptions className="pb-0">
            <div
              className={`thin-scrollbar flex max-h-[300px] flex-col gap-1 overflow-y-auto py-1`}
            >
              {profiles?.map((profile, idx) => {
                return (
                  <AssistantSelectOption
                    key={idx}
                    profile={profile}
                    onClick={close}
                  />
                );
              })}
            </div>

            <div className="flex flex-col">
              <div
                className="my-0 h-[0.5px]"
                style={{
                  backgroundColor: vscCommandCenterInactiveBorder,
                }}
              />
            </div>
          </ListboxOptions>
        </Transition>
      </div>
    </Listbox>
  );
}
