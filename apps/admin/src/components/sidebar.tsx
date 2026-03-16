"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Wrench,
  Package,
  MessageSquare,
  Users,
  Radio,
  AlertTriangle,
  Inbox,
  Settings,
  CreditCard,
  Zap,
} from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Onboardings", href: "/onboardings", icon: Radio },
  { name: "Clients", href: "/clients", icon: Users },
  { name: "Services", href: "/services", icon: Wrench },
  { name: "Packages", href: "/packages", icon: Package },
  { name: "Templates", href: "/templates", icon: MessageSquare },
  { name: "Escalations", href: "/escalations", icon: AlertTriangle },
  { name: "Dead Letter Queue", href: "/dead-letter-queue", icon: Inbox },
  { name: "Billing", href: "/billing", icon: CreditCard },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-[260px] flex-col border-r border-zinc-800/80 bg-zinc-950">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-zinc-800/80 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 shadow-glow">
          <Zap className="h-4 w-4 text-white" />
        </div>
        <span className="font-display text-lg font-bold tracking-tight text-zinc-50">
          LeadrWizard
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3 py-4 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150 ${
                isActive
                  ? "bg-brand-600/10 text-brand-400 shadow-sm ring-1 ring-brand-500/20"
                  : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
              }`}
            >
              <item.icon
                className={`h-[18px] w-[18px] transition-colors ${
                  isActive
                    ? "text-brand-400"
                    : "text-zinc-500 group-hover:text-zinc-300"
                }`}
              />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-zinc-800/80 px-5 py-3">
        <p className="text-[11px] text-zinc-600">
          LeadrWizard v1.0
        </p>
      </div>
    </aside>
  );
}
