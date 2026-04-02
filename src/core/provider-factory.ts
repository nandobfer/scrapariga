/**
 * provider-factory.ts — Factory for instantiating provider instances.
 *
 * Constitution Principle V (Factory Pattern):
 *   - CLI code MUST use ProviderFactory.create() to get a provider.
 *   - Direct `new SomeProvider()` outside this factory is forbidden in CLI code.
 */

import type { BaseScraper } from '../providers/base-scraper.js';

export class ProviderFactory {
  private readonly registry = new Map<string, () => BaseScraper>();

  /**
   * Register a provider factory function under a unique id.
   * The factory is called lazily each time create() is invoked.
   */
  register(id: string, factory: () => BaseScraper): void {
    this.registry.set(id, factory);
  }

  /**
   * Instantiate and return the provider registered under the given id.
   * Throws a descriptive error if the id is not registered.
   */
  create(id: string): BaseScraper {
    const factory = this.registry.get(id);
    if (!factory) {
      throw new Error(
        `ProviderFactory: unknown provider id "${id}". ` +
          `Registered: [${[...this.registry.keys()].join(', ')}]`,
      );
    }
    return factory();
  }

  /**
   * Returns true if the given id is registered.
   */
  has(id: string): boolean {
    return this.registry.has(id);
  }
}
