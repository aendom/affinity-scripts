# Affinity Scripts

Personal collection of scripts for **Affinity by Canva**, written with its JavaScript scripting SDK.

## Scripts

| Script | Description |
| --- | --- |
| [Export Layers](scripts/export-layers/) | Exports each layer as a separate JPG or PNG file, named after its layer name. |

## Repository structure

```
scripts/
  <script-name>/
    <script-name>.js   # the script
    README.md          # what it does, requirements, usage
```

## General requirements

- **Settings > Scripting > Enable Affinity Scripting** turned on.
- Scripts that read or write files need **Access the file system** enabled (gear icon next to **Run** in the Script Editor) and the target folder listed in **Settings > Scripting > File System access**.

## Installing a script

1. Open the **Script Editor** panel and click **New Script**.
2. Paste the contents of the script's `.js` file.
3. Click **Save As…** to add it to the **Scripts Library**.

## Adding a new script

1. Create `scripts/<script-name>/` using lowercase and hyphens.
2. Add `<script-name>.js` with a header comment describing what it does and its requirements.
3. Add a `README.md` following the same sections as the existing scripts.
4. Add a row to the table above.

## License

[MIT](LICENSE)
