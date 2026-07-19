import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildGymImage } from "./buildGymImage.js";
import { resolveGymImageTag } from "./resolveGymImageTag.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const image = await resolveGymImageTag(repositoryRoot);

await buildGymImage(image, repositoryRoot);
