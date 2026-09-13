// Store component: system of record for decisions.
export function createStore() {
  const rows: unknown[] = [];
  return {
    save(row: unknown) {
      rows.push(row);
      return rows.length;
    },
  };
}
