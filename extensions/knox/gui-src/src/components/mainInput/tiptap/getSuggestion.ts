import { computePosition, flip, offset, autoUpdate, Placement } from "@floating-ui/dom";
import { Editor, ReactRenderer } from "@tiptap/react";
import {
  ContextProviderDescription,
  ContextSubmenuItem,
  ContextSubmenuItemWithProvider,
} from "core";
import { MutableRefObject } from "react";

import { IIdeMessenger } from "../../../context/IdeMessenger";
import AtMentionDropdown from "../AtMentionDropdown";
import { ComboBoxItem, ComboBoxItemType, ComboBoxSubAction } from "../types";
// No longer needed since we're using Floating UI directly

function getSuggestion(
  items: (props: { query: string }) => Promise<ComboBoxItem[]>,
  enterSubmenu: (editor: Editor, providerId: string) => void = () => {},
  onClose: () => void = () => {},
  onOpen: () => void = () => {},
) {
  return {
    items,
    allowSpaces: true,
    render: () => {
      let component: any;
      let floatingElement: HTMLElement | null = null;
      let cleanup: (() => void) | null = null;

      const onExit = () => {
        cleanup?.();
        if (floatingElement) {
          floatingElement.remove();
          floatingElement = null;
        }
        component?.destroy();
        onClose();
      };

      const updatePosition = async (clientRect: () => DOMRect) => {
        if (!floatingElement) {return;}

        const rect = clientRect();
        const viewportHeight = window.innerHeight;
        const bottomSpace = viewportHeight - rect.bottom;
        const preferredPlacement: Placement = bottomSpace < viewportHeight / 3 ? 'top-start' : 'bottom-start';

        const virtualElement = {
          getBoundingClientRect: clientRect,
        };

        const { x, y } = await computePosition(virtualElement, floatingElement, {
          placement: preferredPlacement,
          middleware: [
            offset(6),
            flip({
              fallbackPlacements: ['top-start', 'top', 'top-end', 'bottom-start', 'bottom', 'bottom-end'],
              padding: 16,
            }),
          ],
          strategy: 'fixed',
        });

        Object.assign(floatingElement.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
      };

      return {
        onStart: (props: any) => {
          component = new ReactRenderer(AtMentionDropdown, {
            props: { ...props, enterSubmenu, onClose: onExit },
            editor: props.editor,
          });

          if (!props.clientRect) {
            console.log("no client rect");
            return;
          }

          // Create floating element
          floatingElement = document.createElement('div');
          floatingElement.style.cssText = `
            position: fixed;
            z-index: 9999;
            max-width: none;
            pointer-events: auto;
          `;
          
          floatingElement.appendChild(component.element);
          document.body.appendChild(floatingElement);

          // Set up auto-update
          const virtualElement = {
            getBoundingClientRect: props.clientRect,
          };
          
          cleanup = autoUpdate(virtualElement, floatingElement, () => {
            updatePosition(props.clientRect);
          });

          // Initial positioning
          updatePosition(props.clientRect);

          onOpen();
        },

        onUpdate(props: any) {
          component.updateProps({ ...props, enterSubmenu, onClose: onExit });

          if (!props.clientRect) {
            return;
          }

          // Update position with new client rect
          updatePosition(props.clientRect);
        },

        onKeyDown(props: any) {
          if (props.event.key === "Escape") {
            onExit();
            return true;
          }

          return component.ref?.onKeyDown(props);
        },

        onExit,
      };
    },
  };
}

function getSubActionsForSubmenuItem(
  _item: ContextSubmenuItem & { providerTitle: string },
  _ideMessenger: IIdeMessenger,
): ComboBoxSubAction[] | undefined {

  return undefined;
}

export function getContextProviderDropdownOptions(
  availableContextProvidersRef: MutableRefObject<ContextProviderDescription[]>,
  getSubmenuContextItemsRef: MutableRefObject<
    (
      providerTitle: string | undefined,
      query: string,
    ) => ContextSubmenuItemWithProvider[]
  >,
  enterSubmenu: (editor: Editor, providerId: string) => void,
  onClose: () => void,
  onOpen: () => void,
  inSubmenu: MutableRefObject<string | undefined>,
  ideMessenger: IIdeMessenger,
) {
  const items = async ({ query }: { query: string }) => {
    if (inSubmenu.current) {
      const results = getSubmenuContextItemsRef.current(
        inSubmenu.current,
        query,
      );
      return results.map((result) => {
        return {
          ...result,
          label: result.title,
          type: inSubmenu.current as ComboBoxItemType,
          query: result.id,
          subActions: getSubActionsForSubmenuItem(result, ideMessenger),
        };
      });
    }

    const contextProviderMatches: ComboBoxItem[] =
      availableContextProvidersRef.current
        ?.filter(
          (provider) =>
            provider.title.toLowerCase().startsWith(query.toLowerCase()) ||
            provider.displayTitle.toLowerCase().startsWith(query.toLowerCase()),
        )
        .map((provider) => ({
          name: provider.displayTitle,
          description: provider.description,
          id: provider.title,
          title: provider.displayTitle,
          label: provider.displayTitle,
          renderInlineAs: provider.renderInlineAs,
          type: "contextProvider" as ComboBoxItemType,
          contextProvider: provider,
        }))
        .sort((a, b) => {
          // Core defaults first (file), then other core, integrations last
          if (a.id === "file") {
            return -1;
          }
          if (b.id === "file") {
            return 1;
          }
          const aIntegration =
            a.contextProvider?.category === "integration" ? 1 : 0;
          const bIntegration =
            b.contextProvider?.category === "integration" ? 1 : 0;
          return aIntegration - bIntegration;
        }) || [];

    if (contextProviderMatches.length) {
      // contextProviderMatches.push({
      //   title: "Add more context providers",
      //   type: "action",
      //   action: () => {
      //     ideMessenger.post(
      //       "openUrl",
      //       "https://docs.knox.chat/customization/context-providers#built-in-context-providers",
      //     );
      //   },
      //   description: "",
      // });
      return contextProviderMatches;
    }

    // No provider matches -> search all providers
    const results = getSubmenuContextItemsRef.current(undefined, query);
    return results.map((result) => {
      return {
        ...result,
        label: result.title,
        type: result.providerTitle as ComboBoxItemType,
        query: result.id,
        icon: result.icon,
      };
    });
  };

  return getSuggestion(items, enterSubmenu, onClose, onOpen);
}

export function getSlashCommandDropdownOptions(
  availableSlashCommandsRef: MutableRefObject<ComboBoxItem[]>,
  onClose: () => void,
  onOpen: () => void,
) {
  const items = async ({ query }: { query: string }) => {
    const options = [...availableSlashCommandsRef.current];

    const filteredCommands =
      query.length > 0
        ? options.filter((slashCommand) => {
            const sc = slashCommand.title.toLowerCase().replace(/^\//, "");
            const iv = query.toLowerCase();
            return sc.startsWith(iv);
          })
        : options;

    const commandItems = (filteredCommands || []).map((provider) => ({
      name: provider.title,
      description: provider.description,
      id: provider.title,
      title: provider.title,
      label: provider.title,
      type: (provider.type ?? "slashCommand") as ComboBoxItemType,
      action: provider.action,
    }));

    return commandItems;
  };
  return getSuggestion(items, undefined, onClose, onOpen);
}
