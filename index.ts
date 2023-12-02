import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import ProgressBar from "https://deno.land/x/progress@v1.3.4/mod.ts";
import { tgz } from "https://deno.land/x/compress@v0.4.4/mod.ts";
import { walk } from "https://deno.land/std@0.208.0/fs/walk.ts";

const info = ".___utp___info___";

const packageSchema = z.object({
  name: z.string(),
  version: z.string(),
  typings: z.string().optional().nullable(),
  types: z.string().optional().nullable(),
  files: z.array(z.string()).optional().nullable(),
  dist: z.object({
    tarball: z.string(),
    shasum: z.string(),
  }),
});

function normalizeName(name: string) {
  return name.startsWith("@") ? name.substring(1).replace("/", "__") : name;
}

async function isPackageTyped(pkg: z.infer<typeof packageSchema>) {
  if (
    typeof pkg.typings === "string" || typeof pkg.types === "string" ||
    (pkg.files !== null && pkg.files !== undefined && pkg.files.length > 0 &&
      pkg.files.some((file) => file.endsWith(".d.ts")))
  ) {
    return true;
  }

  // the files property doesnt exist, lets inspect the unzipped tarball
  for await (
    const entry of walk(
      `./.cache/${normalizeName(pkg.name)}__${pkg.version}/package`,
    )
  ) {
    if (entry.path.endsWith(".d.ts")) {
      return true;
    }
  }

  return false;
}

async function fetchAndUnzip(url: string, dir: string) {
  try {
    const res = await fetch(url);

    const body = res.body;

    if (body === null) {
      throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
    }

    const location = await Deno.makeTempFile();

    {
      const zip = await Deno.open(location, { create: true, write: true });
      await body.pipeTo(zip.writable);
    }

    await tgz.uncompress(location, dir);
  } catch (e) {
    console.error(e);

    await Deno.remove(dir, { recursive: true });
    await Deno.mkdir(dir, { recursive: true });

    await fetchAndUnzip(url, dir);
  }
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

        const flattenedName = normalizeName(name);

        // dts hit
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
          `./.cache/${flattenedName}__${version}/${info}`,
        ).catch(() => null);

        if (cacheInfo !== null) {
          if (progress) {
            progress.render(++pkgCount);
          }

          const parsedCacheInfo = packageSchema.parse(JSON.parse(cacheInfo));

          // cache hit - make sure that the package is not typed
          return await isPackageTyped(parsedCacheInfo) ? undefined : name;
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

        await Deno.mkdir(`./.cache/${flattenedName}__${version}`, {
          recursive: true,
        });

        await fetchAndUnzip(
          res.dist.tarball,
          `./.cache/${flattenedName}__${version}`,
        );

        await Deno.writeTextFile(
          `./.cache/${flattenedName}__${version}/${info}`,
          JSON.stringify(res),
        );

        if (progress) {
          progress.render(++pkgCount);
        }

        return await isPackageTyped(res) ? undefined : name;
      }),
  ).then((names) => names.filter((name) => name !== undefined));

  console.log(`\n${names.length} packages not typed`);

  await Deno.writeTextFile("./names.json", JSON.stringify(names, null, 2));
}
