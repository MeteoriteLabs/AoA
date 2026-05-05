export type { InstanceGeneralSettings, InstanceExperimentalSettings } from "../validators/instance.js";
import type { InstanceGeneralSettings, InstanceExperimentalSettings } from "../validators/instance.js";

export interface InstanceSettings {
  id: string;
  general: InstanceGeneralSettings;
  experimental: InstanceExperimentalSettings;
  createdAt: Date;
  updatedAt: Date;
}
