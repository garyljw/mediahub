import { requirePageUser } from "@/server/authz";

export const metadata = { title: "Queue" };
export const instant = false;

export default async function QueuePage() {
  await requirePageUser("admin", "requester");
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming soon.</p>
    </div>
  );
}
