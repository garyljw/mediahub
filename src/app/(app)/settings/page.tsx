import Link from "next/link";
import { requirePageUser } from "@/server/authz";
import { getPlexAdminConfig } from "@/server/plex/admin-config";

export const metadata = { title: "Settings" };
// The page reads its settings before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

const SECTIONS = [
  {
    href: "/settings/connections",
    title: "Connections",
    description: "Radarr and Sonarr addresses and API keys.",
  },
  {
    href: "/settings/add-defaults",
    title: "Add defaults",
    description: "Quality profile, root folder and monitoring that new movies and series start with.",
  },
  {
    href: "/settings/users",
    title: "Users",
    description: "Add, reset and remove requester accounts.",
  },
  {
    href: "/settings/updates",
    title: "Updates",
    description: "Installed version and checking for a new release.",
  },
  {
    href: "/settings/system",
    title: "System",
    description: "Disk space and other details about the server.",
  },
];

export default async function SettingsPage() {
  await requirePageUser("admin");
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {getPlexAdminConfig() === null && (
        <div role="status" className="mt-6 rounded-lg border border-primary/40 bg-accent px-4 py-3">
          <p className="font-medium">Set up Plex sign-in</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Admins will sign in with the Plex account that owns your Plex server. Your password keeps working until
            this is done.
          </p>
          <Link href="/setup" className="mt-2 inline-block text-sm font-medium underline">
            Set up Plex sign-in
          </Link>
        </div>
      )}
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
