import { ReactNode } from "react";

const IconWrapper =
  (icon: ReactNode) =>
  ({
    sizeClassName,
    className,
  }: {
    raw?: boolean;
    sizeClassName?: string;
    className?: string;
  }) =>
    sizeClassName ? (
      <span
        className={`${sizeClassName} inline-block shrink-0 grow-0 ${
          className || ""
        }`}
      >
        {icon}
      </span>
    ) : (
      <>{icon}</>
    );

export default IconWrapper;