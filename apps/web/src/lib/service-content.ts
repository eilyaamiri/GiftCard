import index from "../content/international-service-index.json";

export type ServiceContentSummary = (typeof index)[number];

export function getServiceContentSummary(slug: string): ServiceContentSummary | undefined {
  return index.find((entry) => entry.slug === slug);
}
