import Link from "next/link";
import { requirePageUser } from "@/server/authz";

export const metadata = { title: "Settings" };
export const instant = false;

const SECTIONS = [
  {
    href: "/settings/connections",
    title: "Connections",
    description: "Radarr and Sonarr addresses and API keys.",
  },
];

export default async function SettingsPage() {
  await requirePageUser("admin");
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <ul className="mt-6 divide-y rounded-lg border">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link href={section.href} className="block px-4 py-3 hover:bg-accent">
              <span className="block font-medium">{section.title}</span>
              <span className="block text-sm text-muted-foreground">{section.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
