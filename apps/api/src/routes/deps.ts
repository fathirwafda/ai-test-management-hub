import type { AppConfig } from "../config.js";
import type { AiService } from "../ai/service.js";
import type { EvidenceStore } from "../lib/evidence-store.js";
import type { Store } from "../repos/store.js";

export interface Deps {
  config: AppConfig;
  store: Store;
  evidence: EvidenceStore;
  ai: AiService;
}
