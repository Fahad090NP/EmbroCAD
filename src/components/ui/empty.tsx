import * as React from "react";
import { cn } from "../../lib/utils";

interface EmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
}

const Empty = React.forwardRef<HTMLDivElement, EmptyProps>(
  ({ className, icon, title, description, actions, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex min-h-[200px] flex-col items-center justify-center gap-4 p-8 text-center",
          className
        )}
        {...props}
      >
        {icon && <div className="text-muted-foreground">{icon}</div>}
        {title && <h3 className="text-xl font-semibold text-foreground">{title}</h3>}
        {description && (
          <p className="text-sm text-muted-foreground max-w-[280px]">{description}</p>
        )}
        {actions && <div className="flex gap-3 mt-2">{actions}</div>}
        {children}
      </div>
    );
  }
);
Empty.displayName = "Empty";

export { Empty };
