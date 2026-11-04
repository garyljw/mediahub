import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/authz";

// The list page was replaced by Home; the route stays so old bookmarks land on Home.
export default async function TVPage() {
  await requirePageUser("admin", "requester");
  redirect("/");
}
