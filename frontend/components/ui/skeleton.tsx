import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-md bg-white/10 dark:bg-white/15 border border-white/10 dark:border-white/10",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
