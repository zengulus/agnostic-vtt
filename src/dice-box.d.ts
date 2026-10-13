declare module '@3d-dice/dice-box-threejs' {
  export interface DiceResult {
    total: number;
    sets: Array<{ rolls: Array<{ value: number; sides: number }> }>;
  }
  export default class DiceBox {
    constructor(selector: string, options: Record<string, unknown>);
    initialize(): Promise<void>;
    roll(notation: string): Promise<DiceResult>;
    clearDice(): void;
    setDimensions(dimensions?: { x: number; y: number }): void;
    running: number | boolean;
    renderer: { dispose(): void; forceContextLoss(): void; domElement: HTMLCanvasElement };
    diceList: Array<{
      geometry: { dispose(): void };
      material: Array<{ dispose(): void; map?: { dispose(): void } }>;
    }>;
  }
}
