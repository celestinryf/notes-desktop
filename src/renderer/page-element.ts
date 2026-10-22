export function pageElement<T extends Element>(selector: string, type: new () => T): T {
  const node = document.querySelector(selector);
  if (!(node instanceof type)) throw new Error('The page is missing ' + selector + '.');
  return node;
}
