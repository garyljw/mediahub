"use client";

import { useRef } from "react";
import type { ComponentProps, Ref } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchInputProps = Omit<ComponentProps<typeof Input>, "value" | "defaultValue"> & {
  value: string;
  onClear: () => void;
  ref?: Ref<HTMLInputElement>;
};

/** A search box with a one-tap clear button (and Escape to clear). */
export function SearchInput({ className, onClear, onKeyDown, ref, ...props }: SearchInputProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const hasValue = props.value !== "";

  function setRefs(node: HTMLInputElement | null) {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }

  return (
    <div className={cn("relative w-full", className)}>
      <Input
        {...props}
        ref={setRefs}
        type="search"
        className="pr-9 [&::-webkit-search-cancel-button]:appearance-none"
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key !== "Escape" || !hasValue || event.defaultPrevented || event.nativeEvent.isComposing) return;
          // Escape here only clears the box; it doesn't also close anything the box sits in.
          event.preventDefault();
          event.stopPropagation();
          onClear();
        }}
      />
      {hasValue && (
        <button
          type="button"
          aria-label="Clear search"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            onClear();
            innerRef.current?.focus();
          }}
          className="absolute top-1/2 right-0.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}
