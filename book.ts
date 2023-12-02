import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const namesSchema = z.array(z.string());

const names = namesSchema.parse(await Deno.readTextFile("./names.json").then((res) =>
  JSON.parse(res)
));

await Deno.writeTextFile(
    "src/PACKAGES.md",
    `# Packages

${names.map((name) => `* [${name}](https://npmjs.com/package/${name})`).join("\n")}
`
);
