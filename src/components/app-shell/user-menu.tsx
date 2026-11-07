"use client";

import Link from "next/link";
import { ChevronsUpDown, Info, LogOut } from "lucide-react";
import { signOut } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  name: string;
  email: string;
};

// Only name and email reach this component. The user id and session stay on the server.
export function UserMenu({ name, email }: Props) {
  const displayName = name.trim() || email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-full justify-between gap-2 px-2">
          <span className="truncate text-sm font-medium">{displayName}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/about">
            <Info className="size-4" aria-hidden="true" />
            About
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
