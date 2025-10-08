import * as fs from 'fs';
import * as path from 'path';
import { CACHE_PATHS } from '../../utils/constants';

/**
 * Base class for all operations with common functionality
 */
export abstract class BaseOperation {
  /**
   * Ensure cache directory exists
   */
  protected ensureCacheDir(): void {
    if (!fs.existsSync(CACHE_PATHS.DIRECTORY)) {
      fs.mkdirSync(CACHE_PATHS.DIRECTORY, { recursive: true });
    }
  }

  /**
   * Save data to cache file
   */
  protected saveToCache<T>(filePath: string, data: T): void {
    this.ensureCacheDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Load data from cache file
   */
  protected loadFromCache<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error) {
      console.error(`Failed to load cache from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Check if file exists
   */
  protected fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  /**
   * Log progress for array operations
   */
  protected logProgress(current: number, total: number, message: string): void {
    console.log(`[${current}/${total}] ${message}`);
  }

  /**
   * Log error with context
   */
  protected logError(context: string, error: unknown): void {
    console.error(`Error in ${context}:`, error);
    if (error instanceof Error) {
      console.error(`  Message: ${error.message}`);
      if (error.stack) {
        console.error(`  Stack: ${error.stack}`);
      }
    }
  }

  /**
   * Log success message
   */
  protected logSuccess(message: string): void {
    console.log(`✓ ${message}`);
  }
}
