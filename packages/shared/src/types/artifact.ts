import type { ArtifactType, ArtifactStatus, ArtifactVersionSource } from "../constants.js";

export interface Artifact {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  type: ArtifactType;
  status: ArtifactStatus;
  currentVersionId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArtifactVersion {
  id: string;
  artifactId: string;
  versionNumber: number;
  source: ArtifactVersionSource;
  sourceDetail: string | null;
  changelog: string | null;
  parentVersionId: string | null;
  content: string | null;
  fileUrl: string | null;
  createdAt: Date;
}
