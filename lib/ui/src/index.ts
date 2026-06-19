/**
 * `@workspace/ui` — the shared design system: the `cn` class-merge utility and
 * shared hooks. The UI components themselves are exposed as subpath imports
 * (e.g. `@workspace/ui/button`, `@workspace/ui/avatar`) mirroring the shadcn
 * per-file layout, and the design tokens live in `@workspace/ui/theme.css`.
 */
export { cn } from "./lib/utils";
export { useIsMobile } from "./hooks/use-mobile";
export { useToast, toast } from "./hooks/use-toast";
