// Array helpers for callbacks that wait on the database. A plain `items.filter(async x => ...)` keeps everything (a promise is always
// truthy) and `items.reduce(async ...)` adds up promises; these wait for each answer. They run one callback at a time, in order, so a
// list of a few thousand does not open a few thousand queries at once.

export async function filterAsync<T>(items: readonly T[], keep: (item: T, index: number) => Promise<boolean>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) if (await keep(items[i], i)) out.push(items[i]);
  return out;
}

export async function someAsync<T>(items: readonly T[], test: (item: T, index: number) => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < items.length; i++) if (await test(items[i], i)) return true;
  return false;
}

export async function everyAsync<T>(items: readonly T[], test: (item: T, index: number) => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < items.length; i++) if (!(await test(items[i], i))) return false;
  return true;
}

/** The sum of `value` over `items`. */
export async function sumAsync<T>(items: readonly T[], value: (item: T, index: number) => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < items.length; i++) total += await value(items[i], i);
  return total;
}
