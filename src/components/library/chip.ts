import { cn } from "@/lib/utils";

const CHIP_CLASS = "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** A filter chip's classes, selected or not. Shared by Home's filter chips and the person page's kind toggle so they stay alike. */
export function chipClass(selected: boolean): string {
  return cn(
    CHIP_CLASS,
    selected ? "border-transparent bg-brand text-primary-foreground glow-brand" : "border-border bg-background text-foreground hover:bg-accent",
  );
}
