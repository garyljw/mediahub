import { requirePageUser } from "@/server/authz";
import { FocusListPage } from "../focus-page";

export const metadata = { title: "Movie Focus" };
// Blocking route, as on Home: the page waits for its data before rendering, so no Suspense fallback is needed.
export const instant = false;

export default async function MovieFocusPage() {
  const user = await requirePageUser("admin", "requester");
  return <FocusListPage kind="movie" isAdmin={user.role === "admin"} />;
}
