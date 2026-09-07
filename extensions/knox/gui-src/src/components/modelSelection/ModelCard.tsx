import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import {
  defaultBorderRadius,
  greenButtonColor,
  lightGray,
  vscFocusBorder,
} from "..";
import { PackageDimension } from "../../pages/AddNewModel/configs/models";
import { providers } from "../../pages/AddNewModel/configs/providers";
import { FolderOpenIcon } from "../../svg-icons";
import HeaderButtonWithToolTip from "../gui/HeaderButtonWithToolTip";
import InfoHover from "../InfoHover";

import { ModelProviderTag } from "./ModelProviderTag";
import { ModelProviderTags } from "./utils";

interface ModelCardProps {
  title: string;
  description: string;
  tags?: ModelProviderTags[];
  refUrl?: string;
  icon?: string;
  onClick?: (
    e: React.MouseEvent<HTMLDivElement, MouseEvent>,
    dimensionChoices?: string[],
    selectedProvider?: string,
  ) => void;
  disabled?: boolean;
  dimensions?: PackageDimension[];
  providerOptions?: string[];
}

const Div = ({ 
  color, 
  disabled, 
  hovered, 
  className,
  style,
  ...props 
}: { 
  color: string; 
  disabled: boolean; 
  hovered: boolean; 
} & React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "border border-lightgray rounded-none relative w-full transition-all duration-500",
      disabled && "opacity-50",
      !disabled && hovered && "cursor-pointer",
      className
    )}
    style={{
      ...(hovered && !disabled && {
        borderColor: color,
        backgroundColor: `${color}22`
      }),
      ...style
    }}
    {...props}
  />
);

const DimensionsDiv = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex justify-end ml-auto p-1 flex-wrap gap-y-3 border-t border-lightgray",
      className
    )}
    {...props}
  />
);

const DimensionOptionDiv = ({ 
  selected, 
  className,
  ...props 
}: { 
  selected: boolean; 
} & React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col items-center mr-2 p-1 rounded-none border",
      selected ? "bg-green text-white border-green" : "bg-lightgray border-lightgray",
      "cursor-pointer hover:border-[var(--vscode-focusBorder,#159994)]",
      className
    )}
    {...props}
  />
);

function ModelCard(props: ModelCardProps) {
  const { t } = useTranslation();
  const [dimensionChoices, setDimensionChoices] = useState<string[]>(
    props.dimensions?.map((d) => Object.keys(d.options)[0]) || [],
  );

  const [hovered, setHovered] = useState(false);

  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (props.providerOptions?.length) {
      setSelectedProvider(props.providerOptions[0]);
    }
  }, [props.providerOptions]);

  return (
    <Div
      disabled={props.disabled || false}
      color={greenButtonColor}
      hovered={hovered}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="px-2 py-1"
        onClick={
          props.disabled
            ? undefined
            : (e) => {
                if ((e.target as any).closest("a")) {
                  return;
                }
                props.onClick?.(e, dimensionChoices, selectedProvider);
              }
        }
      >
        <div
          className="mb-2"
          style={{
            display: "flex",
            alignItems: "center",
          }}
        >
          {window.vscMediaUrl && props.icon && (
            <img
              src={`${window.vscMediaUrl}/logos/${props.icon}`}
              width="24px"
              height="24px"
              style={{
                borderRadius: "2px",
                padding: "4px",
                marginRight: "10px",
                objectFit: "contain",
              }}
            />
          )}
          <h3>{props.title}</h3>
        </div>

        {props.tags?.map((tag, i) => <ModelProviderTag key={i} tag={tag} />)}

        <p>{props.description}</p>

        {props.refUrl && (
          <a
            style={{
              position: "absolute",
              right: "8px",
              top: "8px",
            }}
            href={props.refUrl}
            target="_blank"
          >
            <HeaderButtonWithToolTip text={t('viewDocs')}>
              <FolderOpenIcon />
            </HeaderButtonWithToolTip>
          </a>
        )}
      </div>

      {(props.dimensions?.length || props.providerOptions?.length) && (
        <DimensionsDiv>
          {props.dimensions?.map((dimension, i) => {
            return (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <InfoHover
                      id={dimension.name}
                      msg={dimension.description}
                    />
                    <p className="mx-2 my-0 py-0 text-sm">{dimension.name}</p>
                  </div>
                  <div className="flex items-center">
                    {Object.keys(dimension.options).map((key) => {
                      return (
                        <DimensionOptionDiv
                          key={key}
                          onClick={(e) => {
                            e.stopPropagation();
                            const newChoices = [...dimensionChoices];
                            newChoices[i] = key;
                            setDimensionChoices(newChoices);
                          }}
                          selected={dimensionChoices[i] === key}
                        >
                          {key}
                        </DimensionOptionDiv>
                      );
                    })}
                  </div>
                </div>
                <br />
              </>
            );
          })}
          {props.providerOptions?.length && (
            <div className="rtl flex flex-wrap items-center justify-end">
              <div className="flex items-center">
                <InfoHover
                  id={"provider-info"}
                  msg={t('chooseProviderForModel')}
                />
              </div>
              <div className="rtl flex flex-wrap items-center justify-end">
                {props.providerOptions?.map((option, i) => {
                  const info = providers[option];
                  if (!info) {
                    return null;
                  }
                  return (
                    <HeaderButtonWithToolTip
                      key={option}  // Add key prop here
                      text={info.title}
                      className="mx-1 items-center p-2 text-center"
                      style={{
                        backgroundColor:
                          (i === 0 &&
                            typeof selectedProvider === "undefined") ||
                          selectedProvider === option
                            ? greenButtonColor + "aa"
                            : undefined,
                      }}
                      onClick={() => {
                        setSelectedProvider(option);
                      }}
                    >
                      {window.vscMediaUrl && info.icon && (
                        <img
                          src={`${window.vscMediaUrl}/logos/${info.icon}`}
                          height="24px"
                        />
                      )}
                    </HeaderButtonWithToolTip>
                  );
                })}
              </div>
            </div>
          )}
        </DimensionsDiv>
      )}
    </Div>
  );
}

export default ModelCard;
