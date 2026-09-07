import {
  DEFAULT_AGENT_TOOL_POLICY,
  formatPolicyLines,
} from "core/tools/toolPolicy";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { IdeMessengerContext } from "../../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import { updateConfig } from "../../../../redux/slices/configSlice";
import { modifyAnyConfigWithSharedConfig } from "core/config/sharedConfig";
import { fontSize } from "../../../../util";

export function PolicyRulesEditor() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const config = useAppSelector((state) => state.config.config);
  const policy = config.experimental?.agentPolicy;

  const [paths, setPaths] = useState(
    formatPolicyLines(policy?.paths) ||
      formatPolicyLines(DEFAULT_AGENT_TOOL_POLICY.paths),
  );
  const [commands, setCommands] = useState(
    formatPolicyLines(policy?.commands) ||
      formatPolicyLines(DEFAULT_AGENT_TOOL_POLICY.commands),
  );
  const [external, setExternal] = useState(
    policy?.externalDirectory ?? DEFAULT_AGENT_TOOL_POLICY.externalDirectory,
  );
  const [sandbox, setSandbox] = useState(
    policy?.sandboxDestructive ?? DEFAULT_AGENT_TOOL_POLICY.sandboxDestructive,
  );

  useEffect(() => {
    if (policy?.paths) {
      setPaths(formatPolicyLines(policy.paths));
    }
    if (policy?.commands) {
      setCommands(formatPolicyLines(policy.commands));
    }
    if (policy?.externalDirectory) {
      setExternal(policy.externalDirectory);
    }
    if (policy?.sandboxDestructive !== undefined) {
      setSandbox(policy.sandboxDestructive);
    }
  }, [policy]);

  const save = (next?: {
    paths?: string;
    commands?: string;
    externalDirectory?: "deny" | "ask" | "allow";
    sandboxDestructive?: boolean;
  }) => {
    const shared = {
      agentPolicyPaths: next?.paths ?? paths,
      agentPolicyCommands: next?.commands ?? commands,
      agentPolicyExternalDirectory: next?.externalDirectory ?? external,
      agentPolicySandboxDestructive: next?.sandboxDestructive ?? sandbox,
    };
    dispatch(updateConfig(modifyAnyConfigWithSharedConfig(config, shared)));
    ideMessenger.post("config/updateSharedConfig", shared);
  };

  const labelStyle = { fontSize: fontSize(-2) };

  return (
    <div className="flex flex-col gap-2 px-1 pb-1">
      <div className="text-[11px] font-medium text-vsc-foreground">
        {t("policyTitle")}
      </div>
      <p className="m-0 text-[10px] text-secgray">{t("policyHelp")}</p>
      <label className="text-[10px] text-secgray" style={labelStyle}>
        {t("policyPaths")}
      </label>
      <textarea
        className="min-h-[52px] w-full resize-y border border-lightgray/40 bg-transparent p-1 font-mono text-[11px] text-vsc-foreground"
        value={paths}
        onChange={(e) => setPaths(e.target.value)}
        onBlur={() => save({ paths })}
        spellCheck={false}
      />
      <label className="text-[10px] text-secgray" style={labelStyle}>
        {t("policyCommands")}
      </label>
      <textarea
        className="min-h-[52px] w-full resize-y border border-lightgray/40 bg-transparent p-1 font-mono text-[11px] text-vsc-foreground"
        value={commands}
        onChange={(e) => setCommands(e.target.value)}
        onBlur={() => save({ commands })}
        spellCheck={false}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[10px] text-secgray" style={labelStyle}>
          {t("policyOutsideWorkspace")}
        </label>
        <select
          className="border border-lightgray/40 bg-transparent px-1 py-0.5 text-[11px] text-vsc-foreground"
          value={external}
          onChange={(e) => {
            const value = e.target.value as "deny" | "ask" | "allow";
            setExternal(value);
            save({ externalDirectory: value });
          }}
        >
          <option value="ask">{t("permissionModeAsk")}</option>
          <option value="deny">{t("deny")}</option>
          <option value="allow">{t("policyAllow")}</option>
        </select>
        <label className="ml-auto flex items-center gap-1 text-[10px] text-secgray">
          <input
            type="checkbox"
            checked={sandbox}
            onChange={(e) => {
              setSandbox(e.target.checked);
              save({ sandboxDestructive: e.target.checked });
            }}
          />
          {t("policyBlockDestructive")}
        </label>
      </div>
    </div>
  );
}
