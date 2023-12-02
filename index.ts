import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import ProgressBar from "https://deno.land/x/progress@v1.3.4/mod.ts";

const packageSchema = z.object({
  typings: z.string().optional().nullable(),
  types: z.string().optional().nullable(),
  files: z.array(z.string()).optional().nullable(),
});

function isPackageTyped(pkg: z.infer<typeof packageSchema>) {
  return typeof pkg.typings === "string" || typeof pkg.types === "string" ||
    (pkg.files !== null && pkg.files !== undefined && pkg.files.length > 0 &&
      pkg.files.some((file) => file.endsWith(".d.ts")));
}

// Get DefinitelyTyped data
{
  const url = "https://github.com/DefinitelyTyped/DefinitelyTyped.git";

  const cmd = new Deno.Command("git", {
    args: ["clone", "--depth=1", url, "./DefinitelyTyped"],
    stdin: "piped",
    stdout: "inherit",
  });

  const child = cmd.spawn();
  await child.status;
}

// Fetch NPM data
{
  const hash = await fetch(
    "https://github.com/LeoDog896/npm-rank/releases/download/latest/raw.json.hash",
  ).then((res) => res.text());

  const existingHash = await Deno.readTextFile("./raw.json.hash").catch(() =>
    ""
  );

  if (hash === existingHash) {
    console.log("No new data");
  } else {
    console.log("New data");
    await Deno.writeTextFile("./raw.json.hash", hash);
    const data = await fetch(
      "https://github.com/LeoDog896/npm-rank/releases/download/latest/raw.json",
    ).then((res) => res.text());
    await Deno.writeTextFile("./raw.json", data);
  }

  const data = await Deno.readTextFile("./raw.json");

  const dataSchema = z.array(z.object({
    name: z.string(),
    version: z.string(),
  }));

  const progress = Deno.isatty(Deno.stdout.rid)
    ? new ProgressBar({
      title: "Package progress:",
      total: 10_000,
    })
    : undefined;

  let pkgCount = 0;

  await Deno.mkdir("./.cache", { recursive: true });

  const names = await Promise.all(
    dataSchema.parse(JSON.parse(data))
      .map(async ({ name, version }) => {
        if (name === null) {
          console.error("Null name");
          Deno.exit(1);
        }

        const flattenedName = name.startsWith("@")
          ? name.substring(1).replace("/", "__")
          : name;

        if (
          await Deno.stat(`./DefinitelyTyped/types/${flattenedName}`).catch(
            () => null,
          ) !==
            null
        ) {
          if (progress) {
            progress.render(++pkgCount);
          }

          return undefined;
        }

        const cacheInfo = await Deno.readTextFile(
          `./.cache/${flattenedName}__${version}`,
        ).catch(() => null);

        if (cacheInfo !== null) {
          if (progress) {
            progress.render(++pkgCount);
          }

          const parsedCacheInfo = packageSchema.parse(JSON.parse(cacheInfo));

          // cache hit - make sure that the package is not typed
          return isPackageTyped(parsedCacheInfo) ? undefined : name;
        }

        let res: z.infer<typeof packageSchema> | undefined;
        while (res === undefined) {
          try {
            res = packageSchema.parse(
              await fetch(`http://registry.npmjs.org/${name}/${version}`).then((
                res,
              ) => res.json()),
            );
          } catch (e) {
            console.error(e);
          }
        }

        if (progress) {
          progress.render(++pkgCount);
        }

        await Deno.writeTextFile(
          `./.cache/${flattenedName}__${version}`,
          JSON.stringify(res),
        );

        return isPackageTyped(res) ? undefined : name;
      }),
  ).then((names) => names.filter((name) => name !== undefined));

  console.log(`\n${names.length} packages not typed`);

  await Deno.writeTextFile("./names.json", JSON.stringify(names, null, 2));
}
