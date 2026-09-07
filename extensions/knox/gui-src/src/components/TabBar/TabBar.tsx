import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import { newSession } from "../../redux/slices/sessionSlice";
import {
  addTab,
  handleSessionChange,
  removeTab,
  setActiveTab,
  setTabs,
} from "../../redux/slices/tabsSlice";
import { AppDispatch, RootState } from "../../redux/store";
import { loadSession, saveCurrentSession } from "../../redux/thunks/session";
import { XMarkIcon } from "../../svg-icons";

export function TabBar() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const currentSessionId = useSelector((state: RootState) => state.session.id);
  const currentSessionTitle = useSelector(
    (state: RootState) => state.session.title,
  );
  const hasHistory = useSelector(
    (state: RootState) => state.session.history.length > 0,
  );
  const tabs = useSelector((state: RootState) => state.tabs.tabs);

  // Simple UUID generator for our needs
  const generateId = useCallback(() => {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }, []);

  // Handle session changes
  useEffect(() => {
    if (!currentSessionId) {return;}

    dispatch(
      handleSessionChange({
        currentSessionId,
        currentSessionTitle,
        newTabId: generateId(), // Pass the ID generator result
      }),
    );
  }, [currentSessionId, currentSessionTitle]);

  const handleNewTab = async () => {
    // Save current session before creating new one
    if (hasHistory) {
      await dispatch(
        saveCurrentSession({ openNewSession: false, generateTitle: true }),
      );
    }

    dispatch(newSession());

    dispatch(
      addTab({
        id: generateId(),
        title: t('chatTab', { number: tabs.length + 1 }),
        isActive: true,
        sessionId: undefined,
      }),
    );
  };

  useEffect(() => {
    if (!tabs.length) {
      handleNewTab();
    }
  }, [tabs.map((t) => t.id).join(",")]);

  const handleTabClick = async (id: string) => {
    const targetTab = tabs.find((tab) => tab.id === id);
    if (!targetTab) {return;}

    if (targetTab.sessionId) {
      // Switch to existing session
      await dispatch(
        loadSession({
          sessionId: targetTab.sessionId,
          saveCurrentSession: hasHistory,
        }),
      );
    }

    dispatch(setActiveTab(id));
  };

  const handleTabClose = async (id: string) => {
    //if (tabs.length <= 1) return;

    const isClosingActive = tabs.find((t) => t.id === id)?.isActive;
    const filtered = tabs.filter((t) => t.id !== id);

    if (isClosingActive) {
      const lastTab = filtered[filtered.length - 1];
      if (filtered.length) {
        await handleTabClick(lastTab.id);
        dispatch(
          setTabs(
            filtered.map((tab, i) => ({
              ...tab,
              isActive: i === filtered.length - 1,
            })),
          ),
        );
      } else {
        dispatch(setTabs([]));
        dispatch(newSession());
      }
    } else {
      dispatch(removeTab(id));
    }
  };

  return tabs.length === 1 ? (
    <></>
  ) : (
    <div 
      className="flex flex-wrap flex-shrink-0 flex-grow-0 relative mt-px border-b-0 scrollbar-none"
      style={{ backgroundColor: 'var(--vscode-tab-inactiveBackground)' }}
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "flex items-center box-border px-[5px_5px_0_10px] flex-grow w-[100px] max-w-[140px] h-[22px]",
            "cursor-pointer border border-solid select-none relative transition-colors",
            "first:border-l-0 [&+&]:border-l-0",
            "group" // Add group for hover effects on children
          )}
          style={{
            backgroundColor: tab.isActive 
              ? 'var(--vscode-tab-activeBackground)' 
              : 'var(--vscode-tab-inactiveBackground)',
            color: tab.isActive 
              ? 'var(--vscode-tab-activeForeground)' 
              : 'var(--vscode-tab-inactiveForeground)',
            borderColor: 'var(--vscode-tab-border)',
            borderBottom: tab.isActive ? 'none' : '1px solid var(--vscode-tab-border)',
            borderTop: tab.isActive ? '1px solid #159994' : '1px solid var(--vscode-tab-border)',
          }}
          onClick={() => handleTabClick(tab.id)}
          onMouseEnter={(e) => {
            if (!tab.isActive) {
              e.currentTarget.style.backgroundColor = 'var(--vscode-tab-hoverBackground)';
              e.currentTarget.style.color = 'var(--vscode-tab-hoverForeground)';
            }
          }}
          onMouseLeave={(e) => {
            if (!tab.isActive) {
              e.currentTarget.style.backgroundColor = 'var(--vscode-tab-inactiveBackground)';
              e.currentTarget.style.color = 'var(--vscode-tab-inactiveForeground)';
            }
          }}
        >
          <span 
            className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-[11px]"
            style={{ color: tab.isActive ? '#159994' : 'inherit' }}
          >
            {tab.title}
          </span>
          <button
            className={cn(
              "flex items-center justify-center w-[14px] h-[14px] ml-[3px]",
              "border-0 bg-transparent opacity-70 cursor-pointer rounded p-px",
              "invisible group-hover:visible",
              "hover:opacity-100"
            )}
            style={{ 
              color: tab.isActive ? '#159994' : 'inherit',
              ...(tab.isActive && { visibility: 'visible' })
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--vscode-tab-hoverBackground)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            onClick={(e) => {
              e.stopPropagation();
              handleTabClose(tab.id);
            }}
          >
            <span className="h-3.5 w-3.5">
              <XMarkIcon />
            </span>
          </button>
        </div>
      ))}
      <div 
        className="flex-1 flex border-b"
        style={{ 
          borderBottomColor: 'var(--vscode-tab-border)',
          backgroundColor: 'var(--vscode-tab-inactiveBackground)'
        }}
      >
        {/* <NewTabButton onClick={handleNewTab}>
          <PlusIcon width={16} height={16} />
        </NewTabButton> */}
      </div>
    </div>
  );
}
