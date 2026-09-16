import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatInTimeZone } from "date-fns-tz";
import { PageHeader } from "@/components/admin/PageHeader";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const [offices, employees] = await Promise.all([
    prisma.office.findMany({ orderBy: { name: "asc" } }),
    prisma.employee.findMany({
      where: { isDeleted: false },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  const currentMonth = formatInTimeZone(new Date(), "Africa/Lagos", "yyyy-MM");

  return (
    <>
      <PageHeader>
        <h1 className="text-2xl font-bold">Reports</h1>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
      <Card>
        <CardHeader>
          <CardTitle>Daily attendance report</CardTitle>
        </CardHeader>
        <CardContent>
          <form action="/api/reports/daily" className="flex flex-wrap items-end gap-2">
            <Field label="From"><Input type="date" name="from" /></Field>
            <Field label="To"><Input type="date" name="to" /></Field>
            <Field label="Office">
              <select name="officeId" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="">All</option>
                {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <ExportButtons />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly attendance report</CardTitle>
        </CardHeader>
        <CardContent>
          <form action="/api/reports/monthly" className="flex flex-wrap items-end gap-2">
            <Field label="Month">
              <Input type="month" name="month" defaultValue={currentMonth} />
            </Field>
            <Field label="Office">
              <select name="officeId" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="">All</option>
                {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <ExportButtons />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Performance report</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Cumulative attendance score per employee for the period, ranked best to worst — the same scoring behind
            the Analytics dashboard, as one row per employee instead of a chart.
          </p>
          <form action="/api/reports/performance" className="flex flex-wrap items-end gap-2">
            <Field label="From"><Input type="date" name="from" /></Field>
            <Field label="To"><Input type="date" name="to" /></Field>
            <Field label="Office">
              <select name="officeId" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="">All</option>
                {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <ExportButtons />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employee attendance report</CardTitle>
        </CardHeader>
        <CardContent>
          <form action="/api/reports/daily" className="flex flex-wrap items-end gap-2">
            <Field label="Employee">
              <select name="employeeId" required className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="From"><Input type="date" name="from" /></Field>
            <Field label="To"><Input type="date" name="to" /></Field>
            <ExportButtons />
          </form>
        </CardContent>
      </Card>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function ExportButtons() {
  return (
    <div className="flex gap-2">
      <Button type="submit" name="format" value="csv" size="sm" variant="outline">
        CSV
      </Button>
      <Button type="submit" name="format" value="xlsx" size="sm" variant="outline">
        Excel
      </Button>
      <Button type="submit" name="format" value="pdf" size="sm">
        PDF
      </Button>
    </div>
  );
}
