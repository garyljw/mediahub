import { requirePageUser } from "@/server/authz";

export const metadata = { title: "Settings" };
export const instant = false;

export default async function SettingsPage() {
  await requirePageUser("admin");
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming soon.</p>
    </div>
  );
}
