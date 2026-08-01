import type { MaterialEmailApi } from "../shared/contracts";

declare global {
  interface Window {
    materialEmail: MaterialEmailApi;
  }
}

export {};

