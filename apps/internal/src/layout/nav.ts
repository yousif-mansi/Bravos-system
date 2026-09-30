import type { WorkspaceDto } from "@bravos/contracts";

export type NavItem = {
  to: string;
  name: string;
  ariaName?: string;
  show: (workspace: WorkspaceDto) => boolean;
  onlineOnly?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

const manager = (workspace: WorkspaceDto) => workspace.staff.role === "manager";

export function navigationFor(workspace: WorkspaceDto, online: boolean): NavGroup[] {
  const groups: NavGroup[] = [
    {
      label: "الرئيسية",
      items: [{
        to: "/workspace",
        name: "الرئيسية",
        ariaName: "العودة لمساحة العمل",
        show: () => Boolean(workspace.activeBranch),
      }],
    },
    {
      label: "التشغيل",
      items: [
        { to: "/lookup", name: "نقطة البيع", show: (value) => value.capabilities.cashier },
        { to: "/sales", name: "المبيعات", show: (value) => Boolean(value.activeBranch) },
        {
          to: "/online-orders",
          name: "الطلبات الأونلاين",
          show: (value) => manager(value) || value.capabilities.orderRepresentative,
          onlineOnly: true,
        },
        { to: "/receiving", name: "استلام المخزون", show: (value) => value.capabilities.manageInventory, onlineOnly: true },
        { to: "/returns", name: "المرتجعات", show: (value) => manager(value) && value.capabilities.manageInventory, onlineOnly: true },
        { to: "/expenses", name: "المصروفات", show: (value) => Boolean(value.activeBranch), onlineOnly: true },
        { to: "/stock-corrections", name: "تصحيح كميات المخزون", show: (value) => manager(value) && value.capabilities.manageInventory, onlineOnly: true },
        { to: "/corrections", name: "تصحيح التسجيلات", show: (value) => manager(value) && value.capabilities.manageInventory, onlineOnly: true },
      ],
    },
    {
      label: "المنتجات",
      items: [
        { to: "/catalog", name: "المنتجات", show: (value) => value.capabilities.manageCatalog, onlineOnly: true },
        { to: "/offers", name: "العروض", show: (value) => value.capabilities.managePricing, onlineOnly: true },
      ],
    },
    {
      label: "التحليل",
      items: [
        { to: "/reports", name: "التقارير", show: manager, onlineOnly: true },
        { to: "/analytics", name: "تحليلات المتجر", show: manager, onlineOnly: true },
      ],
    },
    {
      label: "الإدارة",
      items: [
        { to: "/staff", name: "الموظفون", show: (value) => value.capabilities.manageStaff, onlineOnly: true },
        { to: "/select-branch", name: "الفروع", show: () => true },
        { to: "/backup", name: "نسخة احتياطية", show: manager, onlineOnly: true },
        { to: "/restore", name: "استعادة البيانات", show: manager, onlineOnly: true },
        { to: "/storefront-settings", name: "روابط المتجر", show: (value) => value.capabilities.manageCatalog, onlineOnly: true },
        { to: "/delivery-areas", name: "مناطق التوصيل", show: (value) => value.capabilities.manageCatalog, onlineOnly: true },
        {
          to: "/opening-import",
          name: "استيراد بيانات البداية",
          show: (value) => manager(value) && value.capabilities.manageInventory && value.capabilities.manageCatalog,
          onlineOnly: true,
        },
      ],
    },
  ];

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.show(workspace) && (!item.onlineOnly || online)),
    }))
    .filter((group) => group.items.length > 0);
}
