declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface ImportMetaEnv {
  /** The app's name, from `APP_NAME` where Vite ran. Unset in unit tests, which run without the Vite config. */
  readonly VITE_APP_NAME?: string;
}

declare module "*.json" {
  const value: unknown;
  export default value;
}
