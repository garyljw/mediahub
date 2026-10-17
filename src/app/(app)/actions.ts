"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}
