import { Button } from "@/components/ui/button";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function ExportButtons() {
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
