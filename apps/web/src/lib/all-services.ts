import { api } from "./api";

/** Services beyond the API's first 20 records must remain browsable and orderable. */
export async function listAllServices() {
  const first = await api.services(1, 100);
  const items = [...first.items];
  for (let page = 2; page <= first.meta.totalPages; page += 1) {
    const next = await api.services(page, 100);
    items.push(...next.items);
  }
  return items;
}
