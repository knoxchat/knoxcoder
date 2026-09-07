import { Fragment } from "react";
import { cn } from "@/lib/utils";

import {
  defaultBorderRadius,
  lightGray,
  vscBackground,
  vscForeground,
  vscInputBackground,
  vscListActiveBackground,
  vscListActiveForeground,
} from "..";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Transition,
} from "../../components/ui";
import { DisplayInfo } from "../../pages/AddNewModel/configs/models";
import { CheckIcon, ChevronUpDownIcon, ChipAIIcon } from "../../svg-icons";

export const StyledListbox = ({ className, ...props }: React.ComponentProps<typeof Listbox>) => (
  <Listbox className={cn("bg-vsc-background", className)} {...props} />
);

export const StyledListboxButton = ({ className, ...props }: React.ComponentProps<typeof ListboxButton>) => (
  <ListboxButton
    className={cn(
      "cursor-pointer bg-vsc-background text-left",
      "pl-3 pr-10 py-2 rounded-lg border border-lightgray",
      "m-0 h-full w-full relative",
      "grid grid-cols-[1fr_auto] items-center",
      "text-vsc-foreground focus:outline-none",
      "hover:bg-vsc-input-background",
      className
    )}
    {...props}
  />
);

export const StyledListboxOptions = ({ className, ...props }: React.ComponentProps<typeof ListboxOptions>) => (
  <ListboxOptions
    className={cn(
      "bg-vsc-input-background p-0",
      "absolute top-full left-0 mt-1",
      "h-fit max-h-60 w-[60%]",
      "rounded-none overflow-y-auto z-10",
      "focus:outline-none",
      className
    )}
    {...props}
  />
);

export const StyledListboxOption = ({ 
  selected, 
  className,
  ...props 
}: React.ComponentProps<typeof ListboxOption> & { selected: boolean }) => (
  <ListboxOption
    className={cn(
      "cursor-pointer py-1.5 px-2 pl-3",
      "flex gap-2 items-center",
      selected ? "bg-list-active" : "bg-vsc-input-background",
      "hover:bg-list-active hover:text-list-active-foreground",
      className
    )}
    {...props}
  />
);

interface ModelSelectionListboxProps {
  selectedProvider: DisplayInfo;
  setSelectedProvider: (val: DisplayInfo) => void;
  topOptions?: DisplayInfo[];
  otherOptions?: DisplayInfo[];
}

function ModelSelectionListbox({
  selectedProvider,
  setSelectedProvider,
  topOptions = [],
  otherOptions = [],
}: ModelSelectionListboxProps) {
  return (
    <StyledListbox 
      value={selectedProvider} 
      onChange={(value) => setSelectedProvider(value as DisplayInfo)}
    >
      <div className="relative mb-2 mt-1">
        <StyledListboxButton>
          <span className="flex items-center">
            {window.vscMediaUrl && selectedProvider.icon && (
              <img
                src={`${window.vscMediaUrl}/logos/${selectedProvider.icon}`}
                className="mr-3 h-4 w-4 object-contain object-center"
              />
            )}
            <span className="text-xs">{selectedProvider.title}</span>
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <span className="h-3 w-3 mb-0.5" aria-hidden="true">
              <ChevronUpDownIcon />
            </span>
          </span>
        </StyledListboxButton>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <StyledListboxOptions>
            {topOptions.length > 0 && (
              <div className="py-1">
                {topOptions.map((option, index) => (
                  <StyledListboxOption
                    selected={selectedProvider.title === option.title}
                    key={index}
                    className="relative cursor-default select-none py-2 pr-4 text-knoxcyan"
                    value={option}
                  >
                    {({ selected }) => (
                      <>
                        {option.title === "Autodetect" ? (
                          <span className="mr-2 h-4 w-4">
                            <ChipAIIcon />
                          </span>
                        ) : (
                          window.vscMediaUrl &&
                          option.icon && (
                            <img
                              src={`${window.vscMediaUrl}/logos/${option.icon}`}
                              className="mr-1 h-4 w-4 object-contain object-center"
                            />
                          )
                        )}
                        <span className="text-xs">{option.title}</span>

                        {selected && (
                          <span className="inset-y-0 ml-auto flex items-center pl-3">
                            <span className="h-5 w-5" aria-hidden="true">
                              <CheckIcon />
                            </span>
                          </span>
                        )}
                      </>
                    )}
                  </StyledListboxOption>
                ))}
              </div>
            )}

            {topOptions.length > 0 && otherOptions.length > 0}

            {otherOptions.length > 0 && (
              <div className="py-1">
                {otherOptions.map((option, index) => (
                  <StyledListboxOption
                    selected={selectedProvider.title === option.title}
                    key={index}
                    className="relative cursor-default select-none py-2 pr-4 text-knoxcyan"
                    value={option}
                  >
                    {({ selected }) => (
                      <>
                        {option.title === "Autodetect" ? (
                          <span className="mr-2 h-4 w-4 text-knoxcyan">
                            <ChipAIIcon />
                          </span>
                        ) : (
                          window.vscMediaUrl &&
                          option.icon && (
                            <img
                              src={`${window.vscMediaUrl}/logos/${option.icon}`}
                              className="mr-1 h-4 w-4 object-contain object-center"
                            />
                          )
                        )}
                        <span className="text-xs">{option.title}</span>

                        {selected && (
                          <span className="inset-y-0 ml-auto flex items-center pl-3">
                            <span className="h-5 w-5" aria-hidden="true">
                              <CheckIcon />
                            </span>
                          </span>
                        )}
                      </>
                    )}
                  </StyledListboxOption>
                ))}
              </div>
            )}
          </StyledListboxOptions>
        </Transition>
      </div>
    </StyledListbox>
  );
}

export default ModelSelectionListbox;
