"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  createOfficeNetworkAction,
  regenerateNetworkTokenAction,
  setNetworkEnabledAction,
  setNetworkFailModeAction,
  authorizeCurrentNetworkAction,
  type AuthorizeNetworkResult,
} from "@/lib/actions/offices";
import { coveredIpFamilies, ipv6NetworkLabel } from "@/lib/network/matchIp";
import { toast, toastError } from "@/hooks/use-toast";
import type { OfficeNetwork } from "@prisma/client";

function TokenReveal({ agentId, token, onClose }: { agentId: string; token: string; onClose: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="font-semibold text-amber-900">Save these now — the token will not be shown again.</p>
      <dl className="mt-2 space-y-1 font-mono text-xs">
        <div>
          <dt className="inline text-amber-700">AGENT_ID=</dt>
          <dd className="inline break-all">{agentId}</dd>
        </div>
        <div>
          <dt className="inline text-amber-700">REGISTRATION_TOKEN=</dt>
          <dd className="inline break-all">{token}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-amber-800">
        Put these in network-agent/.env on the office machine. See docs/OFFICE_NETWORK_AGENT_SETUP.md.
      </p>
      <Button size="sm" variant="outline" className="mt-3" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}

export function CreateNetworkForm({ officeId }: { officeId: string }) {
  const [pending, startTransition] = useTransition();
  const [revealed, setRevealed] = useState<{ agentId: string; token: string } | null>(null);
  const [name, setName] = useState("");
  const [cidr, setCidr] = useState("");
  const [failMode, setFailMode] = useState<"FAIL_CLOSED" | "FAIL_OPEN">("FAIL_CLOSED");

  function submit() {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set("officeId", officeId);
    fd.set("name", name);
    fd.set("cidr", cidr);
    fd.set("failMode", failMode);
    startTransition(async () => {
      try {
        const result = await createOfficeNetworkAction(fd);
        setRevealed({ agentId: result.agentId, token: result.registrationToken });
        setName("");
        setCidr("");
        toast({ title: "Network registered", variant: "success" });
      } catch (err) {
        toastError(err, "Couldn't register network");
      }
    });
  }

  if (revealed) {
    return <TokenReveal agentId={revealed.agentId} token={revealed.token} onClose={() => setRevealed(null)} />;
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Network name</label>
        <input
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Starlink — Main"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">CIDR (optional)</label>
        <input
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={cidr}
          onChange={(e) => setCidr(e.target.value)}
          placeholder="102.89.0.0/16"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">If unverified</label>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={failMode}
          onChange={(e) => setFailMode(e.target.value as "FAIL_CLOSED" | "FAIL_OPEN")}
        >
          <option value="FAIL_CLOSED">Deny attendance (recommended)</option>
          <option value="FAIL_OPEN">Allow attendance</option>
        </select>
      </div>
      <Button size="sm" onClick={submit} disabled={pending || !name.trim()}>
        {pending ? "Creating…" : "Register Network"}
      </Button>
    </div>
  );
}

export function NetworkRow({ network }: { network: OfficeNetwork }) {
  const [pending, startTransition] = useTransition();
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [confirmingManual, setConfirmingManual] = useState(false);
  const [manualResult, setManualResult] = useState<AuthorizeNetworkResult | { error: string } | null>(null);

  const staleOrUnverified = network.status !== "VERIFIED";
  const covered = coveredIpFamilies(network);

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{network.name}</p>
          <p className="text-xs text-muted-foreground">
            IPv4: {network.currentPublicIp ?? "—"} · IPv6:{" "}
            {network.currentPublicIpv6 ? ipv6NetworkLabel(network.currentPublicIpv6) : "—"}
            {network.cidr ? ` · CIDR: ${network.cidr}` : ""}
          </p>
          {network.status !== "DISABLED" && covered.ipv4 !== covered.ipv6 ? (
            <p className="text-xs text-amber-700">
              Only IPv{covered.ipv4 ? "4" : "6"} captured — if this Wi-Fi also has IPv
              {covered.ipv4 ? "6" : "4"}, employees whose browser uses it will be refused until it&apos;s
              captured too.
            </p>
          ) : null}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            network.status === "VERIFIED"
              ? "bg-green-100 text-green-700"
              : network.status === "DISABLED"
                ? "bg-gray-200 text-gray-700"
                : "bg-amber-100 text-amber-800"
          }`}
        >
          {network.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Last heartbeat: {network.lastVerifiedAt ? new Date(network.lastVerifiedAt).toLocaleString() : "never"} · Fail
        mode: {network.failMode}
      </p>

      {revealedToken ? (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 font-mono text-xs">
          New REGISTRATION_TOKEN: {revealedToken}
          <Button size="sm" variant="outline" className="ml-2" onClick={() => setRevealedToken(null)}>
            Done
          </Button>
        </div>
      ) : manualResult ? (
        "error" in manualResult ? (
          <div className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800">
            {manualResult.error}
            <Button size="sm" variant="outline" className="ml-2" onClick={() => setManualResult(null)}>
              Dismiss
            </Button>
          </div>
        ) : (
          <div className="mt-2 rounded-md border border-green-300 bg-green-50 p-2 text-xs text-green-800">
            Authorized — captured this network&apos;s IPv{manualResult.family} address{" "}
            <span className="font-mono">{manualResult.ip}</span>.
            {!manualResult.hasIpv4 || !manualResult.hasIpv6 ? (
              <p className="mt-1">
                Phones and browsers can connect over either IPv4 or IPv6, and only IPv
                {manualResult.hasIpv4 ? "4" : "6"} is captured so far — if this Wi-Fi also has IPv
                {manualResult.hasIpv4 ? "6" : "4"}, anyone whose browser uses it will be refused. Click Authorize again from a different browser or
                device on this Wi-Fi to capture it, or run the Network Agent, which captures both automatically.
              </p>
            ) : null}
            <Button size="sm" variant="outline" className="ml-2" onClick={() => setManualResult(null)}>
              Done
            </Button>
          </div>
        )
      ) : confirmingManual ? (
        <div className="mt-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
          <p className="font-medium">
            Only continue if <strong>this device</strong> is connected to the Wi-Fi you want to authorize as{" "}
            {network.name} right now.
          </p>
          <p className="mt-1 text-muted-foreground">
            This will set the office&apos;s authorized IP to whatever IP the server sees this very request coming from.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    const r = await authorizeCurrentNetworkAction(network.id);
                    setManualResult(r);
                    toast({ title: "Network authorized", variant: "success" });
                  } catch (err) {
                    setManualResult({ error: err instanceof Error ? err.message : "Could not authorize." });
                    toastError(err, "Couldn't authorize network");
                  } finally {
                    setConfirmingManual(false);
                  }
                })
              }
            >
              Yes, I&apos;m on this Wi-Fi now
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmingManual(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => setConfirmingManual(true)}>
            Authorize This Network Now
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  const r = await regenerateNetworkTokenAction(network.id);
                  setRevealedToken(r.registrationToken);
                  toast({ title: "Agent token regenerated", variant: "success" });
                } catch (err) {
                  toastError(err, "Couldn't regenerate token");
                }
              })
            }
          >
            Regenerate Agent Token
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await setNetworkEnabledAction(network.id, network.status === "DISABLED");
                  toast({ title: network.status === "DISABLED" ? "Network enabled" : "Network disabled", variant: "success" });
                } catch (err) {
                  toastError(err, "Couldn't update network");
                }
              })
            }
          >
            {network.status === "DISABLED" ? "Enable" : "Disable"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await setNetworkFailModeAction(network.id, network.failMode === "FAIL_CLOSED" ? "FAIL_OPEN" : "FAIL_CLOSED");
                  toast({ title: "Fail mode updated", variant: "success" });
                } catch (err) {
                  toastError(err, "Couldn't update fail mode");
                }
              })
            }
          >
            Switch to {network.failMode === "FAIL_CLOSED" ? "FAIL_OPEN" : "FAIL_CLOSED"}
          </Button>
        </div>
      )}
      {staleOrUnverified ? (
        <p className="mt-2 text-xs text-amber-700">
          {network.failMode === "FAIL_CLOSED"
            ? "Attendance will be denied at this office until this network is authorized (via the agent, or the button above)."
            : "Attendance is currently allowed without live network verification (FAIL_OPEN)."}
        </p>
      ) : null}
    </div>
  );
}
