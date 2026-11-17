import { requirePageUser } from "@/server/authz";
import { readPhoneBackButton } from "@/server/settings/phone-back-button";
import { Breadcrumb } from "@/components/breadcrumb/breadcrumb";
import { navCrumb } from "@/components/breadcrumb/trail";
import { PhoneBackButtonForm } from "@/components/settings/phone-back-button-form";

export const metadata = { title: "Display" };
// The page reads the saved setting before rendering.
export const instant = false;

export default async function DisplayPage() {
  await requirePageUser("admin");

  return (
    <div>
      <div className="mb-4">
        <Breadcrumb label="Display" root={navCrumb("/settings")} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Display</h1>
      <div className="mt-6 space-y-6">
        <section className="rounded-lg border p-5">
          <h2 className="text-lg font-semibold">Phones</h2>
          <div className="mt-4">
            <PhoneBackButtonForm initial={readPhoneBackButton()} />
          </div>
        </section>
      </div>
    </div>
  );
}
