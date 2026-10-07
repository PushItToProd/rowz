import { DOMWrapper } from "@vue/test-utils";

/** Finds an element Teleport rendered directly under document.body. */
export function bodyGet<T extends Element = HTMLElement>(selector: string): DOMWrapper<T> {
  const element = document.body.querySelector<T>(selector);
  if (!element) throw new Error(`No teleported element matches ${selector}`);
  return new DOMWrapper(element);
}

/** Finds all elements Teleport rendered directly under document.body. */
export function bodyFindAll<T extends Element = HTMLElement>(selector: string): DOMWrapper<T>[] {
  return [...document.body.querySelectorAll<T>(selector)].map((element) => new DOMWrapper(element));
}

/** Checks whether Teleport rendered an element directly under document.body. */
export function bodyHas(selector: string): boolean {
  return document.body.querySelector(selector) !== null;
}
