import { env } from "cloudflare:workers";
import { useEffect } from "react";
import { Form, useNavigation, useSearchParams } from "react-router";
import { toast } from "sonner";

import type { Route } from "./+types/invoice-settings";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { requireAdmin } from "~/lib/auth.server";
import { LINE_AMOUNT_TYPES, TAX_TYPES } from "~/lib/invoices";
import { getInvoiceSettings, updateInvoiceSettings } from "~/lib/invoices.server";
import { getGoogleTokens } from "~/lib/google-tokens.server";
import { getXeroTokens } from "~/lib/xero-tokens.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Invoice settings · Mellow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const [settings, xeroTokens, googleTokens] = await Promise.all([
    getInvoiceSettings(env.DB),
    getXeroTokens(env.DB),
    getGoogleTokens(env.DB),
  ]);
  return {
    settings,
    xero: {
      connected: xeroTokens !== null,
      tenantName: xeroTokens?.tenantName ?? null,
    },
    google: {
      connected: googleTokens !== null,
      email: googleTokens?.email ?? null,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();

  const currency = String(form.get("currency") ?? "")
    .trim()
    .toUpperCase();
  const accountCode = String(form.get("accountCode") ?? "").trim();
  const itemDescription = String(form.get("itemDescription") ?? "").trim();
  const lineAmountTypes = String(form.get("lineAmountTypes") ?? "");
  const taxType = String(form.get("taxType") ?? "").trim();
  const dueDays = Number(form.get("dueDays"));
  const bankAccountName = String(form.get("bankAccountName") ?? "").trim();
  const bankBsb = String(form.get("bankBsb") ?? "").trim();
  const bankAccountNumber = String(form.get("bankAccountNumber") ?? "").trim();
  const confirmationFormUrl = String(form.get("confirmationFormUrl") ?? "").trim();

  if (currency.length !== 3) {
    return { ok: false, message: "Currency must be a 3-letter code." };
  }
  if (!accountCode) {
    return { ok: false, message: "Account code is required." };
  }
  if (!itemDescription) {
    return { ok: false, message: "Item description is required." };
  }
  if (!LINE_AMOUNT_TYPES.includes(lineAmountTypes as never)) {
    return { ok: false, message: "Invalid line amount type." };
  }
  if (!TAX_TYPES.some((t) => t.value === taxType)) {
    return { ok: false, message: "Invalid tax type." };
  }
  if (!Number.isInteger(dueDays) || dueDays < 0) {
    return { ok: false, message: "Due days must be a whole number." };
  }

  await updateInvoiceSettings(env.DB, {
    currency,
    accountCode,
    taxType,
    lineAmountTypes,
    itemDescription,
    dueDays,
    bankAccountName: bankAccountName || null,
    bankBsb: bankBsb || null,
    bankAccountNumber: bankAccountNumber || null,
    confirmationFormUrl: confirmationFormUrl || null,
  });

  return { ok: true, message: "Invoice settings saved." };
}

export default function InvoiceSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { settings, xero, google } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) toast.success(actionData.message);
    else toast.error(actionData.message);
  }, [actionData]);

  // One-shot toast after returning from an OAuth round-trip (Xero or Google).
  useEffect(() => {
    const toastFor = (label: string, status: string) => {
      if (status === "connected") toast.success(`${label} connected.`);
      else if (status === "disconnected") toast.success(`${label} disconnected.`);
      else if (status === "error") toast.error(`${label} connection failed.`);
      else if (status === "scope")
        toast.error("Gmail send permission was not granted. Reconnect and allow email sending.");
    };
    const xeroStatus = searchParams.get("xero");
    const googleStatus = searchParams.get("google");
    if (!xeroStatus && !googleStatus) return;
    if (xeroStatus) toastFor("Xero", xeroStatus);
    if (googleStatus) toastFor("Gmail", googleStatus);
    setSearchParams(
      (prev) => {
        prev.delete("xero");
        prev.delete("google");
        return prev;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invoice settings</h1>
        <p className="text-sm text-muted-foreground">
          Defaults forwarded to Xero when an approved submission is invoiced.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Xero connection</CardTitle>
          <CardDescription>
            Invoices can only be created while connected. Authorizing opens Xero's consent screen,
            then returns here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm">
            {xero.connected ? (
              <p>
                <span className="font-medium text-foreground">Connected</span>
                {xero.tenantName ? (
                  <span className="text-muted-foreground"> · {xero.tenantName}</span>
                ) : null}
              </p>
            ) : (
              <p className="text-muted-foreground">Not connected</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {xero.connected ? (
              <>
                <Button asChild variant="outline">
                  <a href="/xero/authorize">Reconnect</a>
                </Button>
                <Form method="post" action="/xero/disconnect">
                  <Button type="submit" variant="destructive">
                    Disconnect
                  </Button>
                </Form>
              </>
            ) : (
              <Button asChild>
                <a href="/xero/authorize">Connect Xero</a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Email (Gmail)</CardTitle>
          <CardDescription>
            Sends approval emails (with the invoice link) from your Google Workspace mailbox.
            Approval still works while disconnected — the email is just skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm">
            {google.connected ? (
              <p>
                <span className="font-medium text-foreground">Connected</span>
                {google.email ? (
                  <span className="text-muted-foreground"> · {google.email}</span>
                ) : null}
              </p>
            ) : (
              <p className="text-muted-foreground">Not connected</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {google.connected ? (
              <>
                <Button asChild variant="outline">
                  <a href="/google/authorize">Reconnect</a>
                </Button>
                <Form method="post" action="/google/disconnect">
                  <Button type="submit" variant="destructive">
                    Disconnect
                  </Button>
                </Form>
              </>
            ) : (
              <Button asChild>
                <a href="/google/authorize">Connect Gmail</a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Line item & tax</CardTitle>
          <CardDescription>
            Applied to the single "table fee" line on each generated invoice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="itemDescription">Item description</Label>
              <Input
                id="itemDescription"
                name="itemDescription"
                defaultValue={settings.itemDescription}
                required
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="currency">Currency</Label>
                <Input
                  id="currency"
                  name="currency"
                  maxLength={3}
                  defaultValue={settings.currency}
                  className="uppercase"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="accountCode">Account code</Label>
                <Input
                  id="accountCode"
                  name="accountCode"
                  defaultValue={settings.accountCode}
                  required
                />
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="lineAmountTypes">Line amount types</Label>
                <Select name="lineAmountTypes" defaultValue={settings.lineAmountTypes}>
                  <SelectTrigger id="lineAmountTypes">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINE_AMOUNT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="taxType">Tax type</Label>
                <Select name="taxType" defaultValue={settings.taxType ?? TAX_TYPES[0].value}>
                  <SelectTrigger id="taxType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="dueDays">Due in (days)</Label>
                <Input
                  id="dueDays"
                  name="dueDays"
                  type="number"
                  min={0}
                  step="1"
                  defaultValue={settings.dueDays}
                  required
                />
              </div>
            </div>

            <div className="border-t pt-5">
              <h3 className="text-sm font-medium">Bank transfer (EFT) details</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Shown as the manual "pay by bank transfer" option on the approval email. Leave blank
                to hide that option.
              </p>
              <div className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="bankAccountName">Account name</Label>
                  <Input
                    id="bankAccountName"
                    name="bankAccountName"
                    defaultValue={settings.bankAccountName ?? ""}
                    placeholder="Mellow Art Market"
                  />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="bankBsb">BSB</Label>
                    <Input
                      id="bankBsb"
                      name="bankBsb"
                      defaultValue={settings.bankBsb ?? ""}
                      placeholder="e.g. 063-000"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="bankAccountNumber">Account number</Label>
                    <Input
                      id="bankAccountNumber"
                      name="bankAccountNumber"
                      defaultValue={settings.bankAccountNumber ?? ""}
                      placeholder="e.g. 1234 5678"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="confirmationFormUrl">Payment confirmation form URL</Label>
                  <Input
                    id="confirmationFormUrl"
                    name="confirmationFormUrl"
                    type="url"
                    defaultValue={settings.confirmationFormUrl ?? ""}
                    placeholder="https://… (optional)"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
