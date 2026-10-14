'use strict';

// =====================================================================
//  Export Layers — Affinity by Canva (Scripting)
//  Exports each top-level layer as a separate file, named after its
//  name in the Layers panel.
//  - Format: any JPEG or PNG export preset (e.g. "JPEG (Best quality)")
//  - Folder: type a path or pick an existing folder
//  - Area: full canvas (document size) or cropped to the layer
//
//  Requirements: scripting enabled, file system access for this script,
//  and a destination inside a folder allowed in
//  Settings > Scripting > File System access.
// =====================================================================

const { app } = require('/application');
const { Document, FileExportOptions, FileExportArea } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { fs } = require('/fs.js');
const { Environment } = require('/environment.js');

// ---------- helpers ----------
function isOk(result) {
    return (result?.value ?? result) == DialogResult.Ok.value;
}

const SEP = (app.userDesktopPath || '').includes('\\') ? '\\' : '/';

function joinPath(dir, name) {
    const clean = dir.replace(/[\\/]+$/, '');
    return clean + SEP + name;
}

function dirName(path) {
    const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
    return i > 0 ? path.slice(0, i) : path;
}

function safeFileName(name) {
    let n = (name || 'layer').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    n = n.replace(/[. ]+$/, '');            // Windows rejects trailing dots/spaces
    return n.length ? n : 'layer';
}

function layerName(node) {
    return node.userDescription || node.description || node.defaultDescription || 'layer';
}

function docBaseName(doc) {
    const t = (doc.title || 'document').replace(/\.[^.]+$/, '');
    return safeFileName(t);
}

// ---------- main ----------
async function run() {
    const doc = Document.current;
    if (!doc) {
        app.alert('Open a document before running this script.', 'Export Layers');
        return;
    }

    // Permissions and allowed folders (Settings > Scripting > File System access).
    // Diagnostics only: we don't stop here; any real error surfaces during export.
    let roots = [];
    try { roots = Environment.fileSystemRoots || []; } catch (_) {}
    try { console.log('Permissions: ' + JSON.stringify(Environment.permissions)); } catch (_) {}
    console.log('Allowed folders: ' + (roots.join(' | ') || '(none)'));

    const layers = doc.layers.toArray();
    if (layers.length === 0) {
        app.alert('The document has no layers.', 'Export Layers');
        return;
    }

    // JPEG / PNG export presets available in this installation
    const presets = FileExportOptions.allPresetNames
        .filter(n => /jpe?g|png/i.test(n));
    if (presets.length === 0) {
        app.alert('No JPEG or PNG export presets were found.', 'Export Layers');
        return;
    }
    let defaultPreset = presets.findIndex(n => /jpe?g.*best/i.test(n));
    if (defaultPreset < 0) defaultPreset = 0;

    // Initial folder: the first allowed folder from Settings
    const defaultFolder = roots.length ? roots[0] : '';

    const norm = p => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const isAllowed = p => !roots.length || roots.some(r => {
        const nr = norm(r), np = norm(p);
        return np === nr || np.startsWith(nr + '\\');
    });

    // ---------- dialog ----------
    const dlg = Dialog.create('Export Layers');
    dlg.initialWidth = 480;
    const col = dlg.addColumn();

    const gFmt = col.addGroup('Format');
    const cFormat = gFmt.addComboBox('Preset', presets, defaultPreset);

    const gDest = col.addGroup('Destination');
    const tFolder = gDest.addTextBox('Folder', defaultFolder);
    const bPick = gDest.addButton('Choose folder…');
    gDest.addStaticText('', 'Tip: in "Choose folder…" select any file inside the target folder. ' +
                            'You can also type a new path and the script will try to create it.');

    const gOpt = col.addGroup('Options');
    const cArea = gOpt.addButtonSet('Area', ['Full canvas', 'Layer only'], 0);
    const sHidden = gOpt.addSwitch('Include hidden layers', true);
    const sPrefix = gOpt.addSwitch('Number files (01_, 02_ …) in panel order', false);

    bPick.onClickHandler = () => {
        try {
            const picked = app.chooseFile();
            const p = typeof picked === 'string' ? picked : (picked?.path ?? '');
            if (p) tFolder.text = dirName(p);
        } catch (e) {
            console.log('chooseFile failed: ' + e);
        }
    };

    if (!isOk(dlg.runModal())) return;

    // ---------- read options ----------
    const presetName = presets[cFormat.selectedIndex];
    const isPng = /png/i.test(presetName);
    const ext = isPng ? '.png' : '.jpg';
    const onlyLayer = cArea.selectedIndex === 1;
    const includeHidden = sHidden.value;
    const numbered = sPrefix.value;

    let folder = (tFolder.text || '').trim().replace(/^"|"$/g, '');
    if (!folder) {
        app.alert('Choose or type a destination folder.', 'Export Layers');
        return;
    }

    if (!isAllowed(folder)) {
        app.alert('Affinity does not allow scripts to write to:\n' + folder +
                  '\n\nAllowed folders:\n' + roots.join('\n') +
                  '\n\nAdd the folder in Settings > Scripting > File System access > Add, ' +
                  'or choose a folder inside one of the allowed ones.', 'Export Layers');
        return;
    }

    // ---------- create folder (if missing) ----------
    // Uses the sync API: the async versions throw NO_ENVIRONMENT in the Script Editor.
    // No-op if the folder exists. On failure we continue; the export will report the error.
    try { fs.createDirectories(folder); } catch (e) { console.log('createDirectories: ' + e); }

    // ---------- export ----------
    // The Layers panel lists the top layer first; doc.layers goes bottom to top.
    const panelOrder = layers.slice().reverse();
    const originalVisibility = layers.map(n => n.isVisible);
    const options = FileExportOptions.createWithPresetName(presetName);

    const usedNames = new Set();
    const ok = [], failed = [];

    try {
        // Hide everything once
        for (const n of layers) if (n.isVisible) doc.setVisible(false, n.selfSelection);

        panelOrder.forEach((node, i) => {
            const wasVisible = originalVisibility[layers.indexOf(node)];
            if (!includeHidden && !wasVisible) return;

            let base = safeFileName(layerName(node));
            if (numbered) base = String(i + 1).padStart(2, '0') + '_' + base;
            let name = base, k = 2;
            while (usedNames.has(name.toLowerCase())) name = base + '_' + (k++);
            usedNames.add(name.toLowerCase());
            const path = joinPath(folder, name + ext);

            try {
                doc.setVisible(true, node.selfSelection);
                const area = onlyLayer
                    ? FileExportArea.createForSelection(node.selfSelection)
                    : FileExportArea.createForWholeDocument();
                const records = doc.export(path, options, area, null);
                const errs = (records?.all || []).filter(r => r.errorMessage);
                if (errs.length) failed.push(name + ': ' + errs[0].errorMessage);
                else ok.push(name + ext);
            } catch (e) {
                failed.push(name + ': ' + e);
            } finally {
                doc.setVisible(false, node.selfSelection);
            }
        });
    } finally {
        // Restore original visibility
        layers.forEach((n, i) => {
            try { doc.setVisible(originalVisibility[i], n.selfSelection); } catch (_) {}
        });
    }

    // ---------- summary ----------
    let msg = 'Exported ' + ok.length + ' file(s) as "' + presetName + '" to:\n' + folder;
    if (failed.length) msg += '\n\nFailed ' + failed.length + ':\n' + failed.join('\n');
    if (failed.length && !ok.length)
        msg += '\n\nCheck that the folder exists (create it in File Explorer if needed) ' +
               'and that it is inside an allowed folder in Settings > Scripting.';
    console.log(msg);
    app.alert(msg, 'Export Layers');
}

run().catch(e => {
    console.log(e?.stack || String(e));
    app.alert('Error: ' + e, 'Export Layers');
});
