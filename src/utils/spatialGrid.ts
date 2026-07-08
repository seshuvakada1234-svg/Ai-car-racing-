import { CarState } from "../types";

export class SpatialGrid {
  private cellSize: number;
  private grid: Map<string, CarState[]>;

  constructor(cellSize = 20) {
    this.cellSize = cellSize;
    this.grid = new Map();
  }

  public clear(): void {
    this.grid.clear();
  }

  private getCellKey(x: number, z: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx},${cz}`;
  }

  public insert(car: CarState): void {
    const key = this.getCellKey(car.position.x, car.position.z);
    let cell = this.grid.get(key);
    if (!cell) {
      cell = [];
      this.grid.set(key, cell);
    }
    cell.push(car);
  }

  /**
   * Retrieves all other cars occupying the same cell or adjacent 8 neighboring cells
   */
  public getNearby(car: CarState): CarState[] {
    const cx = Math.floor(car.position.x / this.cellSize);
    const cz = Math.floor(car.position.z / this.cellSize);
    const nearby: CarState[] = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${cx + dx},${cz + dz}`;
        const cell = this.grid.get(key);
        if (cell) {
          for (const other of cell) {
            if (other.id !== car.id) {
              nearby.push(other);
            }
          }
        }
      }
    }
    return nearby;
  }
}
