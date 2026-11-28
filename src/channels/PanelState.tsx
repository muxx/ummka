import type { ComponentProps, ReactNode, Ref } from "react";
import "./panel-styles.css";

export function PanelState({
  variant,
  title,
  titleRef,
  message,
  action,
  role,
  quiet,
  ref,
}: {
  variant: "pending" | "empty" | "error" | "offline" | "refresh" | "stale";
  title?: string;
  titleRef?: Ref<HTMLHeadingElement>;
  message?: string;
  action?: ReactNode;
  role?: "status" | "alert";
  quiet?: boolean;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      className={`panel-state panel-state--${variant}`}
      data-quiet={quiet || undefined}
      role={title ? role : undefined}
      tabIndex={ref ? -1 : undefined}
      ref={ref}
    >
      {title && (
        <h3
          className="panel-state__title"
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
        >
          {title}
        </h3>
      )}
      {message !== undefined && (
        <p className="panel-state__message" role={title ? undefined : role}>
          {message}
        </p>
      )}
      {action}
    </div>
  );
}

export function PanelRetry(
  props: Omit<ComponentProps<"button">, "type" | "className">,
) {
  return <button {...props} type="button" className="panel-state__action" />;
}
