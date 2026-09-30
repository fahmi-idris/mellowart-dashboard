import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

export default [
  // Public
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),

  // Admin area — wrapped in the sidebar shell
  layout("routes/dashboard-layout.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("inquiry", "routes/inquiry.tsx"),
    route("events", "routes/events.tsx"),
    route("events/:id", "routes/event.$id.tsx"),
    route("activity", "routes/activity.tsx"),
    route("users", "routes/users.tsx"),
    route("invoice-settings", "routes/invoice-settings.tsx"),
    route("email-templates", "routes/email-templates.tsx"),
  ]),

  // JSON APIs (resource routes)
  route("api/inquiries", "routes/api.inquiries.tsx"), // admin-only list
  route("api/inquiries/:id", "routes/api.inquiry.$id.tsx"), // admin-only detail
  route("api/summary", "routes/api.summary.tsx"), // admin-only dashboard counts
  route("api/submit", "routes/api.submit.tsx"), // public, CLIENT_KEY-protected
  route("api/files/*", "routes/api.files.$.tsx"), // admin-only R2 image streamer
  route("email-assets/*", "routes/email-assets.$.tsx"), // public email images from R2

  // Xero OAuth2 (web app) connect flow — admin-only resource routes
  route("xero/authorize", "routes/xero.authorize.tsx"),
  route("xero/callback", "routes/xero.callback.tsx"),
  route("xero/disconnect", "routes/xero.disconnect.tsx"),

  // Google OAuth2 (Gmail send) connect flow — admin-only resource routes
  route("google/authorize", "routes/google.authorize.tsx"),
  route("google/callback", "routes/google.callback.tsx"),
  route("google/disconnect", "routes/google.disconnect.tsx"),
] satisfies RouteConfig;
