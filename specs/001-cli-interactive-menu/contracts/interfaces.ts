/**
 * interfaces.ts — All supporting interfaces and types for the ScraperContract.
 *
 * This file is the source-of-truth for the data model defined in data-model.md.
 * Every provider, renderer, and CLI module depends only on these types.
 *
 * File: src/providers/interfaces.ts  (canonical location in the codebase)
 */

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Describes a single environment variable required by a provider.
 * Declared statically on the provider class; consumed by EnvService.
 */
export interface EnvCredential {
  /** Environment variable name. Must match [A-Z_][A-Z0-9_]* */
  key: string;
  /** Human-readable label shown in the interactive prompt */
  label: string;
  /** Additional description shown below the label */
  description: string;
  /** When true: mask input with *, never log raw value */
  sensitive: boolean;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export type ProgressStatus = 'pending' | 'success' | 'warning' | 'error';

/**
 * Emitted by providers during execution via ProgressCallback.
 * The CLI renderer consumes each event to update the visual section.
 */
export interface ProgressEvent {
  /** Unique step identifier within the provider run (e.g. 'login', 'fetch', 'download') */
  stepId: string;
  /** Human-readable message displayed in the progress bar label */
  label: string;
  /** Current status of this step */
  status: ProgressStatus;
  /** Current attempt number (1-based). Present during retry cycles. */
  attempt?: number;
  /** Maximum attempts allowed. Present during retry cycles. */
  maxAttempts?: number;
}

/**
 * Callback registered by the CLI; called by BaseScraper.emitProgress()
 * on every state change during a provider run.
 */
export type ProgressCallback = (event: ProgressEvent) => void;

// ---------------------------------------------------------------------------
// Document Metadata
// ---------------------------------------------------------------------------

/**
 * Metadata about a document found by fetchDocuments().
 * Passed as argument to download().
 */
export interface DocumentMetadata {
  /** Provider-scoped unique identifier for this document */
  id: string;
  /** Human-readable name; used to derive the ./documents/<slug>/ subdirectory */
  name: string;
  /** Direct download URL if known; undefined if download requires browser interaction */
  url?: string;
  /** Expected MIME type hint for early validation; undefined if unknown */
  mimeHint?: string;
}

// ---------------------------------------------------------------------------
// Scraper Results (discriminated union)
// ---------------------------------------------------------------------------

export interface FileResult {
  type: 'file';
  /** Absolute path to the saved file */
  filePath: string;
  /** Validated MIME type */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
}

export interface PaymentResult {
  type: 'payment';
  /** PIX copy-paste code */
  pixCode: string;
  /** Payload to generate the QR Code (may equal pixCode or be a URL) */
  pixQrData: string;
  /** Amount in cents (integer to avoid float precision issues) */
  amountCents: number;
  /** Due date in YYYY-MM-DD format */
  dueDate?: string;
}

export interface ErrorResult {
  type: 'error';
  message: string;
  cause?: unknown;
}

export type ScraperResult = FileResult | PaymentResult | ErrorResult;

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of attempts. Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms; doubles each attempt (1000 → 2000 → 4000). Default: 1000 */
  baseDelayMs?: number;
  /** Called before each retry with the current attempt number and the thrown error */
  onAttempt?: (attempt: number, error: Error) => void;
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export type MenuItemType = 'provider' | 'all' | 'back' | 'exit';

export interface MenuItem {
  label: string;
  type: MenuItemType;
  /** Required when type === 'provider'; must be registered in ProviderFactory */
  providerId?: string;
  /** Non-empty when this item opens a submenu */
  children?: MenuItem[];
}
