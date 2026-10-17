import { requirePageUser } from "@/server/authz";

export const metadata = { title: "History" };
export const instant = false;

export default async function HistoryPage() {
  await requirePageUser("admin", "requester");
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming soon.</p>
    </div>
  );
}
