/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export class RoomCodeGenerator {
  private static activeCodes = new Set<string>();

  /**
   * Generates a 6-character alphanumeric room code containing only uppercase letters and digits.
   * Matches examples like: ABC123, X9K7PQ, RACE42
   */
  public static generateCode(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Checks Firebase before returning to guarantee a completely unique, non-colliding code.
   */
  public static async generateUnique(attemptsRemaining = 15): Promise<string> {
    if (attemptsRemaining <= 0) {
      throw new Error("Unique room code allocation exhausted. Please retry.");
    }

    const code = this.generateCode();

    // Check real-time Firebase DB presence
    const docRef = doc(db, "rooms", code);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return this.generateUnique(attemptsRemaining - 1);
    }

    return code;
  }

  // Backwards compatibility methods
  public static generate(): string {
    return this.generateCode();
  }

  public static release(code: string): void {
    this.activeCodes.delete(code.toUpperCase());
  }

  public static reserve(code: string): boolean {
    const uppercase = code.toUpperCase();
    if (this.activeCodes.has(uppercase)) return false;
    this.activeCodes.add(uppercase);
    return true;
  }
}
