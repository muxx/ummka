import type { MouseEventHandler, ReactNode, Ref } from "react";
import "./context-panel.css";

export function ContextPanelGroup({ children }: { children: ReactNode }) {
  return <div className="context-panel-group">{children}</div>;
}

export function ContextPanelRow({
  icon,
  title,
  detail,
  onClick,
  ref,
}: {
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      className={
        detail
          ? "context-panel-group__row context-panel-group__row--with-detail"
          : "context-panel-group__row"
      }
      ref={ref}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span>
        <strong>{title}</strong>
        {detail}
      </span>
    </button>
  );
}
