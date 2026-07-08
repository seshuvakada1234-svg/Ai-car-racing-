/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class AssetVerifier {
  /**
   * Simple check of local file blob validation
   */
  public static async verifyBlob(blob: Blob, expectedSize?: number): Promise<boolean> {
    if (!blob) return false;

    // Incomplete, stub or 0-size files are invalid
    if (blob.size <= 100) return false;

    // Check if it's text under the hood instead of binary GLB
    const header = await blob.slice(0, 4).text();
    if (header.startsWith("<") || header.startsWith("{") || header.startsWith("html") || header.startsWith("#")) {
      return false;
    }

    if (expectedSize !== undefined && expectedSize > 0) {
      // Allow +/- 5% difference in actual byte length to deal with compression headers safely
      const ratio = blob.size / expectedSize;
      if (ratio < 0.8 || ratio > 1.2) {
        return false;
      }
    }

    return true;
  }
}
