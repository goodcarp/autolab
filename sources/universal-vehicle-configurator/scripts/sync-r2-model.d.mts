export interface CanonicalR2ModelPath {
  fileName: string;
  source: string;
  mirror: string;
}

export interface CanonicalR2ModelResult {
  checked: string[];
  canonicalDirectory: "public/garage/src";
  mirrorDirectory: "src/scene/r2";
}

export interface CanonicalR2ModelSyncResult extends CanonicalR2ModelResult {
  updated: string[];
}

export function getCanonicalR2ModelPaths(projectRoot?: string): CanonicalR2ModelPath[];
export function checkCanonicalR2Model(
  projectRoot?: string,
): Promise<CanonicalR2ModelResult>;
export function syncCanonicalR2Model(
  projectRoot?: string,
): Promise<CanonicalR2ModelSyncResult>;
