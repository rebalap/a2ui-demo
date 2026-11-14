/**
 * The expense catalog, as the A2UI SDK renders it.
 *
 * The schema is `catalog/catalog.json`, the same document the server validates
 * against. Basic components (Text, Column, TextField, Button…) are the SDK's
 * own; the four expense components are ours, in `components.tsx`.
 */
import {Catalog, type CatalogApi, type ComponentApi, type FunctionApi, type FunctionImplementation} from '@a2ui/web_core/v1_0';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {createComponentImplementation, type ReactCatalogComponent} from '@a2ui/react';

import catalogDocument from '../../catalog/catalog.json';
import {EXPENSE_VIEWS} from './components';

let built: Catalog<ReactCatalogComponent, FunctionImplementation> | null = null;

export function expenseCatalog(): Catalog<ReactCatalogComponent, FunctionImplementation> {
  if (built) return built;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schemas: CatalogApi = Catalog.fromJson(catalogDocument as any);
  const components = [...schemas.components.entries()].map(([name, api]) => {
    const fromSdk = basicCatalog.components.get(name);
    if (fromSdk) return fromSdk;
    const view = EXPENSE_VIEWS[name];
    if (!view) throw new Error(`The catalog offers ${name}, and nothing here draws it.`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createComponentImplementation(api, view as any);
  });
  const functions = [...schemas.functions.entries()].map(([name]) => {
    const fromSdk = basicCatalog.functions.get(name);
    if (!fromSdk) throw new Error(`The catalog offers ${name}(), and nothing here evaluates it.`);
    return fromSdk;
  });
  built = (schemas as Catalog<ComponentApi, FunctionApi>).withEntries(
    components as never,
    functions as never,
  ) as unknown as Catalog<ReactCatalogComponent, FunctionImplementation>;
  return built;
}
