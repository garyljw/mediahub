import { requirePageUser } from "@/server/authz";
import { appVersion } from "@/server/app-version";
import { noticesSummary } from "@/server/notices";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "About" };

export default async function AboutPage() {
  await requirePageUser("admin", "requester");
  const licences = noticesSummary();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">About</h1>
      <p className="mt-2 text-sm">MediaHub {appVersion()}</p>
      <p className="mt-6 text-sm text-muted-foreground">A hobby project for personal use, maintained in spare time.</p>
      <p className="mt-2 text-sm">
        <a href="https://github.com/garyljw/mediahub" target="_blank" rel="noreferrer" className="text-primary hover:underline">
          Source code on GitHub
        </a>
      </p>
      <p className="mt-2 text-sm">MediaHub is released under the MIT licence.</p>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Open-source licences</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          MediaHub is built on the open-source projects listed below, each under its own licence.
        </p>
        <p className="mt-2 text-sm">
          <a href="/api/about/licences" className="text-primary hover:underline">
            Read the full licence texts
          </a>
        </p>

        {licences === null ? (
          <p className="mt-6 text-sm text-muted-foreground">
            The licence list is created when MediaHub is packaged, so it isn&apos;t available in development.
          </p>
        ) : (
          <div className="mt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Licence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {licences.map((item) => (
                  <TableRow key={`${item.name}@${item.version}`}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell className="text-muted-foreground">{item.version}</TableCell>
                    <TableCell className="text-muted-foreground">{item.licence}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
