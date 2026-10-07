import type { RouteLocationRaw } from "vue-router";

export interface Notice {
  kind: "success" | "error";
  text: string;
  action?: { label: string; to: RouteLocationRaw };
}
