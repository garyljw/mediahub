import { LayoutGrid } from "lucide-react";

export function Brand() {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand text-white glow-brand">
        <LayoutGrid className="size-4" />
      </span>
      <span className="truncate bg-brand bg-clip-text [-webkit-background-clip:text] font-display text-lg font-bold tracking-tight text-transparent">MediaHub</span>
    </span>
  );
}
