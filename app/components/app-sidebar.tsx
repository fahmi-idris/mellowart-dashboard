import {
  Activity,
  CalendarDays,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  Receipt,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Form, Link, useLocation } from "react-router";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "~/components/ui/sidebar";

const nav = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Inquiries", url: "/inquiry", icon: Inbox },
  { title: "Events", url: "/events", icon: CalendarDays },
  { title: "Activity", url: "/activity", icon: Activity },
  { title: "Users", url: "/users", icon: Users },
  { title: "Invoice settings", url: "/invoice-settings", icon: Receipt },
  { title: "Email templates", url: "/email-templates", icon: Mail },
];

export function AppSidebar({
  email,
  hasTemplateEvent,
}: {
  email?: string;
  hasTemplateEvent: boolean;
}) {
  const { pathname } = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <ShieldCheck className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Mellow Admin</span>
                  <span className="truncate text-xs text-muted-foreground">Applications</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const Icon = item.icon;
                if (item.url === "/email-templates" && !hasTemplateEvent) {
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        disabled
                        tooltip="Create a current or upcoming event first"
                        title="Create a current or upcoming event first"
                      >
                        <Icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                      <p className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                        Create a current or upcoming event in{" "}
                        <Link
                          to="/events"
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          Events
                        </Link>{" "}
                        to edit email templates.
                      </p>
                    </SidebarMenuItem>
                  );
                }
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url}
                      tooltip={item.title}
                    >
                      <Link to={item.url}>
                        <Icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {email ? (
            <SidebarMenuItem>
              <div className="truncate px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                {email}
              </div>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <Dialog>
              <DialogTrigger asChild>
                <SidebarMenuButton type="button" tooltip="Sign out" className="w-full">
                  <LogOut />
                  <span>Sign out</span>
                </SidebarMenuButton>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Sign out?</DialogTitle>
                  <DialogDescription>
                    You’ll need to sign in again to access the dashboard.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Form method="post" action="/logout">
                    <Button type="submit" className="w-full sm:w-auto">
                      <LogOut className="size-4" /> Sign out
                    </Button>
                  </Form>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
