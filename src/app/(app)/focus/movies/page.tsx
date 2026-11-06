import { requirePageUser } from "@/server/authz";
import { FocusListPage } from "../focus-page";

export const metadata = { title: "Movie Focus" };
// The page waits for Radarr and Plex before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

export default async function MovieFocusPage() {
  const user = await requirePageUser("admin", "requester");
  return <FocusListPage kind="movie" isAdmin={user.role === "admin"} />;
}
