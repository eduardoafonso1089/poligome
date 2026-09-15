# Local Poligome reinstall on Windows

This guide describes how to recreate the local environment and start the
application on Windows. Run the commands in PowerShell or Command Prompt.

## Requirements

- Git
- Node.js 22.13 or newer
- npm

Check the versions:

```powershell
git --version
node --version
npm.cmd --version
```

## Normal installation

```powershell
cd <your-projects-folder>
git clone https://github.com/eduardoafonso1089/poligome.git
cd poligome
npm.cmd ci
```

`npm ci` installs exactly the versions recorded in `package-lock.json`. The
`node_modules` directory is not part of Git and has to be recreated after a
fresh clone.

## Workaround for certificate errors or HTTP 403

On some networks the official npm registry may return
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` or block a tarball with HTTP 403. Use the
mirror for that single run:

```powershell
npm.cmd ci --registry=https://registry.npmmirror.com --strict-ssl=false
```

This does not change the npm configuration permanently. Although TLS validation
is disabled during the download, npm still checks the integrity hashes recorded
in `package-lock.json`. Prefer plain `npm.cmd ci` whenever the network
certificate is correctly installed.

## Starting the application

The repository's `npm run dev` script uses Linux environment-variable syntax. On
Windows, run Vite directly:

```powershell
.\node_modules\.bin\vite.cmd --host 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5173/
```

To stop it, press `Ctrl+C` in the terminal where Vite is running.

## Reinstalling dependencies without cloning again

Inside the project folder:

```powershell
npm.cmd ci
```

If the network blocks the official registry again, reuse the command with
`--registry` and `--strict-ssl=false` shown above.
