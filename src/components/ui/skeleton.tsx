import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A loading placeholder block. Its shimmer comes from the `skeleton` utility in globals.css. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden data-slot="skeleton" className={cn("skeleton rounded-md", className)} {...props} />;
}
