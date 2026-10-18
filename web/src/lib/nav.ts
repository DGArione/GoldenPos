import {
  LayoutDashboard, Store, ClipboardList, Grid3x3, ChefHat, Globe,
  CreditCard, UtensilsCrossed, Boxes, History, BarChart3, Clock,
  Wallet, Users, FileText, Coins, MessageSquare, Contact, ScrollText,
  Star, Gift, Tag, CalendarCheck, Settings, Shield, UserCog,
  Truck, PackageSearch, HandPlatter,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "./api";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  addon?: string;        // only shown when this add-on is enabled
  section: string;       // group label
}

export const NAV_ITEMS: NavItem[] = [
  // ── Operations ──
  { key: "dashboard",    section: "Operations", label: "Dashboard",    href: "/dashboard",     icon: LayoutDashboard },
  { key: "order",        section: "Operations", label: "Order Entry",  href: "/order",         icon: ClipboardList },
  { key: "floor",        section: "Operations", label: "Floor",        href: "/floor",         icon: Grid3x3 },
  { key: "kitchen",      section: "Operations", label: "Kitchen",      href: "/kitchen",       icon: ChefHat },
  { key: "serve",        section: "Operations", label: "Serve",        href: "/serve",         icon: HandPlatter },
  { key: "payment",      section: "Operations", label: "Payment",      href: "/payment",       icon: CreditCard },
  { key: "onlineorders", section: "Operations", label: "Online Orders",href: "/online-orders", icon: Globe },

  // ── Catalog & stock ──
  { key: "menuadmin",    section: "Catalog & stock", label: "Menu",        href: "/menu-admin", icon: UtensilsCrossed },
  { key: "inventory",    section: "Catalog & stock", label: "Inventory",   href: "/inventory",  icon: Boxes },
  { key: "suppliers",    section: "Catalog & stock", label: "Suppliers",   href: "/suppliers",  icon: Truck },
  { key: "purchases",    section: "Catalog & stock", label: "Purchases",   href: "/purchases",  icon: PackageSearch },

  // ── Customers & marketing ──
  { key: "customers",    section: "Customers",   label: "Customers",    href: "/customers",    icon: Contact },
  { key: "reservations", section: "Customers",   label: "Reservations", href: "/reservations", icon: CalendarCheck, addon: "reservations" },
  { key: "loyalty",      section: "Customers",   label: "Loyalty",      href: "/loyalty",      icon: Star,          addon: "loyalty" },
  { key: "giftcards",    section: "Customers",   label: "Gift Cards",   href: "/giftcards",    icon: Gift,          addon: "giftcards" },
  { key: "promotions",   section: "Customers",   label: "Promotions",   href: "/promotions",   icon: Tag,           addon: "promotions" },

  // ── Reports & cash ──
  { key: "history",      section: "Reports & cash", label: "History",     href: "/history",   icon: History },
  { key: "reports",      section: "Reports & cash", label: "Reports",     href: "/reports",   icon: BarChart3 },
  { key: "zreport",      section: "Reports & cash", label: "Z-Report",    href: "/zreport",   icon: FileText },
  { key: "pettycash",    section: "Reports & cash", label: "Petty Cash",  href: "/pettycash", icon: Coins },

  // ── Team ──
  { key: "staff",        section: "Team", label: "Users",       href: "/staff",     icon: Users },
  { key: "timeclock",    section: "Team", label: "Time Clock",  href: "/timeclock", icon: Clock },
  { key: "payroll",      section: "Team", label: "Payroll",     href: "/payroll",   icon: Wallet },
  { key: "messages",     section: "Team", label: "Messages",    href: "/messages",  icon: MessageSquare },

  // ── System ──
  { key: "branches",     section: "System", label: "Branches",   href: "/branches", icon: Store },
  { key: "auditlog",     section: "System", label: "Audit Log",  href: "/audit",    icon: ScrollText },
  { key: "admin",        section: "System", label: "Admin",      href: "/admin",    icon: Shield },
  { key: "profile",      section: "System", label: "My Profile", href: "/profile",  icon: UserCog },
  { key: "settings",     section: "System", label: "Settings",   href: "/settings", icon: Settings },
];

export const ROLE_VISIBILITY: Record<Role, string[]> = {
  // Admin + Settings are ADMIN-ONLY. Super managers run the business but do
  // not see the admin / global-settings pages.
  admin:        ["dashboard", "settings", "auditlog", "staff", "admin", "profile", "messages", "branches"],
  superManager: ["dashboard","branches","order","floor","kitchen","serve","onlineorders","payment","menuadmin","inventory","suppliers","purchases","history","reports","timeclock","payroll","staff","zreport","pettycash","messages","customers","auditlog","loyalty","giftcards","promotions","reservations","profile"],
  manager:      ["dashboard","order","floor","kitchen","serve","onlineorders","payment","menuadmin","inventory","suppliers","purchases","history","reports","timeclock","payroll","staff","zreport","pettycash","messages","customers","auditlog","loyalty","giftcards","promotions","reservations","profile"],
  finance:      ["dashboard","history","reports","inventory","suppliers","purchases","timeclock","payroll","zreport","pettycash","messages","customers","profile"],
  server:       ["order","floor","kitchen","onlineorders","payment","history","timeclock","messages","customers","loyalty","giftcards","promotions","reservations","profile"],
  cashier:      ["payment","serve","onlineorders","history","timeclock","messages","customers","loyalty","giftcards","promotions","profile"],
  kitchen:      ["kitchen","onlineorders","timeclock","messages","profile"],
};

export function visibleNav(role: Role, enabledAddons: string[] = []): NavItem[] {
  const allowed = new Set(ROLE_VISIBILITY[role] || []);
  return NAV_ITEMS.filter((i) => {
    if (!allowed.has(i.key)) return false;
    if (i.addon && !enabledAddons.includes(i.addon)) return false;
    return true;
  });
}

export const NAV_SECTIONS = ["Operations", "Catalog & stock", "Customers", "Reports & cash", "Team", "System"];

/** Group a list of nav items by their section, keeping the section order above. */
export function groupedNav(items: NavItem[]): { section: string; items: NavItem[] }[] {
  const map = new Map<string, NavItem[]>();
  for (const it of items) {
    if (!map.has(it.section)) map.set(it.section, []);
    map.get(it.section)!.push(it);
  }
  return NAV_SECTIONS
    .filter((s) => map.has(s))
    .map((s) => ({ section: s, items: map.get(s)! }));
}
