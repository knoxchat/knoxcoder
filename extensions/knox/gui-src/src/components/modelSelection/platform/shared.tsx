import { ConfigValidationError } from "knoxdev-package/config-yaml";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import {
  ArrowRightStartOnRectangleIcon,
  ExclamationTriangleIcon,
  SettingsIcon,
} from "../../../svg-icons";
import { ToolTip } from "../../gui/Tooltip";

export const OptionDiv = ({ 
  isDisabled, 
  isSelected, 
  className, 
  ...props 
}: { 
  isDisabled?: boolean; 
  isSelected?: boolean; 
} & React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "py-1.5 px-3 min-w-0",
      !isDisabled && "cursor-pointer hover:bg-lightgray/20",
      !isDisabled && isSelected && "bg-lightgray/15",
      isDisabled && "opacity-50",
      className
    )}
    {...props}
  />
);

export const MAX_HEIGHT_PX = 300;

export const Divider = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div 
    className={cn("h-px bg-[var(--vscode-commandCenter-inactiveBorder,#159994)]", className)} 
    {...props} 
  />
);

interface ModelOptionProps {
  children: React.ReactNode;
  idx: number;
  disabled: boolean;
  selected: boolean;
  showConfigure: boolean;
  onOpenConfig: () => void;
  onClick: () => void;
  errors?: ConfigValidationError[];
  onClickError?: (e: any) => void;
}

const IconBase = ({ 
  $hovered, 
  Icon,
  className, 
  ...props 
}: { 
  $hovered: boolean;
  Icon: React.ComponentType<any>;
} & React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "w-[1.2em] h-[1.2em] cursor-pointer p-1 rounded-none",
      $hovered ? "opacity-75 visible" : "opacity-0 invisible",
      "hover:opacity-100 hover:bg-lightgray/20",
      className
    )}
    {...props}
  >
    <Icon />
  </div>
);

const StyledCog6ToothIcon = (props: Omit<React.ComponentProps<typeof IconBase>, 'Icon'>) => (
  <IconBase Icon={SettingsIcon} {...props} />
);
const StyledArrowTopRightOnSquareIcon = (props: Omit<React.ComponentProps<typeof IconBase>, 'Icon'>) => (
  <IconBase Icon={ArrowRightStartOnRectangleIcon} {...props} />
);
const StyledExclamationTriangleIcon = (props: Omit<React.ComponentProps<typeof IconBase>, 'Icon'>) => (
  <IconBase Icon={ExclamationTriangleIcon} {...props} />
);

export function Option({
  children,
  idx,
  disabled,
  onClick,
  showConfigure,
  selected,
  errors,
  onClickError,
  onOpenConfig,
}: ModelOptionProps) {
  const [hovered, setHovered] = useState(false);
  const { t } = useTranslation();

  function handleOptionClick(e: any) {
    if (disabled) {
      e.preventDefault();
      e.stopPropagation();
    }
    onClick();
  }

  return (
    <OptionDiv
      key={idx}
      isDisabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      isSelected={selected}
      onClick={!disabled ? handleOptionClick : undefined}
    >
      <div className="flex w-full flex-col gap-0.5">
        <div className="flex w-full items-center justify-between">
          {children}
          <div className="ml-2 flex items-center">
            {!errors?.length ? (
              showConfigure ? (
                <StyledCog6ToothIcon
                  $hovered={hovered}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onOpenConfig();
                  }}
                />
              ) : (
                <StyledArrowTopRightOnSquareIcon
                  $hovered={hovered}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onOpenConfig();
                  }}
                />
              )
            ) : (
              <>
                <StyledExclamationTriangleIcon
                  data-tooltip-id={`${idx}-errors-tooltip`}
                  $hovered={hovered}
                  className="cursor-pointer text-red"
                  onClick={onClickError}
                />
                <ToolTip id={`${idx}-errors-tooltip`}>
                  <div className="font-semibold">{t('errorLabel')}</div>
                  {JSON.stringify(errors, null, 2)}
                </ToolTip>
              </>
            )}
          </div>
        </div>
      </div>
    </OptionDiv>
  );
}
