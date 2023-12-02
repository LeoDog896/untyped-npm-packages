import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import ProgressBar from "https://deno.land/x/progress@v1.3.4/mod.ts";

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
  }));

  const packageSchema = z.object({
    typings: z.string().optional().nullable(),
  });

  const progress = Deno.isatty(Deno.stdout.rid)
    ? new ProgressBar({
      title: "Package progress:",
      total: 10_000,
    })
    : undefined;

  let pkgCount = 0;

  const names = dataSchema.parse(JSON.parse(data)).map((item) => item.name)
    .filter(async (name) => {
      if (name === null) {
        console.error("Null name");
        Deno.exit(1);
      }

      const flattenedName = name.startsWith("@") ? name.substring(1).replace("/", "__") : name;

      if (
        await Deno.stat(`./DefinitelyTyped/types/${flattenedName}`).catch(() => null) !==
          null
      ) {
        if (progress) {
          progress.render(++pkgCount);
        }

        return false
      }

      let res: z.infer<typeof packageSchema> | undefined;
      while (res === undefined) {
        try {
          res = packageSchema.parse(
            await fetch(`http://registry.npmjs.org/${name}/latest`).then((res) =>
              res.json()
            ),
          );
        } catch (e) {
          console.error(e);
        }
      }

      if (progress) {
        progress.render(++pkgCount);
      }

      return res.typings === undefined;
    });

  await Deno.writeTextFile("./names.json", JSON.stringify(names));
}
