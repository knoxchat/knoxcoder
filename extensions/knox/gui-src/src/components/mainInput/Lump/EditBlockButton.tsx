import { ConfigYaml } from "knoxdev-package/config-yaml";
import { useContext } from "react";

import { useAuth } from "../../../context/Auth";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { PencilSquareIcon } from "../../../svg-icons";

type SectionKey = Exclude<
  keyof ConfigYaml,
  "name" | "version" | "schema" | "agent"
>;

interface EditBlockButtonProps<T extends SectionKey> {
  blockType: T;
  block?: NonNullable<ConfigYaml[T]>[number];
  className?: string;
}

export default function EditBlockButton<T extends SectionKey>({
  blockType,
  className = "",
}: EditBlockButtonProps<T>) {
  const ideMessenger = useContext(IdeMessengerContext);
  const { selectedProfile } = useAuth();

  const handleEdit = () => {
    if (selectedProfile?.profileType === "local") {
      ideMessenger.post("config/openProfile", {
        profileId: undefined,
      });
    }
  };

  return (
    <span
      className={`h-3 w-3 cursor-pointer hover:brightness-125 ${className}`}
      onClick={handleEdit}
    >
      <PencilSquareIcon />
    </span>
  );
}
