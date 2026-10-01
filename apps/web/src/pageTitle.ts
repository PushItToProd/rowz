import { toValue, watchEffect, type MaybeRefOrGetter } from "vue";
import { APP_NAME } from "./appName";

/** What the browser tab shows for a page: the page's title, then the app's name. */
export function pageTitle(title: string | undefined): string {
  return title === undefined || title === "" ? APP_NAME : `${title} | ${APP_NAME}`;
}

/**
 * Keeps the browser tab's title in step with the view that calls it. A view
 * whose title is not known yet, such as an editor still loading its
 * spreadsheet, gives `undefined` and the tab shows the app's name alone.
 */
export function usePageTitle(title: MaybeRefOrGetter<string | undefined>): void {
  watchEffect(() => {
    document.title = pageTitle(toValue(title));
  });
}
