import { requirePageUser } from "@/server/authz";
import { FocusListPage } from "../focus-page";

export const metadata = { title: "TV Focus" };
// The page waits for Sonarr and Plex before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

export default async function TvFocusPage() {
  const user = await requirePageUser("admin", "requester");
  return <FocusListPage kind="series" isAdmin={user.role === "admin"} />;
}
