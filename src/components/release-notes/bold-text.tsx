import type { ReactNode } from "react";

/** Splits text on **bold** runs. An unclosed ** stays as plain text. Everything is a React text node, never HTML. */
export function BoldText({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  for (;;) {
    const open = rest.indexOf("**");
    const close = open === -1 ? -1 : rest.indexOf("**", open + 2);
    if (close === -1) break;
    if (open > 0) parts.push(rest.slice(0, open));
    parts.push(<strong key={key++}>{rest.slice(open + 2, close)}</strong>);
    rest = rest.slice(close + 2);
  }
  if (rest) parts.push(rest);
  return <>{parts}</>;
}
