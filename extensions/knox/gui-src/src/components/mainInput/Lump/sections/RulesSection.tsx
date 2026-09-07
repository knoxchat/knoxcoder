import { Maximize2 } from "lucide-react";
import { parseConfigYaml } from "knoxdev-package/config-yaml";
import { useContext, useMemo } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";

import { defaultBorderRadius, vscCommandCenterActiveBorder } from "../../..";
import { useAuth } from "../../../../context/Auth";
import { IdeMessengerContext } from "../../../../context/IdeMessenger";
import { useAppDispatch } from "../../../../redux/hooks";
import {
  setDialogMessage,
  setShowDialog,
} from "../../../../redux/slices/uiSlice";
import { RootState } from "../../../../redux/store";
import { PencilSquareIcon } from "../../../../svg-icons";
import { fontSize } from "../../../../util";
import HeaderButtonWithToolTip from "../../../gui/HeaderButtonWithToolTip";

import { ExploreBlocksButton } from "./ExploreBlocksButton";
import { t } from "i18next";

interface RuleCardProps {
  index: number;
  rule: string;
  onClick: () => void;
  title: string;
}

const RuleCard: React.FC<RuleCardProps> = ({ rule, onClick, title }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  function onClickExpand() {
    dispatch(setShowDialog(true));
    dispatch(
      setDialogMessage(
        <div className="p-4 text-center">
          <h3>{title}</h3>
          <pre className="max-w-full overflow-x-scroll">{rule}</pre>
        </div>,
      ),
    );
  }

  return (
    <div
      style={{
        borderRadius: defaultBorderRadius,
        border: `1px solid ${vscCommandCenterActiveBorder}`,
      }}
      className="px-2 py-1 transition-colors"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div
              className="text-vsc-foreground mb-1"
              style={{
                fontSize: fontSize(-2),
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontSize: fontSize(-3),
              }}
              className="line-clamp-3 text-knoxcyan"
            >
              {rule}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <HeaderButtonWithToolTip onClick={onClickExpand} text={t('expand')}>
              <Maximize2 className="h-3 w-3 text-knoxcyan" />
            </HeaderButtonWithToolTip>{" "}
            <HeaderButtonWithToolTip onClick={onClick} text={t('edit')}>
              <span className="h-3 w-3">
                <PencilSquareIcon />
              </span>
            </HeaderButtonWithToolTip>
          </div>
        </div>
      </div>
    </div>
  );
};

export function RulesSection() {
  const ideMessenger = useContext(IdeMessengerContext);
  const { selectedProfile } = useAuth();

  const rules = useSelector(
    (state: RootState) => state.config.config.rules ?? [],
  );

  const mergedRules = useMemo(() => {
    const parsed = selectedProfile?.rawYaml
      ? parseConfigYaml(selectedProfile?.rawYaml ?? "")
      : undefined;
    return rules.map((rule, index) => ({
      unrolledRule: rule,
      ruleFromYaml: parsed?.rules?.[index],
    }));
  }, [rules]);

  return (
    <div>
      <div className="space-y-3">
        {mergedRules.map((rule, index) => {
          if (!rule.ruleFromYaml) {
            return (
              <RuleCard
                key={index}
                index={index}
                rule={rule.unrolledRule}
                onClick={() =>
                  ideMessenger.post("config/openProfile", {
                    profileId: undefined,
                  })
                }
                title={t('locallyDefinedRule')}
              />
            );
          }

          if (typeof rule.ruleFromYaml === "string") {
            return (
              <RuleCard
                key={index}
                index={index}
                rule={rule.unrolledRule}
                onClick={() => {}}
                title={t('inlineRule')}
              />
            );
          }

          if (!rule.ruleFromYaml?.uses) {
            return null;
          }

          return (
            <RuleCard
              key={index}
              index={index}
              rule={rule.unrolledRule}
              onClick={() => {}}
              title={rule.ruleFromYaml?.uses}
            />
          );
        })}
      </div>
      <ExploreBlocksButton blockType="rules" />
    </div>
  );
}
