export type PackageStatus = "loaded" | "not_loaded";

export type ResolvedPackage = {
  /** The raw entry from settings.json packages array */
  entry: string;
  /** Package name from package.json or basename */
  name: string;
  /** Absolute path on disk */
  resolvedPath: string;
  /** Which settings.json this came from */
  scope: "global" | "project";
  status: PackageStatus;
  manifest?: {
    description?: string;
    extensions?: string[];
    skills?: string[];
    prompts?: string[];
    themes?: string[];
  };
  error?: string;
};
