/**
 * The app's surfaces, held by the A2UI SDK's MessageProcessor.
 *
 * Applying messages, binding, validation checks and turning presses into
 * actions are all the SDK's. This file only keeps a version number so React
 * knows when to redraw.
 */
import {MessageProcessor, type ActionPayload, type SurfaceModel} from '@a2ui/web_core/v1_0';
import type {ReactCatalogComponent} from '@a2ui/react';

import {expenseCatalog} from './catalog';

export class Surfaces {
  readonly processor: MessageProcessor<ReactCatalogComponent>;
  private listeners = new Set<() => void>();
  private version = 0;
  onPress: ((action: ActionPayload) => void) | null = null;
  readonly rejected: string[] = [];

  constructor() {
    this.processor = new MessageProcessor<ReactCatalogComponent>([expenseCatalog()], action => this.onPress?.(action), {
      errorHandler: error => {
        this.rejected.push(error.error.message);
        console.warn('[a2ui] rejected:', error.error.message);
      },
    });
    this.processor.onSurfaceCreated(() => this.bump());
    this.processor.onSurfaceDeleted(() => this.bump());
  }

  apply(messages: unknown[]): void {
    for (const m of messages) this.processor.processMessagesWithErrors([m]);
    this.bump();
  }

  get(id: string): SurfaceModel<ReactCatalogComponent> | undefined {
    return this.processor.getSurface(id);
  }

  clear(): void {
    for (const id of [...this.processor.getSurfaces().keys()]) {
      this.processor.processMessages([{version: '1.0', deleteSurface: {surfaceId: id}}]);
    }
    this.bump();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;
  private bump() {
    this.version += 1;
    for (const l of this.listeners) l();
  }
}
