/**
 * A detail list: the rows behind a clickable figure, opened in the side panel.
 * Each list describes its columns and filter chips (facets) so the frontend can
 * show any list with one component.
 */
import type { Db } from '../db.js';
import type { PanelFilters } from '../queryBuilder.js';
import type { Scope } from '../../plugins/scope.js';
import type { DetailColumn, DetailFacet } from '../../types/api.js';

export type DetailRow = Record<string, string | number | null>;

export interface DetailRequest {
  page: number;
  pageSize: number;
  search?: string;
  /** Chosen facet values by facet key; a missing key means its first option. */
  facets: Record<string, string>;
}

export interface DetailResult {
  rows: DetailRow[];
  total: number;
  note?: string;
  /** Why this view cannot show the list. */
  unavailable?: string;
}

export interface DetailListDef {
  title: string;
  columns: DetailColumn[];
  /** The filter chips; may depend on the period (e.g. its months). */
  facets: (filters: PanelFilters) => DetailFacet[];
  fetch(db: Db, scope: Scope, filters: PanelFilters, req: DetailRequest): Promise<DetailResult>;
}

/** The chosen value of a facet, or its first option. */
export function facetValue(def: DetailListDef, filters: PanelFilters, req: DetailRequest, key: string): string {
  return req.facets[key] ?? def.facets(filters).find((f) => f.key === key)?.options[0]?.value ?? 'all';
}

export const ALL = { value: 'all', label: 'All' };
