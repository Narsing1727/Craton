import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type DataType } from "@/lib/data";

export function DataTypeBadge({ type, className }: { type: DataType; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[0.7rem] border-border bg-muted/20 text-foreground hover:bg-muted/40 transition-colors",
        className
      )}
    >
      {type}
    </Badge>
  );
}
