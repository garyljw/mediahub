import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/authz";

export const instant = false;

export default async function HomePage() {
  await requirePageUser("admin", "requester");
  redirect("/movies");
}
