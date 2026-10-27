type Load = (ids: string[], query: string) => Promise<ListRow[]>;

export function createRowCache(load: Load) {
  let rows = new Map<string, ListRow>();
  let query = '';
  let generation = 0;
  const asked = new Set<string>();
  return {
    reset(next: readonly ListRow[], nextQuery: string) {
      rows = new Map(next.map((r) => [r.id, r]));
      query = nextQuery;
      generation++;
      asked.clear();
    },
    get: (id: string) => rows.get(id),
    set(row: ListRow) { rows.set(row.id, row); },
    async fetch(ids: readonly string[]) {
      const want = ids.filter((id) => !rows.has(id) && !asked.has(id));
      if (!want.length) return [];
      const at = generation;
      for (const id of want) asked.add(id);
      let got: ListRow[];
      try { got = await load(want, query); } catch (err) {
        if (at === generation) for (const id of want) asked.delete(id);
        throw err;
      }
      if (at !== generation) return [];
      for (const r of got) rows.set(r.id, r);
      return got.map((r) => r.id);
    },
  };
}
