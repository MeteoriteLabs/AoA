import { Link } from "@/lib/router";
import { Menu, Search } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useSidebar } from "../context/SidebarContext";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Fragment } from "react";

export function BreadcrumbBar() {
  const { breadcrumbs, subtitle, entityColor } = useBreadcrumbs();
  const { toggleSidebar, toggleCollapse, isMobile } = useSidebar();

  if (breadcrumbs.length === 0) return null;

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  const menuButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="mr-2 shrink-0"
      onClick={isMobile ? toggleSidebar : toggleCollapse}
      aria-label={isMobile ? "Open sidebar" : "Toggle sidebar"}
    >
      <Menu className="h-5 w-5" />
    </Button>
  );

  const searchButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
      onClick={openSearch}
      aria-label="Search (Cmd+K)"
      title="Search (Cmd+K)"
    >
      <Search className="h-4 w-4" />
    </Button>
  );

  // Single breadcrumb = page title (Title Case, with optional subtitle)
  if (breadcrumbs.length === 1) {
    return (
      <div
        className="border-b border-border px-4 md:px-6 shrink-0 flex items-center min-w-0 overflow-hidden"
        style={entityColor ? { borderTopWidth: "2px", borderTopColor: entityColor, minHeight: subtitle ? "3.5rem" : "3rem" } : { minHeight: subtitle ? "3.5rem" : "3rem" }}
      >
        {menuButton}
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold tracking-wide truncate">
            {breadcrumbs[0].label}
          </h1>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate -mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        {searchButton}
      </div>
    );
  }

  // Multiple breadcrumbs = breadcrumb trail
  return (
    <div
      className="border-b border-border px-4 md:px-6 h-12 shrink-0 flex items-center min-w-0 overflow-hidden"
      style={entityColor ? { borderTopWidth: "2px", borderTopColor: entityColor } : undefined}
    >
      {menuButton}
      <Breadcrumb className="min-w-0 overflow-hidden flex-1">
        <BreadcrumbList className="flex-nowrap">
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <Fragment key={i}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem className={isLast ? "min-w-0" : "shrink-0"}>
                  {isLast || !crumb.href ? (
                    <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      {searchButton}
    </div>
  );
}
