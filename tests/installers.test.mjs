import test from "node:test";
import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";


async function executable(path, source) {
  await writeFile(path, source);
  await chmod(path, 0o755);
}

test("Linux installer downloads a compatible local Node release when the installed one is too old", async () => {
  const directory = await mkdtemp(join(tmpdir(), "poligome-installer-"));
  const project = join(directory, "project");
  const bin = join(directory, "bin");
  const marker = join(directory, "npm-arguments");
  const checksumMarker = join(directory, "checksum-verified");
  const tarDestination = join(directory, "tar-destination");

  try {
    await mkdir(project);
    await mkdir(bin);
    await cp(new URL("../install.sh", import.meta.url), join(project, "install.sh"));
    await chmod(join(project, "install.sh"), 0o755);

    await executable(join(bin, "node"), `#!/usr/bin/env bash
if [[ "\${1:-}" == "-e" ]]; then exit 1; fi
if [[ "\${1:-}" == "-p" ]]; then printf '20.19.5'; exit 0; fi
printf 'v20.19.5\\n'
`);
    await executable(join(bin, "npm"), `#!/usr/bin/env bash
printf 'system:%s\\n' "$*" > "$INSTALL_MARKER"
`);
    await executable(join(bin, "curl"), `#!/usr/bin/env bash
target=""
source="\${!#}"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" || "$1" == "--output" ]]; then target="$2"; shift 2; continue; fi
  shift
done
if [[ "$source" == *SHASUMS256.txt ]]; then
  printf '%s  %s\\n' deadbeef node-v22.13.1-linux-x64.tar.xz > "$target"
else
  touch "$target"
fi
`);
    await executable(join(bin, "sha256sum"), `#!/usr/bin/env bash
printf 'verified\\n' > "$CHECKSUM_MARKER"
`);
    await executable(join(bin, "uname"), `#!/usr/bin/env bash
printf 'x86_64\\n'
`);
    await executable(join(bin, "tar"), `#!/usr/bin/env bash
while [[ $# -gt 0 ]]; do
if [[ "$1" == "-C" ]]; then destination="$2"; break; fi
  shift
done
printf '%s\\n' "$destination" > "$TAR_DESTINATION"
mkdir -p "$destination/bin"
cat > "$destination/bin/node" <<'NODE'
#!/usr/bin/env bash
if [[ "\${1:-}" == "-e" ]]; then exit 0; fi
if [[ "\${1:-}" == "-p" ]]; then printf '22.13.1'; exit 0; fi
printf 'v22.13.1\\n'
NODE
cat > "$destination/bin/npm" <<'NPM'
#!/usr/bin/env bash
printf 'downloaded:%s\\n' "$*" > "$INSTALL_MARKER"
NPM
chmod +x "$destination/bin/node" "$destination/bin/npm"
`);

    const result = spawnSync("bash", ["./install.sh"], {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        XDG_CACHE_HOME: join(directory, "cache"),
        INSTALL_MARKER: marker,
        CHECKSUM_MARKER: checksumMarker,
        TAR_DESTINATION: tarDestination,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Downloading Node\.js/);
    assert.match(result.stdout, /Run: PATH=.*node-v22\.13\.1-linux-x64\/bin:\$PATH.*npm run dev/);
    assert.equal(await readFile(checksumMarker, "utf8"), "verified\n");
    assert.match(await readFile(tarDestination, "utf8"), new RegExp(`^${join(directory, "cache", "poligome").replaceAll("/", "\\/")}`));
    assert.equal(await readFile(marker, "utf8"), "downloaded:ci\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
