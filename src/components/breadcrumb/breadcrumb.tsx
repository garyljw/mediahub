"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isPlainClick } from "@/components/home/return-place";
import { cn } from "@/lib/utils";
import { DEFAULT_ROOT, readStep, readTrail, visit, writeTrail, type Crumb } from "./trail";

/**
 * The trail of pages that led to this one, ending with this page's `label`. Server and first render show the root and
 * this page, because storage isn't there on the server. After mount it shows the stored trail with this page added.
 * Every crumb but the last is a real link, so middle-click and new tabs work. `parents` are the pages this one belongs
 * under (a show, for its episode): when the trail starts afresh here, they sit between the root and this page.
 */
export function Breadcrumb({ label, root = DEFAULT_ROOT, parents }: { label: string; root?: Crumb; parents?: Crumb[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [trail, setTrail] = useState<Crumb[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const rootPath = root.path;
  const rootLabel = root.label;
  // A new array on every render, so the effect depends on its content, not its identity.
  const parentsKey = JSON.stringify(parents ?? []);

  // Read after mount, not during render: the first render must not depend on storage.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const next = visit(readTrail(), { path: pathname, label }, readStep(), { path: rootPath, label: rootLabel }, JSON.parse(parentsKey) as Crumb[]);
      writeTrail(next);
      setTrail(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, label, rootPath, rootLabel, parentsKey]);

  const crumbs: Crumb[] = trail ?? [root, ...(parents ?? []), { path: pathname, label }];
  const last = crumbs.length - 1;
  // On a phone a long trail shows the first crumb, "…", the parent and this page. Tapping "…" shows all of it.
  const collapsible = crumbs.length > 3 && !expanded;

  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {crumbs.map((crumb, index) => {
          const hiddenOnPhone = collapsible && index > 0 && index < last - 1;
          return (
            <Fragment key={crumb.path}>
              {collapsible && index === 1 && (
                <li className="flex items-center gap-1.5 sm:hidden">
                  <button type="button" aria-label="Show the full trail" onClick={() => setExpanded(true)} className="hover:underline">
                    …
                  </button>
                  <span aria-hidden="true">›</span>
                </li>
              )}
              <li className={cn("flex min-w-0 items-center gap-1.5", hiddenOnPhone && "max-sm:hidden")}>
                {index === last ? (
                  <span aria-current="page" className="max-w-[60vw] truncate sm:max-w-md">
                    {crumb.label}
                  </span>
                ) : (
                  <>
                    <Link
                      href={crumb.path}
                      onClick={(event) => {
                        if (index !== last - 1 || !isPlainClick(event)) return;
                        // Reached by one click from this crumb: the page before this one in history is it, so go back
                        // to keep its place instead of opening it afresh.
                        const step = readStep();
                        if (step?.from !== crumb.path || step.to !== pathname) return;
                        event.preventDefault();
                        router.back();
                      }}
                      className="max-w-[40vw] truncate hover:underline sm:max-w-xs"
                    >
                      {crumb.label}
                    </Link>
                    <span aria-hidden="true">›</span>
                  </>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
