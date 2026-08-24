/**
 * Vendored fork of Cloudflare's kumo design system (@cloudflare/kumo),
 * taken shadcn-style so this repo owns the component source.
 *
 * Provenance: https://github.com/cloudflare/kumo @ 38518e34 (v2.12.0)
 * Scope: only the components cluster-ui uses — trimmed from upstream's
 * src/index.ts. To sync a component later, re-copy its folder from upstream
 * and re-add its export block here.
 *
 * Upstream rules still apply:
 * - semantic tokens only (`bg-kumo-base`, `text-kumo-default`, …), never raw
 *   Tailwind colors, never the `dark:` variant (tokens use light-dark()).
 * - compose classes via `cn()`; wrap interactive roots with the providers
 *   below where needed.
 */

// Action
export { Button, RefreshButton, LinkButton, buttonVariants, type ButtonProps } from "./components/button";
export { ClipboardText } from "./components/clipboard-text";

// Display
export { Badge, type BadgeVariant } from "./components/badge";
export { Code, CodeBlock } from "./components/code";
export { LayerCard } from "./components/layer-card";
export { Text } from "./components/text";

// Feedback
export { Banner, BannerVariant } from "./components/banner";
export { Loader, SkeletonLine } from "./components/loader";

// Input
export {
  Checkbox,
  type CheckboxChangeEventDetails,
} from "./components/checkbox";
export { Field, fieldVariants, type FieldProps } from "./components/field";
export { Input, inputVariants } from "./components/input";
export { InputGroup } from "./components/input-group";
export { Label, labelVariants, labelContentVariants } from "./components/label";
export { Select } from "./components/select";

// Navigation
export { Pagination } from "./components/pagination";
export { Sidebar } from "./components/sidebar";
export { Tabs, type TabsProps, type TabsItem } from "./components/tabs";
export { Toolbar } from "./components/toolbar";

// Overlay
export {
  Dialog,
  DialogRoot,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "./components/dialog";
export { Tooltip, TooltipProvider } from "./components/tooltip";

// Layout / data
export { Empty, type EmptyProps } from "./components/empty";
export { Table } from "./components/table";

// Utils & providers
export { cn, safeRandomId } from "./utils/cn";
export {
  LinkProvider,
  useLinkComponent,
  type LinkComponentProps,
} from "./utils/link-provider";
export { KumoPortalProvider, type PortalContainer } from "./utils/portal-provider";
