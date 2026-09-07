import { Editor } from "@tiptap/react";
import { MessageSquare } from "lucide-react";
import {
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";

import {
  lightGray,
  vscForeground,
  vscListActiveBackground,
  vscListActiveForeground,
  vscQuickInputBackground,
} from "../..";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { AddIcon, ArrowLeftIcon, AtIcon } from "../../../svg-icons";
import { fontSize } from "../../../util";
import FileIcon from "../../FileIcon";
import HeaderButtonWithToolTip from "../../gui/HeaderButtonWithToolTip";
import SafeImg from "../../SafeImg";
import { getNamedIcon } from "../icons";
import { ComboBoxItem, ComboBoxItemType } from "../types";

export function getIconFromDropdownItem(
  id: string | undefined,
  type: ComboBoxItemType,
) {
  const typeIcon = type === "contextProvider" ? AtIcon : MessageSquare;
  return getNamedIcon(id) ?? typeIcon;
}

function DropdownIcon(props: { className?: string; item: ComboBoxItem }) {
  if (props.item.type === "action") {
    return <span className={props.className + " h-3 w-3 mb-1"}><AddIcon /></span>;
  }

  const provider =
    props.item.type === "contextProvider" || props.item.type === "slashCommand"
      ? props.item.id
      : props.item.type;

  const IconComponent = getIconFromDropdownItem(provider, props.item.type);

  const fallbackIcon = (
    <IconComponent
      className={`${props.className} shrink-0`}
      height="1.2em"
      width="1.2em"
    />
  );

  if (!props.item.icon) {
    return fallbackIcon;
  }

  return (
    <SafeImg
      className="shrink-0 pr-2"
      src={props.item.icon}
      height="18em"
      width="18em"
      fallback={fallbackIcon}
    />
  );
}


interface AtMentionDropdownProps {
  items: ComboBoxItem[];
  command: (item: any) => void;

  editor: Editor;
  enterSubmenu?: (editor: Editor, providerId: string) => void;
  onClose: () => void;
}

const AtMentionDropdown = forwardRef((props: AtMentionDropdownProps, ref) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();

  const ideMessenger = useContext(IdeMessengerContext);

  const [selectedIndex, setSelectedIndex] = useState(0);

  const [subMenuTitle, setSubMenuTitle] = useState<string | undefined>(
    undefined,
  );
  const [querySubmenuItem, setQuerySubmenuItem] = useState<
    ComboBoxItem | undefined
  >(undefined);
  const [loadingSubmenuItem, setLoadingSubmenuItem] = useState<
    ComboBoxItem | undefined
  >(undefined);

  const [allItems, setAllItems] = useState<ComboBoxItem[]>([]);

  useEffect(() => {
    const items = [...props.items];
    if (subMenuTitle === ".prompt file") {
      items.push({
        title: t('addNewPromptFile'),
        type: "action",
        action: () => {
          ideMessenger.post("config/newPromptFile", undefined);
          const { tr } = props.editor.view.state;
          const text = tr.doc.textBetween(0, tr.selection.from);
          const start = text.lastIndexOf("@");
          if (start !== -1) {
            props.editor.view.dispatch(
              tr.delete(start, tr.selection.from).scrollIntoView(),
            );
          }
          props.onClose(); // Escape the mention list after creating a new prompt file
        },
        description: t('createNewPromptFile'),
      });
    }
    setLoadingSubmenuItem(items.find((item) => item.id === "loading"));
    setAllItems(items.filter((item) => item.id !== "loading"));
  }, [subMenuTitle, props.items, props.editor]);

  const queryInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (queryInputRef.current) {
      queryInputRef.current.focus();
    }
  }, [querySubmenuItem, queryInputRef]);

  const selectItem = (index: number) => {
    const item = allItems[index];

    if (item.type === "action" && item.action) {
      item.action();
      return;
    }

    if (
      item.type === "contextProvider" &&
      item.contextProvider?.type === "submenu"
    ) {
      setSubMenuTitle(item.description);
      if (item.id) {
        props.enterSubmenu?.(props.editor, item.id);
      }
      return;
    }

    if (item.contextProvider?.type === "query") {
      // update editor to complete context provider title
      const { tr } = props.editor.view.state;
      const text = tr.doc.textBetween(0, tr.selection.from);
      const partialText = text.slice(text.lastIndexOf("@") + 1);
      const remainingText = item.title.slice(partialText.length);
      props.editor.view.dispatch(
        tr.insertText(remainingText, tr.selection.from),
      );

      setSubMenuTitle(item.description);
      setQuerySubmenuItem(item);
      return;
    }

    if (item) {
      props.command({ ...item, itemType: item.type });
    }
  };

  const totalItems = allItems.length;

  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const upHandler = () => {
    setSelectedIndex((prevIndex) => {
      const newIndex = prevIndex - 1 >= 0 ? prevIndex - 1 : 0;
      itemRefs.current[newIndex]?.scrollIntoView({
        behavior: "instant" as ScrollBehavior,
        block: "nearest",
      });
      return newIndex;
    });
  };

  const downHandler = () => {
    setSelectedIndex((prevIndex) => {
      const newIndex = prevIndex + 1 < totalItems ? prevIndex + 1 : prevIndex;
      itemRefs.current[newIndex]?.scrollIntoView({
        behavior: "instant" as ScrollBehavior,
        block: "nearest",
      });
      return newIndex;
    });
  };

  const enterHandler = () => {
    selectItem(selectedIndex);
  };

  useEffect(() => setSelectedIndex(0), [allItems]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowUp") {
        upHandler();
        return true;
      }

      if (event.key === "ArrowDown") {
        downHandler();
        return true;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        enterHandler();
        event.stopPropagation();
        event.preventDefault();
        return true;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }

      if (event.key === " ") {
        if (allItems.length === 1) {
          enterHandler();
          return true;
        }
      }

      return false;
    },
  }));

  const showFileIconForItem = (item: ComboBoxItem) => {
    return ["file", "code"].includes(item.type);
  };

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, allItems.length);
  }, [allItems]);

  return (
    <div 
      className="rounded-md overflow-x-hidden overflow-y-auto max-h-[min(330px,60vh)] p-0.5 relative w-[min(90vw,350px)] sm:w-[min(70vw,400px)] md:w-[min(50vw,450px)]"
      style={{
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0px 10px 20px rgba(0, 0, 0, 0.1)',
        fontSize: fontSize(-2),
        backgroundColor: vscQuickInputBackground,
      }}
    >
      {querySubmenuItem ? (
        <textarea
          onClick={(e) => {
            e.stopPropagation();
          }}
          rows={1}
          ref={queryInputRef}
          placeholder={querySubmenuItem.description}
          className="bg-[#fff1] rounded-md p-1 px-2 w-full focus:outline-none resize-none"
          style={{
            border: `1px solid ${lightGray}`,
            color: vscForeground,
            fontFamily: 'inherit',
          }}
          onKeyDown={(e) => {
            if (!queryInputRef.current) {
              return;
            }
            if (e.key === "Enter") {
              if (e.shiftKey) {
                queryInputRef.current.innerText += "\n";
              } else {
                props.command({
                  ...querySubmenuItem,
                  itemType: querySubmenuItem.type,
                  query: queryInputRef.current.value,
                  label: `${querySubmenuItem.label}: ${queryInputRef.current.value}`,
                });
              }
            } else if (e.key === "Escape") {
              setQuerySubmenuItem(undefined);
              setSubMenuTitle(undefined);
            }
          }}
        />
      ) : (
        <>
          {subMenuTitle && (
            <div 
              className="bg-transparent border border-transparent rounded-md block m-0 p-1 px-1.5 text-left w-full mb-2"
              style={{
                color: vscForeground,
                fontSize: fontSize(-2),
              }}
            >
              {subMenuTitle}
            </div>
          )}
          {loadingSubmenuItem && (
            <div 
              className="bg-transparent border border-transparent rounded-md block m-0 p-1 px-1.5 text-left w-full"
              style={{
                color: vscForeground,
                fontSize: fontSize(-2),
              }}
            >
              <span className="flex w-full items-center">
                <div className="flex min-w-0 flex-1 items-center">
                  <div className="mr-2 shrink-0">
                    <DropdownIcon item={loadingSubmenuItem} />
                  </div>
                  <span className="truncate">{loadingSubmenuItem.title}</span>
                </div>
                <span
                  style={{
                    color: lightGray,
                    textAlign: "right",
                  }}
                  className="ml-2 flex shrink-0 items-center gap-1"
                >
                  <span className="hidden sm:inline-block text-xs opacity-75 truncate max-w-30">
                    {loadingSubmenuItem.description}
                  </span>
                </span>
              </span>
            </div>
          )}
          {allItems.length ? (
            allItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  className={`item cursor-pointer border border-transparent rounded-md block m-0 p-1 px-1.5 text-left w-full ${isSelected ? '' : ''}`}
                  style={{
                    backgroundColor: isSelected ? vscListActiveBackground : 'transparent',
                    color: isSelected ? vscListActiveForeground : vscForeground,
                    fontSize: fontSize(-2),
                  }}
                  key={index}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectItem(index);
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  data-testid="context-provider-dropdown-item"
                >
                  <span className="flex w-full items-center">
                    <div className="flex min-w-0 flex-1 items-center">
                      {showFileIconForItem(item) ? (
                        <div className="mr-2 shrink-0">
                          <FileIcon
                            height="20px"
                            width="20px"
                            filename={item.description}
                          />
                        </div>
                      ) : (
                        <DropdownIcon item={item} className="mr-2 shrink-0" />
                      )}
                      <span className="truncate" title={item.id}>{item.title}</span>
                    </div>
                    
                    <span
                      style={{
                        color: lightGray,
                        textAlign: "right",
                        opacity: isSelected ? 1 : 0.5,
                      }}
                      className="ml-2 flex shrink-0 items-center gap-1"
                    >
                      <span className="hidden sm:inline-block text-xs opacity-75 truncate max-w-30">
                        {item.description}
                      </span>
                      
                      {item.type === "contextProvider" &&
                        item.contextProvider?.type === "submenu" && (
                          <span className="ml-1 shrink-0 mt-1.5">
                            <ArrowLeftIcon />
                          </span>
                        )}
                      
                      {item.subActions?.map((subAction) => {
                        const Icon = getIconFromDropdownItem(
                          subAction.icon,
                          "action",
                        );
                        return (
                          <HeaderButtonWithToolTip
                            key={item.id || index} // Added key prop
                            onClick={(e) => {
                              subAction.action(item);
                              e.stopPropagation();
                              e.preventDefault();
                              props.onClose();
                            }}
                            text={undefined}
                          >
                            <Icon width="1.2em" height="1.2em" />
                          </HeaderButtonWithToolTip>
                        );
                      })}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div 
              className="item bg-transparent border border-transparent rounded-md block m-0 p-1 px-1.5 text-left w-full"
              style={{
                color: vscForeground,
                fontSize: fontSize(-2),
              }}
            >
              No Result
            </div>
          )}
        </>
      )}
    </div>
  );
});

AtMentionDropdown.displayName = "AtMentionDropdown";

export default AtMentionDropdown;
